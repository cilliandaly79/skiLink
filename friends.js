/* skiLink friends — add friends by username or invite link; only accepted friends appear on
   your map, friend list and leaderboard. Needs a signed-in Supabase account (config.js) and
   the tables from supabase/schema.sql. Your own position is shared only while
   "Share my location with friends" is on. */
(() => {
const acc = () => window.skiLinkAccount;
const sb = () => acc() && acc().client;
const API = () => SkiCore.createApi(sb());   // every database call lives in core/api.js (shared with the native app)
const sess = () => acc() && acc().session;
const available = () => !!(sb() && sess() && !sess().guest && sess().id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const initialsOf = n => (n || '').trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
const RANK_OF = {beginner:2, intermediate:3, advanced:4, expert:5};
// other people's profile fields go into HTML, so keep them to safe characters/values
const cleanText = (t, max) => String(t ?? '').replace(/[<>&"`]/g, '').replace(/'/g, '’').trim().slice(0, max);
const cleanColor = c => /^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#007aff';
const cleanUser = u => /^[a-z0-9_.]{3,20}$/.test(u || '') ? u : '';
const cleanPerson = p => ({...p, display_name:cleanText(p.display_name, 40), username:cleanUser(p.username), color:cleanColor(p.color)});
const USERNAME = /^[a-z0-9_.]{3,20}$/;
const today = () => new Date().toLocaleDateString('en-CA');        // YYYY-MM-DD, local day
const STALE_MS = SkiCore.STALE_MS;

let me = null, rows = [], people = new Map(), locs = new Map(), stats = new Map();
let pollTimer = null, slowTimer = null, started = false, pendingAdd = null;

/* ---------------- data ---------------- */
async function ensureProfile(){
  const s = sess(), p = s.profile || {};
  const {data, error} = await API().getProfile(s.id);
  if (error) throw error;
  const want = {display_name:p.name || '', color:p.color || '#007aff', skill:p.skill || 'intermediate'};
  if (!data){
    const {data:ins, error:e2} = await API().insertProfile(s.id, want);
    if (e2) throw e2; me = ins;
  } else if (data.display_name !== want.display_name || data.color !== want.color || data.skill !== want.skill){
    const {data:up} = await API().updateProfile(s.id, want);
    me = up || data;
  } else me = data;
  return me;
}
async function setUsername(raw){
  const u = String(raw || '').trim().toLowerCase().replace(/^@/, '');
  if (!USERNAME.test(u)) throw new Error('Usernames are 3–20 characters: letters, numbers, dots or underscores.');
  if (!me) await ensureProfile();
  if (me.username === u) return u;
  const {data, error} = await API().updateProfile(sess().id, {username:u});
  if (error) throw new Error(error.code === '23505' ? `@${u} is taken — try another.` : error.message);
  me = data; return u;
}
async function loadFriendships(){
  const {data, error} = await API().listFriendships();
  if (error) throw error;
  rows = data || [];
  const ids = [...new Set(rows.flatMap(r => [r.requester, r.addressee]))].filter(id => id !== sess().id);
  if (ids.length){
    const {data:ps} = await API().profilesByIds(ids);
    (ps || []).forEach(p => people.set(p.id, cleanPerson(p)));
  }
}
let seenIncoming = null;
function announce(){
  const uid = sess() && sess().id;
  const incoming = uid ? rows.filter(r => r.status === 'pending' && r.addressee === uid) : [];
  if (seenIncoming){
    incoming.filter(r => !seenIncoming.has(r.id)).forEach(r => {
      const p = people.get(r.requester) || {}, who = p.display_name || '@' + (p.username || 'someone');
      toast(`${who} wants to be friends`);
      if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible')
        navigator.serviceWorker && navigator.serviceWorker.ready.then(reg => reg.showNotification('New friend request', {body:`${who} wants to be friends on skiLink`, icon:'icon-192.png', tag:'sk-req-' + r.id}));
    });
  }
  seenIncoming = new Set(incoming.map(r => r.id));
  dispatchEvent(new CustomEvent('skilink:friends'));
}
function requests(){
  const uid = sess() && sess().id; if (!uid) return {incoming:[], outgoing:[]};
  const wrap = r => ({id:r.id, at:r.created_at, person:people.get(r.requester === uid ? r.addressee : r.requester) || {}});
  return {incoming:rows.filter(r => r.status === 'pending' && r.addressee === uid).map(wrap),
          outgoing:rows.filter(r => r.status === 'pending' && r.requester === uid).map(wrap)};
}
async function accept(id){
  const {error} = await API().acceptRequest(id);
  if (error) throw error;
  await loadFriendships(); await loadLive(); syncFriends(); announce();
}
async function decline(id){
  const {error} = await API().removeFriendship(id);
  if (error) throw error;
  await loadFriendships(); await loadLive(); syncFriends(); announce();
}
const friendIds = () => rows.filter(r => r.status === 'accepted').map(r => r.requester === sess().id ? r.addressee : r.requester);
async function loadLive(){
  const ids = friendIds();
  locs = new Map(); stats = new Map();
  if (ids.length){
    const {data} = await API().liveLocations(ids);
    (data || []).forEach(l => locs.set(l.user_id, l));
  }
  const {data:st} = await API().dayStats([...ids, sess().id]);
  (st || []).forEach(x => stats.set(x.user_id, x));
  const mine = stats.get(sess().id);
  if (mine && !gps.loadedToday){ gps.loadedToday = true;   // carry on today's stats from another device/session
    tracker.merge({top:mine.top_speed, vert:mine.vertical, runs:mine.runs, dist:mine.distance});
    applyMyStats(); }
}

/* ---------------- friends on the map ---------------- */
function syncFriends(){
  const ids = friendIds();
  const list = ids.map(id => {
    const p = people.get(id) || {}, l = locs.get(id), st = stats.get(id);
    const f = friends.find(x => x.id === id) || {id, real:true};
    Object.assign(f, {
      real:true, name:p.display_name || p.username || 'Friend', username:p.username, color:p.color || '#007aff',
      initials:initialsOf(p.display_name || p.username), maxRank:RANK_OF[p.skill] || 3,
      stats:{top:st ? +st.top_speed || 0 : 0, vert:st ? +st.vertical || 0 : 0, runs:st ? +st.runs || 0 : 0, dist:st ? +st.distance || 0 : 0},
    });
    if (l){
      const seen = Date.parse(l.updated_at), speed = (l.speed_kmh || 0) / 3.6;
      Object.assign(f, {lat:+l.lat, lon:+l.lon, alt:l.altitude == null ? null : +l.altitude, speed, seen, stale:Date.now() - seen > STALE_MS, statusText:cleanText(l.status, 30),
        state: /riding|lift/i.test(l.status || '') ? 'riding' : speed > 2 ? 'skiing' : 'idle'});
      const b = l.battery == null ? null : Math.max(0, Math.min(100, Math.round(+l.battery)));
      Object.assign(f, {battery:Number.isFinite(b) ? b : null, charging:l.charging === true, batteryAt:l.battery_at ? Date.parse(l.battery_at) : null});
      if (f.stale) f.speed = 0;
      if (G) snapReal(f);
    } else Object.assign(f, {lat:null, lon:null, speed:0, node:null, state:'idle', battery:null, charging:false});
    return f;
  });
  const same = list.length === friends.length && list.every((f, i) => friends[i] && friends[i].id === f.id);
  if (ui.friendMode !== 'real' || !same) setFriends(list, 'real');
}

/* ---------------- your GPS: position, speed, today's stats ---------------- */
// the stats maths lives in core/presence.js (shared with the native app); this file only wires it to the browser
const tracker = SkiCore.createTracker();
const gps = {watch:null, lastUp:0, lastUpPos:null, lastStats:0, stats:tracker.stats, loadedToday:false};
const meters = SkiCore.metersBetween;
function applyMyStats(){ you.realStats = true; you.stats = {top:gps.stats.top, vert:gps.stats.vert, runs:gps.stats.runs, dist:gps.stats.dist}; }
function startGps(){
  if (gps.watch != null || !('geolocation' in navigator)) return;
  gps.watch = navigator.geolocation.watchPosition(onPos, () => {}, {enableHighAccuracy:true, maximumAge:5000, timeout:30000});
}
function stopGps(){ if (gps.watch != null){ navigator.geolocation.clearWatch(gps.watch); gps.watch = null; } }
function onPos(p){
  const c = p.coords, here = {lat:c.latitude, lon:c.longitude, alt:c.altitude, t:p.timestamp};
  const r = tracker.update({...here, speed:c.speed, accuracy:c.accuracy});
  if (!r) return;
  const v = r.speed;
  applyMyStats();
  you.speed = v;
  if (G){
    const n = nearestMainNode(here.lat, here.lon);
    if (n.meters < 2000){
      you.gps = {lat:here.lat, lon:here.lon, alt:here.alt};
      if (you.node !== n.id || you.edge){
        you.node = n.id; you.edge = null; you.state = v > 2 ? 'skiing' : 'idle';
        if (ui.nav){   // follow your real position: re-plan from where you are
          const r = dijkstra(n.id, ui.nav.meet, ui.maxRank) || dijkstra(n.id, ui.nav.meet, 5);
          you.navQueue = r ? r.edges : []; drawRoute(); checkMeet();
        }
      }
    } else you.gps = null;   // not at this resort: keep the map usable with a manual position
  }
  upload(here, v);
}
const bat = {level:null, charging:null, ok:false, serverOk:true, lastPush:0};
(async () => {
  try {
    if (!navigator.getBattery) return;
    const b = await navigator.getBattery();
    const upd = () => { bat.level = Math.round(b.level * 100); bat.charging = !!b.charging; bat.ok = true; you.battery = bat.level; you.charging = bat.charging; pushBattery(); };
    b.addEventListener('levelchange', upd); b.addEventListener('chargingchange', upd); upd();
  } catch {}
})();
const batteryFields = () => bat.ok && bat.serverOk ? {battery:bat.level, charging:bat.charging, battery_at:new Date().toISOString()} : {};
// battery-only update between position updates (e.g. phone sitting in a pocket), only while sharing
async function pushBattery(){
  if (!available() || !bat.ok || !bat.serverOk || !(sess().profile || {}).shareLocation || !gps.lastUpPos) return;
  if (Date.now() - bat.lastPush < 60000 && bat.level > 20) return;
  bat.lastPush = Date.now();
  const {error} = await API().updateBattery(sess().id, batteryFields());
  if (error && /battery|charging/i.test(error.message)) bat.serverOk = false;
}
async function upload(here, v){
  if (!available()) return;
  const share = !!(sess().profile || {}).shareLocation, now = Date.now();
  if (share && (now - gps.lastUp > 10000 || !gps.lastUpPos || meters(gps.lastUpPos, here) > 30)){
    gps.lastUp = now; gps.lastUpPos = here;
    const status = you.state === 'riding' ? 'Riding a lift' : v > 2 ? 'Skiing' : 'Stopped';
    const row = {user_id:sess().id, lat:here.lat, lon:here.lon, speed_kmh:Math.round(v * 36) / 10,
      altitude:here.alt, status, resort:(currentResort && currentResort.id) || null};
    let {error} = await API().upsertLocation({...row, ...batteryFields()});
    // server without the battery columns yet (schema.sql not re-run): keep sharing location without it
    if (error && /battery|charging/i.test(error.message)){ bat.serverOk = false; ({error} = await API().upsertLocation(row)); }
    if (!error && bat.ok) bat.lastPush = now;
  }
  if (now - gps.lastStats > 60000){
    gps.lastStats = now;
    await API().upsertDayStats(sess().id, gps.stats);
  }
}
async function stopSharing(){ if (available()) await API().deleteLocation(sess().id); }

/* ---------------- lifecycle ---------------- */
async function start(){
  if (!available()){ stop(); return; }
  try {
    await ensureProfile(); await loadFriendships(); await loadLive(); syncFriends(); announce();
  } catch (e){
    console.warn('friends', e);
    if (/relation .* does not exist|schema cache/i.test(e.message || '')) toast('Friends aren’t set up on the server yet (run supabase/schema.sql)');
    return;
  }
  started = true;
  clearInterval(pollTimer); clearInterval(slowTimer);
  pollTimer = setInterval(async () => { if (document.visibilityState !== 'visible') return; try { await loadLive(); syncFriends(); } catch {} }, 15000);
  slowTimer = setInterval(async () => { try { await loadFriendships(); syncFriends(); announce(); if (sheet.classList.contains('show')) render(); } catch {} }, 20000);
  const prof = sess().profile || {};
  if (prof.shareLocation && navigator.permissions){
    try { if ((await navigator.permissions.query({name:'geolocation'})).state === 'granted') startGps(); } catch { startGps(); }
  } else if (!prof.shareLocation){ stopSharing(); }
  if (pendingAdd){ open(); }
}
function stop(){
  clearInterval(pollTimer); clearInterval(slowTimer); started = false; me = null; rows = []; people.clear(); seenIncoming = null; announce();
  if (ui.friendMode === 'real') setFriends([], 'none');
}
addEventListener('skilink:session', () => { start(); });

/* ---------------- friends sheet ---------------- */
const sheet = document.createElement('div'); sheet.className = 'acct'; sheet.id = 'friendsSheet';
document.body.appendChild(sheet);
let msg = '', msgKind = '';
function row(p, actions, sub){
  return `<div class="fr-row"><div class="avatar sm" style="background:${esc(p.color || '#007aff')}">${esc(initialsOf(p.display_name || p.username))}</div>
    <div class="fr-who"><b>${esc(p.display_name || p.username)}</b><small>${sub || '@' + esc(p.username || '')}</small></div><div class="fr-acts">${actions}</div></div>`;
}
function render(){
  if (!available()){
    sheet.innerHTML = `<div class="ob-card"><button class="close" data-f="close" aria-label="Close">✕</button>
      <h2>Friends</h2><p class="lead">Create an account to add friends. Only the friends you add can see you on the map, and only they appear on your leaderboard.</p>
      <button class="ob-btn primary" data-f="signup">Create account</button></div>`;
    return;
  }
  const uid = sess().id;
  const incoming = rows.filter(r => r.status === 'pending' && r.addressee === uid);
  const outgoing = rows.filter(r => r.status === 'pending' && r.requester === uid);
  const accepted = rows.filter(r => r.status === 'accepted');
  const other = r => people.get(r.requester === uid ? r.addressee : r.requester) || {};
  const needName = !me || !me.username;
  sheet.innerHTML = `<div class="ob-card fr-sheet"><button class="close" data-f="close" aria-label="Close">✕</button>
    <h2>Friends</h2><p class="lead">Only friends you add can see you, and only they show up on your map and leaderboard.</p>
    ${needName ? `<div class="acct-sec">Choose your username</div>
      <form id="frName" class="fr-add"><span>@</span><input name="u" placeholder="yourname" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="done" maxlength="20"><button class="ob-btn primary" type="submit">Save</button></form>
      <p class="ob-hint">Friends use this to find you.</p>`
    : `<div class="card fr-me"><div><small>Your username</small><b>@${esc(me.username)}</b></div><button class="btn route" data-f="invite">${ICON.people} Invite</button></div>`}
    <div class="acct-sec">Add a friend</div>
    <form id="frAdd" class="fr-add"><span>@</span><input name="u" placeholder="their username" value="${esc(pendingAdd || '')}" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="search" maxlength="20" ${needName ? 'disabled' : ''}><button class="ob-btn primary" type="submit" ${needName ? 'disabled' : ''}>Add</button></form>
    ${msg ? `<p class="fr-msg ${msgKind}">${esc(msg)}</p>` : ''}
    ${incoming.length ? `<div class="acct-sec">Requests · ${incoming.length}</div><div class="card fr-list">${incoming.map(r => row(other(r),
      `<button class="pill ok" data-f="accept" data-id="${r.id}">Accept</button><button class="pill" data-f="remove" data-id="${r.id}">Decline</button>`)).join('')}</div>` : ''}
    <div class="acct-sec">Your friends · ${accepted.length}</div>
    ${accepted.length ? `<div class="card fr-list">${accepted.map(r => { const o = other(r), l = locs.get(o.id);
      return row(o, `<button class="pill" data-f="remove" data-id="${r.id}" data-name="${esc(o.display_name || o.username)}">Remove</button>`,
        l ? `@${esc(o.username)} · ${Date.now() - Date.parse(l.updated_at) > STALE_MS ? 'last seen ' + agoShort(Date.parse(l.updated_at)) : 'on the mountain'}` : `@${esc(o.username)} · not sharing location`); }).join('')}</div>`
      : `<p class="ob-hint">No friends yet — add someone by username or send your invite link.</p>`}
    ${outgoing.length ? `<div class="acct-sec">Sent · waiting for them</div><div class="card fr-list">${outgoing.map(r => row(other(r),
      `<button class="pill" data-f="remove" data-id="${r.id}">Cancel</button>`)).join('')}</div>` : ''}
  </div>`;
}
async function open(){
  render(); sheet.classList.add('show');
  if (available() && started){ try { await loadFriendships(); render(); } catch {} }
  if (pendingAdd && available() && me && me.username){ const u = pendingAdd; pendingAdd = null; await addByName(u); }
}
function say(text, kind){ msg = text; msgKind = kind || ''; render(); }
async function addByName(raw){
  const u = String(raw || '').trim().toLowerCase().replace(/^@/, '');
  if (!USERNAME.test(u)) return say('Usernames are 3–20 letters, numbers, dots or underscores.', 'bad');
  if (me && u === me.username) return say('That’s you!', 'bad');
  const {data, error} = await API().findUser(u);
  if (error) return say(error.message, 'bad');
  const p = data && data[0] && cleanPerson(data[0]);
  if (!p) return say(`No skier called @${u}. Check the spelling, or send them your invite link.`, 'bad');
  people.set(p.id, p);
  const existing = rows.find(r => (r.requester === p.id || r.addressee === p.id));
  if (existing) return say(existing.status === 'accepted' ? `You’re already friends with ${p.display_name || '@' + u}.` : `There’s already a request between you and @${u}.`, '');
  const {error:e2} = await API().sendRequest(sess().id, p.id);
  if (e2) return say(e2.message, 'bad');
  await loadFriendships(); announce();
  say(`Request sent to ${p.display_name || '@' + u}. They’ll appear once they accept.`, 'ok');
}
sheet.addEventListener('submit', async e => {
  e.preventDefault();
  const val = e.target.u.value;
  if (e.target.id === 'frName'){ try { await setUsername(val); say(`You’re @${me.username}. Share your invite link so friends can add you.`, 'ok'); } catch (x){ say(x.message, 'bad'); } }
  else if (e.target.id === 'frAdd') addByName(val);
});
sheet.addEventListener('click', async e => {
  if (e.target === sheet) return sheet.classList.remove('show');
  const b = e.target.closest('[data-f]'); if (!b) return;
  const f = b.dataset.f;
  if (f === 'close') sheet.classList.remove('show');
  else if (f === 'signup'){ sheet.classList.remove('show'); acc().open(); }
  else if (f === 'invite'){
    const url = `${location.origin}${location.pathname}?add=${encodeURIComponent(me.username)}`;
    const text = `Add me on skiLink so we can find each other on the mountain — I’m @${me.username}`;
    try { if (navigator.share){ await navigator.share({title:'Add me on skiLink', text, url}); return; } } catch (x){ if (x.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast('Invite link copied'); } catch { prompt('Copy your invite link:', url); }
  } else if (f === 'accept'){
    b.disabled = true;
    const {error} = await API().acceptRequest(b.dataset.id);
    if (error) return say(error.message, 'bad');
    await loadFriendships(); await loadLive(); syncFriends(); announce(); say('Friend added', 'ok');
  } else if (f === 'remove'){
    if (b.dataset.name && !confirm(`Remove ${b.dataset.name} from your friends? You’ll stop seeing each other.`)) return;
    b.disabled = true;
    const {error} = await API().removeFriendship(b.dataset.id);
    if (error) return say(error.message, 'bad');
    await loadFriendships(); await loadLive(); syncFriends(); announce(); say('', '');
  }
});
addEventListener('keydown', e => { if (e.key === 'Escape') sheet.classList.remove('show'); });

// invite links: ?add=username
(() => {
  const q = new URLSearchParams(location.search), u = q.get('add');
  if (!u) return;
  pendingAdd = u.toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 20);
  q.delete('add'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
})();

window.skiLinkFriends = {available, open, setUsername, get me(){ return me; }, start, stopSharing, startGps, requests, accept, decline};
start();
})();
