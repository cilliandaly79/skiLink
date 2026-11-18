/* skiLink accounts — sign up / sign in, profile setup, permissions, account menu.
   Real accounts (any device) use Supabase when config.js has a project URL + anon key.
   Otherwise accounts are stored on this device only (password hashed with PBKDF2). */
(() => {
const CFG = window.SKILINK_CONFIG || {};
const CLOUD = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
const COLORS = ['#1a73e8', '#e4572e', '#7b2cbf', '#0a9396', '#e09f3e', '#d6336c', '#2b9348', '#14213d'];
const SKILLS = [
  {k:'beginner', label:'Beginner', sub:'Greens & easy blues', rank:2},
  {k:'intermediate', label:'Intermediate', sub:'Blues & reds', rank:3},
  {k:'advanced', label:'Advanced', sub:'Happy on blacks', rank:4},
  {k:'expert', label:'Expert', sub:'Anything, incl. off-piste', rank:5},
];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const initialsOf = n => (n || '').trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'ME';
const store = {
  get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: k => { try { localStorage.removeItem(k); } catch {} },
};
const blankProfile = () => ({name:'', color:COLORS[0], skill:'intermediate', home:'', shareLocation:false, onboarded:false});

/* ---------------- sign-in back-ends (same interface) ---------------- */
const DeviceAuth = {
  mode:'device',
  async hash(pw, salt){
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({name:'PBKDF2', salt:new TextEncoder().encode(salt), iterations:150000, hash:'SHA-256'}, key, 256);
    return btoa(String.fromCharCode(...new Uint8Array(bits)));
  },
  users(){ return store.get('sk-users') || {}; },
  async session(){
    const s = store.get('sk-session'); if (!s) return null;
    if (s.guest) return {guest:true, profile:s.profile};
    const u = this.users()[s.email]; return u ? {email:s.email, profile:u.profile} : null;
  },
  async signUp(email, pw, profile){
    const us = this.users();
    if (us[email]) throw new Error('There’s already an account with this email on this phone — sign in instead.');
    const salt = Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
    us[email] = {salt, hash:await this.hash(pw, salt), profile, created:Date.now()};
    store.set('sk-users', us); store.set('sk-session', {email});
    return {email, profile};
  },
  async signIn(email, pw){
    const u = this.users()[email];
    if (!u || await this.hash(pw, u.salt) !== u.hash) throw new Error('Email or password is incorrect.');
    store.set('sk-session', {email});
    return {email, profile:u.profile};
  },
  async guest(profile){ store.set('sk-session', {guest:true, profile}); return {guest:true, profile}; },
  async save(sess, profile){
    if (sess.guest) return store.set('sk-session', {guest:true, profile});
    const us = this.users(); if (us[sess.email]){ us[sess.email].profile = profile; store.set('sk-users', us); }
  },
  async signOut(){ store.del('sk-session'); },
  async reset(){ throw new Error('Accounts saved on this phone can’t be reset by email. Create a new account instead.'); },
  async remove(sess){
    if (!sess.guest){ const us = this.users(); delete us[sess.email]; store.set('sk-users', us); }
    store.del('sk-session');
  },
};
const CloudAuth = {
  mode:'cloud', client:null,
  async init(){
    if (this.client) return;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.min.js';
      s.onload = res; s.onerror = () => rej(new Error('Can’t reach the sign-in service — check your connection.'));
      document.head.appendChild(s);
    });
    this.client = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
  },
  wrap(u){ return u ? {email:u.email, profile:Object.assign(blankProfile(), u.user_metadata || {})} : null; },
  async session(){
    const g = store.get('sk-session'); if (g && g.guest) return {guest:true, profile:g.profile};
    await this.init(); const {data} = await this.client.auth.getSession();
    return this.wrap(data.session && data.session.user);
  },
  async signUp(email, pw, profile){
    await this.init();
    const {data, error} = await this.client.auth.signUp({email, password:pw, options:{data:profile, emailRedirectTo:location.origin + location.pathname}});
    if (error) throw error;
    store.del('sk-session');
    return data.session ? this.wrap(data.user) : {email, profile, needsConfirm:true};
  },
  async signIn(email, pw){
    await this.init();
    const {data, error} = await this.client.auth.signInWithPassword({email, password:pw});
    if (error) throw new Error(/invalid login/i.test(error.message) ? 'Email or password is incorrect.' : error.message);
    store.del('sk-session');
    return this.wrap(data.user);
  },
  guest: DeviceAuth.guest,
  async save(sess, profile){
    if (sess.guest) return store.set('sk-session', {guest:true, profile});
    await this.init(); const {error} = await this.client.auth.updateUser({data:profile}); if (error) throw error;
  },
  async signOut(){ store.del('sk-session'); if (this.client) await this.client.auth.signOut(); },
  async reset(email){
    await this.init();
    const {error} = await this.client.auth.resetPasswordForEmail(email, {redirectTo:location.origin + location.pathname});
    if (error) throw error;
  },
  async remove(sess){
    if (sess.guest){ store.del('sk-session'); return; }
    throw new Error('Deleting a cloud account needs the server — ask the skiLink team to remove it.');
  },
};
const Auth = CLOUD ? CloudAuth : DeviceAuth;

/* ---------------- permissions ---------------- */
async function permState(kind){
  if (kind === 'location'){
    if (!('geolocation' in navigator)) return 'unsupported';
    try { return (await navigator.permissions.query({name:'geolocation'})).state; } catch { return store.get('sk-geo') || 'prompt'; }
  }
  if (!('Notification' in window)) return 'unsupported';   // iPhone: only after Add to Home Screen
  return Notification.permission === 'default' ? 'prompt' : Notification.permission;
}
function askLocation(){
  return new Promise(res => navigator.geolocation.getCurrentPosition(
    () => { store.set('sk-geo', 'granted'); res('granted'); },
    e => { if (e.code === 1) store.set('sk-geo', 'denied'); res(e.code === 1 ? 'denied' : 'prompt'); },
    {timeout:15000, maximumAge:60000}));
}
async function askNotifications(){
  if (!('Notification' in window)) return 'unsupported';
  try { const p = await Notification.requestPermission(); return p === 'default' ? 'prompt' : p; } catch { return 'denied'; }
}
const STATE_TAG = {granted:'<span class="tag ok">Allowed</span>', denied:'<span class="tag no">Blocked</span>',
  prompt:'<span class="tag req">Not set</span>', unsupported:'<span class="tag na">Not available</span>'};
async function permCards(profile){
  const [loc, note] = await Promise.all([permState('location'), permState('notifications')]);
  const btn = (kind, st) => st === 'granted' ? '' : st === 'unsupported' ? '' :
    st === 'denied' ? `<button class="off" data-perm="${kind}">Try again</button>` : `<button data-perm="${kind}">Allow</button>`;
  const blocked = `<p class="why">Blocked in your browser — turn it on in Settings › your browser › skiLink, then tap Try again.</p>`;
  return `
    <div class="perm"><div class="ic" style="--c:var(--tint)">${ICON.location}</div>
      <b>Location ${STATE_TAG[loc]}</b>
      <p>Shows where you are on the piste map and works out routes from your spot to your friends. Only used while skiLink is open.</p>
      <div class="act">${btn('location', loc)}${loc === 'denied' ? blocked : ''}</div></div>
    <div class="perm"><div class="ic" style="--c:var(--red)">${ICON.bell}</div>
      <b>Notifications ${STATE_TAG[note]}</b>
      <p>Meet-up progress on your lock screen (“6 min to Maya”), and a ping when you’ve met up.</p>
      <div class="act">${btn('notifications', note)}${note === 'denied' ? blocked : note === 'unsupported' ? '<p class="why" style="color:var(--muted)">On iPhone, add skiLink to your Home Screen first (Share › Add to Home Screen).</p>' : ''}</div></div>
    <div class="perm"><div class="ic" style="--c:var(--green)">${ICON.people}</div>
      <b>Share my location with friends <span class="tag ${profile.shareLocation ? 'ok' : 'na'}">${profile.shareLocation ? 'On' : 'Off'}</span></b>
      <p>Friends you add can see you on their map and find routes to you. You can turn this off any time.</p>
      <div class="act"><button class="switch${profile.shareLocation ? ' on' : ''}" data-share aria-label="Share my location with friends" role="switch" aria-checked="${profile.shareLocation}"></button></div></div>`;
}

/* ---------------- onboarding screens ---------------- */
let sess = null, draft = blankProfile(), step = 'welcome', editing = false, showPw = false;
const ob = document.createElement('div'); ob.className = 'ob'; ob.id = 'onboarding';
const acct = document.createElement('div'); acct.className = 'acct'; acct.id = 'account';
document.body.append(ob, acct);

const dots = n => `<div class="ob-dots">${[1, 2, 3].map(i => `<i class="${i === n ? 'on' : ''}"></i>`).join('')}</div>`;
const brand = `<div class="ob-brand"><img class="ob-appicon sm" src="icon-192.png" alt=""></div>`;
const homeOptions = sel => {
  const opt = (id, label) => `<option value="${id}"${id === sel ? ' selected' : ''}>${esc(label)}</option>`;
  return `<option value="">Choose later</option>` +
    `<optgroup label="Resorts">${RESORTS.map(r => opt(r.id, r.name)).join('')}</optgroup>` +
    `<optgroup label="Lift-pass areas">${Object.values(PASSES).map(p => opt(p.id, p.name)).join('')}</optgroup>`;
};
const deviceNote = CLOUD ? '' : `<div class="ob-note">For now your account is saved <b>on this phone only</b>. Once skiLink’s sign-in server is connected, you’ll be able to sign in on any device.</div>`;

async function render(){
  let h = '';
  if (step === 'welcome') h = `<div class="ob-hello">
      <img class="ob-appicon" src="icon-192.png" alt="">
      <h1>Welcome to skiLink</h1>
      <ul class="ob-feats">
        <li><span class="fi" style="--c:var(--tint)">${ICON.people}</span><div><b>See your friends live</b><p>Everyone on one piste map, with their speed and what they’re riding.</p></div></li>
        <li><span class="fi" style="--c:var(--indigo)">${ICON.route}</span><div><b>Meet up the quickest way</b><p>Routes over lifts and runs, matched to your ski level.</p></div></li>
        <li><span class="fi" style="--c:var(--green)">${GLYPH.lift}</span><div><b>Live lift status</b><p>Closed lifts and runs are left out of your route automatically.</p></div></li>
      </ul></div>
    <div class="ob-actions">
      <button class="ob-btn primary" data-go="signup">Create account</button>
      <button class="ob-btn ghost" data-go="signin">Sign in</button>
      <button class="ob-btn link" data-act="guest">Try it without an account</button></div>`;
  else if (step === 'signup') h = brand + `<div class="ob-card">${dots(1)}
      <h2>Create your account</h2><p class="lead">It takes about a minute.</p>${deviceNote}
      <div class="ob-err" id="obErr"></div>
      <form id="obForm" novalidate>
        <label class="ob-field"><span>Your name</span><input name="name" autocomplete="name" value="${esc(draft.name)}" placeholder="e.g. Alex Murphy" required></label>
        <label class="ob-field"><span>Email</span><input name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required></label>
        <label class="ob-field"><span>Password</span><div class="ob-pw"><input name="password" type="${showPw ? 'text' : 'password'}" autocomplete="new-password" minlength="8" placeholder="At least 8 characters" required><button type="button" data-act="pw">${showPw ? 'Hide' : 'Show'}</button></div></label>
        <label class="ob-check"><input type="checkbox" name="terms"> <span>I agree that skiLink stores my account details and shares my location only with friends I choose. <a href="#" data-act="privacy">How we use your data</a></span></label>
        <button class="ob-btn primary" type="submit">Create account</button>
      </form>
      <button class="ob-btn link" data-go="signin">Already have an account? Sign in</button>
      <button class="ob-btn link" data-go="welcome">‹ Back</button></div>`;
  else if (step === 'signin') h = brand + `<div class="ob-card">
      <h2>Sign in</h2><p class="lead">Welcome back.</p>${deviceNote}
      <div class="ob-err" id="obErr"></div>
      <form id="obForm" novalidate>
        <label class="ob-field"><span>Email</span><input name="email" type="email" autocomplete="email" inputmode="email" required></label>
        <label class="ob-field"><span>Password</span><div class="ob-pw"><input name="password" type="${showPw ? 'text' : 'password'}" autocomplete="current-password" required><button type="button" data-act="pw">${showPw ? 'Hide' : 'Show'}</button></div></label>
        <button class="ob-btn primary" type="submit">Sign in</button>
      </form>
      <button class="ob-btn link" data-go="reset">Forgot your password?</button>
      <button class="ob-btn link" data-go="signup">New here? Create an account</button>
      <button class="ob-btn link" data-go="welcome">‹ Back</button></div>`;
  else if (step === 'reset') h = brand + `<div class="ob-card">
      <h2>Reset password</h2><p class="lead">We’ll email you a link to choose a new password.</p>
      <div class="ob-err" id="obErr"></div>
      <form id="obForm" novalidate>
        <label class="ob-field"><span>Email</span><input name="email" type="email" autocomplete="email" inputmode="email" required></label>
        <button class="ob-btn primary" type="submit">Send reset link</button>
      </form>
      <button class="ob-btn link" data-go="signin">‹ Back to sign in</button></div>`;
  else if (step === 'confirm') h = brand + `<div class="ob-card">
      <h2>Check your email 📬</h2><p class="lead">We sent a confirmation link to <b>${esc(draft.email)}</b>. Tap it, then come back and sign in.</p>
      <button class="ob-btn primary" data-go="signin">I’ve confirmed — sign in</button></div>`;
  else if (step === 'privacy') h = brand + `<div class="ob-card">
      <h2>How we use your data</h2>
      <p class="lead">• <b>Account:</b> your name, email and ski level, so friends recognise you.<br>
      • <b>Location:</b> used to show you on the map and plan routes. It’s only shared with friends you add, and only if you switch sharing on.<br>
      • <b>Notifications:</b> only for meet-ups you start.<br>
      • You can change any of this, sign out or delete your account from the account menu.</p>
      <button class="ob-btn primary" data-go="signup">Got it</button></div>`;
  else if (step === 'profile') h = brand + `<div class="ob-card">${editing ? '' : dots(2)}
      <h2>${editing ? 'Edit profile' : 'Set up your profile'}</h2><p class="lead">This is how friends see you on the map.</p>
      <div class="ob-avatar" id="obAv" style="background:${draft.color}">${esc(initialsOf(draft.name))}</div>
      <div class="ob-err" id="obErr"></div>
      <form id="obForm" novalidate>
        <label class="ob-field"><span>Display name</span><input name="name" value="${esc(draft.name)}" autocomplete="nickname" maxlength="24" required></label>
        <div class="ob-field"><span>Your colour</span><div class="ob-colors">${COLORS.map(c => `<button type="button" data-color="${c}" class="${c === draft.color ? 'on' : ''}" style="background:${c}" aria-label="Colour ${c}"></button>`).join('')}</div></div>
        <div class="ob-field"><span>Your ski level</span><div class="ob-seg">${SKILLS.map(s => `<button type="button" data-skill="${s.k}" class="${s.k === draft.skill ? 'on' : ''}">${s.label}<small>${s.sub}</small></button>`).join('')}</div></div>
        <p class="ob-hint">Used to suggest routes you’ll enjoy. You can still pick any route.</p>
        <label class="ob-field"><span>Home resort</span><select name="home">${homeOptions(draft.home)}</select></label>
        <button class="ob-btn primary" type="submit">${editing ? 'Save' : 'Continue'}</button>
      </form>
      ${editing ? '<button class="ob-btn link" data-act="cancelEdit">Cancel</button>' : ''}</div>`;
  else if (step === 'perms') h = brand + `<div class="ob-card">${dots(3)}
      <h2>Permissions</h2><p class="lead">skiLink needs a couple of things from your phone to work on the mountain. You can change these later.</p>
      <div id="obPerms">${await permCards(draft)}</div>
      <button class="ob-btn primary" data-act="finish">Start skiing</button>
      <p class="ob-hint" style="text-align:center;margin-top:10px">Without location you can still place yourself on the map by hand.</p></div>`;
  ob.innerHTML = `<div class="ob-wrap">${h}</div>`;
  const f = ob.querySelector('input[name=name], input[name=email]');
  if (f && !isMobile()) f.focus();
}
function err(msg){ const e = document.getElementById('obErr'); if (e){ e.textContent = msg; e.classList.add('show'); e.scrollIntoView({block:'nearest'}); } }
function busy(form, on, label){ const b = form.querySelector('[type=submit]'); if (b){ b.disabled = on; if (label) b.textContent = label; } }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

ob.addEventListener('click', async e => {
  const go = e.target.closest('[data-go]'), act = e.target.closest('[data-act]');
  if (go){ e.preventDefault(); step = go.dataset.go; showPw = false; return render(); }
  const c = e.target.closest('[data-color]');
  if (c){ draft.color = c.dataset.color; ob.querySelectorAll('[data-color]').forEach(x => x.classList.toggle('on', x === c)); document.getElementById('obAv').style.background = draft.color; return; }
  const sk = e.target.closest('[data-skill]');
  if (sk){ draft.skill = sk.dataset.skill; ob.querySelectorAll('[data-skill]').forEach(x => x.classList.toggle('on', x === sk)); return; }
  const pm = e.target.closest('[data-perm]');
  if (pm){ pm.disabled = true; pm.textContent = 'Waiting…';
    if (pm.dataset.perm === 'location') await askLocation(); else await askNotifications();
    document.getElementById('obPerms').innerHTML = await permCards(draft); return; }
  if (e.target.closest('[data-share]')){ draft.shareLocation = !draft.shareLocation; document.getElementById('obPerms').innerHTML = await permCards(draft); return; }
  if (!act) return;
  const a = act.dataset.act;
  if (a === 'pw'){ showPw = !showPw; const i = ob.querySelector('.ob-pw input'); i.type = showPw ? 'text' : 'password'; act.textContent = showPw ? 'Hide' : 'Show'; }
  else if (a === 'privacy'){ e.preventDefault(); step = 'privacy'; render(); }
  else if (a === 'guest'){ draft = Object.assign(blankProfile(), {name:'Guest'}); sess = await Auth.guest(draft); step = 'profile'; render(); }
  else if (a === 'cancelEdit'){ editing = false; hideOnboarding(); openAccount(); }
  else if (a === 'finish'){
    draft.onboarded = true; await saveProfile(draft);
    hideOnboarding(); applyProfile();
    if (draft.home && draft.home !== sel.value) chooseArea(draft.home);
    if (await permState('location') === 'granted') setTimeout(() => document.getElementById('bGps').click(), 1200);
    toast(`You’re all set, ${draft.name.split(' ')[0]}!`);
  }
});

ob.addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target, d = Object.fromEntries(new FormData(form));
  const email = (d.email || '').trim().toLowerCase();
  try {
    if (step === 'signup'){
      if (!d.name || !d.name.trim()) return err('Please enter your name.');
      if (!EMAIL.test(email)) return err('Please enter a valid email address.');
      if ((d.password || '').length < 8) return err('Your password needs at least 8 characters.');
      if (!d.terms) return err('Please agree to how skiLink uses your data to continue.');
      busy(form, true, 'Creating account…');
      draft = Object.assign(blankProfile(), draft, {name:d.name.trim()});
      const r = await Auth.signUp(email, d.password, draft);
      if (r.needsConfirm){ draft.email = email; step = 'confirm'; return render(); }
      sess = r; step = 'profile'; render();
    } else if (step === 'signin'){
      if (!EMAIL.test(email) || !d.password) return err('Enter your email and password.');
      busy(form, true, 'Signing in…');
      sess = await Auth.signIn(email, d.password);
      draft = Object.assign(blankProfile(), sess.profile);
      if (draft.onboarded){ hideOnboarding(); applyProfile(); toast(`Welcome back, ${draft.name.split(' ')[0] || 'skier'}!`); }
      else { step = 'profile'; render(); }
    } else if (step === 'reset'){
      if (!EMAIL.test(email)) return err('Please enter a valid email address.');
      busy(form, true, 'Sending…');
      await Auth.reset(email);
      toast('Reset link sent — check your email'); step = 'signin'; render();
    } else if (step === 'profile'){
      if (!d.name || !d.name.trim()) return err('Please enter a display name.');
      draft.name = d.name.trim(); draft.home = d.home || '';
      if (editing){ editing = false; await saveProfile(draft); hideOnboarding(); applyProfile(); openAccount(); toast('Profile saved'); return; }
      step = 'perms'; render();
    }
  } catch (x){
    busy(form, false, step === 'signup' ? 'Create account' : step === 'signin' ? 'Sign in' : step === 'reset' ? 'Send reset link' : 'Continue');
    err(x.message || 'Something went wrong — please try again.');
  }
});
ob.addEventListener('input', e => { if (e.target.name === 'name' && document.getElementById('obAv')) document.getElementById('obAv').textContent = initialsOf(e.target.value); });

function showOnboarding(s){ step = s; render(); ob.classList.add('show'); document.body.classList.add('ob-open'); }
function hideOnboarding(){ ob.classList.remove('show'); document.body.classList.remove('ob-open'); if (window.map) setTimeout(() => map.invalidateSize({pan:false}), 50); }
async function saveProfile(p){ if (!sess) return; sess.profile = Object.assign({}, p); try { await Auth.save(sess, sess.profile); } catch (x){ toast('Couldn’t save your profile: ' + x.message); } }

/* ---------------- apply profile to the app ---------------- */
function applyProfile(){
  const p = (sess && sess.profile) || blankProfile();
  you.initials = initialsOf(p.name); you.color = p.color; you.profileName = p.name;
  const sk = SKILLS.find(s => s.k === p.skill);
  window.PREF_RANK = sk ? sk.rank : 5;
  if (!ui.nav) ui.maxRank = window.PREF_RANK;
  paintButton();
  if (typeof renderQuick === 'function' && G){ renderQuick(); renderPanel(); }
}
const btn = document.createElement('button');
btn.className = 'acct-btn'; btn.id = 'acctBtn'; btn.title = 'Your account';
btn.onclick = () => sess ? openAccount() : showOnboarding('welcome');
document.getElementById('hero').appendChild(btn);
function paintButton(){ const p = sess && sess.profile; btn.style.background = p ? p.color : 'rgba(255,255,255,.25)'; btn.textContent = p ? initialsOf(p.name) : '👤'; }

/* ---------------- account sheet ---------------- */
async function openAccount(){
  const p = sess.profile, home = p.home && findArea(p.home);
  acct.innerHTML = `<div class="ob-card"><button class="close" data-a="close" aria-label="Close">✕</button>
    <div class="acct-head"><div class="ob-avatar" style="background:${p.color}">${esc(initialsOf(p.name))}</div>
      <b>${esc(p.name || 'Skier')}</b><small>${sess.guest ? 'Guest — not signed in' : esc(sess.email)}</small><br>
      <span class="acct-mode">${sess.guest ? 'Saved on this phone' : Auth.mode === 'cloud' ? 'Cloud account' : 'Account saved on this phone'}</span></div>
    <div class="acct-sec">Profile</div>
    <div class="card" style="margin:0">Ski level: <b>${esc((SKILLS.find(s => s.k === p.skill) || {}).label || '–')}</b><br>Home resort: <b>${esc(home ? home.name : 'not set')}</b></div>
    <button class="ob-btn ghost" data-a="edit">Edit profile</button>
    <div class="acct-sec">Permissions</div>
    <div id="acctPerms">${await permCards(p)}</div>
    <div class="acct-sec">Account</div>
    ${sess.guest ? '<button class="ob-btn primary" data-a="upgrade">Create an account</button>' : ''}
    <button class="ob-btn ghost" data-a="signout">${sess.guest ? 'Leave guest mode' : 'Sign out'}</button>
    ${sess.guest || Auth.mode === 'device' ? '<button class="ob-btn danger" data-a="delete">Delete my account & data</button>' : ''}
  </div>`;
  acct.classList.add('show');
}
acct.addEventListener('click', async e => {
  if (e.target === acct) return acct.classList.remove('show');
  const pm = e.target.closest('[data-perm]');
  if (pm){ pm.disabled = true; pm.textContent = 'Waiting…'; if (pm.dataset.perm === 'location') await askLocation(); else await askNotifications();
    document.getElementById('acctPerms').innerHTML = await permCards(sess.profile); return; }
  if (e.target.closest('[data-share]')){ await saveProfile(Object.assign({}, sess.profile, {shareLocation:!sess.profile.shareLocation}));
    document.getElementById('acctPerms').innerHTML = await permCards(sess.profile); return; }
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a;
  if (a === 'close') acct.classList.remove('show');
  else if (a === 'edit'){ acct.classList.remove('show'); draft = Object.assign(blankProfile(), sess.profile); editing = true; showOnboarding('profile'); }
  else if (a === 'upgrade'){ acct.classList.remove('show'); draft = Object.assign(blankProfile(), sess.profile, {name:sess.profile.name === 'Guest' ? '' : sess.profile.name}); showOnboarding('signup'); }
  else if (a === 'signout'){
    if (!confirm(sess.guest ? 'Leave guest mode? Your profile on this phone will be cleared.' : 'Sign out of skiLink?')) return;
    await Auth.signOut(); sess = null; draft = blankProfile(); acct.classList.remove('show'); applyProfile(); showOnboarding('welcome');
  } else if (a === 'delete'){
    if (!confirm('Delete your account and profile from this phone? This can’t be undone.')) return;
    try { await Auth.remove(sess); } catch (x){ return toast(x.message); }
    sess = null; draft = blankProfile(); acct.classList.remove('show'); applyProfile(); showOnboarding('welcome'); toast('Account deleted');
  }
});
addEventListener('keydown', e => { if (e.key === 'Escape') acct.classList.remove('show'); });

/* ---------------- start ---------------- */
(async () => {
  paintButton();
  try { sess = await Auth.session(); } catch { sess = null; }
  if (sess && sess.profile && sess.profile.onboarded){ draft = Object.assign(blankProfile(), sess.profile); applyProfile(); }
  else if (sess){ draft = Object.assign(blankProfile(), sess.profile); showOnboarding('profile'); }
  else showOnboarding('welcome');
  if (CLOUD && CloudAuth.client) CloudAuth.client.auth.onAuthStateChange((ev, s) => {
    if (ev === 'PASSWORD_RECOVERY'){ const pw = prompt('Choose a new password (at least 8 characters):');
      if (pw && pw.length >= 8) CloudAuth.client.auth.updateUser({password:pw}).then(r => toast(r.error ? r.error.message : 'Password updated')); }
  });
})();
window.skiLinkAccount = {get session(){ return sess; }, open:() => sess ? openAccount() : showOnboarding('welcome')};
})();
