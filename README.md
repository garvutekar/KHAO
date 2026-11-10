# KHAO — swipe. match. eat.

A Tinder-style PWA for Indian couples and friend groups to decide where to eat.
Plain HTML/CSS/JS with no build step, no paid APIs and no API keys.

## Flow
1. **Squad**: host creates a plan and shares the link (WhatsApp / copy / native share). Friends join from the link.
2. **Dates**: everyone taps the days they're free, with live dots showing who else is free.
3. **Prefs**: best common date is shown; everyone picks diet (Veg / Egg / Non-veg / Jain / Vegan), spice and allergies.
4. **Spot + ₹**: everyone drops their area (search or GPS) and budget. KHAO uses the **midpoint** and the median budget.
5. **Cuisines**: swipe 18 cuisines (right = yum, left = nah, up = obsessed). The top 3 win.
6. **Places**: swipe on real nearby restaurants for those 3 cuisines.
7. **The match**: the winner plus a leaderboard. Tap any spot for the map, address, hours, diet info, budget, squad reviews and directions.

Each step waits until everyone is done. The host can skip people who are too slow.

## Free stack
| Need | Service | Cost |
|---|---|---|
| Restaurants: all of India, tier 1 cities to small towns (~280k places) | **Overture Maps** places, pre-built into `data/tiles/` and served with the app | Free, unlimited |
| Restaurants (if no tiles nearby) | OpenStreetMap: Overpass, with Photon as backup | Free |
| Area search | Nominatim (OpenStreetMap), with district/state results skipped | Free, about 1 req/s |
| Restaurant map | Google Maps embed (keyless; or the official Embed API with a key) | Free, unlimited |
| Group sync | Firebase Realtime Database (REST + SSE, no SDK) | Free Spark plan |
| Hosting | GitHub Pages | Free |

There are no restaurant photos, and ratings come from the squad itself. The **Photos & reviews** button opens the place on Google Maps.

## Restaurant data: Overture tiles
`tools/build_tiles.py` queries [Overture Maps](https://overturemaps.org) for every food place in India and its neighbours. It keeps food spots (no bars, confidence ≥ 0.45, not closed) and writes 0.05° tiles (about 5 km squares) to `data/tiles/`. The app only loads the tiles around the squad's meeting point; a missing tile means no places there.

Cuisine matching, strongest first:
1. The name says it ("… Misal", "… Biryani", "Udupi …")
2. A specific Overture category (pizza_restaurant, chinese_restaurant…)
3. The broad "indian_restaurant" category, only to top up a short list

Bars are ranked lower, and delivery-only cloud kitchens are skipped.

Refresh after a new Overture release (monthly, about 1 minute):
```bash
python3 -m venv .venv && .venv/bin/pip install duckdb certifi
.venv/bin/python tools/build_tiles.py
```
Data licences: CDLA-Permissive-2.0, Apache-2.0 or CC0, per record.

## Run locally
```bash
python3 -m http.server 5173
```
Open http://localhost:5173. Without config the app runs in **local mode**: groups sync between tabs on one device, and the host can add "test friends" who vote automatically. This is handy for demos.

## Real multi-phone groups (about 2 minutes, free)
1. Go to https://console.firebase.google.com, create a project, then **Build → Realtime Database → Create database**.
2. Under **Rules**, paste:
   ```json
   { "rules": { "groups": { "$gid": { ".read": true, ".write": true } } } }
   ```
   Groups are only reachable by their random link ID. For production, add Firebase Auth (anonymous) and tighten these rules.
3. Copy the database URL into `config.js` as `firebaseUrl`.
4. Deploy the folder to any static host over HTTPS. The PWA then installs to the home screen.

## Diet rules
Diet comes from everyone's prefs. Veg, Jain, Vegan and Eggetarian all count as "no meat".
- **Everyone no-meat:** meat-only cuisines (steak, seafood, sushi, Korean, Bengali) are hidden. Places known to have no veg food are dropped, and pure-veg spots stay in.
- **A mix:** only cuisines with both veg and non-veg options are shown, and only places serving both. Pure-veg places (including Udupi / "Sagar" / "Bhavan" names) and meat-only places are left out.
- **Everyone non-veg:** no filter.

## Google (optional)
- `googleMapsKey` with only **Maps Embed API** enabled (free, unlimited) gives the official map with Google's place card and rating.
- Setting `useGooglePlaces: true` as well (and enabling **Places API (New)**) switches restaurant search to paid Google Places, which adds photos, ratings and reviews. Billing is required.
1. In Google Cloud Console, use the same project as Firebase (`khao-10c77`) and turn on **billing**. Google gives a free monthly allowance per API.
2. Enable **Places API (New)** and **Maps Embed API**.
3. Go to **Credentials → Create credentials → API key**, then restrict it:
   - **Application restriction:** Websites, set to `https://garvutekar.github.io/*` and `http://localhost:5174/*`
   - **API restriction:** Places API (New) and Maps Embed API
4. Set a **quota or budget alert** so testing can't run up a bill.

How it's used: Nearby Search for cuisines Google has a type for (Chinese, pizza, burgers…), and Text Search for the rest (biryani, chaat, thali, dosa…). Firebase stores **only place IDs and coordinates**, because Google's terms don't allow storing Places content. Each phone loads names, photos and reviews from Google itself.

## Files
- `index.html`, `styles.css`: shell and design system (neutral palette, condensed display type, mono labels)
- `app.js`: screens, swipe deck, stage gating, detail sheet, test friends
- `store.js`: sync layer (localStorage or Firebase REST/SSE)
- `places.js`: Nominatim, Overpass and Photon lookups
- `data.js`: cuisines, budgets, diets
- `sw.js`, `manifest.webmanifest`, `icons/`: PWA bits
