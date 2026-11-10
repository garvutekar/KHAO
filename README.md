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
| Area search / reverse geocode | Nominatim (OpenStreetMap) | Free, about 1 req/s |
| Restaurants with photos, ratings, reviews | Google Places API (New), when a key is set | Free monthly allowance, then billed |
| Restaurants (no key) | Overpass API (OSM), Photon (komoot) as fallback | Free |
| Map | Leaflet + OpenStreetMap tiles | Free with attribution |
| Real-time group sync | Firebase Realtime Database (REST + SSE, no SDK) | Free Spark plan |
| Hosting | GitHub Pages / Netlify / Vercel / Cloudflare Pages | Free |

Ratings and reviews come from the **squad itself** (stars and a note per person). There's also a "Public reviews" link-out to Google Maps. No paid Places API is used, so KHAO doesn't make up ratings.
Budget tiers are **estimates** based on place type and cuisine, because OSM rarely stores prices.

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

## Google Places (optional, for photos, ratings and reviews)
Put a browser key in `config.js` as `googleMapsKey`. Leave it empty to use free OpenStreetMap data.
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
