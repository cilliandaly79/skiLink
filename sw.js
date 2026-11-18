/* PisteMap service worker — keeps the app usable with patchy signal on the mountain.
   - app shell + Leaflet + fonts: cached on install, served cache-first
   - resort data (data/*.json): cache-first, refreshed in the background
   - map tiles you've looked at: cached (up to ~3000), so the map still shows offline
   - weather / elevation: network first, cached copy if offline
   Bump VERSION when index.html changes so phones pick up the new app. */
const VERSION = 'pistemap-v9';
const SHELL = ['./', 'index.html', 'account.js', 'account.css', 'friends.js', 'config.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'];
const TILE_HOSTS = ['tile.opentopomap.org', 'server.arcgisonline.com'];
const MAX_TILES = 3000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'tiles' && k !== 'data').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function cacheFirst(req, cacheName, refresh){
  const cache = await caches.open(cacheName), hit = await cache.match(req);
  const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; });
  if (hit){ if (refresh) net.catch(() => {}); return hit; }
  return net;
}
async function networkFirst(req, cacheName){
  const cache = await caches.open(cacheName);
  try { const res = await fetch(req); if (res.ok) cache.put(req, res.clone()); return res; }
  catch (err){ const hit = await cache.match(req); if (hit) return hit; throw err; }
}
let trimming = false;
async function trimTiles(){
  if (trimming) return; trimming = true;
  try { const c = await caches.open('tiles'), keys = await c.keys();
    for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]); } finally { trimming = false; }
}

// progress notification while meeting a friend: tap = open the map, "End" = stop navigating
self.addEventListener('notificationclick', e => {
  const end = e.action === 'end';
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:'window', includeUncontrolled:true}).then(list => {
    const client = list[0];
    if (end){ list.forEach(c => c.postMessage({type:'end-nav'})); return; }
    if (client) return client.focus();
    return self.clients.openWindow('./');
  }));
});

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (TILE_HOSTS.some(h => url.hostname.endsWith(h))){
    e.respondWith(cacheFirst(req, 'tiles', false).then(r => { trimTiles(); return r; }));
  } else if (url.origin === location.origin && (url.pathname.includes('/status/') || url.pathname.includes('/api/'))){
    e.respondWith(networkFirst(req, 'data'));   // live lift status: always fresh when online
  } else if (url.origin === location.origin && url.pathname.includes('/data/')){
    e.respondWith(cacheFirst(req, 'data', true));
  } else if (url.hostname.endsWith('open-meteo.com')){
    e.respondWith(networkFirst(req, 'data'));
  } else if (url.hostname.includes('overpass')){
    return;   // live map queries: always network
  } else if (req.mode === 'navigate' || (url.origin === location.origin && /\.(html|webmanifest)$|\/$/.test(url.pathname))){
    e.respondWith(networkFirst(req, VERSION));   // newest app when online, cached app when not
  } else if (url.origin === location.origin){
    e.respondWith(networkFirst(req, VERSION));   // app's own scripts/styles: newest when online, cached when offline
  } else if (url.hostname.endsWith('cdnjs.cloudflare.com') || url.hostname.includes('fonts.g') || url.hostname.endsWith('jsdelivr.net')){
    // app shell: serve cached copy, refresh in background
    e.respondWith(cacheFirst(req, VERSION, true));
  }
});
