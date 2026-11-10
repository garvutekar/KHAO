"""Build KHAO's restaurant tiles from Overture Maps places.

Queries Overture's public S3 bucket for every food & drink place in the Indian subcontinent
(tier 1 and 2 cities, towns and villages alike), and writes small JSON tiles
(0.05° ≈ 5.5 km squares) to data/tiles/, plus data/tiles/index.json.
The app loads only the tiles around a squad's meeting point, so search is free and unlimited.

Usage (from the repo root, ~1 minute):
    python3 -m venv .venv && .venv/bin/pip install duckdb certifi
    .venv/bin/python tools/build_tiles.py

Data: Overture Maps Foundation places (CDLA-Permissive-2.0 / Apache-2.0 / CC0 per record).
"""
import json
import math
import os
import shutil
import urllib.request

import certifi
import duckdb

os.environ.setdefault('SSL_CERT_FILE', certifi.where())

# India plus neighbours (min lon, min lat, max lon, max lat).
REGION = (68.0, 6.5, 97.5, 35.7)
TILE = 0.05
MIN_CONFIDENCE = 0.45
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'tiles')


def latest_release():
    with urllib.request.urlopen('https://stac.overturemaps.org/catalog.json', timeout=30) as r:
        return json.load(r)['latest']


def tile_key(lat, lon):
    return f'{math.floor(lat / TILE)}_{math.floor(lon / TILE)}'


def rows(release):
    con = duckdb.connect()
    con.execute("install httpfs; load httpfs; install spatial; load spatial; set s3_region='us-west-2';")
    x0, y0, x1, y1 = REGION
    src = f's3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*'
    return con.execute(f"""
        select id, names.primary, ST_Y(geometry), ST_X(geometry), taxonomy.primary, confidence,
               coalesce(addresses[1].freeform, '') || coalesce(', ' || addresses[1].locality, ''),
               coalesce(phones[1], ''), coalesce(websites[1], ''), coalesce(socials[1], '')
        from read_parquet('{src}', hive_partitioning=1)
        where bbox.xmin between {x0} and {x1} and bbox.ymin between {y0} and {y1}
          and list_contains(taxonomy.hierarchy, 'food_and_drink')
          and not list_contains(taxonomy.hierarchy, 'alcoholic_beverage_venue')
          and confidence >= {MIN_CONFIDENCE}
          and coalesce(operating_status, 'open') = 'open'
          and names.primary is not null
    """).fetchall()


def main():
    release = latest_release()
    print(f'Overture release {release}: querying food places…')
    tiles = {}
    for gid, name, lat, lon, cat, conf, addr, phone, web, social in rows(release):
        tiles.setdefault(tile_key(lat, lon), []).append([
            gid.replace('-', '')[:16], name, round(lat, 5), round(lon, 5), cat or 'restaurant',
            round(conf, 2), addr.strip(', '), phone, web, social])
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)
    for key, recs in tiles.items():
        recs.sort(key=lambda r: -r[5])
        with open(os.path.join(OUT, f'{key}.json'), 'w') as f:
            json.dump(recs, f, ensure_ascii=False, separators=(',', ':'))
    total = sum(map(len, tiles.values()))
    with open(os.path.join(OUT, 'index.json'), 'w') as f:
        # No tile list: the app just asks for nearby tiles, and a missing one means "no places here".
        json.dump({'release': release, 'tile': TILE, 'region': REGION, 'places': total, 'count': len(tiles)},
                  f, separators=(',', ':'))
    print(f'{total} places in {len(tiles)} tiles')


if __name__ == '__main__':
    main()
