// Free place data: OpenStreetMap via Nominatim (search) and Overpass (restaurants). No keys, no billing.
// Please keep it polite: Nominatim allows ~1 request/second, so search input is debounced in the UI.
import { CUISINES, CUISINE_BY_ID } from './data.js';

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const NOMINATIM = 'https://nominatim.openstreetmap.org';

const shortLabel = s => s.split(',').map(x => x.trim()).filter(x => !/^\d{6}$/.test(x) && x !== 'India').slice(0, 3).join(', ');

export async function geocode(q) {
  const r = await fetch(`${NOMINATIM}/search?format=jsonv2&countrycodes=in&limit=6&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } });
  if (!r.ok) throw new Error('Search failed');
  return (await r.json()).map(x => ({ label: shortLabel(x.display_name), lat: +x.lat, lon: +x.lon }));
}

export async function reverseGeocode(lat, lon) {
  try {
    const r = await fetch(`${NOMINATIM}/reverse?format=jsonv2&zoom=16&lat=${lat}&lon=${lon}`, { headers: { 'Accept-Language': 'en' } });
    const j = await r.json();
    return shortLabel(j.display_name || 'My location');
  } catch { return 'My location'; }
}

export function distKm(a, b) {
  const R = 6371, toR = d => d * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function getJSON(url, opts = {}, ms = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error(url + ' ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

// Ask every mirror at once and take the first answer, so one slow server can't stall the squad.
function overpass(q) {
  return Promise.any(OVERPASS.map(url => getJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(q),
  }))).then(j => j.elements || []);
}

// Photon (komoot) is a free OSM search engine. Fewer tags than Overpass, but a solid fallback.
const FOOD = new Set(['restaurant', 'fast_food', 'cafe', 'food_court', 'ice_cream']);
async function photon(def, origin) {
  const batches = await Promise.allSettled(def.q.slice(0, 2).map(q =>
    getJSON(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${origin.lat}&lon=${origin.lon}&limit=15&osm_tag=amenity&lang=en`, {}, 12000)));
  return batches.flatMap(b => b.status === 'fulfilled' ? b.value.features : [])
    .filter(f => FOOD.has(f.properties.osm_value) && f.properties.name)
    .filter(f => {
      // Drop fuzzy hits whose name clearly belongs to another cuisine ("… South Indian Kitchen" under North Indian).
      const n = f.properties.name.toLowerCase();
      const own = def.q.some(k => n.includes(k));
      return own || !CUISINES.some(c => c !== def && c.q.some(k => k.length > 4 && n.includes(k)));
    })
    .map(f => {
      const p = f.properties;
      return {
        type: { N: 'node', W: 'way', R: 'relation' }[p.osm_type] || 'node', id: p.osm_id,
        lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
        tags: {
          name: p.name, amenity: p.osm_value, cuisine: def.name,
          'addr:housenumber': p.housenumber, 'addr:street': p.street, 'addr:suburb': p.district || p.locality, 'addr:city': p.city,
        },
      };
    });
}

const PREMIUM = new Set(['japanese', 'continental', 'korean', 'coastal']);
function estimateBudget(amenity, cuisineId, tags) {
  let b = { fast_food: 1, food_court: 1, ice_cream: 1, cafe: 2, restaurant: 2 }[amenity] || 2;
  if (PREMIUM.has(cuisineId) && amenity === 'restaurant') b++;
  if (tags.cuisine && /fine_dining/.test(tags.cuisine)) b = 4;
  return Math.min(b, 4);
}

function normalize(el, def, origin) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  const yn = v => (v === 'yes' || v === 'only' || v === 'no') ? v : '';
  return {
    id: el.type[0] + el.id,
    osm: `${el.type}/${el.id}`,
    name: t.name,
    cuisineId: def.id,
    cuisineLabel: (t.cuisine || def.name).split(';').map(s => s.replace(/_/g, ' ')).slice(0, 3).join(' · '),
    amenity: t.amenity,
    lat, lon,
    distKm: +distKm(origin, { lat, lon }).toFixed(1),
    budget: estimateBudget(t.amenity, def.id, t),
    diet: { veg: yn(t['diet:vegetarian']), vegan: yn(t['diet:vegan']), jain: yn(t['diet:jain']), halal: yn(t['diet:halal']) },
    addr: [t['addr:housenumber'], t['addr:street'], t['addr:suburb'] || t['addr:neighbourhood'], t['addr:city']].filter(Boolean).join(', '),
    hours: t.opening_hours || '',
    phone: t.phone || t['contact:phone'] || '',
    website: t.website || t['contact:website'] || '',
    instagram: t['contact:instagram'] || '',
    delivery: t.delivery === 'yes',
    outdoor: t.outdoor_seating === 'yes',
  };
}

const richness = r => ['addr', 'hours', 'phone', 'website'].filter(k => r[k]).length + Object.values(r.diet).filter(Boolean).length;

function demoPlaces(defs, origin) {
  return defs.flatMap(d => ['Social', 'House', 'Corner'].map((suffix, i) => ({
    id: `demo-${d.id}-${i}`, demo: true, name: `${d.name.split(' ')[0]} ${suffix}`,
    cuisineId: d.id, cuisineLabel: d.name, amenity: 'restaurant',
    lat: origin.lat + (Math.random() - .5) * .03, lon: origin.lon + (Math.random() - .5) * .03,
    distKm: +(0.4 + Math.random() * 3).toFixed(1), budget: 1 + Math.floor(Math.random() * 3),
    diet: { veg: d.veg ? 'yes' : '', vegan: '', jain: '', halal: '' },
    addr: '', hours: '', phone: '', website: '', instagram: '', delivery: false, outdoor: false,
  })));
}

// Returns up to 6 places per cuisine, interleaved so the deck alternates cuisines.
export async function findRestaurants({ lat, lon, cuisines }) {
  const origin = { lat, lon };
  const defs = cuisines.map(id => CUISINE_BY_ID[id]).filter(Boolean);
  const regexes = defs.map(d => new RegExp(d.osm, 'i'));
  const all = defs.map(d => d.osm).join('|');
  let byCuisine = {};
  let source = 'osm';
  const add = (el, def, seen) => {
    const key = (el.tags?.name || '').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    (byCuisine[def.id] ||= []).push(normalize(el, def, origin));
  };
  try {
    for (const radius of [3000, 7000]) {
      const q = `[out:json][timeout:20];nwr["amenity"~"^(restaurant|fast_food|cafe|food_court|ice_cream)$"]["name"]["cuisine"~"${all}",i](around:${radius},${lat},${lon});out center tags 400;`;
      const els = await overpass(q);
      byCuisine = {};
      const seen = new Set();
      for (const el of els) {
        const idx = regexes.findIndex(re => re.test((el.tags?.cuisine || '').toLowerCase()));
        if (idx >= 0) add(el, defs[idx], seen);
      }
      if (defs.every(d => (byCuisine[d.id] || []).length >= 4)) break;
    }
  } catch (e) {
    console.warn('Overpass unavailable, trying Photon', e);
  }
  if (Object.values(byCuisine).flat().length < 6) {
    const seen = new Set(Object.values(byCuisine).flat().map(r => r.name.toLowerCase()));
    const found = await Promise.all(defs.map(d => photon(d, origin).catch(() => [])));
    found.forEach((els, i) => els.forEach(el => add(el, defs[i], seen)));
    for (const id in byCuisine) byCuisine[id] = byCuisine[id].filter(r => r.distKm <= 12);
  }
  for (const id in byCuisine) {
    byCuisine[id].sort((a, b) => (b.distKm < 1.5 ? 1 : 0) - (a.distKm < 1.5 ? 1 : 0) || richness(b) - richness(a) || a.distKm - b.distKm);
  }
  let lists = defs.map(d => (byCuisine[d.id] || []).slice(0, 6));
  if (lists.flat().length < 3) {
    source = 'demo';
    const demo = demoPlaces(defs, origin);
    lists = defs.map(d => demo.filter(x => x.cuisineId === d.id));
  }
  const out = [];
  for (let i = 0; i < 6; i++) lists.forEach(l => l[i] && out.push(l[i]));
  return { source, list: out };
}
