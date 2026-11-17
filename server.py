"""PisteMap dev server: serves the app and a live lift/run status API.

    python server.py            # http://localhost:5174

GET /api/status/<resort-id>  ->  {"resort", "available", "sources", "updated", "lifts": [...], "runs": [...]}
  each item: {"name", "status": "open"|"closed"|"scheduled", "number", "kind", "difficulty"}

Status comes from the resorts' own public feeds (Intermaps, Lumiplan, infosnow, resort APIs).
Browsers can't read those feeds directly (cross-site restrictions), so this server fetches,
parses and caches them (2 minutes), and the app polls it. Standard library only.
"""
import html, json, re, sys, threading, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 PisteMap/0.1"
CACHE_SECONDS = 120

# resort id (same as index.html RESORTS) -> list of (feed type, feed id)
FEEDS = {
    "stanton":    [("intermaps", "skiarlberg")],
    "solden":     [("intermaps", "soelden")],
    "ischgl":     [("intermaps", "silvretta_arena")],
    "kitzbuehel": [("intermaps", "kitzski")],
    "courchevel": [("lumiplan", "courchevel"), ("lumiplan", "meribel")],
    "valthorens": [("lumiplan", "val-thorens"), ("lumiplan", "les-menuires"), ("lumiplan", "orelle")],
    "verbier":    [("infosnow", "31")],
    "jackson":    [("jacksonhole", "")],
}
SOURCE_PAGES = {
    "intermaps": "https://winter.intermaps.com/{id}/data?lang=en",
    "lumiplan": "https://bulletinv3.lumiplan.pro/bulletin.php?station={id}&lang=en",
    "infosnow": "https://www.infosnow.ch/~apgmontagne/?lang=en&pid={id}&tab=web-wi",
    "jacksonhole": "https://www.jacksonhole.com/api/all.json",
}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
    with urllib.request.urlopen(req, timeout=20) as r:
        raw, cs = r.read(), r.headers.get_content_charset()
    for enc in filter(None, [cs, "utf-8"]):
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            pass
    return raw.decode("latin-1")   # older resort pages are ISO-8859-1


def norm_status(s):
    s = (s or "").lower()
    if "open" in s and "not" not in s:
        return "open"
    if any(k in s for k in ("schedul", "prepar", "forecast", "delay", "wait", "hold", "expected")):
        return "scheduled"
    return "closed"


# ---------------------------------------------------------------- feed parsers
def parse_intermaps(fid):
    d = json.loads(get(SOURCE_PAGES["intermaps"].format(id=fid)))
    lifts, runs = [], []
    for key, out in (("lifts", lifts), ("slopes", runs)):
        for it in d.get(key) or []:
            p = it.get("popup") or {}
            title = p.get("title") or ""
            if not title:
                continue
            out.append({"name": title, "status": norm_status(p.get("status") or it.get("status")),
                        "number": str(p.get("number") or it.get("number") or "") or None,
                        "kind": p.get("subtitle") or ""})
    return lifts, runs


LP_LIFT = ("GONDOLA", "CHAIRLIFT", "SURFACE_LIFT", "MAGIC_CARPET", "CABLE_CAR", "FUNICULAR", "TRAIN", "TELEMIX", "FUNITEL", "TRAM", "LIFT")
LP_RUN = re.compile(r"DOWNHILL_SKIING_(GREEN|BLUE|RED|BLACK)|^LINK$")


def parse_lumiplan(fid):
    h = get(SOURCE_PAGES["lumiplan"].format(id=fid))
    lifts, runs = [], []
    for typ, name, state in re.findall(r'image/type/([A-Z_]+)\.svg".{0,700}?class="nom">([^<]+)<.*?image/etats/([a-z_]+)\.svg', h, re.S):
        name = html.unescape(name).strip()
        st = "open" if state.endswith("_open") or "_open_" in state else norm_status(state.replace("trail_", ""))
        if any(k in typ for k in LP_LIFT):
            lifts.append({"name": name, "status": st, "number": None, "kind": typ.replace("_", " ").title()})
        else:
            m = LP_RUN.search(typ)
            if m:
                runs.append({"name": name, "status": st, "number": None, "kind": "run", "difficulty": (m.group(1) or "link").lower()})
    return lifts, runs


def parse_infosnow(fid):
    h = get(SOURCE_PAGES["infosnow"].format(id=fid))
    cut = h.find("Slopes (")
    lifts, runs = [], []
    for m in re.finditer(r'data/status/\d+/(\d)\.gif".*?<td[^>]*>\s*<img[^>]*>\s*</td>\s*<td[^>]*>([^<]+)</td>', h, re.S):
        code, name = m.group(1), html.unescape(m.group(2)).strip()
        if name.lower() in ("open", "in preparation", "closed", "geöffnet", "ouvert", "fermé"):
            continue   # the page's legend, not a lift
        st = {"1": "open", "2": "scheduled"}.get(code, "closed")
        (runs if cut != -1 and m.start() > cut else lifts).append({"name": name, "status": st, "number": None, "kind": ""})
    return lifts, runs


def parse_jacksonhole(_):
    d = json.loads(get(SOURCE_PAGES["jacksonhole"]))
    lifts = [{"name": v.get("name", ""), "status": norm_status(v.get("openingStatus")), "number": None, "kind": v.get("liftType", "")}
             for v in (d.get("lifts") or {}).values()]
    runs = [{"name": v.get("name", ""), "status": norm_status(v.get("openingStatus")), "number": None, "kind": "run",
             "difficulty": (v.get("trailLevel") or "").lower()} for v in (d.get("trails") or {}).values()]
    return lifts, runs


PARSERS = {"intermaps": parse_intermaps, "lumiplan": parse_lumiplan, "infosnow": parse_infosnow, "jacksonhole": parse_jacksonhole}

_cache, _lock = {}, threading.Lock()


def resort_status(rid):
    with _lock:
        hit = _cache.get(rid)
        if hit and time.time() - hit[0] < CACHE_SECONDS:
            return hit[1]
    feeds = FEEDS.get(rid)
    if not feeds:
        return {"resort": rid, "available": False, "reason": "No public live status feed connected for this resort yet."}
    lifts, runs, sources, errors = [], [], [], []

    def run(feed):
        kind, fid = feed
        return feed, PARSERS[kind](fid)

    with ThreadPoolExecutor(max_workers=len(feeds)) as ex:
        futures = [ex.submit(run, f) for f in feeds]
        for fut in futures:
            try:
                (kind, fid), (l, r) = fut.result()
                lifts += l; runs += r
                sources.append({"type": kind, "url": SOURCE_PAGES[kind].format(id=fid)})
            except Exception as e:  # one broken feed shouldn't hide the others
                errors.append(str(e))
    out = {"resort": rid, "available": bool(lifts or runs), "updated": int(time.time()), "sources": sources,
           "lifts": lifts, "runs": runs, "errors": errors}
    if not out["available"]:
        out["reason"] = "The resort hasn't published its lift list yet (often before the season starts)." if not errors else "Status feed unreachable right now."
    with _lock:
        _cache[rid] = (time.time(), out)
    return out


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        m = re.match(r"^/api/status/([a-z0-9_-]+)/?$", self.path.split("?")[0])
        if not m:
            return super().do_GET()
        body = json.dumps(resort_status(m.group(1))).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            sys.stderr.write("%s\n" % (fmt % args))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5174
    root = Path(__file__).resolve().parent
    import functools
    httpd = ThreadingHTTPServer(("", port), functools.partial(Handler, directory=str(root)))
    print(f"PisteMap on http://localhost:{port}  (live status at /api/status/<resort>)", flush=True)
    httpd.serve_forever()
