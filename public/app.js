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

// Fictional display activity is isolated from customer balances and server bets.
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
function buildSamples(roundId) {
  const rng = randomFor(seedOf('samples-' + roundId));
  const total = 1200 + Math.floor(rng() * 601);
  // Exactly fifteen higher sample stakes; remaining rows mainly ₹500/₹1,000/₹3,000.
  const high = [60000,55000,50000,48000,45000,40000,35000,30000,25000,20000,15000,12000,10000,6000,5000];
  const usual = [100,200,300,500,500,500,1000,1000,1000,1500,2000,3000,3000];
  const names = ['S','T','L','96','98','97','K','R','P','M'];
  sampleRows = Array.from({length:total}, (_,i) => ({
    key:'sample-' + i, simulated:true, username:names[Math.floor(rng()*names.length)] + '****',
    avatarId:Math.floor(rng()*300), stake:high[i] || usual[Math.floor(rng()*usual.length)],
    target:(112 + Math.floor(rng()*183)) / 100, willCash:rng() < 0.72,
    join: i < high.length ? 0 : rng(),
  }));
  sampleRound = roundId;
}
function activityRows() {
  const round = state.round;
  if (sampleRound !== round.id) { buildSamples(round.id); visibleRows = 50; }
  const progress = round.phase === 'WAITING' ? Math.max(0,Math.min(1,1 - round.countdown / 10)) : 1;
  const fake = sampleRows.filter((b) => b.join <= progress).map((b) => {
    const won = b.willCash && round.phase !== 'WAITING' && (round.phase === 'CRASHED' ? b.target < round.mult : b.target <= round.mult);
    return {...b,status:won ? 'WON' : round.phase === 'CRASHED' ? 'LOST' : 'ACTIVE',mult:won ? b.target : 0,payout:won ? Math.floor(b.stake*b.target) : 0};
  });
  const real = state.allBets.map((b,i) => ({...b,simulated:false,key:'user-' + (b.id ?? i),avatarId:b.avatarId ?? seedOf(b.username)}));
  return [...real,...fake].sort((a,b) => b.stake - a.stake || Number(a.simulated) - Number(b.simulated) || String(a.key).localeCompare(String(b.key)));
}
function renderBets() {
  if (!state || !$('#betrows')) return;
  const all = tab === 'ALL';
  $('#activity').hidden = !all;
  $('#morebets').hidden = true;
  if (!all) {
    $('#bethead').innerHTML = '<tr><th>ROUND</th><th>BET ₹</th><th>RESULT</th></tr>';
    $('#betrows').innerHTML = state.bets.map((b) => `<tr><td>#${esc(b.round_id)}<small>BET ${esc(b.panel)}</small></td><td>${num(b.stake)}</td><td><span class="pill">${esc(b.status)}${b.status === 'WON' ? ' · ' + Number(b.mult).toFixed(2) + 'x · ' + num(b.payout) : ''}</span></td></tr>`).join('') || '<tr><td colspan="3" class="muted">No bets yet</td></tr>';
    $('#listnote').textContent = 'Your own bets only · Simulation balance'; return;
  }
  const rows = activityRows();
  const online = 4000 + seedOf('online-' + Math.floor(Date.now()/5000)) % 4001;
  const payout = rows.reduce((sum,b) => sum + Number(b.payout || 0),0);
  $('#activity').innerHTML = `<div class="activityleft"><div class="avatarstack">${[3,24,87].map(avatarImg).join('')}</div><span><b>${count(rows.length)}</b> Bets · Online ${count(online)}</span><small>Simulated online count · Sample + user bets</small></div><div class="activitywin"><b>${num(payout)}</b><small>Total win · includes samples</small></div>`;
  $('#bethead').innerHTML = '<tr><th>PLAYER</th><th>BET ₹</th><th>X</th><th>WIN ₹</th></tr>';
  $('#betrows').innerHTML = rows.slice(0,visibleRows).map((b) => `<tr class="${b.status === 'WON' ? 'wonrow' : ''}"><td><div class="playercell">${avatarImg(b.avatarId)}<span>${esc(masked(b.username))}<small class="${b.simulated ? 'samplelabel' : 'userlabel'}">${b.simulated ? 'Simulated' : 'User bet'}</small></span></div></td><td>${count(b.stake)}</td><td>${b.status === 'WON' ? Number(b.mult).toFixed(2) + 'x' : '—'}</td><td>${b.status === 'WON' ? count(b.payout) : b.status === 'LOST' ? 'LOST' : '—'}</td></tr>`).join('');
  $('#morebets').hidden = rows.length <= visibleRows;
  $('#morebets').textContent = `SHOW MORE (${count(Math.min(visibleRows,rows.length))}/${count(rows.length)})`;
  $('#listnote').textContent = 'Sample bets are fictional. Only your own bets affect your balance.';
}
async function refresh() {
  if (!me || busy || refreshing || !$('#balance')) return;
  refreshing = true; const userId = me.id;
  try {
    const snapshot = await api('state');
    if (!me || me.id !== userId || !$('#balance')) return;
    state = snapshot; me = state.user;
    $('#balance').textContent = num(me.balance);
    $('#history').innerHTML = state.history.map((v,i) => `<span class="${i%2 ? 'wine' : 'green'}" title="${['ADMIN','ADMIN2'].includes(v.mode) ? 'Admin-Controlled Demo' : 'Random Demo'}">${Number(v.mult).toFixed(2)}x${['ADMIN','ADMIN2'].includes(v.mode) ? ' · A' : ''}</span>`).join('') || '<span>First demo round</span>';
    const r = state.round;
    $('#phase').textContent = r.phase === 'WAITING' ? `NEXT ROUND IN ${r.countdown}s` : r.phase === 'FLYING' ? 'FLYING' : 'FLEW AWAY';
    $('#mult').textContent = r.phase === 'WAITING' ? 'GET READY' : Number(r.mult).toFixed(2) + 'x';
    $('#mult').classList.toggle('crashed',r.phase === 'CRASHED');
    $('#roundid').textContent = 'ROUND #' + r.id;
    flightSnapshot = r; flightReceivedAt = performance.now();
    if (!document.hidden) gameAudio.sync(r);
    for (const n of [1,2]) {
      const b = state.bets.find((v) => Number(v.round_id) === Number(r.id) && Number(v.panel) === n);
      const button = $(`[data-bet="${n}"]`);
      button.classList.toggle('wine',!!b && r.phase === 'FLYING');
      button.disabled = b ? b.status !== 'ACTIVE' || r.phase !== 'FLYING' : r.phase !== 'WAITING';
      button.innerHTML = b?.status === 'ACTIVE' && r.phase === 'FLYING' ? `CASH OUT<small>${num(Math.floor(b.stake*r.mult))}</small>` : b ? `${b.status === 'ACTIVE' ? 'BET PLACED' : esc(b.status)}<small>${num(b.stake)}</small>` : r.phase === 'WAITING' ? 'BET<small>AMOUNT</small>' : 'NEXT ROUND';
    }
    renderBets();
  } catch {
    gameAudio.reset();
    if ($('#phase')) $('#phase').textContent = 'CONNECTION LOST · RETRYING';
    for (const b of document.querySelectorAll('[data-bet]')) b.disabled = true;
  } finally { refreshing = false; }
}
async function readImage(file) {
  if (!file?.size) return null;
  if (file.size > 1500000) throw new Error('Proof image must be under 1.5 MB.');
  return new Promise((resolve,reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read image')); reader.readAsDataURL(file);
  });
}
async function request(type) {
  config = await api('public'); const deposit = type === 'DEPOSIT', min = deposit ? 100 : 300;
  const bankFields = [['Account Holder',config.bankHolder],['Bank',config.bankName],['Account Number',config.bankAccount],['IFSC',config.bankIfsc],['UPI ID',config.upiId]];
  const payment = `<div class="bankdetails"><h3>Admin Deposit Details</h3>${bankFields.filter(([,v]) => v).map(([k,v]) => `<p><b>${k}:</b> ${esc(v)}</p>`).join('')}${config.qrImageId ? `<img class="qrpreview" src="/api/media/${encodeURIComponent(config.qrImageId)}" alt="Admin deposit QR">` : ''}<p>${esc(config.depositInstructions || 'Contact support if deposit details have not been configured.')}</p></div>`;
  show(deposit ? 'Deposit Request' : 'Withdrawal Request', `${deposit ? payment : ''}<form id="reqform">${field(`Amount (₹${min}–₹25,000)`,'amount','number',`min="${min}" max="25000" step="1" value="${min}"`)}${deposit ? `${field('UTR / Reference','utr','text','maxlength="100"')}<label>Proof Image (optional, max 1.5 MB)<input name="proofFile" type="file" accept="image/png,image/jpeg,image/webp"></label>` : `${field('Account Holder','holder','text','maxlength="120"')}${field('Bank Name','bank','text','maxlength="120"')}${field('Account Number','account','text','inputmode="numeric" pattern="[0-9]{6,22}"')}${field('Confirm Account Number','confirmAccount','text','inputmode="numeric" pattern="[0-9]{6,22}"')}${field('IFSC','ifsc','text','maxlength="11"')}<p class="muted">The withdrawal amount is held on submission. Rejection restores the held balance.</p>`}<label>Note (optional)<input name="note" maxlength="300"></label><button type="submit" class="green full">SUBMIT REQUEST</button><p class="error" id="formerror"></p></form>`);
  $('#reqform').onsubmit = async (e) => {
    e.preventDefault(); const button = e.target.querySelector('button'); if (button.disabled) return; button.disabled = true;
    try {
      const d = Object.fromEntries(new FormData(e.target));
      const proof = deposit ? await readImage(e.target.querySelector('[name=proofFile]').files[0]) : null;
      const result = await api('request',{type,amount:Number(d.amount),note:d.note,utr:d.utr,proof,holder:d.holder,bank:d.bank,account:d.account,confirmAccount:d.confirmAccount,ifsc:d.ifsc});
      modal.close(); toast('Request #' + result.id + ' sent to admin — PENDING'); await refresh();
    } catch (error) { formError(error); } finally { button.disabled = false; }
  };
}
async function info(kind) {
  config = await api('public');
  if (kind === 'rules') show('Rules',`<p class="rules">${esc(config.rules)}</p>`);
  if (kind === 'bonus') show('Bonus Information',`${bonuses()}<p>Welcome: ${pct('welcome')}% added only by admin after review. Deposit approval does not add a bonus automatically.</p><p>Promo: ${pct('promo')}% added only by admin. Checking a code does not credit the balance.</p><p>Losing: ${pct('losing')}% reviewed by admin when losses reach ₹10,000 or more. No bonus is automatic.</p>`);
  if (kind === 'promo') {
    const result = await api('me'); if (result.user?.role !== 'customer') return; me = result.user;
    const code = me.promoCode || '';
    show('Promo Code',`<form id="promoform"><label>Admin Promo Code<input name="code" value="${esc(code)}" readonly required maxlength="30"></label><button class="green full" ${code ? '' : 'disabled'}>CHECK CODE</button>${code ? '' : '<p class="muted">Admin has not assigned a promo code. Contact Customer Support.</p>'}<p class="error" id="formerror"></p></form>`);
    $('#promoform').onsubmit = async (e) => {
      e.preventDefault(); const button = e.target.querySelector('button'); if (button.disabled) return; button.disabled = true;
      try { const r = await api('promo',{code:new FormData(e.target).get('code')}); modal.close(); toast(r.message || 'Contact admin for the promo bonus.'); await refresh(); }
      catch (error) { formError(error); } finally { button.disabled = false; }
    };
  }
}
function dateIST(value) {
  const s = String(value || '');
  const d = new Date(/(?:Z|[+-]\d\d:?\d\d)$/i.test(s) ? s : s.replace(' ','T') + 'Z');
  return Number.isNaN(d.getTime()) ? esc(s) : esc(d.toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})) + ' IST';
}
async function account() {
  const data = await api('account');
  show('Account History',`<h3>Requests</h3><div class="tablewrap"><table><tr><th>TYPE</th><th>AMOUNT</th><th>STATUS</th></tr>${data.requests.map((b) => `<tr><td>${esc(b.type)}</td><td>${num(b.amount)}</td><td>${esc(b.status)}<small>${esc(b.admin_note || '')}</small>${b.proof_id ? `<a href="/api/media/${encodeURIComponent(b.proof_id)}" target="_blank" rel="noopener">View proof</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="3">No requests yet</td></tr>'}</table></div><h3>Account Statement</h3><div class="tablewrap"><table>${data.ledger.map((b) => `<tr><td>${esc(String(b.note || '').replace(/\bdemo\s+/gi,''))}<small>${dateIST(b.created)}</small></td><td>${num(b.amount)}</td></tr>`).join('') || '<tr><td>No transactions yet</td></tr>'}</table></div>`);
}
app.addEventListener('click',async (e) => {
  const button = e.target.closest('button'); if (!button || button.disabled) return;
  if (button.closest('#gamemenu')) closeMenu();
  try {
    if (button.dataset.auth) auth(button.dataset.auth);
    else if (button.hasAttribute('data-sound')) {
      await gameAudio.toggle(); button.textContent = gameAudio.enabled ? '🔊' : '🔇';
      button.setAttribute('aria-pressed',String(gameAudio.enabled)); toast(gameAudio.enabled ? 'Sound ON' : 'Sound OFF');
      if (gameAudio.enabled) { gameAudio.tone(880,880,0.18,0.08); if (state?.round && !document.hidden) gameAudio.sync(state.round); }
    } else if (button.hasAttribute('data-support')) support();
    else if (button.hasAttribute('data-logout')) { await api('logout',{}); me = null; state = null; welcome(); }
    else if (button.hasAttribute('data-password')) changePassword();
    else if (button.dataset.request) await request(button.dataset.request);
    else if (button.dataset.info) await info(button.dataset.info);
    else if (button.hasAttribute('data-account')) await account();
    else if (button.dataset.step) {
      const step = Number(button.dataset.step), input = $('#stake' + Math.abs(step));
      input.value = Math.max(10,Math.min(25000,(Number(input.value) || 10) + (step > 0 ? 10 : -10)));
    } else if (button.dataset.quick) {
      const [n,v] = button.dataset.quick.split(','); $('#stake' + n).value = v;
    } else if (button.dataset.tab) {
      tab = button.dataset.tab; visibleRows = 50;
      for (const b of document.querySelectorAll('[data-tab]')) b.classList.toggle('green',b === button);
      renderBets();
    } else if (button.hasAttribute('data-more')) { visibleRows += 50; renderBets(); }
    else if (button.dataset.bet && state) {
      busy = true; button.disabled = true;
      const n = Number(button.dataset.bet);
      const b = state.bets.find((v) => Number(v.round_id) === Number(state.round.id) && Number(v.panel) === n && v.status === 'ACTIVE');
      try {
        if (b && state.round.phase === 'FLYING') { await api('cashout',{id:b.id}); gameAudio.cashout(); }
        else { await api('bet',{amount:Number($('#stake'+n).value),panel:n,roundId:state.round.id}); }
      } finally { busy = false; await refresh(); }
    }
  } catch (error) { toast(error.message); }
});
async function init() {
  try {
    config = await api('public'); me = (await api('me')).user;
    if (me?.role === 'customer') {
      if (me.mustChangePassword) { welcome(); changePassword(true); }
      else { renderGame(); await refresh(); }
    } else welcome();
  } catch (error) { app.innerHTML = '<p class="error">Unable to connect. Refresh to retry.</p>'; toast(error.message); }
}
await init();
setInterval(() => { if (!document.hidden) refresh(); },500);
document.addEventListener('visibilitychange',() => { if (document.hidden) gameAudio.reset(); else refresh(); });
