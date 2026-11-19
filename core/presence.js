/* skiLink core — presence & GPS stats
   Turns raw GPS fixes into today's stats (top speed, distance, vertical, runs), and decides when a
   friend's phone may have died. Platform-independent: feed it fixes from the browser's Geolocation
   API on the web, or from expo-location / CoreLocation in the native app. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SkiCore = Object.assign(root.SkiCore || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

const STALE_MS = 10 * 60 * 1000;   // a friend's position older than this is "last seen"

// distance in metres between two {lat, lon} points (equirectangular; fine at ski-area scale)
function metersBetween(a, b){
  const k = Math.cos(a.lat * Math.PI / 180);
  return Math.hypot(a.lat - b.lat, (a.lon - b.lon) * k) * 111320;
}

/* Today's stats from a stream of GPS fixes.
   fix = {lat, lon, alt (m|null), speed (m/s|null), accuracy (m), t (ms)}
   update() returns {speed} for a usable fix, or null for one that was ignored. */
function createTracker(stats){
  const st = stats || {top:0, vert:0, runs:0, dist:0};
  let last = null, low = null, runDrop = 0;
  return {
    stats: st,
    update(fix){
      if (fix.accuracy > 60) return null;                                       // poor fixes (cliffs, gondola cabins)
      let v = fix.speed;
      if ((v == null || isNaN(v)) && last) v = metersBetween(last, fix) / Math.max(1, (fix.t - last.t) / 1000);
      v = v || 0;
      if (last && v < 45){                                                      // ignore >160 km/h glitches
        const d = metersBetween(last, fix);
        if (v > 1.5) st.dist += d;
        if (fix.alt != null && last.alt != null){
          const dz = last.alt - fix.alt;
          if (dz > 0 && v > 2){ st.vert += dz; runDrop += dz; }
          // a run = a descent of 100 m+ followed by going back up (a lift)
          low = low == null ? fix.alt : Math.min(low, fix.alt);
          if (fix.alt - low > 40 && runDrop > 100){ st.runs++; runDrop = 0; low = fix.alt; }
        }
        st.top = Math.max(st.top, v * 3.6);
      }
      last = fix;
      return {speed:v};
    },
    // carry on today's stats saved from another device/session
    merge(saved){
      st.top = Math.max(st.top, saved.top || 0); st.vert = Math.max(st.vert, saved.vert || 0);
      st.runs = Math.max(st.runs, saved.runs || 0); st.dist = Math.max(st.dist, saved.dist || 0);
    },
  };
}

// battery colour band: 'chg' charging, 'crit' ≤15 %, 'low' ≤30 %, 'ok', or null when unknown
function batteryLevel(battery, charging){
  if (battery == null) return null;
  return charging ? 'chg' : battery <= 15 ? 'crit' : battery <= 30 ? 'low' : 'ok';
}

/* Should we warn about a friend's phone?  f = {lat, seen (ms), battery (0-100|null), charging}
   'dead'  — low battery, then no updates          'dying' — still updating but nearly empty
   'quiet' — no updates for 30 min+ and battery unknown (e.g. iPhone on the web) */
function phoneState(f, now){
  now = now || Date.now();
  if (f.lat == null || !f.seen) return null;
  const quietMin = (now - f.seen) / 60000, stale = now - f.seen > STALE_MS;
  if (stale && f.battery != null && f.battery <= 15 && !f.charging) return {level:'dead', battery:f.battery, seen:f.seen, quietMin};
  if (!stale && f.battery != null && f.battery <= 10 && !f.charging) return {level:'dying', battery:f.battery, seen:f.seen, quietMin};
  if (quietMin > 30 && f.battery == null) return {level:'quiet', seen:f.seen, quietMin};
  return null;
}

// location sharing: on, paused until a time, or off. profile = {shareLocation, sharePausedUntil(ms)}
function sharingState(profile, now){
  const p = profile || {}, t = now || Date.now();
  if (!p.shareLocation) return {on:false, mode:'off'};
  if (p.sharePausedUntil && p.sharePausedUntil > t) return {on:false, mode:'paused', until:p.sharePausedUntil};
  return {on:true, mode:'on'};
}

return {STALE_MS, metersBetween, createTracker, batteryLevel, phoneState, sharingState};
});
