import { CUISINES, CUISINE_BY_ID, BUDGETS, DIETS, SPICE, ALLERGIES, AVATAR_TONES, BOT_NAMES } from './data.js';
import { createStore } from './store.js';
import { geocode, reverseGeocode, findRestaurants, findOverture, findGoogle, googleLookup, photoUrl } from './places.js';

const store = createStore(window.KHAO_CONFIG || {});
const GKEY = (window.KHAO_CONFIG || {}).googleMapsKey || '';
// Paid Google Places search is opt-in; the free Overture tiles are the default restaurant source.
const GPLACES = !!(window.KHAO_CONFIG || {}).useGooglePlaces && !!GKEY;
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
const placeCache = {}; // Google place details, kept in memory only (never stored in Firebase)
let hydrating = false;

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
  const ready = !!s.restaurants && !needsHydrate();
  if (s.restaurants && !ready) hydrate();
  if (s.stage === 'restaurants' && !done) {
    key += ready ? ':deck' : ':load';
    if (!s.restaurants) ensureRestaurants();
  }
  let runoff = false;
  if (s.stage === 'results') {
    if (!ready) key += ':load';
    else {
      const fp = finalPick();
      runoff = !fp.winner;
      key += fp.winner ? ':final' : fp.phase === 'host' ? ':host' : s.runoff?.[me] ? ':picked' : ':runoff';
    }
  }
  const loading = !done && (s.stage === 'restaurants' || s.stage === 'results') && !ready;
  const factory = done ? viewWaiting : loading ? viewScouting : runoff ? viewRunoff : VIEWS[s.stage];
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

// Squad diet mode, from everyone's prefs. Egg, Jain and vegan count as veg (no meat).
const VEG_SIDE = new Set(['veg', 'jain', 'vegan', 'egg']);
function dietMode() {
  const diets = Object.keys(G.members || {}).map(u => G.prefs?.[u]?.diet).filter(Boolean);
  const veg = diets.filter(d => VEG_SIDE.has(d)).length;
  return !diets.length ? 'any' : veg === diets.length ? 'veg' : veg ? 'mixed' : 'any';
}
const cuisineOk = (c, mode = dietMode()) => mode === 'veg' ? c.veg : mode === 'mixed' ? c.veg && c.nonveg : true;
const allowedCuisines = () => CUISINES.filter(c => cuisineOk(c));
const DIET_NOTE = {
  veg: 'All-veg squad — meat-only cuisines are hidden.',
  mixed: 'Veg + non-veg squad — only cuisines and places that serve both.',
};

function groupDiet() {
  const diets = Object.values(G.prefs || {}).map(p => p.diet);
  return { veg: diets.some(d => d === 'veg' || d === 'jain' || d === 'vegan'), jain: diets.includes('jain'), vegan: diets.includes('vegan'), diets };
}

// Top 3 cuisines by likes — plus every cuisine tied with 3rd place, so a tie never silently drops one.
function topCuisines() {
  const score = {}, likes = {};
  for (const votes of Object.values(G.cuisineVotes || {})) for (const [cid, v] of Object.entries(votes)) {
    score[cid] = (score[cid] || 0) + v;
    if (v > 0) likes[cid] = (likes[cid] || 0) + 1;
  }
  const n = Object.keys(G.members || {}).length;
  const ranked = CUISINES.map((c, i) => ({ c, i, score: score[c.id] || 0, likes: likes[c.id] || 0 }))
    .filter(x => cuisineOk(x.c))
    .sort((a, b) => b.likes - a.likes || b.score - a.score || a.i - b.i)
    .map(x => ({ ...x, pct: Math.round(100 * x.likes / Math.max(1, n)) }));
  const top = ranked.slice(0, 3);
  const cut = top[top.length - 1];
  if (cut?.likes > 0) top.push(...ranked.slice(3).filter(x => x.likes === cut.likes));
  return top;
}
// Keep the restaurant deck around 18 cards however many cuisines made it through.
const spotsPerCuisine = n => Math.min(6, Math.max(2, Math.floor(18 / Math.max(1, n))));

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

// The squad's restaurant list merged with Google details loaded on this phone.
const placeList = () => (G.restaurants || []).map(ref => ({ ...ref, ...(placeCache[ref.id] || {}) }));
const needsHydrate = () => !!GKEY && (G.restaurants || []).some(ref => ref.g && !placeCache[ref.id]);
async function hydrate() {
  if (hydrating || !GKEY || !G.meet) return;
  hydrating = true;
  try {
    const refs = G.restaurants.filter(r => r.g && !placeCache[r.id]);
    const got = await googleLookup({ refs, origin: G.meet, key: GKEY });
    got.forEach(r => { placeCache[r.id] = r; });
    // Anything Google can't return any more still gets a card, so the deck never stalls.
    refs.forEach(r => { placeCache[r.id] ||= { name: 'Unavailable spot', cuisineLabel: CUISINE_BY_ID[r.cuisineId].name, budget: 2, diet: {} }; });
  } catch (e) {
    console.warn('Google details failed', e);
    toast('Couldn’t load place details');
  } finally {
    hydrating = false;
    if (G) onState(G);
  }
}

function restScores() {
  const n = Object.keys(G.members || {}).length;
  return placeList().map(r => {
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

// How the plan's winner is decided:
//  1. a clear #1 on likes, then Obsessed count, wins outright (distance never decides);
//  2. a tie goes to a squad runoff — everyone picks one of the tied spots, most picks wins;
//  3. still tied after the runoff → the host picks.
function finalPick() {
  const ranked = restScores();
  const best = ranked[0];
  const tied = best && best.likes > 0 ? ranked.filter(x => x.likes === best.likes && x.supers === best.supers) : [];
  if (tied.length < 2) return { winner: best || null, how: 'votes', tied };
  if (G.final) return { winner: tied.find(x => x.r.id === G.final) || best, how: 'host', tied };
  const picks = G.runoff || {};
  const ids = Object.keys(G.members || {});
  if (!G.runoffClosed && !ids.every(u => picks[u])) return { winner: null, phase: 'vote', tied };
  const count = {};
  for (const id of Object.values(picks)) count[id] = (count[id] || 0) + 1;
  const top = Math.max(0, ...tied.map(x => count[x.r.id] || 0));
  const leaders = tied.filter(x => (count[x.r.id] || 0) === top);
  if (leaders.length === 1) return { winner: leaders[0], how: 'runoff', tied, count };
  return { winner: null, phase: 'host', tied: leaders, count };
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
  const label = r.priceText || '₹'.repeat(r.budget);
  return `<span class="badge ${fits ? 'ok' : 'warn'}">${label}${r.budgetKnown ? '' : ' <small>est.</small>'}</span>`;
}

const fmtCount = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n);
function ratingTag(r) {
  return r.rating ? `<span class="badge">★ ${r.rating.toFixed(1)} · ${fmtCount(r.ratingCount)}</span>` : '';
}
const photoBg = (r, w) => r.photos?.length && GKEY ? `background-image:url('${photoUrl(r.photos[0].name, GKEY, w)}');` : '';

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
      ${isHost() ? `<button class="btn ghost" id="bot">+ Add test friend</button>` : ''}
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
            res.innerHTML = list.length ? list.map((p, i) => `<li><button data-i="${i}"><span class="kind">${esc(p.kind || 'Place')}</span>${esc(p.label)}</button></li>`).join('') : `<li class="muted">No matches — try a bigger landmark</li>`;
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
  const items = seededShuffle(allowedCuisines(), gid);
  const note = DIET_NOTE[dietMode()];
  const mine = G.cuisineVotes?.[me] || {};
  const start = Math.max(0, items.findIndex(c => mine[c.id] === undefined));
  let deck;
  return {
    html: `
    <div class="deck-head"><p class="eyebrow"><b>05</b> — Swipe cuisines</p><span class="deck-count"></span></div>
    ${note ? `<p class="diet-note">${note}</p>` : ''}
    <div class="deck"></div>
    ${deckControls}`,
    init(root) {
      deck = mountDeck(root, items, items.every(c => mine[c.id] !== undefined) ? items.length : start, (c, k) => `
        <div class="cuisine" style="--tone:${c.tone}">
          <div class="c-top"><span class="eyebrow">Drop ${pad(k + 1)}</span><span class="tagline-sm">${!c.nonveg ? 'Pure veg' : !c.veg ? 'Meat-forward' : dietMode() === 'veg' ? 'Veg options' : 'Veg + non-veg'} · ${'🌶️'.repeat(c.spice) || 'No heat'}</span></div>
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
    ${stageHead(6, `The top ${top.length}`, 'Cuisines that made the cut', top.length > 3 ? 'There was a tie, so every tied cuisine is in.' : '')}
    <ol class="podium">${top.map((t, i) => `<li style="--tone:${t.c.tone}"><b>${pad(i + 1)}</b><span class="p-emoji">${t.c.emoji}</span><span class="p-name">${t.c.name}</span><em>${t.pct}%</em></li>`).join('')}</ol>
    <div class="center-msg compact"><div class="spinner"></div><p class="eyebrow">Scouting spots near ${esc(meet?.label || 'you')}</p><p class="fine">Finding real restaurants near the squad…</p></div>`,
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
    const cuisines = topCuisines().map(t => t.c.id);
    const args = { ...meet, cuisines, diet: dietMode(), per: spotsPerCuisine(cuisines.length) };
    let res = null;
    if (GPLACES) {
      try { res = await findGoogle({ ...args, key: GKEY }); } catch (e) { console.warn('Google Places unavailable', e); }
    }
    if (!res) {
      try { res = await findOverture(args); } catch (e) { console.warn('Overture tiles unavailable here, using OpenStreetMap', e); }
    }
    res ||= await findRestaurants(args);
    await set('meet', { ...meet, source: res.source });
    if (res.source === 'google') {
      res.list.forEach(r => { placeCache[r.id] = r; });
      await set('restaurants', res.list.map(r => ({ id: r.id, g: true, cuisineId: r.cuisineId, lat: r.lat, lon: r.lon, distKm: r.distKm })));
    } else {
      await set('restaurants', res.list);
    }
  } finally { fetching = false; }
}

function restCard(r, k) {
  const c = CUISINE_BY_ID[r.cuisineId];
  return `<div class="rest">
    <div class="r-visual ${photoBg(r, 800) ? 'has-photo' : ''}" style="--tone:${c.tone};${photoBg(r, 800)}">
      <span class="eyebrow">Spot ${pad(k + 1)}${r.demo ? ' · Demo data' : ''}</span>
      ${photoBg(r, 800) ? `<span class="photo-credit">${r.photos[0].by ? `Photo: ${esc(r.photos[0].by)} · ` : ''}Google</span>` : `<span class="r-emoji">${c.emoji}</span>`}
      <button class="info" data-info="${r.id}" aria-label="Details">i</button>
    </div>
    <div class="r-body">
      <p class="eyebrow">${esc(r.cuisineLabel)}</p>
      <h3>${esc(r.name)}</h3>
      <div class="badges">${ratingTag(r)}${budgetTag(r)}<span class="badge">${r.distKm} km</span>${dietBadges(r)}</div>
      ${r.addr ? `<p class="fine">${esc(r.addr)}</p>` : ''}
      ${r.hours ? `<p class="fine">🕒 ${esc(r.hours)}</p>` : ''}
    </div>
  </div>`;
}

function viewRestaurants() {
  const items = placeList();
  const mine = G.restVotes?.[me] || {};
  const start = items.findIndex(r => mine[r.id] === undefined);
  const top = topCuisines();
  const intro = start === 0;
  return {
    html: `
    <div id="intro" ${intro ? '' : 'hidden'}>
      ${stageHead(6, `The top ${top.length}`, 'Cuisines that made the cut', `${top.length > 3 ? 'Tied cuisines all made it. ' : ''}${items.length} spots near ${esc(G.meet?.label || 'you')}. Swipe like you mean it.`)}
      <ol class="podium">${top.map((t, i) => `<li style="--tone:${t.c.tone}"><b>${pad(i + 1)}</b><span class="p-emoji">${t.c.emoji}</span><span class="p-name">${t.c.name}</span><em>${t.pct}%</em></li>`).join('')}</ol>
      ${DIET_NOTE[dietMode()] ? `<p class="diet-note">${DIET_NOTE[dietMode()]}</p>` : ''}
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
    const top = topCuisines();
    return `<p class="eyebrow">Top ${top.length} cuisines${top.length > 3 ? ' — tied, so all go through' : ''}</p><ol class="podium">${top.map((t, i) => `<li style="--tone:${t.c.tone}"><b>${pad(i + 1)}</b><span class="p-emoji">${t.c.emoji}</span><span class="p-name">${t.c.name}</span><em>${t.pct}%</em></li>`).join('')}</ol>`;
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

// Tie-break: the squad picks one of the tied spots, or the host decides if the runoff ties too.
function viewRunoff() {
  const fp = finalPick();
  const hostTurn = fp.phase === 'host';
  const mine = G.runoff?.[me];
  const canPick = hostTurn ? isHost() : !mine;
  const t0 = fp.tied[0];
  const pending = () => members().filter(([u]) => !G.runoff?.[u]).map(([, m]) => m.name);
  const status = () => hostTurn
    ? (isHost() ? '' : `<p class="waiting-line"><span class="pulse"></span>Waiting for ${esc(memberName(G.host))} to choose</p>`)
    : mine ? `<p class="waiting-line"><span class="pulse"></span>Waiting on ${pending().slice(0, 3).map(esc).join(', ')}</p>
      <ul class="roster">${members().map(([u, m]) => `<li class="${G.runoff?.[u] ? 'done' : ''}">${avatar(u, m)}<span>${esc(m.name)}${u === me ? ' <em>(you)</em>' : ''}</span><b>${G.runoff?.[u] ? '✓' : '···'}</b></li>`).join('')}</ul>` : '';
  return {
    html: `
    <div class="center-msg compact">
      <p class="eyebrow">${fp.tied.length} spots tied · ${t0.pct}% of the squad${t0.supers ? ` · ${t0.supers} obsessed each` : ''}</p>
      <h2 class="title">${hostTurn ? 'Still tied.<br>Host decides.' : 'It’s a tie.<br>Pick your fave.'}</h2>
      <p class="lede">${hostTurn
        ? `The squad split evenly${isHost() ? ' — you make the call.' : '.'}`
        : mine ? 'Locked in. Waiting for the rest of the squad.' : 'One pick each. Most picks wins and becomes the plan.'}</p>
    </div>
    <ul class="runoff">${fp.tied.map(x => {
      const c = CUISINE_BY_ID[x.r.cuisineId];
      return `<li class="${mine === x.r.id ? 'on' : ''}">
        <span class="r-mini ${photoBg(x.r, 800) ? 'has-photo' : ''}" style="--tone:${c.tone};${photoBg(x.r, 800)}">${photoBg(x.r, 800) ? '' : c.emoji}</span>
        <span class="row-main"><strong>${esc(x.r.name)}</strong><small>${esc(x.r.cuisineLabel)} · ${x.r.distKm} km · ${x.r.priceText || '₹'.repeat(x.r.budget)}${hostTurn && fp.count ? ` · ${fp.count[x.r.id] || 0} pick${fp.count[x.r.id] === 1 ? '' : 's'}` : ''}</small></span>
        <button class="info" data-info="${x.r.id}" aria-label="Details">i</button>
        ${canPick ? `<button class="btn small" data-pick="${x.r.id}">Pick</button>` : mine === x.r.id ? '<b class="mine">Your pick</b>' : ''}
      </li>`;
    }).join('')}</ul>
    <div class="panel" id="runoffStatus" ${status() ? '' : 'hidden'}>${status()}</div>
    ${!hostTurn && isHost() && mine ? `<div class="sticky-cta"><button class="btn ghost" id="closeRunoff">Don’t wait — count the picks so far</button></div>` : ''}`,
    init(root) {
      root.addEventListener('click', e => {
        const info = e.target.closest('[data-info]');
        if (info) return openSheet(info.dataset.info);
        const pick = e.target.closest('[data-pick]');
        if (!pick) return;
        if (hostTurn) set('final', pick.dataset.pick);
        else set(`runoff/${me}`, pick.dataset.pick);
      });
      $('#closeRunoff', root)?.addEventListener('click', () => set('runoffClosed', true));
    },
    update() {
      const el = $('#runoffStatus');
      if (el) { el.innerHTML = status(); el.hidden = !status(); }
    },
  };
}

function viewResults() {
  const fp = finalPick();
  const ranked = restScores();
  const { dates, max } = bestDates();
  const top = topCuisines();
  // The decided winner leads the leaderboard, even when a runoff lifted it above an equal score.
  const ordered = () => { const all = restScores(); const w = all.find(x => x.r.id === fp.winner?.r.id); return w ? [w, ...all.filter(x => x !== w)] : all; };
  const listHTML = () => ordered().map((x, i) => {
    const rs = reviewStats(x.r.id);
    return `<li><button class="row" data-info="${x.r.id}">
      <b class="rank">${pad(i + 1)}</b>
      <span class="r-mini ${photoBg(x.r, 800) ? 'has-photo' : ''}" style="--tone:${CUISINE_BY_ID[x.r.cuisineId].tone};${photoBg(x.r, 800)}">${photoBg(x.r, 800) ? '' : CUISINE_BY_ID[x.r.cuisineId].emoji}</span>
      <span class="row-main"><strong>${esc(x.r.name)}</strong><small>${esc(x.r.cuisineLabel)} · ${x.r.distKm} km · ${x.r.priceText || '₹'.repeat(x.r.budget)}${x.r.rating ? ` · ★ ${x.r.rating.toFixed(1)}` : rs.list.length ? ` · ★ ${rs.avg.toFixed(1)}` : ''}</small></span>
      <span class="pct">${x.pct}%</span>
    </button></li>`;
  }).join('');
  const w = ranked.find(x => x.r.id === fp.winner?.r.id) || ranked[0];
  const how = { runoff: ' · won the tie-break vote', host: ' · tie broken by the host' }[fp.how] || '';
  const link = w ? w.r.mapsUri || (w.r.osm ? `https://www.openstreetmap.org/${w.r.osm}` : `https://www.google.com/maps/search/?api=1&query=${w.r.lat},${w.r.lon}`) : '';
  const plan = w ? `KHAO says: ${w.r.name} (${w.r.cuisineLabel}) on ${dates[0] ? fmtDate(dates[0]) : 'TBD'} 🍽️ ${link}` : '';
  return {
    html: w ? `
    <section class="winner">
      <p class="eyebrow">It’s a match — ${w.pct}% of the squad${how}</p>
      ${photoBg(w.r, 800) ? `<div class="w-photo" style="${photoBg(w.r, 800)}"><span class="photo-credit">${w.r.photos[0].by ? `Photo: ${esc(w.r.photos[0].by)} · ` : ''}Google</span></div>` : `<span class="w-emoji">${CUISINE_BY_ID[w.r.cuisineId].emoji}</span>`}
      <h1 class="mega small">${esc(w.r.name)}</h1>
      <p class="w-meta">${esc(w.r.cuisineLabel)} · ${w.r.distKm} km from midpoint</p>
      <div class="badges center">${ratingTag(w.r)}${budgetTag(w.r)}${dietBadges(w.r)}${w.supers ? `<span class="badge ok">★ ${w.supers} obsessed</span>` : ''}</div>
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

function openSheet(id) {
  const r = placeList().find(x => x.id === id);
  if (!r) return;
  sheetRid = id;
  const score = restScores().find(x => x.r.id === id);
  const q = encodeURIComponent(`${r.name} ${r.addr || G.meet?.label || ''}`);
  const google = r.g && GKEY;
  // Google's own map for every spot. With a key, the official Embed API (free, unlimited) shows Google's
  // place card with its rating; without one, the classic keyless embed pins the exact coordinates.
  const mapQuery = `${r.name}, ${r.addr || G.meet?.label || ''}`;
  const mapSrc = GKEY
    ? `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(GKEY)}&q=${r.g ? `place_id:${encodeURIComponent(r.id)}` : encodeURIComponent(mapQuery)}&center=${r.lat},${r.lon}&zoom=16`
    : `https://maps.google.com/maps?q=${r.lat},${r.lon}&z=17&output=embed`;
  const reviewsUrl = r.mapsUri || `https://www.google.com/maps/search/?api=1&query=${q}`;
  const sheet = $('#sheet');
  sheet.innerHTML = `
    <div class="sheet-bg" data-close></div>
    <div class="sheet-panel" role="dialog" aria-label="${esc(r.name)}">
      <button class="sheet-x" data-close aria-label="Close">✕</button>
      <div class="map" id="map"><iframe title="Map of ${esc(r.name)}" referrerpolicy="no-referrer-when-downgrade" allowfullscreen
             src="${esc(mapSrc)}"></iframe></div>
      ${google && r.photos?.length ? `<div class="gallery">${r.photos.map(ph => `<figure>
          <img loading="lazy" src="${photoUrl(ph.name, GKEY, 800)}" alt="Photo of ${esc(r.name)}">
          <figcaption>${ph.by ? `Photo: ${ph.byUri ? `<a target="_blank" rel="noopener" href="${esc(ph.byUri)}">${esc(ph.by)}</a>` : esc(ph.by)}` : 'Photo'} · Google</figcaption>
        </figure>`).join('')}</div>` : ''}
      <div class="sheet-body">
        <p class="eyebrow">${esc(r.cuisineLabel)}${r.demo ? ' · Demo data' : ''}</p>
        <h2 class="title sm">${esc(r.name)}</h2>
        <div class="badges">${ratingTag(r)}${budgetTag(r)}<span class="badge">${r.distKm} km</span>${dietBadges(r)}${r.delivery ? '<span class="badge">Delivers</span>' : ''}${r.outdoor ? '<span class="badge">Outdoor seating</span>' : ''}</div>
        <div class="stats">
          <div><b>${score && G.stage === 'results' ? score.pct + '%' : '—'}</b><span>${G.stage === 'results' ? 'Squad match' : 'Match after voting'}</span></div>
          ${r.rating ? `<div><b>★ ${r.rating.toFixed(1)}</b><span>${fmtCount(r.ratingCount)} Google ratings</span></div>` : ''}
          <div><b id="avgStars">—</b><span>Squad rating</span></div>
          <div><b>${'₹'.repeat(r.budget)}</b><span>${r.priceText ? r.priceText + ' per person' : BUDGETS[r.budget - 1].label}</span></div>
        </div>
        <dl class="facts">
          ${r.addr ? `<dt>Address</dt><dd>${esc(r.addr)}</dd>` : ''}
          ${r.week?.length ? `<dt>Hours</dt><dd>${r.hours ? `<b>${esc(r.hours)}</b><br>` : ''}${r.week.map(esc).join('<br>')}</dd>` : r.hours ? `<dt>Hours</dt><dd>${esc(r.hours)}</dd>` : ''}
          ${r.phone ? `<dt>Phone</dt><dd><a href="tel:${esc(r.phone)}">${esc(r.phone)}</a></dd>` : ''}
          ${r.instagram ? `<dt>Insta</dt><dd><a target="_blank" rel="noopener" href="${esc(r.instagram)}">${esc(r.instagram.replace(/^https?:\/\/(www\.)?instagram\.com\//, '@').replace(/\/$/, ''))}</a></dd>` : ''}
          ${r.website ? `<dt>Web</dt><dd><a target="_blank" rel="noopener" href="${esc(r.website)}">${esc(r.website.replace(/^https?:\/\//, ''))}</a></dd>` : ''}
          <dt>Diet</dt><dd>${dietBadges(r) || 'Not listed — call ahead if strict.'}</dd>
        </dl>
        <div class="btn-row">
          <a class="btn primary" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lon}${r.g ? `&destination_place_id=${encodeURIComponent(r.id)}` : ''}">Directions</a>
          <a class="btn ghost" target="_blank" rel="noopener" href="${esc(reviewsUrl)}">${r.g ? 'Open in Google Maps ↗' : 'Photos &amp; reviews ↗'}</a>
        </div>
        ${r.gReviews?.length ? `<section class="reviews g-reviews">
          <div class="count-row"><span class="eyebrow">Google reviews</span></div>
          <ul>${r.gReviews.map(rv => `<li><div><b>${rv.authorUri ? `<a target="_blank" rel="noopener" href="${esc(rv.authorUri)}">${esc(rv.author)}</a>` : esc(rv.author)}</b>
            <span class="st">${'★'.repeat(Math.round(rv.rating))}${'☆'.repeat(5 - Math.round(rv.rating))}</span> <small>${esc(rv.when)}</small>
            ${rv.text ? `<p>${esc(rv.text)}</p>` : ''}</div></li>`).join('')}</ul>
        </section>` : ''}
        <section class="reviews">
          <div class="count-row"><span class="eyebrow">Squad reviews</span></div>
          <ul id="revList"></ul>
          <form id="revForm" class="rev-form">
            <div class="stars" id="stars">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-s="${n}">★</button>`).join('')}</div>
            <textarea name="text" maxlength="280" rows="2" placeholder="Been here? The butter chicken was…"></textarea>
            <button class="btn small">Post review</button>
          </form>
        </section>
        <p class="fine">${r.g ? 'Place info, photos and reviews from Google Maps.' : r.id.startsWith('o') ? 'Place data: Overture Maps Foundation (Meta, Microsoft, Foursquare &amp; more). Map: Google.' : 'Place data © OpenStreetMap contributors. Map: Google.'} Squad ratings come only from people in this plan.</p>
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

// ---------- test friends: simulated squad members, driven by the host's device
function runBots() {
  if (!isHost()) return;
  const st = G.stage;
  let n = 0;
  // Tie-break runoff: test friends pick one of the tied spots once you've picked.
  if (st === 'results' && G.runoff?.[me] && !G.runoffClosed && !needsHydrate()) {
    const fp = finalPick();
    if (fp.phase !== 'vote') return;
    for (const [uid, m] of members()) {
      if (!m.bot || G.runoff?.[uid] || botTimers.has(uid + 'runoff')) continue;
      botTimers.add(uid + 'runoff');
      const choice = fp.tied[Math.floor(Math.random() * fp.tied.length)].r.id;
      setTimeout(() => set(`runoff/${uid}`, choice), 1500 + n++ * 1500 + Math.random() * 800);
    }
    return;
  }
  // Test friends only answer after you've locked in, one at a time, so you're never rushed.
  if (!GATED.includes(st) || !G.done?.[st]?.[me]) return;
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
    await set(`cuisineVotes/${uid}`, Object.fromEntries(allowedCuisines().map(c => [c.id, pick(.4)])));
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
