import { CUISINES, CUISINE_BY_ID, BUDGETS, DIETS, SPICE, ALLERGIES, AVATAR_TONES, BOT_NAMES } from './data.js';
import { createStore } from './store.js';
import { geocode, reverseGeocode, findRestaurants } from './places.js';

const store = createStore(window.KHAO_CONFIG || {});
const STAGES = ['lobby', 'dates', 'prefs', 'place', 'cuisines', 'restaurants', 'results'];
const GATED = ['dates', 'prefs', 'place', 'cuisines', 'restaurants'];
const LABEL = { lobby: 'Squad', dates: 'Dates', prefs: 'Prefs', place: 'Spot + ₹', cuisines: 'Cuisines', restaurants: 'Places', results: 'The match' };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rid = (n = 6) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
const pad = n => String(n).padStart(2, '0');

const app = $('#app');
let gid = null, G = null, me = null, unsub = null;
let current = { key: null, view: null };
let keyHandler = null;
let sheetRid = null;
const advanced = new Set();
const botTimers = new Set();
let fetching = false;

// ---------- identity (per tab in local mode so tabs act as different people)
const idStore = () => store.mode === 'local' ? sessionStorage : localStorage;
const getMe = id => { try { return idStore().getItem('khao:me:' + id); } catch { return null; } };
const setMe = (id, u) => { try { idStore().setItem('khao:me:' + id, u); } catch {} };
const savedName = () => { try { return localStorage.getItem('khao:name') || ''; } catch { return ''; } };
const saveName = n => { try { localStorage.setItem('khao:name', n); } catch {} };

const set = (path, value) => store.set(gid, path, value).catch(e => toast(e.message));
const shareLink = () => `${location.origin}${location.pathname}#/g/${gid}`;
const members = () => Object.entries(G?.members || {}).sort((a, b) => a[1].joinedAt - b[1].joinedAt);
const memberName = u => G?.members?.[u]?.name || 'Someone';
const isHost = () => G?.host === me;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}

function avatar(u, m, extra = '') {
  return `<span class="av ${extra}" style="--tone:${m.color}" title="${esc(m.name)}">${esc(m.name.slice(0, 1).toUpperCase())}</span>`;
}

// ---------- routing + render loop
function route() {
  unsub?.();
  unsub = null; G = null; current = { key: null, view: null };
  closeSheet();
  const m = location.hash.match(/^#\/g\/([a-z0-9]+)/i);
  if (!m) { gid = null; renderHeader(); return mount('home', viewHome()); }
  gid = m[1];
  me = getMe(gid);
  mount('loading', { html: `<div class="center-msg"><div class="spinner"></div><p class="eyebrow">Loading squad</p></div>` });
  unsub = store.subscribe(gid, s => { try { onState(s); } catch (e) { console.error('KHAO', e); } });
}
addEventListener('hashchange', route);

function mount(key, view) {
  app.innerHTML = view.html;
  app.classList.remove('enter'); void app.offsetWidth; app.classList.add('enter');
  keyHandler = view.onKey || null;
  view.init?.(app);
  current = { key, view };
  renderHeader();
  scrollTo(0, 0);
}

function show(key, factory) {
  if (current.key === key) { current.view.update?.(); renderHeader(); return; }
  mount(key, factory());
}

function onState(s) {
  G = s;
  if (!s) return show('notfound', viewNotFound);
  me = getMe(gid);
  if (!me || !s.members?.[me]) return show(s.stage === 'lobby' ? 'join' : 'locked', s.stage === 'lobby' ? viewJoin : viewLocked);
  runBots();
  if (sheetRid) renderSheetReviews();
  const done = GATED.includes(s.stage) && !!s.done?.[s.stage]?.[me];
  let key = s.stage + (done ? ':wait' : '') + (done && allDone() ? ':all' : '');
  if (s.stage === 'restaurants' && !done) {
    key += s.restaurants ? ':deck' : ':load';
    if (!s.restaurants) ensureRestaurants();
  }
  const factory = done ? viewWaiting : s.stage === 'restaurants' && !s.restaurants ? viewScouting : VIEWS[s.stage];
  show(key, factory);
}

const allDone = () => {
  const ids = Object.keys(G.members || {});
  return ids.length > 0 && ids.every(u => G.done?.[G.stage]?.[u]);
};
function advance(from) {
  if (G.stage !== from) return;
  advanced.add(from);
  set('stage', STAGES[STAGES.indexOf(from) + 1]);
}

function renderHeader() {
  const el = $('#progress');
  const inGroup = G && me && G.members?.[me];
  if (!inGroup) { el.innerHTML = ''; $('#stepLabel').textContent = ''; return; }
  const i = STAGES.indexOf(G.stage);
  $('#stepLabel').textContent = `${pad(i + 1)}/${pad(STAGES.length)} · ${LABEL[G.stage]}`;
  el.innerHTML = STAGES.map((s, k) => `<i class="${k < i ? 'past' : k === i ? 'now' : ''}"></i>`).join('');
}

addEventListener('keydown', e => { if (keyHandler && !e.target.closest('input,textarea')) keyHandler(e); });

// ---------- shared bits
function stageHead(n, eyebrow, title, lede = '') {
  return `<header class="stage-head">
    <p class="eyebrow"><b>${pad(n)}</b> — ${eyebrow}</p>
    <h2 class="title">${title}</h2>
    ${lede ? `<p class="lede">${lede}</p>` : ''}
  </header>`;
}

function memberStatus(stage) {
  return `<ul class="roster">${members().map(([u, m]) => {
    const done = stage ? !!G.done?.[stage]?.[u] : true;
    return `<li class="${done ? 'done' : ''}">${avatar(u, m)}<span>${esc(m.name)}${u === me ? ' <em>(you)</em>' : ''}${u === G.host ? ' <em>· host</em>' : ''}</span><b>${done ? '✓' : '···'}</b></li>`;
  }).join('')}</ul>`;
}

function nextDays(n) {
  const out = [], d = new Date();
  d.setHours(12, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    out.push({
      iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      dow: d.toLocaleDateString('en-IN', { weekday: 'short' }),
      day: d.getDate(),
      mon: d.toLocaleDateString('en-IN', { month: 'short' }),
      weekend: d.getDay() === 0 || d.getDay() === 6,
      rel: i === 0 ? 'Today' : i === 1 ? 'Tmrw' : '',
    });
    d.setDate(d.getDate() + 1);
  }
  return out;
}
const fmtDate = iso => new Date(iso + 'T12:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

function dateTally() {
  const tally = {};
  for (const days of Object.values(G.dates || {})) for (const iso of Object.keys(days)) tally[iso] = (tally[iso] || 0) + 1;
  return tally;
}
function bestDates() {
  const tally = dateTally();
  const max = Math.max(0, ...Object.values(tally));
  return { max, dates: Object.keys(tally).filter(d => tally[d] === max).sort() };
}

function groupDiet() {
  const diets = Object.values(G.prefs || {}).map(p => p.diet);
  return { veg: diets.some(d => d === 'veg' || d === 'jain' || d === 'vegan'), jain: diets.includes('jain'), vegan: diets.includes('vegan'), diets };
}

function topCuisines() {
  const score = {}, likes = {};
  for (const votes of Object.values(G.cuisineVotes || {})) for (const [cid, v] of Object.entries(votes)) {
    score[cid] = (score[cid] || 0) + v;
    if (v > 0) likes[cid] = (likes[cid] || 0) + 1;
  }
  const n = Object.keys(G.members || {}).length;
  return CUISINES.map((c, i) => ({ c, i, score: score[c.id] || 0, likes: likes[c.id] || 0 }))
    .sort((a, b) => b.likes - a.likes || b.score - a.score || a.i - b.i)
    .slice(0, 3).map(x => ({ ...x, pct: Math.round(100 * x.likes / Math.max(1, n)) }));
}

function meetingPoint() {
  const pts = Object.values(G.place || {}).filter(p => p && p.lat);
  if (!pts.length) return null;
  const lat = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
  const lon = pts.reduce((a, p) => a + p.lon, 0) / pts.length;
  const budgets = pts.map(p => p.budget || 2).sort((a, b) => a - b);
  const budget = budgets[Math.floor((budgets.length - 1) / 2)];
  const labels = [...new Set(pts.map(p => p.label.split(',')[0].replace(/^Near /, '')))];
  const label = labels.length === 1 ? labels[0] : `Midpoint of ${labels.slice(0, 3).join(' · ')}`;
  return { lat: +lat.toFixed(5), lon: +lon.toFixed(5), budget, label };
}

function restScores() {
  const n = Object.keys(G.members || {}).length;
  return (G.restaurants || []).map(r => {
    let likes = 0, supers = 0, score = 0;
    const fans = [];
    for (const [u, votes] of Object.entries(G.restVotes || {})) {
      const v = votes?.[r.id];
      if (v > 0) { likes++; fans.push(u); score += v; }
      if (v === 2) supers++;
    }
    return { r, likes, supers, score, fans, pct: Math.round(100 * likes / Math.max(1, n)) };
  }).sort((a, b) => b.likes - a.likes || b.supers - a.supers || a.r.distKm - b.r.distKm);
}

function reviewStats(id) {
  const list = Object.entries(G.reviews?.[id] || {}).map(([u, rv]) => ({ u, ...rv })).sort((a, b) => b.ts - a.ts);
  const avg = list.length ? list.reduce((a, x) => a + x.stars, 0) / list.length : 0;
  return { list, avg };
}

function dietBadges(r) {
  const gd = G ? groupDiet() : { veg: false, jain: false, vegan: false };
  const b = [];
  if (r.diet?.veg === 'only') b.push(['ok', 'Pure veg']);
  else if (r.diet?.veg === 'yes') b.push(['ok', 'Veg options']);
  else if (r.diet?.veg === 'no') b.push([gd.veg ? 'warn' : '', 'Limited veg']);
  else if (gd.veg) b.push(['', CUISINE_BY_ID[r.cuisineId]?.veg ? 'Veg likely' : 'Veg: unlisted']);
  if (r.diet?.vegan === 'yes' || r.diet?.vegan === 'only') b.push(['ok', 'Vegan']);
  if (r.diet?.jain === 'yes' || r.diet?.jain === 'only') b.push(['ok', 'Jain']);
  if (r.diet?.halal === 'yes' || r.diet?.halal === 'only') b.push(['', 'Halal']);
  return b.map(([cls, t]) => `<span class="badge ${cls}">${t}</span>`).join('');
}

function budgetTag(r) {
  const fits = !G?.meet || r.budget <= G.meet.budget;
  return `<span class="badge ${fits ? 'ok' : 'warn'}">${'₹'.repeat(r.budget)} <small>est.</small></span>`;
}

function seededShuffle(arr, seed) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { h = (h * 1103515245 + 12345) >>> 0; const j = h % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- swipe deck
function mountDeck(root, items, start, cardHTML, onVote, onDone) {
  const stack = $('.deck', root);
  const counter = $('.deck-count', root);
  let i = start, busy = false;

  function draw() {
    stack.innerHTML = '';
    if (counter) counter.textContent = `${pad(Math.min(i + 1, items.length))} / ${pad(items.length)}`;
    if (i >= items.length) return onDone();
    for (let k = Math.min(i + 2, items.length - 1); k >= i; k--) {
      const c = document.createElement('article');
      c.className = 'card' + (k === i ? ' top' : '');
      c.style.setProperty('--depth', k - i);
      c.innerHTML = cardHTML(items[k], k) + `<span class="stamp yes">Yum</span><span class="stamp no">Nah</span><span class="stamp super">Obsessed</span>`;
      stack.appendChild(c);
    }
    bind(stack.lastElementChild);
  }

  function bind(card) {
    let sx = 0, sy = 0, dx = 0, dy = 0, drag = false;
    card.addEventListener('pointerdown', e => {
      if (e.target.closest('button,a')) return;
      drag = true; sx = e.clientX; sy = e.clientY; dx = dy = 0;
      card.setPointerCapture(e.pointerId);
      card.classList.add('dragging');
    });
    card.addEventListener('pointermove', e => {
      if (!drag) return;
      dx = e.clientX - sx; dy = e.clientY - sy;
      card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 16}deg)`;
      card.dataset.hint = dx > 60 ? 'yes' : dx < -60 ? 'no' : dy < -80 ? 'super' : '';
    });
    const end = () => {
      if (!drag) return;
      drag = false;
      card.classList.remove('dragging');
      if (dx > 110) fling(1); else if (dx < -110) fling(0); else if (dy < -130) fling(2);
      else { card.style.transform = ''; card.dataset.hint = ''; }
    };
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
  }

  function fling(v) {
    const card = $('.card.top', stack);
    if (!card || busy) return;
    busy = true;
    const x = v === 1 ? innerWidth * 1.2 : v === 0 ? -innerWidth * 1.2 : 0;
    const y = v === 2 ? -innerHeight : 60;
    card.dataset.hint = ['no', 'yes', 'super'][v];
    card.style.transform = `translate(${x}px, ${y}px) rotate(${v === 1 ? 24 : v === 0 ? -24 : 0}deg)`;
    card.style.opacity = '0';
    onVote(items[i], v);
    i++;
    setTimeout(() => { busy = false; draw(); }, 280);
  }

  $$('[data-vote]', root).forEach(b => b.addEventListener('click', () => fling(+b.dataset.vote)));
  draw();
  return {
    onKey(e) {
      if (e.key === 'ArrowRight') fling(1);
      else if (e.key === 'ArrowLeft') fling(0);
      else if (e.key === 'ArrowUp') fling(2);
    },
  };
}

const deckControls = `<div class="deck-actions">
  <button class="round" data-vote="0" aria-label="Nah">✕</button>
  <button class="round small" data-vote="2" aria-label="Obsessed">★</button>
  <button class="round dark" data-vote="1" aria-label="Yum">♥</button>
</div>
<p class="hint">Drag right = yum · left = nah · up = obsessed <span class="kbd">← ↑ →</span></p>`;

// ---------- views
function viewHome() {
  return {
    html: `
    <section class="hero">
      <p class="eyebrow">Drop 001 — For couples &amp; squads</p>
      <h1 class="mega">Where<br>we<br>eating<span class="q">?</span></h1>
      <p class="lede">Swipe on cuisines. Swipe on places. Match on dinner.<br>No more “anything is fine, you decide”.</p>
    </section>
    <form class="panel" id="create">
      <label class="field"><span>Your name</span><input name="name" required maxlength="24" autocomplete="given-name" placeholder="Aarav" value="${esc(savedName())}"></label>
      <label class="field"><span>Plan name <em>optional</em></span><input name="plan" maxlength="40" placeholder="Friday dinner"></label>
      <button class="btn primary big">Start a squad <i>→</i></button>
      <p class="fine">Got an invite link? Just open it — you’ll land in the squad.</p>
    </form>
    <section class="specs">
      ${[['Squad up', 'Share one link on WhatsApp. Everyone joins in a tap.'],
         ['Dates + prefs', 'Pick free days, diet, spice level, area and budget.'],
         ['Swipe cuisines', 'Tinder for food. Top 3 cuisines make the cut.'],
         ['Swipe places', 'Real spots nearby. Highest match wins dinner.']]
        .map(([t, d], i) => `<div class="spec"><b>${pad(i + 1)}</b><h3>${t}</h3><p>${d}</p></div>`).join('')}
    </section>
    ${store.mode === 'local' ? `<p class="mode-note"><b>Local mode</b> — groups sync between tabs on this device. Add test friends in the lobby, or set a free Firebase URL in <code>config.js</code> to play across phones.</p>` : ''}`,
    init(root) {
      $('#create', root).addEventListener('submit', async e => {
        e.preventDefault();
        const f = new FormData(e.target);
        const name = f.get('name').trim();
        if (!name) return;
        saveName(name);
        const id = rid(6), uid = 'u' + rid(8);
        await store.create(id, {
          id, name: f.get('plan').trim() || 'Dinner plans', host: uid, createdAt: Date.now(), stage: 'lobby',
          members: { [uid]: { name, joinedAt: Date.now(), color: AVATAR_TONES[0] } },
        });
        setMe(id, uid);
        location.hash = '#/g/' + id;
      });
    },
  };
}

function viewJoin() {
  const host = memberName(G.host);
  return {
    html: `
    <section class="hero">
      <p class="eyebrow">You’re invited</p>
      <h1 class="mega small">${esc(G.name)}</h1>
      <p class="lede"><b>${esc(host)}</b> wants to figure out where to eat. ${members().length} in the squad so far.</p>
      <div class="avatars">${members().map(([u, m]) => avatar(u, m)).join('')}</div>
    </section>
    <form class="panel" id="join">
      <label class="field"><span>Your name</span><input name="name" required maxlength="24" placeholder="Your name" value="${esc(savedName())}"></label>
      <button class="btn primary big">Join the squad <i>→</i></button>
    </form>`,
    init(root) {
      $('#join', root).addEventListener('submit', async e => {
        e.preventDefault();
        const name = new FormData(e.target).get('name').trim();
        if (!name) return;
        saveName(name);
        const uid = 'u' + rid(8);
        setMe(gid, uid);
        await set(`members/${uid}`, { name, joinedAt: Date.now(), color: AVATAR_TONES[members().length % AVATAR_TONES.length] });
      });
    },
  };
}

function viewLocked() {
  return { html: `<div class="center-msg"><p class="eyebrow">Doors closed</p><h2 class="title">Squad’s already swiping.</h2><p class="lede">Ask ${esc(memberName(G.host))} for a fresh link, or start your own.</p><a class="btn primary" href="#/">Start a squad <i>→</i></a></div>` };
}
function viewNotFound() {
  return { html: `<div class="center-msg"><p class="eyebrow">404 — no squad</p><h2 class="title">This link’s gone cold.</h2><p class="lede">${store.mode === 'local' ? 'Local mode links only work on the device that created them.' : 'Double-check the link with whoever sent it.'}</p><a class="btn primary" href="#/">Start a squad <i>→</i></a></div>` };
}

function viewLobby() {
  const link = shareLink();
  const msg = `Where we eating? 🍽️ Join "${G.name}" on KHAO and swipe with me: ${link}`;
  const listHTML = () => `
    <div class="count-row"><span class="eyebrow">In the squad</span><b>${pad(members().length)}</b></div>
    <ul class="roster">${members().map(([u, m]) => `<li class="done">${avatar(u, m)}<span>${esc(m.name)}${u === me ? ' <em>(you)</em>' : ''}${u === G.host ? ' <em>· host</em>' : ''}${m.bot ? ' <em>· test</em>' : ''}</span><b>✓</b></li>`).join('')}</ul>`;
  return {
    html: `
    ${stageHead(1, 'Squad up', esc(G.name), 'Send the link. Once everyone’s in, the host locks the squad and the swiping starts.')}
    <div class="panel share">
      <span class="eyebrow">Invite link</span>
      <div class="link-row"><input readonly value="${esc(link)}" id="link"><button class="btn small" id="copy">Copy</button></div>
      <div class="btn-row">
        <a class="btn ghost" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">WhatsApp</a>
        ${navigator.share ? `<button class="btn ghost" id="share">Share…</button>` : ''}
      </div>
      ${store.mode === 'local' ? `<p class="fine">Local mode: open this link in another tab to join as someone else.</p>` : ''}
    </div>
    <div class="panel" id="members">${listHTML()}</div>
    <div class="sticky-cta">
      ${store.mode === 'local' && isHost() ? `<button class="btn ghost" id="bot">+ Add test friend</button>` : ''}
      ${isHost()
        ? `<button class="btn primary big" id="start">Everyone’s in — lock it <i>→</i></button>`
        : `<p class="waiting-line"><span class="pulse"></span>Waiting for ${esc(memberName(G.host))} to lock the squad</p>`}
    </div>`,
    init(root) {
      $('#copy', root).onclick = async () => {
        try { await navigator.clipboard.writeText(link); } catch { $('#link').select(); document.execCommand('copy'); }
        toast('Link copied');
      };
      $('#share', root)?.addEventListener('click', () => navigator.share({ title: 'KHAO', text: msg }).catch(() => {}));
      $('#bot', root)?.addEventListener('click', () => {
        const used = new Set(members().map(([, m]) => m.name));
        const name = BOT_NAMES.find(n => !used.has(n)) || 'Friend ' + rid(2);
        set(`members/b${rid(7)}`, { name, joinedAt: Date.now(), color: AVATAR_TONES[members().length % AVATAR_TONES.length], bot: true });
      });
      $('#start', root)?.addEventListener('click', () => {
        if (members().length < 2 && !confirm('Just you? Swiping solo still works. Continue?')) return;
        set('stage', 'dates');
      });
    },
    update() { $('#members').innerHTML = listHTML(); },
  };
}

function viewDates() {
  const days = nextDays(14);
  const mine = new Set(Object.keys(G.dates?.[me] || {}));
  const dots = iso => {
    const others = Object.entries(G.dates || {}).filter(([u, d]) => u !== me && d[iso]).length;
    return '<i></i>'.repeat(Math.min(others, 6));
  };
  return {
    html: `
    ${stageHead(2, 'When', 'Pick your free days', 'Tap every day that works. Dots show who else is free.')}
    <div class="days">${days.map(d => `
      <button class="day ${mine.has(d.iso) ? 'on' : ''} ${d.weekend ? 'wknd' : ''}" data-iso="${d.iso}">
        <span>${d.rel || d.dow}</span><b>${d.day}</b><small>${d.mon}</small><em class="dots">${dots(d.iso)}</em>
      </button>`).join('')}</div>
    <div class="sticky-cta"><button class="btn primary big" id="go">Lock my dates <i>→</i></button></div>`,
    init(root) {
      const btn = $('#go', root);
      const sync = () => { btn.disabled = !mine.size; btn.firstChild.textContent = mine.size ? `Lock ${mine.size} date${mine.size > 1 ? 's' : ''} ` : 'Pick at least one '; };
      $$('.day', root).forEach(b => b.onclick = () => {
        const iso = b.dataset.iso;
        mine.has(iso) ? mine.delete(iso) : mine.add(iso);
        b.classList.toggle('on');
        sync();
      });
      sync();
      btn.onclick = async () => {
        await set(`dates/${me}`, Object.fromEntries([...mine].map(d => [d, true])));
        set(`done/dates/${me}`, true);
      };
    },
    update() { $$('.day').forEach(b => { $('.dots', b).innerHTML = dots(b.dataset.iso); }); },
  };
}

function viewPrefs() {
  const p = G.prefs?.[me] || {};
  let diet = p.diet || '', spice = p.spice || 2;
  const allergies = new Set(p.allergies || []);
  const { max, dates } = bestDates();
  const n = members().length;
  return {
    html: `
    <div class="panel date-card">
      <p class="eyebrow">The date${dates.length > 1 ? 's' : ''}</p>
      ${dates.length ? `<h3 class="date-big">${fmtDate(dates[0])}</h3>
        <p class="lede">${max === n ? `Everyone’s free 🎉` : `${max}/${n} free — closest we got`}${dates.length > 1 ? ` · also ${dates.slice(1, 4).map(fmtDate).join(', ')}` : ''}</p>`
        : `<h3 class="date-big">TBD</h3>`}
    </div>
    ${stageHead(3, 'You', 'What’s your vibe?', 'So nobody ends up at a place they can’t eat at.')}
    <section class="group"><p class="eyebrow">Diet</p><div class="chips" id="diet">${DIETS.map(d => `<button class="chip ${diet === d.id ? 'on' : ''}" data-v="${d.id}">${d.emoji} ${d.label}</button>`).join('')}</div></section>
    <section class="group"><p class="eyebrow">Spice tolerance</p><div class="seg" id="spice">${SPICE.map(s => `<button class="${spice === s.id ? 'on' : ''}" data-v="${s.id}"><span>${s.emoji}</span>${s.label}</button>`).join('')}</div></section>
    <section class="group"><p class="eyebrow">Allergies / avoid <em>optional</em></p><div class="chips" id="allergy">${ALLERGIES.map(a => `<button class="chip ${allergies.has(a) ? 'on' : ''}" data-v="${a}">${a}</button>`).join('')}</div></section>
    <div class="sticky-cta"><button class="btn primary big" id="go">Save my vibe <i>→</i></button></div>`,
    init(root) {
      const btn = $('#go', root);
      const sync = () => { btn.disabled = !diet; };
      $$('#diet .chip', root).forEach(b => b.onclick = () => { diet = b.dataset.v; $$('#diet .chip').forEach(x => x.classList.toggle('on', x === b)); sync(); });
      $$('#spice button', root).forEach(b => b.onclick = () => { spice = +b.dataset.v; $$('#spice button').forEach(x => x.classList.toggle('on', x === b)); });
      $$('#allergy .chip', root).forEach(b => b.onclick = () => { const v = b.dataset.v; allergies.has(v) ? allergies.delete(v) : allergies.add(v); b.classList.toggle('on'); });
      sync();
      btn.onclick = async () => {
        await set(`prefs/${me}`, { diet, spice, allergies: [...allergies] });
        set(`done/prefs/${me}`, true);
      };
    },
  };
}

function viewPlace() {
  let picked = G.place?.[me] ? { ...G.place[me] } : null;
  let budget = G.place?.[me]?.budget || 0;
  let timer;
  const othersHTML = () => {
    const rows = Object.entries(G.place || {}).filter(([u]) => u !== me);
    return rows.length ? `<p class="eyebrow">Squad spots</p><ul class="spots">${rows.map(([u, p]) => `<li>${avatar(u, G.members[u] || { name: '?', color: '#999' })}<span>${esc(p.label)}</span><b>${'₹'.repeat(p.budget || 2)}</b></li>`).join('')}</ul>` : '';
  };
  return {
    html: `
    ${stageHead(4, 'Where + how much', 'Your spot &amp; budget', 'Everyone drops their area — we find the midpoint so nobody travels 2 hours.')}
    <div class="panel">
      <label class="field"><span>Area / landmark</span><input id="q" placeholder="Try “Koramangala” or “Bandra West”" autocomplete="off" value="${esc(picked?.label || '')}"></label>
      <ul class="results" id="res"></ul>
      <button class="btn ghost" id="locate">◎ Use my location</button>
      <p class="picked" id="picked">${picked ? `📍 ${esc(picked.label)}` : ''}</p>
    </div>
    <section class="group"><p class="eyebrow">Budget per person</p>
      <div class="budgets">${BUDGETS.map(b => `<button class="budget ${budget === b.id ? 'on' : ''}" data-v="${b.id}"><b>${b.sym}</b><span>${b.label}</span><small>${b.sub}</small></button>`).join('')}</div>
    </section>
    <section class="group" id="others">${othersHTML()}</section>
    <div class="sticky-cta"><button class="btn primary big" id="go">Drop my pin <i>→</i></button></div>`,
    init(root) {
      const btn = $('#go', root), res = $('#res', root), q = $('#q', root);
      const sync = () => { btn.disabled = !(picked && budget); $('#picked').textContent = picked ? `📍 ${picked.label}` : ''; };
      const choose = p => { picked = p; q.value = p.label; res.innerHTML = ''; sync(); };
      q.addEventListener('input', () => {
        clearTimeout(timer);
        picked = null; sync();
        const v = q.value.trim();
        if (v.length < 3) { res.innerHTML = ''; return; }
        timer = setTimeout(async () => {
          res.innerHTML = `<li class="muted">Searching…</li>`;
          try {
            const list = await geocode(v);
            res.innerHTML = list.length ? list.map((p, i) => `<li><button data-i="${i}">${esc(p.label)}</button></li>`).join('') : `<li class="muted">No matches — try a bigger landmark</li>`;
            $$('button', res).forEach(b => b.onclick = () => choose(list[+b.dataset.i]));
          } catch { res.innerHTML = `<li class="muted">Search is offline right now</li>`; }
        }, 650);
      });
      $('#locate', root).onclick = () => {
        if (!navigator.geolocation) return toast('Location not available');
        $('#locate').textContent = '◎ Locating…';
        navigator.geolocation.getCurrentPosition(async pos => {
          const { latitude: lat, longitude: lon } = pos.coords;
          choose({ lat: +lat.toFixed(5), lon: +lon.toFixed(5), label: await reverseGeocode(lat, lon) });
          $('#locate').textContent = '◎ Use my location';
        }, () => { toast('Couldn’t get your location'); $('#locate').textContent = '◎ Use my location'; }, { timeout: 10000 });
      };
      $$('.budget', root).forEach(b => b.onclick = () => { budget = +b.dataset.v; $$('.budget').forEach(x => x.classList.toggle('on', x === b)); sync(); });
      sync();
      btn.onclick = async () => {
        await set(`place/${me}`, { lat: picked.lat, lon: picked.lon, label: picked.label, budget });
        set(`done/place/${me}`, true);
      };
    },
    update() { $('#others').innerHTML = othersHTML(); },
  };
}

function viewCuisines() {
  const items = seededShuffle(CUISINES, gid);
  const mine = G.cuisineVotes?.[me] || {};
  const start = Math.max(0, items.findIndex(c => mine[c.id] === undefined));
  let deck;
  return {
    html: `
    <div class="deck-head"><p class="eyebrow"><b>05</b> — Swipe cuisines</p><span class="deck-count"></span></div>
    <div class="deck"></div>
    ${deckControls}`,
    init(root) {
      deck = mountDeck(root, items, items.every(c => mine[c.id] !== undefined) ? items.length : start, (c, k) => `
        <div class="cuisine" style="--tone:${c.tone}">
          <div class="c-top"><span class="eyebrow">Drop ${pad(k + 1)}</span><span class="tagline-sm">${c.veg ? 'Veg-friendly' : 'Meat-forward'} · ${'🌶️'.repeat(c.spice) || 'No heat'}</span></div>
          <div class="c-emoji">${c.emoji}</div>
          <div class="c-body"><h3>${c.name}</h3><p>${c.tag}</p></div>
        </div>`,
        (c, v) => set(`cuisineVotes/${me}/${c.id}`, v),
        () => set(`done/cuisines/${me}`, true));
      keyHandler = deck.onKey;
    },
  };
}

function viewScouting() {
  const top = topCuisines();
  const meet = meetingPoint();
  return {
    html: `
    ${stageHead(6, 'The top 3', 'Cuisines that made the cut')}
    <ol class="podium">${top.map((t, i) => `<li style="--tone:${t.c.tone}"><b>${pad(i + 1)}</b><span class="p-emoji">${t.c.emoji}</span><span class="p-name">${t.c.name}</span><em>${t.pct}%</em></li>`).join('')}</ol>
    <div class="center-msg compact"><div class="spinner"></div><p class="eyebrow">Scouting spots near ${esc(meet?.label || 'you')}</p><p class="fine">Pulling real restaurants from OpenStreetMap…</p></div>`,
  };
}

async function ensureRestaurants() {
  if (fetching || G.restaurants) return;
  if (!isHost()) {
    // Host normally fetches; anyone steps in if the host has gone quiet.
    clearTimeout(ensureRestaurants.t);
    ensureRestaurants.t = setTimeout(() => { if (G?.stage === 'restaurants' && !G.restaurants) fetchRestaurants(); }, 12000);
    return;
  }
  fetchRestaurants();
}
async function fetchRestaurants() {
  if (fetching) return;
  fetching = true;
  try {
    const meet = meetingPoint() || { lat: 19.076, lon: 72.8777, budget: 2, label: 'Mumbai' };
    const { list, source } = await findRestaurants({ ...meet, cuisines: topCuisines().map(t => t.c.id) });
    await set('meet', { ...meet, source });
    await set('restaurants', list);
  } finally { fetching = false; }
}

function restCard(r, k) {
  const c = CUISINE_BY_ID[r.cuisineId];
  return `<div class="rest">
    <div class="r-visual" style="--tone:${c.tone}">
      <span class="eyebrow">Spot ${pad(k + 1)}${r.demo ? ' · Demo data' : ''}</span>
      <span class="r-emoji">${c.emoji}</span>
      <button class="info" data-info="${r.id}" aria-label="Details">i</button>
    </div>
    <div class="r-body">
      <p class="eyebrow">${esc(r.cuisineLabel)}</p>
      <h3>${esc(r.name)}</h3>
      <div class="badges">${budgetTag(r)}<span class="badge">${r.distKm} km</span>${dietBadges(r)}</div>
      ${r.addr ? `<p class="fine">${esc(r.addr)}</p>` : ''}
      ${r.hours ? `<p class="fine">🕒 ${esc(r.hours)}</p>` : ''}
    </div>
  </div>`;
}

function viewRestaurants() {
  const items = G.restaurants || [];
  const mine = G.restVotes?.[me] || {};
  const start = items.findIndex(r => mine[r.id] === undefined);
  const top = topCuisines();
  const intro = start === 0;
  return {
    html: `
    <div id="intro" ${intro ? '' : 'hidden'}>
      ${stageHead(6, 'The top 3', 'Cuisines that made the cut', `${items.length} spots near ${esc(G.meet?.label || 'you')}. Swipe like you mean it.`)}
      <ol class="podium">${top.map((t, i) => `<li style="--tone:${t.c.tone}"><b>${pad(i + 1)}</b><span class="p-emoji">${t.c.emoji}</span><span class="p-name">${t.c.name}</span><em>${t.pct}%</em></li>`).join('')}</ol>
      ${G.meet?.source === 'demo' ? `<p class="mode-note">Couldn’t find enough mapped spots here, so these are <b>demo places</b>. Try a busier area next time.</p>` : ''}
      <div class="sticky-cta"><button class="btn primary big" id="begin">Start swiping places <i>→</i></button></div>
    </div>
    <div id="deckWrap" ${intro ? 'hidden' : ''}>
      <div class="deck-head"><p class="eyebrow"><b>06</b> — Swipe places</p><span class="deck-count"></span></div>
      <div class="deck rest-deck"></div>
      ${deckControls}
    </div>`,
    init(root) {
      const go = () => {
        $('#intro', root).hidden = true;
        $('#deckWrap', root).hidden = false;
        const deck = mountDeck(root, items, start < 0 ? items.length : start, restCard,
          (r, v) => set(`restVotes/${me}/${r.id}`, v),
          () => set(`done/restaurants/${me}`, true));
        keyHandler = deck.onKey;
        root.addEventListener('click', e => {
          const b = e.target.closest('[data-info]');
          if (b) openSheet(b.dataset.info);
        });
      };
      if (intro) $('#begin', root).onclick = go; else go();
    },
  };
}

function stageReveal(st) {
  if (st === 'dates') {
    const { max, dates } = bestDates();
    return `<p class="eyebrow">The date</p><h3 class="date-big">${dates[0] ? fmtDate(dates[0]) : 'TBD'}</h3>
      <p class="lede">${max === members().length ? 'Everyone’s free 🎉' : `${max}/${members().length} free — closest we got`}</p>`;
  }
  if (st === 'prefs') {
    const counts = {};
    for (const p of Object.values(G.prefs || {})) counts[p.diet] = (counts[p.diet] || 0) + 1;
    return `<p class="eyebrow">Squad diet</p><div class="chips reveal-chips">${DIETS.filter(d => counts[d.id]).map(d => `<span class="chip on">${d.emoji} ${d.label} ×${counts[d.id]}</span>`).join('')}</div>`;
  }
  if (st === 'place') {
    const m = meetingPoint();
    const b = BUDGETS[(m?.budget || 2) - 1];
    return `<p class="eyebrow">Meeting point</p><h3 class="date-big">${esc((m?.label || 'TBD').split(',')[0])}</h3><p class="lede">Budget ${b.sym} · ${b.label} per person</p>`;
  }
  if (st === 'cuisines') {
    return `<p class="eyebrow">Top 3 cuisines</p><ol class="podium">${topCuisines().map((t, i) => `<li style="--tone:${t.c.tone}"><b>${pad(i + 1)}</b><span class="p-emoji">${t.c.emoji}</span><span class="p-name">${t.c.name}</span><em>${t.pct}%</em></li>`).join('')}</ol>`;
  }
  return `<p class="eyebrow">Votes are in</p><h3 class="date-big">Match ready</h3>`;
}

function viewWaiting() {
  const st = G.stage;
  const pending = () => members().filter(([u]) => !G.done?.[st]?.[u]).map(([, m]) => m.name);
  if (allDone()) {
    return {
      html: `
      <div class="center-msg compact"><p class="eyebrow">${LABEL[st]} — everyone’s in</p></div>
      <div class="panel reveal">${stageReveal(st)}</div>
      <div class="panel">${memberStatus(st)}</div>
      <div class="sticky-cta">${isHost()
        ? `<button class="btn primary big" id="next">${st === 'restaurants' ? 'See the match' : 'Continue'} <i>→</i></button>`
        : `<p class="waiting-line"><span class="pulse"></span>Waiting for ${esc(memberName(G.host))} to continue</p>`}</div>`,
      init(root) { $('#next', root)?.addEventListener('click', () => advance(st)); },
    };
  }
  const line = () => {
    const p = pending();
    return `Waiting on ${p.slice(0, 3).map(esc).join(', ')}${p.length > 3 ? ` +${p.length - 3}` : ''}`;
  };
  return {
    html: `
    <div class="center-msg">
      <p class="eyebrow">${LABEL[st]} — locked</p>
      <h2 class="title">You’re in.<br>Squad’s still cooking.</h2>
      <p class="waiting-line" id="wline"><span class="pulse"></span>${line()}</p>
    </div>
    <div class="panel" id="roster">${memberStatus(st)}</div>
    ${isHost() ? `<div class="sticky-cta"><button class="btn ghost" id="skip">Don’t wait — move on without them</button></div>` : ''}`,
    init(root) {
      $('#skip', root)?.addEventListener('click', () => {
        if (st === 'restaurants' && !Object.keys(G.restVotes || {}).length) return;
        advance(st);
      });
    },
    update() {
      $('#wline').innerHTML = `<span class="pulse"></span>${line()}`;
      $('#roster').innerHTML = memberStatus(st);
    },
  };
}

function viewResults() {
  const ranked = restScores();
  const { dates, max } = bestDates();
  const top = topCuisines();
  const listHTML = () => restScores().map((x, i) => {
    const rs = reviewStats(x.r.id);
    return `<li><button class="row" data-info="${x.r.id}">
      <b class="rank">${pad(i + 1)}</b>
      <span class="r-mini" style="--tone:${CUISINE_BY_ID[x.r.cuisineId].tone}">${CUISINE_BY_ID[x.r.cuisineId].emoji}</span>
      <span class="row-main"><strong>${esc(x.r.name)}</strong><small>${esc(x.r.cuisineLabel)} · ${x.r.distKm} km · ${'₹'.repeat(x.r.budget)}${rs.list.length ? ` · ★ ${rs.avg.toFixed(1)}` : ''}</small></span>
      <span class="pct">${x.pct}%</span>
    </button></li>`;
  }).join('');
  const w = ranked[0];
  const plan = w ? `KHAO says: ${w.r.name} (${w.r.cuisineLabel}) on ${dates[0] ? fmtDate(dates[0]) : 'TBD'} 🍽️ https://www.openstreetmap.org/${w.r.osm || ''}` : '';
  return {
    html: w ? `
    <section class="winner">
      <p class="eyebrow">It’s a match — ${w.pct}% of the squad</p>
      <span class="w-emoji">${CUISINE_BY_ID[w.r.cuisineId].emoji}</span>
      <h1 class="mega small">${esc(w.r.name)}</h1>
      <p class="w-meta">${esc(w.r.cuisineLabel)} · ${w.r.distKm} km from midpoint</p>
      <div class="badges center">${budgetTag(w.r)}${dietBadges(w.r)}${w.supers ? `<span class="badge ok">★ ${w.supers} obsessed</span>` : ''}</div>
      <div class="fans">${w.fans.map(u => G.members[u] ? avatar(u, G.members[u]) : '').join('')}</div>
      <div class="btn-row"><button class="btn primary" data-info="${w.r.id}">Map &amp; reviews</button>
      <a class="btn ghost" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(plan)}">Share plan</a></div>
    </section>
    <div class="plan-grid">
      <div><span class="eyebrow">When</span><b>${dates[0] ? fmtDate(dates[0]) : 'TBD'}</b><small>${max}/${members().length} free</small></div>
      <div><span class="eyebrow">Where</span><b>${esc((G.meet?.label || '').split(',')[0])}</b><small>Group midpoint</small></div>
      <div><span class="eyebrow">Budget</span><b>${BUDGETS[(G.meet?.budget || 2) - 1].sym}</b><small>${BUDGETS[(G.meet?.budget || 2) - 1].label}</small></div>
      <div><span class="eyebrow">Top cuisine</span><b>${top[0]?.c.emoji} ${esc(top[0]?.c.name || '')}</b><small>${top.slice(1).map(t => t.c.name).join(' · ')}</small></div>
    </div>
    <section class="group"><p class="eyebrow">Full leaderboard — tap for map &amp; reviews</p><ul class="board" id="board">${listHTML()}</ul></section>
    <div class="sticky-cta"><a class="btn ghost" href="#/">New plan</a></div>`
      : `<div class="center-msg"><h2 class="title">No spots to rank.</h2><a class="btn primary" href="#/">New plan</a></div>`,
    init(root) {
      root.addEventListener('click', e => { const b = e.target.closest('[data-info]'); if (b) openSheet(b.dataset.info); });
    },
    update() { const b = $('#board'); if (b) b.innerHTML = listHTML(); },
  };
}

const VIEWS = { lobby: viewLobby, dates: viewDates, prefs: viewPrefs, place: viewPlace, cuisines: viewCuisines, restaurants: viewRestaurants, results: viewResults };

// ---------- detail sheet (map + reviews)
let leafletReady;
function loadLeaflet() {
  return leafletReady ||= new Promise((res, rej) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = () => res(window.L); s.onerror = rej;
    document.head.appendChild(s);
  });
}

function openSheet(id) {
  const r = (G.restaurants || []).find(x => x.id === id);
  if (!r) return;
  sheetRid = id;
  const c = CUISINE_BY_ID[r.cuisineId];
  const score = restScores().find(x => x.r.id === id);
  const q = encodeURIComponent(`${r.name} ${r.addr || G.meet?.label || ''}`);
  const sheet = $('#sheet');
  sheet.innerHTML = `
    <div class="sheet-bg" data-close></div>
    <div class="sheet-panel" role="dialog" aria-label="${esc(r.name)}">
      <button class="sheet-x" data-close aria-label="Close">✕</button>
      <div class="map" id="map"><span class="r-emoji">${c.emoji}</span></div>
      <div class="sheet-body">
        <p class="eyebrow">${esc(r.cuisineLabel)}${r.demo ? ' · Demo data' : ''}</p>
        <h2 class="title sm">${esc(r.name)}</h2>
        <div class="badges">${budgetTag(r)}<span class="badge">${r.distKm} km</span>${dietBadges(r)}${r.delivery ? '<span class="badge">Delivers</span>' : ''}${r.outdoor ? '<span class="badge">Outdoor seating</span>' : ''}</div>
        <div class="stats">
          <div><b>${score && G.stage === 'results' ? score.pct + '%' : '—'}</b><span>${G.stage === 'results' ? 'Squad match' : 'Match after voting'}</span></div>
          <div><b id="avgStars">—</b><span>Squad rating</span></div>
          <div><b>${'₹'.repeat(r.budget)}</b><span>${BUDGETS[r.budget - 1].label}</span></div>
        </div>
        <dl class="facts">
          ${r.addr ? `<dt>Address</dt><dd>${esc(r.addr)}</dd>` : ''}
          ${r.hours ? `<dt>Hours</dt><dd>${esc(r.hours)}</dd>` : ''}
          ${r.phone ? `<dt>Phone</dt><dd><a href="tel:${esc(r.phone)}">${esc(r.phone)}</a></dd>` : ''}
          ${r.website ? `<dt>Web</dt><dd><a target="_blank" rel="noopener" href="${esc(r.website)}">${esc(r.website.replace(/^https?:\/\//, ''))}</a></dd>` : ''}
          <dt>Diet</dt><dd>${dietBadges(r) || 'Not listed on the map — call ahead if strict.'}</dd>
        </dl>
        <div class="btn-row">
          <a class="btn primary" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lon}">Directions</a>
          <a class="btn ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${q}">Public reviews ↗</a>
        </div>
        <section class="reviews">
          <div class="count-row"><span class="eyebrow">Squad reviews</span></div>
          <ul id="revList"></ul>
          <form id="revForm" class="rev-form">
            <div class="stars" id="stars">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-s="${n}">★</button>`).join('')}</div>
            <textarea name="text" maxlength="280" rows="2" placeholder="Been here? The butter chicken was…"></textarea>
            <button class="btn small">Post review</button>
          </form>
        </section>
        <p class="fine">Place data © OpenStreetMap contributors. Squad ratings come only from people in this plan.</p>
      </div>
    </div>`;
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('open'));
  $$('[data-close]', sheet).forEach(b => b.onclick = closeSheet);

  const mineRv = G.reviews?.[id]?.[me];
  let stars = mineRv?.stars || 0;
  const paint = () => $$('#stars button').forEach(b => b.classList.toggle('on', +b.dataset.s <= stars));
  $$('#stars button').forEach(b => b.onclick = () => { stars = +b.dataset.s; paint(); });
  if (mineRv) $('#revForm textarea').value = mineRv.text || '';
  paint();
  $('#revForm').onsubmit = e => {
    e.preventDefault();
    if (!stars) return toast('Tap some stars first');
    set(`reviews/${id}/${me}`, { stars, text: e.target.text.value.trim(), ts: Date.now() });
    toast('Review posted');
  };
  renderSheetReviews();

  loadLeaflet().then(L => {
    if (sheetRid !== id) return;
    const el = $('#map');
    el.innerHTML = '';
    const map = L.map(el, { zoomControl: false, attributionControl: true }).setView([r.lat, r.lon], 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    L.marker([r.lat, r.lon], { icon: L.divIcon({ className: 'pin', html: `<span>${c.emoji}</span>`, iconSize: [44, 44], iconAnchor: [22, 44] }) }).addTo(map);
    if (G.meet) L.circleMarker([G.meet.lat, G.meet.lon], { radius: 7, color: '#111', weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(map).bindTooltip('Squad midpoint');
  }).catch(() => {});
}

function renderSheetReviews() {
  const list = $('#revList');
  if (!list) return;
  const { list: rv, avg } = reviewStats(sheetRid);
  $('#avgStars').textContent = rv.length ? `★ ${avg.toFixed(1)}` : '—';
  list.innerHTML = rv.length ? rv.map(x => `<li>${G.members[x.u] ? avatar(x.u, G.members[x.u]) : ''}<div><b>${esc(memberName(x.u))}</b> <span class="st">${'★'.repeat(x.stars)}${'☆'.repeat(5 - x.stars)}</span>${x.text ? `<p>${esc(x.text)}</p>` : ''}</div></li>`).join('')
    : `<li class="muted">No squad reviews yet. Been here? Drop one.</li>`;
}

function closeSheet() {
  sheetRid = null;
  const sheet = $('#sheet');
  if (!sheet || sheet.hidden) return;
  sheet.classList.remove('open');
  setTimeout(() => { if (!sheetRid) { sheet.hidden = true; sheet.innerHTML = ''; } }, 250);
}
addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

// ---------- test friends (local mode only): they answer each step a moment after it opens
function runBots() {
  if (store.mode !== 'local' || !isHost()) return;
  const st = G.stage;
  // Test friends only answer after you've locked in, one at a time, so you're never rushed.
  if (!GATED.includes(st) || !G.done?.[st]?.[me]) return;
  let n = 0;
  for (const [uid, m] of members()) {
    if (!m.bot || G.done?.[st]?.[uid] || botTimers.has(uid + st)) continue;
    botTimers.add(uid + st);
    setTimeout(() => botAct(uid, st), 1500 + n++ * 1500 + Math.random() * 800);
  }
}

async function botAct(uid, st) {
  if (!G || G.stage !== st) return;
  const pick = (yes, sup = 0.1) => { const r = Math.random(); return r < sup ? 2 : r < sup + yes ? 1 : 0; };
  if (st === 'dates') {
    const days = nextDays(14).map(d => d.iso);
    const hostDays = Object.keys(G.dates?.[me] || {});
    const chosen = days.filter(d => hostDays.includes(d) ? Math.random() < .75 : Math.random() < .3);
    await set(`dates/${uid}`, Object.fromEntries((chosen.length ? chosen : [days[5]]).map(d => [d, true])));
  } else if (st === 'prefs') {
    await set(`prefs/${uid}`, { diet: ['veg', 'nonveg', 'nonveg', 'egg', 'jain'][Math.floor(Math.random() * 5)], spice: 1 + Math.floor(Math.random() * 3), allergies: [] });
  } else if (st === 'place') {
    const h = G.place[me];
    await set(`place/${uid}`, { lat: +(h.lat + (Math.random() - .5) * .03).toFixed(5), lon: +(h.lon + (Math.random() - .5) * .03).toFixed(5), label: `Near ${h.label.split(',')[0]}`, budget: 1 + Math.floor(Math.random() * 3) });
  } else if (st === 'cuisines') {
    await set(`cuisineVotes/${uid}`, Object.fromEntries(CUISINES.map(c => [c.id, pick(.4)])));
  } else if (st === 'restaurants') {
    await set(`restVotes/${uid}`, Object.fromEntries(G.restaurants.map(r => [r.id, pick(.5, .12)])));
  }
  await set(`done/${st}/${uid}`, true);
}

// ---------- PWA
let installEvt;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#install').hidden = false; });
$('#install').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#install').hidden = true; };
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

route();
