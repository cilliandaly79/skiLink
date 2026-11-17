# skiLink — PisteMap

A phone-first ski map: see your friends on the mountain, live speeds, a leaderboard, and the quickest
lift + run routes to meet up (Easiest / Balanced / Fastest), with live open/closed lift and run status.

**Live app:** https://cilliandaly79.github.io/skiLink/ — open it on your phone and choose *Add to Home Screen*.

## What's in here

| Path | What it is |
|---|---|
| `index.html` | The whole app (Leaflet map, routing, UI). Installable on phones (PWA). |
| `sw.js`, `manifest.webmanifest`, `icon*` | Offline support + home-screen install |
| `data/<resort>.json` | Pre-downloaded runs & lifts from OpenStreetMap for the preset resorts |
| `server.py` | Local dev server: serves the app + live status at `/api/status/<resort>` |
| `tools/build_status.py` | Writes live status to `status/<resort>.json` (used on GitHub Pages) |
| `tools/fetch_resorts.py` | Re-downloads resort run/lift data from OpenStreetMap |
| `tools/make_icons.py` | Regenerates the PNG app icons |
| `.github/workflows/pages.yml` | Deploys to GitHub Pages and refreshes live status every 15 min |

## Run it locally

```bash
python server.py
```

Then open http://localhost:5174. (Python 3.10+, no packages needed.)

## Live lift & run status

Read from each resort's own public feed:

- Intermaps — St. Anton, Sölden, Ischgl, Kitzbühel
- Lumiplan — Courchevel/Méribel, Val Thorens/Les Menuires/Orelle
- infosnow.ch — Verbier
- Resort API — Jackson Hole

Zermatt, Whistler, Vail and Niseko have no feed connected yet. Feeds can change without notice —
`server.py` has one small parser per feed type.

## Data & credits

Pistes and lifts © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors ·
map tiles © [OpenTopoMap](https://opentopomap.org) (CC-BY-SA) / Esri imagery ·
elevation & weather [Open-Meteo](https://open-meteo.com) · lift status from the resorts' own feeds.
Friends' positions are simulated in this prototype.
