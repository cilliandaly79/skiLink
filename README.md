# skiLink — PisteMap

A phone-first ski map: see your friends on the mountain, live speeds, a leaderboard, and the quickest
lift + run routes to meet up (Easiest / Balanced / Fastest), with live open/closed lift and run status.

**Live app:** https://cilliandaly79.github.io/skiLink/ — open it on your phone and choose *Add to Home Screen*.

> **End goal: a native iPhone & Android app.** This web app is the prototype. Shared logic lives in
> [`core/`](core/) and moves to the native app unchanged — see [docs/native-app.md](docs/native-app.md)
> for the plan and the rules every new feature follows.

## What's in here

| Path | What it is |
|---|---|
| `core/` | **Shared logic for web + native**: resorts, trail network & routing, lift-status matching, GPS stats & phone warnings, Supabase queries, design tokens |
| `index.html` | Web app UI (Leaflet map, sheet, screens) built on `core/`. Installable on phones (PWA). |
| `account.js`, `account.css`, `config.js` | Sign up / sign in, profile, permissions, account menu |
| `friends.js`, `supabase/schema.sql` | Friends: requests, invite links, live locations, today's stats |
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

## Accounts

First launch shows a welcome screen: **create an account**, **sign in**, or **try without an account**,
then profile setup (name, colour, ski level, home resort) and a permissions screen
(location, notifications, and opt-in location sharing with friends). The avatar button opens the
account menu (edit profile, permissions, sign out, delete).

- **Now:** accounts are saved on each phone only (passwords hashed with PBKDF2, never stored).
- **Real accounts on any device:** create a free project at [supabase.com](https://supabase.com), then put its
  Project URL and *anon public* key in `config.js` (Project Settings → API) and push. Sign-up, sign-in,
  password reset and profiles then work through Supabase Auth. In Supabase, set
  Authentication → URL Configuration → Site URL to `https://cilliandaly79.github.io/skiLink/`.

## Friends

Add friends by **username** or an **invite link** (`…/skiLink/?add=yourname`). Only accepted friends
appear on your map, friend list and leaderboard. Your position is shared with them only while
*Share my location with friends* is on, and today's stats (top speed, vertical, runs, distance) come
from your phone's GPS.

**One-time setup:** open Supabase → SQL Editor → New query, paste [`supabase/schema.sql`](supabase/schema.sql)
and click **Run**. It creates the tables and row-level security rules:
nobody can list users (exact-username lookup only), and locations/stats are readable only by accepted friends.

Without an account you can switch on **Demo skiers** in the Friends tab to try routes with simulated friends.

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
