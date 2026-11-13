import { flightPoint, elapsedAt, GameAudio } from '/flight.js?v=20261106-twoplans';

const $ = (s) => document.querySelector(s);
const app = $('#app'), modal = $('#modal');
let me = null, config = {}, state = null, busy = false, refreshing = false;
let tab = 'ALL', visibleRows = 50, sampleRound = null, sampleRows = [];
const gameAudio = new GameAudio();
let flightSnapshot = null, flightReceivedAt = 0, flightFrame = 0, toastTimer;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = (v) => '₹' + Number(v || 0).toLocaleString('en-IN');
const count = (v) => Number(v || 0).toLocaleString('en-IN');
const pct = (k) => esc(config[k] ?? 10);

function stopFlight() {
  gameAudio.reset();
  if (flightFrame) cancelAnimationFrame(flightFrame);
  flightFrame = 0; flightSnapshot = null;
}
function startFlight() {
  stopFlight();
  function draw() {
    const plane = $('#flyingplane'), trail = $('#flighttrail');
    if (!plane || !trail) { stopFlight(); return; }
    const snapshot = flightSnapshot || {phase:'WAITING',elapsedMs:0};
    const point = flightPoint(elapsedAt(snapshot, flightReceivedAt, performance.now()));
    plane.style.left = `${point.x / 600 * 100}%`;
    plane.style.top = `${point.y / 250 * 100}%`;
    plane.style.transform = `translate(-50%,-50%) rotate(${point.angle.toFixed(2)}deg)`;
    plane.classList.toggle('flying', snapshot.phase === 'FLYING');
    plane.classList.toggle('gone', snapshot.phase === 'CRASHED');
    trail.setAttribute('d', snapshot.phase === 'WAITING' ? 'M 70 215' : point.path);
    if (document.hidden || performance.now() - flightReceivedAt > 2000) gameAudio.stopEngine();
    flightFrame = requestAnimationFrame(draw);
  }
  draw();
}
function toast(message) {
  $('#toast').textContent = message; $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4000);
}
async function api(route, data) {
  const response = await fetch('/api/' + route, {
    method: data ? 'POST' : 'GET', cache:'no-store',
    headers: data ? {'Content-Type':'application/json'} : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !['login','signup'].includes(route)) {
      me = null; state = null; if (modal.open) modal.close(); welcome();
    }
    throw new Error(result.error || 'Please retry.');
  }
  return result;
}
function logo() {
  return '<div class="brand"><img src="/plane.svg" alt=""><div><small>SUPER FAST</small><strong>AVIATOR</strong></div></div>';
}
function bonuses() {
  return `<div class="bonusrow">${[['welcome','WELCOME<br>BONUS'],['promo','PROMO CODE<br>BONUS'],['losing','LOSING<br>BONUS']].map(([k,t]) => `<div class="bonus"><b>${pct(k)}%</b><span>${t}</span></div>`).join('')}</div>`;
}
function whatsappIcon() {
  return '<svg class="supporticon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20.5 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.5-4.8A8.5 8.5 0 1 1 20.5 11.5Z"/><path d="M8.2 7.3c.3-.2.7-.2.9.2l.8 1.8c.1.3 0 .5-.2.7l-.6.6c.7 1.4 1.8 2.5 3.3 3.2l.6-.7c.2-.2.4-.3.7-.2l1.8.9c.3.2.4.5.3.8-.3 1-1.1 1.6-2.1 1.5-3.7-.5-6.7-3.4-7.1-7.1-.1-.8.6-1.5 1.6-1.7Z"/></svg>';
}
function show(title, html) {
  modal.innerHTML = `<div class="dialoghead"><h2>${esc(title)}</h2><button data-close aria-label="Close dialog">×</button></div>${html}`;
  if (!modal.open) modal.showModal();
}
modal.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) modal.close(); });
function support() {
  let url;
  try { url = new URL(config.support); } catch { /* Unconfigured link. */ }
  if (url?.protocol === 'https:') window.open(url.href, '_blank', 'noopener,noreferrer');
  else show('24/7 Customer Support', '<p>The administrator has not configured a support link yet.</p>');
}
function welcome() {
  stopFlight();
  app.innerHTML = `<main class="welcome"><header><button data-auth="login" class="outline">LOGIN</button><button data-auth="signup" class="wine">SIGN UP</button></header><div class="welcomecontent"><div class="herologo"><img src="/plane.svg" alt="Airplane"><small>SUPER FAST</small><h1>AVIATOR</h1><i></i></div>${bonuses()}<button class="support wine" data-support>${whatsappIcon()}24/7 CUSTOMER SUPPORT</button><p class="muted demofoot">Simulation balance</p></div></main>`;
}
function signupWhatsApp() {
  let url;
  try { url = new URL(String(config.support || '')); } catch { toast('Admin must configure a WhatsApp support link before signup.'); return; }
  if (url.protocol !== 'https:' || url.hostname !== 'wa.me' || url.port || url.username || url.password || !/^\/[1-9][0-9]{7,14}\/?$/.test(url.pathname)) {
    toast('Admin must configure a WhatsApp link with country code.'); return;
  }
  const chat = new URL('https://wa.me' + url.pathname);
  chat.searchParams.set('text','Hello, I would like to request a Super Fast Aviator customer ID.');
  window.location.assign(chat.href);
}
function field(label, name, type = 'text', extra = '') {
  return `<label>${label}<input name="${name}" type="${type}" ${extra} required></label>`;
}
function formError(error) { if ($('#formerror')) $('#formerror').textContent = error.message; }
function auth(mode = 'login') {
  if (mode === 'signup') { signupWhatsApp(); return; }
  show('Customer Login', `<form id="authform">${field('Customer ID','username','text','autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="30"')}${field('Password','password','password','autocomplete="current-password" minlength="8" maxlength="128"')}<button class="green full" type="submit">LOGIN</button><p class="error" id="formerror"></p></form>`);
  $('#authform').onsubmit = async (e) => {
    e.preventDefault(); const button = e.target.querySelector('button'); if (button.disabled) return;
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(e.target));
      data.username = String(data.username || '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{4,30}$/.test(data.username)) throw new Error('Customer ID must be 4–30 English letters, numbers, dots, underscores or hyphens.');
      me = (await api('login',data)).user; modal.close();
      if (me.mustChangePassword) { changePassword(true); return; }
      renderGame(); await refresh();
    } catch (error) { formError(error); } finally { button.disabled = false; }
  };
}
function changePassword(required = false) {
  show(required ? 'Change Temporary Password' : 'Change Password', `<p>${required ? 'Set a new password before using the game.' : 'Changing your password ends existing customer sessions.'}</p><form id="passwordform">${field('Current Password','currentPassword','password','autocomplete="current-password" maxlength="128"')}${field('New Password','newPassword','password','autocomplete="new-password" minlength="8" maxlength="128"')}${field('Confirm New Password','confirmPassword','password','autocomplete="new-password" minlength="8" maxlength="128"')}<button type="submit" class="green full">SAVE PASSWORD</button><p class="error" id="formerror"></p></form>`);
  $('#passwordform').onsubmit = async (e) => {
    e.preventDefault(); const button = e.target.querySelector('button'); if (button.disabled) return; button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(e.target));
      if (data.newPassword !== data.confirmPassword) throw new Error('New passwords do not match.');
      await api('password',data); me = null; state = null; modal.close(); welcome(); toast('Password changed. Log in with the new password.');
    } catch (error) { formError(error); } finally { button.disabled = false; }
  };
}
function panel(n) {
  return `<section class="betpanel" id="panel${n}"><div><div class="paneltitle">BET ${n}<span>AMOUNT</span></div><div class="stake"><button data-step="-${n}" aria-label="Decrease bet ${n}">−</button><div class="stakevalue"><span class="stakecurrency" aria-hidden="true">₹</span><input id="stake${n}" type="number" min="10" max="25000" step="1" value="10" aria-label="Bet ${n} stake"></div><button data-step="${n}" aria-label="Increase bet ${n}">+</button></div><div class="quick">${[10,100,500,1000].map((v) => `<button data-quick="${n},${v}">${v}</button>`).join('')}</div></div><button class="betaction green" data-bet="${n}" disabled>WAIT…</button></section>`;
}
function closeMenu() {
  if ($('#gamemenu')) $('#gamemenu').hidden = true;
  $('#menutoggle')?.setAttribute('aria-expanded','false');
}
function renderGame() {
  stopFlight(); tab = 'ALL'; visibleRows = 50;
  app.innerHTML = `<main class="game"><nav class="gamenav"><button class="green" data-request="DEPOSIT">DEPOSIT</button><button class="wine" data-request="WITHDRAWAL">WITHDRAWAL</button><button id="menutoggle" aria-label="Open menu" aria-expanded="false" aria-controls="gamemenu">☰</button><div id="gamemenu" hidden><button data-info="rules">Rules</button><button data-info="bonus">Bonus Information</button><button data-info="promo">Promo Code</button><button data-account>History</button><button data-password>Password</button><button data-support>${whatsappIcon()}24/7 Support</button><button data-logout>Logout</button></div></nav><header class="gamehead">${logo()}<button class="mini outline" data-sound aria-label="Toggle sound" aria-pressed="${gameAudio.enabled}">${gameAudio.enabled ? '🔊' : '🔇'}</button><div class="balance"><b id="balance">${num(me.balance)}</b><small>BALANCE · ${esc(me.username)}</small></div></header><div id="history" class="history"></div><section class="chart"><div class="chartgrid"></div><div class="flightplot"><svg viewBox="0 0 600 250" preserveAspectRatio="none" class="trail" aria-hidden="true"><path id="flighttrail" d="M 70 215"/></svg><img id="flyingplane" src="/plane.svg" alt="Flying airplane"></div><div class="roundstatus"><span id="phase">CONNECTING</span><b id="mult">1.00x</b><small id="roundid"></small></div></section>${panel(1)}${panel(2)}<section class="betssection"><div class="betstabs"><button class="green" data-tab="ALL">ALL BETS</button><button data-tab="MY">MY BETS</button></div><div id="activity" class="activity" hidden></div><div class="tablewrap betslist"><table><thead id="bethead"></thead><tbody id="betrows"></tbody></table></div><button id="morebets" class="morebets" data-more hidden>SHOW MORE</button><p id="listnote" class="listnote"></p></section></main>`;
  startFlight();
  $('#menutoggle').onclick = () => {
    const menu = $('#gamemenu'); menu.hidden = !menu.hidden;
    $('#menutoggle').setAttribute('aria-expanded',String(!menu.hidden));
  };
}
document.addEventListener('click', (e) => { if (!e.target.closest('.gamenav')) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

function seedOf(value) {
  let h = 2166136261;
  for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0),16777619);
  return h >>> 0;
}
function randomFor(seed) {
  let value = seed >>> 0;
  return () => { value = (Math.imul(value,1664525) + 1013904223) >>> 0; return value / 4294967296; };
}
const avatarCache = new Map();
function avatar(index) {
  const id = ((Number(index) || 0) % 300 + 300) % 300;
  if (avatarCache.has(id)) return avatarCache.get(id);
  const backgrounds = ['#07383a','#781a40','#152e27','#38202c','#20292b'];
  const skin = ['#ffffff','#e3ded8','#beb5ab','#95877c','#71675e'][id % 5];
  const hair = id % 3 === 0 ? '<path d="M17 30V18Q32 2 47 18v12l-8-10-9 6-7-3z" fill="#111"/>' : id % 3 === 1 ? '<path d="M15 35V21Q32 1 49 21v14l-7-12-20 3z" fill="#781a40"/>' : '<path d="M14 23Q32 5 50 23v5H14z" fill="#0cb2b7"/><path d="M13 27h41" stroke="#fff" stroke-width="3"/>';
  const glasses = Math.floor(id / 15) % 2 ? '<path d="M21 32h9v6h-9zm13 0h9v6h-9zM30 34h4" fill="none" stroke="#111" stroke-width="2"/>' : '<circle cx="25" cy="34" r="2" fill="#111"/><circle cx="39" cy="34" r="2" fill="#111"/>';
  const mouth = Math.floor(id / 30) % 2 ? '<path d="M26 43q6 6 12 0" fill="none" stroke="#111" stroke-width="2"/>' : '<path d="M27 44h10" stroke="#781a40" stroke-width="2"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${backgrounds[Math.floor(id / 3) % 5]}"/><path d="M8 64v-6q24-21 48 0v6" fill="${Math.floor(id / 60) % 2 ? '#781a40' : '#0cb2b7'}"/><ellipse cx="32" cy="33" rx="16" ry="21" fill="${skin}"/>${hair}${glasses}${mouth}<circle cx="${7 + id % 50}" cy="7" r="2" fill="#fff"/></svg>`;
  const uri = 'data:image/svg+xml,' + encodeURIComponent(svg);
  avatarCache.set(id,uri); return uri;
}
function avatarImg(id) { return `<img class="playeravatar" src="${avatar(id)}" alt="" width="30" height="30">`; }
function masked(value) {
  const s = String(value || 'S');
  return (/^\d/.test(s) ? s.slice(0,2) : s.slice(0,1).toUpperCase()) + '****';
}
function sampleRoundCap(roundId) {
  const slot = ((roundId % 150) + 150) % 150;
  const special = {0:15000,1:10000,29:55000,59:57000,89:56000,119:54000,149:60000};
  if (Object.hasOwn(special,slot)) return special[slot];
  const caps = [5000,15000,10000,30000,20000,25000,8000,35000,12000,40000,18000,45000,6000,48000];
  return caps[(slot * 5 + Math.floor(roundId / 150) * 3) % caps.length];
}
function sampleIdentityGroup(roundId) {
  return Math.floor((Number(roundId) - 1) / 3);
}
function sampleIdentity(index, roundId) {
  const group = sampleIdentityGroup(roundId);
  const names = ['S','T','L','96','98','97','K','R','P','M'];
  return {
    username:names[((index * 7 + group) % names.length + names.length) % names.length] + '****',
    avatarId:((index * 47 + group * 31) % 300 + 300) % 300,
  };
}
function buildSamples(roundId) {
  const rng = randomFor(seedOf('rotating-samples-v2-' + roundId));
  const total = 1200 + ((roundId * 137) % 601);
  const cap = sampleRoundCap(roundId);
  const step = cap <= 15000 ? 50 : 100;
  const minimum = Math.max(3050,Math.round(cap * 0.3 / step) * step);
  const candidates = [];
  for (let value = minimum; value < cap; value += step) candidates.push(value);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i],candidates[j]] = [candidates[j],candidates[i]];
  }
  const high = [cap,...candidates.slice(0,14)].sort((a,b) => b-a);
  const usual = [500,1000,3000,500,1000,3000,100,500,1000,3000,200,1000,500,3000,1500,500,1000,2000];
  sampleRows = Array.from({length:total}, (_,i) => ({
    key:'sample-' + i, simulated:true, ...sampleIdentity(i,roundId),
    stake:i < high.length ? high[i] : usual[(seedOf('small-' + i) + roundId) % usual.length],
    target:(112 + Math.floor(rng()*183)) / 100, willCash:rng() < 0.72,
    join:i < high.length ? 0 : rng(),
  }));
  sampleRound = roundId;
}
function activityRows() {
  const round = state.round;
  if (sampleRound !== round.id) { buildSamples(round.id); visibleRows = 50; }
  const progress = round.phase === 'WAITING' ? Math.max(0
