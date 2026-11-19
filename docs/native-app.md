# skiLink → native app

**End goal:** skiLink ships as a native iPhone and Android app. The web app at
`cilliandaly79.github.io/skiLink` is the working prototype, and everything is built so it
moves across with as little rewriting as possible.

## Recommended stack: Expo (React Native)

| Why | |
|---|---|
| Reuses the code we have | `core/` is plain JavaScript — the native app imports it unchanged |
| One codebase | iPhone and Android from the same project |
| Same backend | Supabase works the same (`@supabase/supabase-js`) — no server changes |
| Native features | Background location, battery, push, haptics, widgets via Expo modules |

A pure Swift app would mean rewriting every feature; only choose it if Android is never needed.

## What carries over unchanged

| File | What it does |
|---|---|
| `core/resorts.js` | Preset resorts, lift-pass areas, lift types, difficulty colours, OpenStreetMap query |
| `core/graph.js` | Builds the run/lift network, speed model, routing (Dijkstra), turn-by-turn steps |
| `core/status.js` | Matches resort lift-status feeds to lifts and runs |
| `core/presence.js` | GPS → today's stats (top speed, vertical, runs, distance); "phone may have died" rules |
| `core/api.js` | Every Supabase query (profiles, friend requests, live locations, battery, stats) |
| `core/theme.js` | Design tokens: Apple colours (light/dark), type scale, radii, spring/sheet motion |
| `supabase/schema.sql` | Database tables + security rules (already live) |
| `data/*.json`, `status/*.json` | Resort maps and live lift status, served from GitHub Pages — fetch the same URLs |
| `server.py`, `tools/build_status.py` | Lift-status feed parsers (run on GitHub Actions every 15 min) |

Each `core/` file loads as a plain `<script>` on the web **and** with `require()` in React Native:

```js
const {buildGraph, finishGraph, dijkstra, buildSteps} = require('./core/graph.js');
const {createApi} = require('./core/api.js');
const api = createApi(supabase);          // supabase-js client with AsyncStorage session
const route = dijkstra(G, myNode, friendNode, 4);
```

## Web feature → native equivalent

| Feature | Web prototype | Native app |
|---|---|---|
| Map | Leaflet + OpenTopoMap tiles | `@maplibre/maplibre-react-native` (custom tiles + offline packs) |
| Bottom sheet | Hand-written (momentum, rubber-band) | `@gorhom/bottom-sheet` — same snap points & feel |
| Animations | CSS transitions | Reanimated + Gesture Handler (see the `animate-expo` skill), springs from `core/theme.js` |
| Sign-in | supabase-js (CDN) | supabase-js + `expo-secure-store` for the session |
| Your location | `navigator.geolocation` (foreground only) | `expo-location` **with background updates** (TaskManager) |
| Battery | Battery API (not on iPhone web) | `expo-battery` — **works on iPhone** |
| Meet-up progress | Notification + app badge | **Live Activity / lock-screen widget** (iOS), ongoing notification (Android) |
| Friend requests | In-app alert | **Push notifications** (`expo-notifications` + a Supabase Edge Function) |
| Invite link | `?add=username` | Universal link / `skilink://add/username` (expo-router) |
| Offline | Service worker caches tiles you've seen | Downloadable offline map packs per resort |
| Press feedback | CSS `:active` | `expo-haptics` + Pressable scale |
| Install | Add to Home Screen | App Store / Google Play |

## What native unlocks (can't be done on the web)

- **Battery on iPhone** — friends see each other's % on every phone.
- **Location while the phone is in your pocket** — friends stay visible without the app open.
- **Live Activities & widgets** — "6 min to Maya" on the lock screen and Dynamic Island.
- **Push notifications** for friend requests and meet-ups, even when the app is closed.
- **Offline maps** for whole resorts — no signal needed on the mountain.

## Migration plan

1. `npx create-expo-app skilink-app` (TypeScript, expo-router). Copy `core/` in, or share it as a package.
2. Sign-in + profile + permissions screens using `core/api.js` and `core/theme.js`.
3. Map screen: load `data/<id>.json` → `buildGraph`/`finishGraph`, draw runs/lifts, friends' pins.
4. Friends, requests, leaderboard (same queries via `core/api.js`).
5. Routing + turn-by-turn (`dijkstra`, `buildSteps`), bottom sheet.
6. Background location + battery (`expo-location`, `expo-battery`) feeding `core/presence.js`.
7. Push (Edge Function on new friend request), Live Activity for meet-ups, offline packs.
8. TestFlight / Play internal testing → store release.

Store accounts needed: Apple Developer Program ($99/year) and Google Play Console ($25 once).

**Before launch:** OpenTopoMap and Open-Meteo's free tiers aren't meant for a busy app — switch to a
commercial tile provider (e.g. MapTiler, Stadia, Thunderforest) and pre-compute resort elevation into
`data/*.json`.

## Rules for every new feature (so it ports cleanly)

1. **Logic in `core/`, UI outside it.** Anything that isn't drawing or touching the page — maths,
   rules, data shaping, database queries — goes in a `core/` file with no DOM, no Leaflet, no `localStorage`.
2. **Data calls go through `core/api.js`.** Never call `supabase.from(...)` directly from UI code.
3. **Return data, not text or HTML.** Core returns `{level:'dead', battery:9}`; each app words it.
4. **Design values come from `core/theme.js`** — no new hard-coded colours.
5. **Platform features behind small wrappers** (GPS, battery, notifications, storage) so each one
   has an obvious native replacement.
