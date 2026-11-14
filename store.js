// Group sync. Two backends with the same tiny API:
//   create(id, data) · set(id, 'a/b/c', value) · subscribe(id, cb) -> unsubscribe
// - local:    localStorage + storage events (tabs on one device; free, zero setup)
// - firebase: Firebase Realtime Database REST + Server-Sent Events (free Spark plan, no SDK)

export function setPath(obj, path, value) {
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return value;
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null) o[parts[i]] = {};
    o = o[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (value === null || value === undefined) delete o[last];
  else o[last] = value;
  return obj;
}

export function createStore(cfg = {}) {
  return cfg.firebaseUrl ? firebaseStore(cfg.firebaseUrl) : localStore();
}

function localStore() {
  const key = id => 'khao:g:' + id;
  const read = id => { try { return JSON.parse(localStorage.getItem(key(id)) || 'null'); } catch { return null; } };
  const write = (id, s) => localStorage.setItem(key(id), JSON.stringify(s));
  const subs = new Map();
  const pending = new Set();
  // Coalesce notifications so a burst of writes renders once.
  const notify = id => {
    if (pending.has(id)) return;
    pending.add(id);
    queueMicrotask(() => { pending.delete(id); const s = read(id); (subs.get(id) || []).forEach(cb => cb(s)); });
  };
  addEventListener('storage', e => { if (e.key && e.key.startsWith('khao:g:')) notify(e.key.slice(7)); });

  return {
    mode: 'local',
    async create(id, data) { write(id, data); notify(id); },
    async set(id, path, value) {
      const s = read(id) || {};
      write(id, setPath(s, path, value));
      notify(id);
    },
    subscribe(id, cb) {
      if (!subs.has(id)) subs.set(id, new Set());
      subs.get(id).add(cb);
      notify(id);
      return () => subs.get(id).delete(cb);
    },
  };
}

function firebaseStore(base) {
  base = base.replace(/\/+$/, '');
  const put = (url, value) => fetch(url, { method: 'PUT', body: JSON.stringify(value ?? null) })
    .then(r => { if (!r.ok) throw new Error('Sync failed: ' + r.status); });

  return {
    mode: 'cloud',
    create: (id, data) => put(`${base}/groups/${id}.json`, data),
    set: (id, path, value) => put(`${base}/groups/${id}/${path}.json`, value),
    subscribe(id, cb) {
      let state = null, es = null, retry = null, closed = false;
      const apply = (type, e) => {
        const { path, data } = JSON.parse(e.data);
        if (type === 'put') {
          state = path === '/' ? data : setPath(state || {}, path, data);
        } else {
          state = state || {};
          for (const [k, v] of Object.entries(data || {})) setPath(state, `${path}/${k}`, v);
        }
        cb(state ? structuredClone(state) : null);
      };
      // Phones sleep and switch networks; a dropped stream would freeze the squad, so reopen it.
      // Firebase re-sends the whole group on connect, so nothing is missed.
      const open = () => {
        if (closed) return;
        es?.close();
        es = new EventSource(`${base}/groups/${id}.json`);
        es.addEventListener('put', e => apply('put', e));
        es.addEventListener('patch', e => apply('patch', e));
        es.addEventListener('cancel', () => { clearTimeout(retry); retry = setTimeout(open, 3000); });
        es.onerror = () => { if (es.readyState === EventSource.CLOSED) { clearTimeout(retry); retry = setTimeout(open, 2000); } };
      };
      const wake = () => { if (!document.hidden && (!es || es.readyState === EventSource.CLOSED)) open(); };
      document.addEventListener('visibilitychange', wake);
      addEventListener('online', open);
      open();
      return () => {
        closed = true;
        clearTimeout(retry);
        es?.close();
        document.removeEventListener('visibilitychange', wake);
        removeEventListener('online', open);
      };
    },
  };
}
