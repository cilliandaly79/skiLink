"""Pre-download run & lift data for the preset resorts from OpenStreetMap (Overpass API).

Usage:  python tools/fetch_resorts.py              # all presets not downloaded yet
        python tools/fetch_resorts.py zermatt      # just one
        python tools/fetch_resorts.py --force      # re-download everything

Writes data/<id>.json, which index.html loads instantly instead of waiting on Overpass.
Large resorts are fetched in small tiles, because the public Overpass servers time out
on big areas. Keep RESORTS in sync with the RESORTS list in index.html.
"""
import json, math, sys, time, urllib.parse, urllib.request
from pathlib import Path

RESORTS = {
    # European Alps first
    "zermatt":    (45.920,    7.660, 46.030,    7.800),
    "stanton":    (47.100,   10.150, 47.170,   10.300),
    "valthorens": (45.260,    6.530, 45.330,    6.620),
    "verbier":    (46.060,    7.180, 46.130,    7.330),
    "ischgl":     (46.930,   10.250, 47.020,   10.380),
    "solden":     (46.900,   10.880, 46.990,   11.030),
    "kitzbuehel": (47.380,   12.300, 47.460,   12.420),
    "courchevel": (45.360,    6.540, 45.440,    6.670),
    # extra pieces that, with the resorts above, make up the ski-pass areas (see PASSES in index.html)
    "3v-belleville": (45.330,  6.480, 45.365,  6.680),   # Les Menuires / St-Martin: joins Val Thorens to Méribel
    "arlberg-lech":  (47.165, 10.050, 47.270, 10.250),   # Lech, Zürs, Warth-Schröcken
    "4v-nendaz":     (46.120,  7.250, 46.210,  7.420),   # Nendaz, Veysonnaz, Thyon
    "cervinia":      (45.850,  7.580, 45.950,  7.720),   # Breuil-Cervinia, Valtournenche
    "kitz-south":    (47.300, 12.300, 47.385, 12.470),   # Jochberg, Pass Thurn
    # rest of the world
    "jackson":    (43.565, -110.885, 43.615, -110.800),
    "whistler":   (50.030, -123.000, 50.130, -122.850),
    "vail":       (39.570, -106.450, 39.650, -106.300),
    "niseko":     (42.820,  140.620, 42.890,  140.720),
}
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
TILE = 0.05  # degrees


def query(b):
    b = ",".join(f"{v:.4f}" for v in b)
    return (f'[out:json][timeout:60];(way["piste:type"="downhill"]({b});way["aerialway"]({b});'
            f'way["railway"="funicular"]({b});way["railway"]["rack"]({b}););out body geom;'
            f'wr["landuse"="winter_sports"]["name"]({b});out tags center;')


def fetch(bbox):
    data = urllib.parse.urlencode({"data": query(bbox)}).encode()
    for attempt in range(4):
        for url in ENDPOINTS:
            try:
                req = urllib.request.Request(url, data=data, headers={"User-Agent": "PisteMap-prototype/0.1"})
                with urllib.request.urlopen(req, timeout=90) as r:
                    return json.load(r)
            except Exception as e:
                print(f"    {url.split('/')[2]}: {e}", flush=True)
        time.sleep(15 * (attempt + 1))
    raise RuntimeError("all Overpass endpoints failed")


def tiles(bbox):
    s, w, n, e = bbox
    ny, nx = max(1, math.ceil((n - s) / TILE - 1e-9)), max(1, math.ceil((e - w) / TILE - 1e-9))
    for i in range(ny):
        for j in range(nx):
            yield (s + (n - s) * i / ny, w + (e - w) * j / nx, s + (n - s) * (i + 1) / ny, w + (e - w) * (j + 1) / nx)


def main():
    out = Path(__file__).resolve().parent.parent / "data"
    out.mkdir(exist_ok=True)
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    failed = []
    for rid in args or list(RESORTS):
        path = out / f"{rid}.json"
        if path.exists() and not force and not args:
            print(f"{rid}: already downloaded", flush=True)
            continue
        t = time.time()
        ts = list(tiles(RESORTS[rid]))
        print(f"{rid}: {len(ts)} tile(s)", flush=True)
        merged = {}
        try:
            for k, tb in enumerate(ts):
                osm = fetch(tb)
                for e in osm["elements"]:
                    item = {"type": e["type"], "id": e["id"], "tags": e.get("tags", {})}
                    if "nodes" in e:
                        item["nodes"] = e["nodes"]
                        item["geometry"] = [[round(p["lat"], 6), round(p["lon"], 6)] for p in e["geometry"]]
                    merged[(e["type"], e["id"])] = item  # ways crossing tile edges come back whole; dedupe
                print(f"  tile {k + 1}/{len(ts)} ok", flush=True)
        except RuntimeError as e:
            print(f"{rid}: FAILED ({e})", flush=True)
            failed.append(rid)
            continue
        path.write_text(json.dumps({"elements": list(merged.values())}, separators=(",", ":")), encoding="utf-8")
        print(f"{rid}: DONE {len(merged)} elements in {time.time() - t:.0f}s", flush=True)
    print("ALL FINISHED" + (f" - failed: {', '.join(failed)}" if failed else ""), flush=True)


if __name__ == "__main__":
    main()
