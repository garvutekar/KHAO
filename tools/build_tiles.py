"""Build KHAO's restaurant tiles from Overture Maps places.

Downloads Overture places for each city box, keeps food & drink spots, and writes
small JSON tiles (0.05° ≈ 5.5 km squares) to data/tiles/, plus data/tiles/index.json.
The app loads only the tiles around a squad's meeting point, so search is free and unlimited.

Usage (from the repo root):
    python3 -m venv .venv && .venv/bin/pip install overturemaps duckdb certifi
    .venv/bin/python tools/build_tiles.py              # all cities
    .venv/bin/python tools/build_tiles.py bengaluru    # just one

Data: Overture Maps Foundation places (CDLA-Permissive-2.0 / Apache-2.0 / CC0 per record).
"""
import json
import math
import os
import subprocess
import sys
import tempfile

import certifi
import duckdb

os.environ.setdefault('SSL_CERT_FILE', certifi.where())

# (min lon, min lat, max lon, max lat)
CITIES = {
    'mumbai':     (72.77, 18.88, 73.15, 19.32),  # incl. Thane, Navi Mumbai
    'delhi-ncr':  (76.85, 28.38, 77.55, 28.90),  # Delhi, Gurugram, Noida
    'bengaluru':  (77.45, 12.83, 77.80, 13.15),
    'hyderabad':  (78.25, 17.25, 78.65, 17.60),
    'chennai':    (80.10, 12.85, 80.33, 13.23),
    'kolkata':    (88.22, 22.45, 88.50, 22.70),
    'pune':       (73.70, 18.42, 74.00, 18.65),
    'ahmedabad':  (72.45, 22.92, 72.70, 23.13),
    'jaipur':     (75.70, 26.80, 75.90, 27.00),
    'chandigarh': (76.65, 30.62, 76.88, 30.80),
    'lucknow':    (80.85, 26.75, 81.05, 26.95),
    'kochi':      (76.20,  9.90, 76.40, 10.10),
    'goa':        (73.68, 15.20, 74.00, 15.62),
    'indore':     (75.78, 22.65, 75.95, 22.80),
}

TILE = 0.05
MIN_CONFIDENCE = 0.45
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'tiles')
# Bars, breweries etc. aren't dinner spots for this app.
SKIP = ('alcoholic_beverage_venue',)


def tile_key(lat, lon):
    return f'{math.floor(lat / TILE)}_{math.floor(lon / TILE)}'


def download(city, bbox, tmp):
    path = os.path.join(tmp, f'{city}.parquet')
    cli = os.path.join(os.path.dirname(sys.executable), 'overturemaps')
    subprocess.run([cli, 'download', '--bbox=' + ','.join(map(str, bbox)),
                    '-f', 'geoparquet', '-t', 'place', '-o', path], check=True)
    return path


def release_of(path):
    state = path + '.state'
    try:
        return json.load(open(state)).get('last_release', '')
    except Exception:
        return ''


def rows(path):
    con = duckdb.connect()
    con.execute('load spatial')
    skip = ' and '.join(f"not list_contains(taxonomy.hierarchy, '{s}')" for s in SKIP)
    return con.execute(f"""
        select id, names.primary, ST_Y(geometry), ST_X(geometry), taxonomy.primary, confidence,
               coalesce(addresses[1].freeform, '') || coalesce(', ' || addresses[1].locality, ''),
               coalesce(phones[1], ''), coalesce(websites[1], ''), coalesce(socials[1], '')
        from read_parquet('{path}')
        where list_contains(taxonomy.hierarchy, 'food_and_drink') and {skip}
          and confidence >= {MIN_CONFIDENCE}
          and coalesce(operating_status, 'open') = 'open'
          and names.primary is not null
    """).fetchall()


def main():
    wanted = sys.argv[1:] or list(CITIES)
    os.makedirs(OUT, exist_ok=True)
    index_path = os.path.join(OUT, 'index.json')
    index = json.load(open(index_path)) if os.path.exists(index_path) else {'tile': TILE, 'cities': {}, 'tiles': []}
    tiles = {}
    with tempfile.TemporaryDirectory() as tmp:
        duckdb.connect().execute('install spatial')
        for city in wanted:
            bbox = CITIES[city]
            path = download(city, bbox, tmp)
            index['release'] = release_of(path) or index.get('release', '')
            n = 0
            for gid, name, lat, lon, cat, conf, addr, phone, web, social in rows(path):
                rec = [gid.replace('-', '')[:16], name, round(lat, 5), round(lon, 5), cat or 'restaurant',
                       round(conf, 2), addr.strip(', '), phone, web, social]
                tiles.setdefault(tile_key(lat, lon), []).append(rec)
                n += 1
            index['cities'][city] = {'bbox': bbox, 'places': n}
            print(f'{city}: {n} food places')
    for key, recs in tiles.items():
        recs.sort(key=lambda r: -r[5])
        with open(os.path.join(OUT, f'{key}.json'), 'w') as f:
            json.dump(recs, f, ensure_ascii=False, separators=(',', ':'))
    index['tiles'] = sorted(set(index['tiles']) | set(tiles))
    with open(index_path, 'w') as f:
        json.dump(index, f, separators=(',', ':'))
    print(f'{len(tiles)} tiles written, {len(index["tiles"])} total')


if __name__ == '__main__':
    main()
