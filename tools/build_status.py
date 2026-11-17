"""Write live lift/run status for every resort to status/<id>.json (for static hosting).

    python tools/build_status.py

GitHub Pages can't run server.py, so the GitHub Actions workflow runs this every 15 minutes
and publishes the JSON files with the site. The app reads /api/status/<id> when server.py is
running, and falls back to status/<id>.json otherwise.
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import server  # noqa: E402  (reuses the feed parsers)

ALL = ["zermatt", "stanton", "valthorens", "verbier", "ischgl", "solden", "kitzbuehel", "courchevel",
       "jackson", "whistler", "vail", "niseko",
       "3vallees", "arlberg", "4vallees", "matterhorn", "kitzski"]   # lift-pass areas


def main():
    out = ROOT / "status"
    out.mkdir(exist_ok=True)
    for rid in ALL:
        s = server.resort_status(rid)
        (out / f"{rid}.json").write_text(json.dumps(s, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        if s.get("available"):
            lo = sum(1 for x in s["lifts"] if x["status"] == "open")
            print(f"{rid}: {lo}/{len(s['lifts'])} lifts open" + (f"  errors: {s['errors']}" if s.get("errors") else ""))
        else:
            print(f"{rid}: {s.get('reason')}")


if __name__ == "__main__":
    main()
