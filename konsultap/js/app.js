const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = (u, method, body) => DB.api(u, method, body).catch(e => { throw e; });
const toast = (m, ms = 4500) => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms); };
const loading = (el, text = 'Loading...') => { el.innerHTML = `<p class="loading" role="status"><span class="spin" aria-hidden="true"></span>${esc(text)}</p>`; };
/** Disables a button while an async action runs, so a double tap cannot send it twice. */
async function busy(btn, fn) {
  if (!btn || btn.disabled) return;
  const label = btn.textContent, big = btn.classList.contains('btn') && !btn.classList.contains('sm');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true'); if (big) btn.textContent = 'Please wait...';
  try { return await fn(); } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = label; }
}
const submitBtn = f => f.querySelector('button:not([type=button])');
const statusTag = st => `<span class="tag ${st}">${esc(String(st).replace('_', ' '))}</span>`;
const HOURS_ALL = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const hoursFor = d => HOURS_ALL.filter(h => d !== today() || h > new Date().getHours());
const timeOpts = hs => hs.length ? hs.map(h => `<option value="${String(h).padStart(2, '0')}:00">${fmtH(h)}</option>`).join('') : '<option value="">No slots left</option>';
const TITLES = { home: 'Home', queue: 'Live queue', login: 'Sign in', portal: 'Staff sign in', book: 'Book an appointment', doctor: 'My clinic', admin: 'Admin console', privacy: 'Privacy Notice', forgot: 'Reset your password', reset: 'Choose a new password' };
const fmtH = h => { const n = h % 12 || 12; return n + (h < 12 ? ' AM' : ' PM'); };
const slot = t => { const [h] = t.split(':').map(Number); return fmtH(h); };
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
/* ---------- color legends (every color-coded indicator gets one) ---------- */
const legend = (items, title = 'Legend') => `<ul class="legend" aria-label="${title}"><li><b>${title}:</b></li>` + items.map(([c, t]) => `<li><i class="sw ${c}" aria-hidden="true"></i>${t}</li>`).join('') + '</ul>';
const LG_FAC = [['fac available', 'Available (free to use)'], ['fac occupied', 'Occupied / in use (striped)'], ['fac maintenance', 'Under maintenance (round)'], ['available', 'Green badge: at least one free'], ['cancelled', 'Red badge: none free']];
const LG_STATUS = [['pending', 'Pending: waiting for admin to confirm'], ['confirmed', 'Confirmed or finished'], ['serving', 'Now being served'], ['cancelled', 'Cancelled or no-show'], ['available', 'Arrived at the hospital']];
const LG_QUEUE = [['now', 'Now serving'], ['next', 'Next in line'], ['confirmed', 'Waiting in line'], ['available', 'Arrived (checked in)']];
const LG_WAIT = [['available', 'No one waiting'], ['pending', '1 to 3 waiting'], ['occupied', 'More than 3 waiting'], ['cancelled', 'Doctor on leave today']];
const LG_FC = [['peak', 'Predicted busiest hours'], ['normal', 'Other hours'], ['range', 'Likely range']];
const LG_MAIL = [['available', 'Email sent to patient'], ['pending', 'Not sent (see note)']];
let depts = [], doctors = [], timer = null, view = 'home', openPatient = null;

/* ---------- routing + role-based access control ---------- */
let ME = null;
const ROUTES = { home: null, queue: null, privacy: null, forgot: null, reset: null, login: 'guest', portal: 'guest', book: ['patient'], doctor: ['doctor'], admin: ['admin'] };
const go = r => { location.hash = '#/' + r; };
const homeFor = u => (u && (u.role === 'doctor' || u.role === 'admin')) ? u.role : 'home';
/* Staff (doctor/admin) sign in is on an unlisted route that is never linked from public pages. */
const isStaff = r => r === 'doctor' || r === 'admin';
const loginFor = r => isStaff(r) ? 'portal/staff-login/' + r : 'login/patient';
function renderNav() {
  const L = !ME ? [['home', 'Home'], ['queue', 'Live queue'], ['login/patient', 'Sign in']]
    : ME.role === 'patient' ? [['home', 'Home'], ['book', 'Book'], ['queue', 'Live queue']]
    : ME.role === 'doctor' ? [['doctor', 'My clinic'], ['queue', 'Live queue']] : [['admin', 'Admin console'], ['queue', 'Live queue']];
  $('#nav').innerHTML = L.map(([r, t]) => `<button data-view="${r}" class="${r.split('/')[0] === view ? 'on' : ''}">${t}</button>`).join('') +
    (ME ? `<span class="who">${esc(ME.name)} <small>${ME.role}</small></span><button id="logoutBtn" class="out">Log out</button>` : '');
}
async function route() {
  const parts = location.hash.replace('#', '').split('/'), name = parts[1] || 'home';
  ME = await api('/me');
  if (ME && ME.role === 'patient') api('/my/appointments').then(l => { myIds = new Set(l.map(a => a.id)); }).catch(() => {}); else myIds = new Set();   // lets us alert a patient when it is their turn
  let v = Object.hasOwn(ROUTES, name) ? name : 'home';
  if (v === 'portal' && parts[2] !== 'staff-login') v = 'home';            // only the exact staff URL works
  const rule = ROUTES[v], sub = v === 'portal' ? parts[3] : parts[2];
  if ((v === 'login' || v === 'portal') && ME) return go(homeFor(ME));
  if (Array.isArray(rule) && !(ME && rule.includes(ME.role))) {
    if (!ME) {
      if (v === 'book') { sessionStorage.next = v; toast('Please sign in to continue.'); return go('login/patient'); }
      return go('home');                                                    // staff pages: never reveal where the staff login is
    }
    toast(`Access denied: ${ME.role} accounts cannot open that page.`); return go(homeFor(ME));
  }
  show(v, sub);
}
function show(v, sub) {
  view = v; clearTimeout(timer); $('#dyn').innerHTML = '';
  ['home', 'login', 'portal', 'book', 'queue', 'privacy', 'forgot', 'reset'].forEach(id => $('#' + id).classList.toggle('hidden', id !== v));
  renderNav(); document.title = `${TITLES[v]} | KonsulTap`;
  if (['home', 'queue'].includes(v)) pollQueue();
  if (v === 'home' && !$('#hChart').innerHTML) setTimeout(() => { if (view === 'home') drawForecast('h'); }, 150);
  if (v === 'queue') loadPatientFac();
  if (v === 'login') showPortal(sub || 'patient');
  if (v === 'portal') showStaff(sub);
  if (v === 'forgot') openForgot(sub);
  if (v === 'reset') openReset(sub);
  if (v === 'book') openBook();
  if (v === 'doctor') mountDoctor();
  if (v === 'admin') mountAdmin();
  window.scrollTo(0, 0);
  const m = $('#main'); m.setAttribute('tabindex', '-1'); m.focus({ preventScroll: true });   // screen readers: announce the new page
}
window.addEventListener('hashchange', route);
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-view]'); if (b) { e.preventDefault(); go(b.dataset.view); }
  if (e.target.id === 'logoutBtn') { await api('/logout', 'POST'); location.hash = '#/home'; route(); }
  const c = e.target.closest('[data-copy]'); if (c) navigator.clipboard?.writeText(c.dataset.copy).then(() => toast('Reference code copied.')).catch(() => toast('Could not copy. Please select the code and copy it.'));
  if (e.target.closest('[data-print]')) window.print();
});
window.addEventListener('kt-session-expired', () => { const r = ME && ME.role; ME = null; toast('Your session expired. Please sign in again.', 7000); location.hash = '#/' + loginFor(r); route(); });
function bindTabs(root) {
  $$('.tabs', root).forEach(t => {
    t.setAttribute('role', 'tablist');
    $$('button', t).forEach(b => { b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(b.classList.contains('on'))); b.setAttribute('aria-controls', b.dataset.t); });
    $$('.tab', t.parentElement).forEach(x => x.setAttribute('role', 'tabpanel'));
    t.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      $$('button', t).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
      $$('.tab', t.parentElement).forEach(x => x.classList.toggle('hidden', x.id !== b.dataset.t));
      tabLoad[b.dataset.t]?.();
    });
  });
}
function showPortal(p) {
  if (p !== 'register') p = 'patient';                                  // old #/login/doctor links fall back to the patient form
  $$('#login form').forEach(f => f.classList.toggle('hidden', f.dataset.portal !== p));
  $('#loginTitle').textContent = p === 'register' ? 'Create a patient account' : 'Patient sign in';
  if (p === 'patient') initGoogle();
}
function showStaff(p) {
  p = p === 'admin' ? 'admin' : 'doctor';
  $$('#portal form').forEach(f => f.classList.toggle('hidden', f.dataset.portal !== p));
  $$('#staffTabs button').forEach(b => { b.classList.toggle('on', b.dataset.p === p); b.setAttribute('aria-pressed', String(b.dataset.p === p)); });
}
$('#staffTabs').onclick = e => { const b = e.target.closest('button'); if (b) go('portal/staff-login/' + b.dataset.p); };
async function afterLogin(r) {
  toast('Welcome, ' + r.user.name); const nx = sessionStorage.next; delete sessionStorage.next;
  go(r.user.role === 'patient' ? (nx === 'book' ? 'book' : 'home') : r.user.role); route();
}
$$('form.login').forEach(f => f.onsubmit = e => {
  e.preventDefault(); const m = $('.msg', f);
  busy(submitBtn(f), async () => {
    m.className = 'msg'; m.textContent = '';
    try { const r = await api('/login', 'POST', { role: f.dataset.role, ...Object.fromEntries(new FormData(f)) }); f.reset(); afterLogin(r); }
    catch (x) { m.className = 'msg err'; m.textContent = x.message; }
  });
});

/* ---------- sign-up: strict email format, typo suggestions, confirm password ---------- */
const EMAIL_STRICT = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;
const validEmail = e => e.length <= 190 && EMAIL_STRICT.test(e);
const COMMON_DOMAINS = ['gmail.com', 'yahoo.com', 'yahoo.com.ph', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com', 'g.batstate-u.edu.ph'];
const TLD_FIX = { con: 'com', cmo: 'com', cpm: 'com', xom: 'com', vom: 'com', comm: 'com', coom: 'com', ogr: 'org', nte: 'net' };
function editDistance(a, b) {   // Damerau-Levenshtein (a swapped pair of letters counts as one typo)
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
/** Returns a corrected email if the domain looks like a typo of a common provider (e.g. gmial.com -> gmail.com), else null. */
function suggestEmail(email) {
  const at = email.lastIndexOf('@'); if (at < 1) return null;
  const local = email.slice(0, at), dom = email.slice(at + 1);
  if (COMMON_DOMAINS.includes(dom)) return null;
  let best = null, bestD = Infinity;
  COMMON_DOMAINS.forEach(c => { const dd = editDistance(dom, c); if (dd < bestD) { best = c; bestD = dd; } });
  if (bestD <= (dom.length < 9 ? 1 : 2)) return local + '@' + best;
  const tld = dom.split('.').pop();
  if (TLD_FIX[tld]) return local + '@' + dom.slice(0, -tld.length) + TLD_FIX[tld];
  return null;
}
const regF = $('#fRegister');
let typoKept = '';   // an email the user chose to keep even though we suggested a fix
function checkRegEmail(final) {
  const el = regF.email, hint = $('#emailHint');
  if (final) el.value = el.value.trim().toLowerCase();
  const v = el.value.trim().toLowerCase();
  hint.className = 'field-hint'; hint.textContent = '';
  if (!v) { el.setCustomValidity(''); return true; }                      // "required" handles empty
  if (!validEmail(v)) {
    el.setCustomValidity('Enter a valid email address, for example juan.delacruz@gmail.com.');
    if (final) { hint.className = 'field-hint err'; hint.textContent = 'That email address does not look right. Example: juan.delacruz@gmail.com'; }
    return false;
  }
  el.setCustomValidity('');
  const s = final && typoKept !== v ? suggestEmail(v) : null;
  if (s) { hint.className = 'field-hint warn'; hint.innerHTML = `Did you mean <button type="button" class="linkbtn" data-fix="${esc(s)}">${esc(s)}</button>? <button type="button" class="linkbtn subtle" data-keep>No, keep mine</button>`; return false; }
  return true;
}
function checkConfirm(final) {
  const c = regF.confirm, h = $('#confirmHint'), pw = regF.password.value;
  const bad = !!c.value && c.value !== pw;
  c.setCustomValidity(bad ? 'The passwords do not match.' : '');
  const showBad = bad && (final || c.value.length >= pw.length);          // don't nag while they are still typing
  h.className = 'field-hint ' + (showBad ? 'err' : (c.value && !bad ? 'ok' : ''));
  h.textContent = showBad ? 'The passwords do not match.' : (c.value && !bad ? 'Passwords match.' : '');
}
regF.email.addEventListener('input', () => checkRegEmail(false));
regF.email.addEventListener('change', () => checkRegEmail(true));
regF.password.addEventListener('input', () => checkConfirm(false));
regF.confirm.addEventListener('input', () => checkConfirm(false));
regF.confirm.addEventListener('change', () => checkConfirm(true));
regF.addEventListener('click', e => {
  const fix = e.target.closest('[data-fix]'); if (fix) { regF.email.value = fix.dataset.fix; typoKept = ''; checkRegEmail(true); regF.email.focus(); }
  if (e.target.closest('[data-keep]')) { typoKept = regF.email.value.trim().toLowerCase(); checkRegEmail(true); regF.password.focus(); }
});
regF.addEventListener('reset', () => { typoKept = ''; ['#emailHint', '#confirmHint'].forEach(s => { $(s).textContent = ''; $(s).className = 'field-hint'; }); });
regF.onsubmit = e => {
  e.preventDefault(); const f = regF, m = $('.msg', f);
  m.className = 'msg'; m.textContent = '';
  checkConfirm(true);
  if (!checkRegEmail(true)) { m.className = 'msg err'; m.textContent = f.email.validity.valid ? 'Please confirm your email address above: it may have a typo.' : 'Enter a valid email address.'; f.email.focus(); return; }
  if (!f.checkValidity()) { f.reportValidity(); return; }
  busy(submitBtn(f), async () => {
    try { const { confirm, ...v } = Object.fromEntries(new FormData(f)); const r = await api('/register', 'POST', { ...v, consent: f.consent.checked }); f.reset(); afterLogin(r); }
    catch (x) { m.className = 'msg err'; m.textContent = x.message; }
  });
};

/* ---------- show/hide toggle (eye icon) on every password field ---------- */
const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.1 10.1 0 0 1 12 19C5 19 1 12 1 12a18.5 18.5 0 0 1 5.06-5.94M9.9 5.24A9.1 9.1 0 0 1 12 5c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';
function addPwToggles(root = document) {
  $$('input[type=password]:not([data-pw])', root).forEach(inp => {
    inp.dataset.pw = '1';
    const wrap = document.createElement('span'), b = document.createElement('button');
    wrap.className = 'pw-wrap'; inp.replaceWith(wrap); wrap.append(inp, b);
    b.type = 'button'; b.className = 'pw-toggle';
    const set = show => { inp.type = show ? 'text' : 'password'; b.innerHTML = show ? EYE_OFF : EYE; b.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); b.title = b.getAttribute('aria-label'); b.setAttribute('aria-pressed', String(show)); };
    set(false);
    b.onclick = e => { e.preventDefault(); const pos = inp.selectionStart; set(inp.type === 'password'); inp.focus(); try { inp.setSelectionRange(pos, pos); } catch {} };
    inp.form?.addEventListener('reset', () => set(false));                // never leave a password visible after the form is cleared
  });
}
addPwToggles();
/* ---------- password recovery ---------- */
const FORGOT = {
  patient: ['Email', 'Enter the email you registered with. We will send you a link to choose a new password.'],
  doctor: ['Doctor ID or email', 'Hospital staff: the link is sent to the email on file for your account. If none is on file, ask the administrator.'],
  admin: ['Username or email', 'The link is sent to the email on file for the administrator account.']
};
let forgotRole = 'patient';
function openForgot(role) {
  forgotRole = FORGOT[role] ? role : 'patient';
  const f = $('#fForgot'); $('#forgotLabelText').textContent = FORGOT[forgotRole][0]; $('#forgotHelp').textContent = FORGOT[forgotRole][1];
  $('#forgotBack').href = '#/' + loginFor(forgotRole); $('.msg', f).textContent = ''; f.identifier.value = ''; f.identifier.type = forgotRole === 'patient' ? 'email' : 'text'; f.identifier.focus();
}
$('#fForgot').onsubmit = e => {
  e.preventDefault(); const f = e.target, m = $('.msg', f);
  busy(submitBtn(f), async () => {
    m.className = 'msg'; m.textContent = '';
    try { const r = await api('/password/forgot', 'POST', { role: forgotRole, identifier: f.identifier.value }); m.className = 'msg ok'; m.textContent = r.message; f.identifier.value = ''; }
    catch (x) { m.className = 'msg err'; m.textContent = x.message; }
  });
};
async function openReset(tok) {
  const st = $('#resetState'), f = $('#fReset'); f.classList.add('hidden'); $('.msg', f).textContent = '';
  if (tok) { sessionStorage.kt_reset = tok; history.replaceState(null, '', '#/reset'); }   // keep the secret out of the address bar and browser history
  const token = sessionStorage.kt_reset;
  const bad = '<p class="msg err">This reset link is invalid or has expired.</p><p>Request a new link from the sign-in page: <a href="#/forgot/patient">Forgot your password?</a></p>';
  if (!token) { st.innerHTML = bad; return; }
  loading(st, 'Checking your link...');
  try {
    const v = await api('/password/verify?token=' + encodeURIComponent(token));
    if (!v.valid) { delete sessionStorage.kt_reset; st.innerHTML = bad; return; }
    st.innerHTML = ''; f.classList.remove('hidden'); f.password.focus();
  } catch (x) { st.innerHTML = `<p class="msg err">${esc(x.message)}</p>`; }
}
$('#fReset').onsubmit = e => {
  e.preventDefault(); const f = e.target, m = $('.msg', f);
  if (f.password.value !== f.confirm.value) { m.className = 'msg err'; m.textContent = 'The two passwords do not match.'; return; }
  busy(submitBtn(f), async () => {
    m.className = 'msg';
    try {
      const r = await api('/password/reset', 'POST', { token: sessionStorage.kt_reset, password: f.password.value });
      delete sessionStorage.kt_reset; f.reset(); f.classList.add('hidden'); api('/logout', 'POST').catch(() => {});   // clear any old login on this device
      $('#resetState').innerHTML = `<p class="msg ok">Your password was changed. You were signed out on all devices.</p><p><a class="btn g" href="#/${esc(loginFor(r.role))}">Sign in</a></p>`;
    } catch (x) { m.className = 'msg err'; m.textContent = x.message; }
  });
};

/* Google sign-in (patients). Shown only when a Client ID is set in js/config.js. */
let gReady = null;
async function initGoogle() {
  const id = window.KONSULTAP_GOOGLE_CLIENT_ID, w = $('#gWrap');
  if (!id) { w.classList.add('hidden'); return; }
  w.classList.remove('hidden');
  try {
    if (!(window.google && google.accounts)) await (gReady ||= new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.onload = ok; sc.onerror = () => { gReady = null; no(new Error('Could not load Google sign-in. Check your connection.')); }; document.head.append(sc); }));
    const { nonce, nonceToken } = await api('/auth/nonce');
    google.accounts.id.initialize({ client_id: id, nonce, callback: async ({ credential }) => { try { afterLogin(await api('/auth/google', 'POST', { credential, nonceToken })); } catch (x) { toast(x.message, 7000); } } });
    google.accounts.id.renderButton($('#gBtn'), { theme: 'outline', size: 'large', text: 'signin_with' });
  } catch (x) { $('#gBtn').innerHTML = `<small class="muted">${esc(x.message)}</small>`; }
}

/* ---------- home & live queue ---------- */
let qFails = 0, qLast = null, queueRows = [], myIds = new Set(), prevState = {}, lastServing = {}, dashT;
const stateOf = r => r.status === 'serving' ? 'serving' : r.is_next ? 'next' : 'waiting';
/* ---- wait-time estimates: the server sends minutes at the moment it computed them; we count down locally so they stay fresh ---- */
const stamp = rows => { const t = Date.now(); rows.forEach(r => { r._rx = t; }); return rows; };
const left = (r, v) => Math.max(0, v - (Date.now() - (r._rx || Date.now())) / 60000);
const nice = m => m < 10 ? Math.round(m) : Math.round(m / 5) * 5;
const dur = m => m >= 60 ? `${Math.floor(m / 60)} hr${m % 60 >= 5 ? ' ' + Math.round(m % 60 / 5) * 5 + ' min' : ''}` : `${m} min`;
function waitText(r) {
  if (!r || r.status === 'serving' || r.wait_minutes == null) return '';
  const m = left(r, r.wait_minutes);
  return m <= 2 ? 'Any moment now' : `About ${dur(nice(m))}`;
}
function waitTitle(r) {
  const lo = nice(left(r, r.wait_low)), hi = nice(left(r, r.wait_high)), eta = new Date(r._rx + r.wait_minutes * 60000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Likely ${dur(lo)} to ${dur(hi)}. Estimated call time around ${eta}.${r.estimate_basis === 'default' ? ' Based on typical visit length.' : ''}`;
}
const etaHTML = r => { const t = waitText(r); return t ? ` <span class="eta" title="${esc(waitTitle(r))}">${esc(t)}</span>` : ''; };
const estLine = a => {
  const qr = queueRows.find(r => r.id === a.id);
  if (!qr) return '';
  return qr.status === 'serving' ? '<br><small><b>Now being served</b></small>' : (a.status === 'confirmed' && a.date === today() ? '<br><small>Estimated wait:' + etaHTML(qr) + '</small>' : '');
};
function setLive(on, why) {
  $$('.live-state').forEach(el => { el.className = 'live-state ' + (on ? 'on' : 'off'); el.textContent = on ? 'Live' : (why === 'unsupported' ? 'Auto-refresh' : 'Reconnecting...'); });
}
/** Real-time: the server pushes queue changes; no page refresh needed. */
function startLive() {
  Live.connect({
    state: setLive,
    snapshot: d => { queueRows = stamp(d.rows); qFails = 0; $('#connBanner').classList.add('hidden'); renderQueue(); },     // full picture on every (re)connect
    queue: d => {                                                                                                     // one doctor's queue changed
      queueRows = queueRows.filter(r => r.doctor_id !== d.doctor_id).concat(stamp(d.rows)).sort((a, b) => a.doctor_id - b.doctor_id || a.time.localeCompare(b.time) || a.queue_no - b.queue_no);
      qLast = new Date(); renderQueue(); refreshDashboards(d);
    }
  });
}
function refreshDashboards(d) {
  clearTimeout(dashT);
  dashT = setTimeout(() => {
    if (view === 'doctor' && ME && d.doctor_id == ME.ref_id && $('#dq') && !$('#dq').classList.contains('hidden')) docQueue();
    if (view === 'admin' && $('#am') && !$('#am').classList.contains('hidden')) monitor();
    if (view === 'book') loadMine();
  }, 300);
}
async function refreshQueue() {
  try { queueRows = stamp(await api('/queue')); qFails = 0; qLast = new Date(); $('#connBanner').classList.add('hidden'); }
  catch {
    qFails++; const b = $('#connBanner');
    b.textContent = `Connection lost. Showing the last data${qLast ? ' from ' + qLast.toLocaleTimeString() : ''}. Retrying automatically...`; b.classList.remove('hidden'); return;
  }
  renderQueue();
  if (view === 'queue') refreshLeave();
}
async function refreshLeave() {
  const dp = $('#qDept').value;
  try {
    const lv = await api('/leave/today'), off = lv.filter(x => !dp || x.dept_id == dp);
    $('#leaveBanner').innerHTML = off.length ? `<div class="banner warn" role="status"><b>Doctors on leave today:</b> ${off.map(x => esc(x.doctor) + ' (' + esc(x.dept) + ')').join(', ')}. Their patients are moved to another doctor or contacted by email.</div>` : '';
  } catch { /* the banner is optional */ }
}
/** Draws the queue from queueRows. Called after a fetch AND after every pushed event. */
function renderQueue() {
  const rows = queueRows, dp = $('#qDept').value;
  // 1) tell a patient when it is their turn / they are next; announce changes to screen readers
  rows.forEach(r => {
    const st = stateOf(r), was = prevState[r.id];
    if (was !== undefined && was !== st && myIds.has(r.id)) {
      if (st === 'serving') toast(`It's your turn! Please proceed to ${r.room} (${r.doctor}).`, 15000);
      else if (st === 'next') toast(`You're next in line with ${r.doctor}. Please be ready.`, 12000);
    }
  });
  prevState = Object.fromEntries(rows.map(r => [r.id, stateOf(r)]));
  const nowKey = {}, said = [];
  rows.filter(r => r.status === 'serving').forEach(r => { nowKey[r.doctor_id] = r.queue_no; if (lastServing[r.doctor_id] !== undefined && lastServing[r.doctor_id] !== r.queue_no && (!dp || r.dept_id == dp)) said.push(`Now serving ticket ${r.queue_no} with ${r.doctor}.`); });
  lastServing = nowKey; if (said.length && view === 'queue') $('#liveAnnounce').textContent = said.join(' ');
  // 2) the "Now serving" board (home page)
  const serving = rows.filter(r => r.status === 'serving');
  $('#nowServing').innerHTML = serving.length ? serving.slice(0, 5).map(r => { const nx = rows.find(x => x.doctor_id === r.doctor_id && x.is_next); return `<div class="ns"><span>${esc(r.dept)}<br><small>${esc(r.doctor)}${nx ? ' &middot; Next: #' + nx.queue_no + ' (' + waitText(nx).toLowerCase() + ')' : ''}</small></span><b>#${r.queue_no}</b></div>`; }).join('') : '<p>No consultations in progress.</p>';
  if (view !== 'queue') return;
  // 3) the live queue page
  if (!dp) $('#liveQueue').innerHTML = '<div class="empty">Choose a department to see the queue of its confirmed doctors.</div>';
  else {
    const by = {}; rows.filter(r => r.dept_id == dp).forEach(r => (by[r.doctor_id] ||= []).push(r));
    $('#liveQueue').innerHTML = Object.values(by).map(l => `<div class="qcol"><h4>${esc(l[0].doctor)}</h4><small class="muted">${esc(l[0].dept)} &middot; ${esc(l[0].room)}${l[0].avg_minutes ? ' &middot; Avg visit about ' + Math.round(l[0].avg_minutes) + ' min' : ''}</small>` +
      l.map(r => `<div class="qn ${r.status === 'serving' ? 's' : r.is_next ? 'next' : ''}"><b>${r.queue_no}</b><span>${esc(r.patient_name.split(' ')[0])} ${r.status === 'serving' ? '<span class="tag serving">Now serving</span>' : (r.is_next ? '<span class="tag next">Next</span> ' : '') + '<small class="muted">' + slot(r.time) + '</small>' + etaHTML(r) + (r.checked_in ? ' <span class="tag available">Arrived</span>' : '')}</span></div>`).join('') + '</div>').join('') || '<div class="empty">No confirmed doctors have patients in line in this department today.</div>';
  }
  $('#stamp').textContent = 'Updated ' + new Date().toLocaleTimeString();
}
/** Safety net: with the live connection up we only re-check once a minute; if it is down (e.g. serverless) we poll every 15 s (backing off) to keep phones responsive. */
async function pollQueue() {
  clearTimeout(timer);
  if (!['home', 'queue'].includes(view)) return;
  if (!document.hidden) await refreshQueue();
  timer = setTimeout(pollQueue, Live.isLive() ? 60000 : Math.min(15000 * 2 ** qFails, 60000));
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && ['home', 'queue'].includes(view)) pollQueue(); });
const FAC_LABELS = {
  staff: { available: 'Available', occupied: 'Occupied', maintenance: 'Maintenance' },
  doctor: { occupied: 'Reserve / In use', available: 'Release', maintenance: 'Maintenance' }
};
function facHTML(list, editable, doctorMode = false) {
  const grp = {}; list.forEach(f => ((grp[f.kind + '|' + f.group_name]) ||= []).push(f));
  const labels = doctorMode ? FAC_LABELS.doctor : FAC_LABELS.staff;
  const order = doctorMode ? ['occupied', 'available', 'maintenance'] : ['available', 'occupied', 'maintenance'];
  const mk = kind => Object.entries(grp).filter(([k]) => k.startsWith(kind)).map(([k, l]) => {
    const av = l.filter(x => x.status === 'available').length;
    return `<div class="fcard"><div class="fcard-top"><b>${esc(l[0].group_name)}</b><span class="tag ${av ? 'available' : 'occupied'}">${av} of ${l.length} available</span></div>
      <div class="dots" role="group" aria-label="${esc(l[0].group_name)}: ${av} of ${l.length} available">${l.map(x => `<i class="${x.status}" role="img" aria-label="${esc(x.name)}: ${x.status}" title="${esc(x.name)}: ${x.status}"></i>`).join('')}</div>
      ${editable ? `<div class="fcard-ctrl"><select data-fac="${esc(l[0].group_name)}" aria-label="Select unit in ${esc(l[0].group_name)}">${l.map(x => `<option value="${x.id}">${esc(x.name)} (${x.status})</option>`).join('')}</select>
      <div class="fcard-btns">${order.map(s => `<button type="button" class="btn sm ${s === 'occupied' ? 'r' : s === 'maintenance' ? 'o dark' : 'g'}" data-set="${s}">${labels[s]}</button>`).join('')}</div></div>` : ''}</div>`;
  }).join('');
  const beds = mk('bed'), eq = mk('equipment');   // equipment is staff-only: the patient view never shows this section
  const sections = (beds ? `<h3>Rooms &amp; beds</h3><div class="fac">${beds}</div>` : '') + (eq ? `<h3 style="margin-top:1.2rem">Medical equipment</h3><div class="fac">${eq}</div>` : '');
  return legend(LG_FAC, 'Color legend') + (sections || '<div class="empty">No matching facilities found.</div>');
}
async function loadPatientFac() { $('#patientFac').innerHTML = facHTML((await api('/facilities')).filter(f => f.kind === 'bed'), false); }
async function loadFac(el, editable, doctorMode = false) {
  const el$ = $(el);
  if (!el$.innerHTML.trim()) loading(el$, 'Loading facilities...');
  let all;
  try { all = await api('/facilities'); } catch (x) { el$.innerHTML = `<p class="msg err">${esc(x.message)}</p>`; return; }
  const state = el$._facState ||= { filter: 'all', q: '' };
  const beds = all.filter(f => f.kind === 'bed'), eqs = all.filter(f => f.kind === 'equipment');
  const bAv = beds.filter(f => f.status === 'available').length, eAv = eqs.filter(f => f.status === 'available').length;
  const render = () => {
    let list = all;
    if (state.filter === 'bed') list = beds;
    else if (state.filter === 'equipment') list = eqs;
    else if (state.filter === 'available') list = all.filter(f => f.status === 'available');
    const q = state.q.trim().toLowerCase();
    if (q) list = list.filter(f => (f.group_name + ' ' + f.name).toLowerCase().includes(q));
    el$.querySelector('.fac-body').innerHTML = facHTML(list, editable, doctorMode);
  };
  el$.innerHTML = (doctorMode ? `<div class="card inner fac-bar"><div><b>Clinic resource &amp; bed desk</b><br><small class="muted">Check availability and reserve a bed or piece of equipment for a patient. Changes update the live board and are recorded in the audit log.</small></div>
      <div class="fac-stats"><span class="tag available">${bAv}/${beds.length} beds free</span><span class="tag available">${eAv}/${eqs.length} equipment free</span></div></div>` : '') +
    `<div class="row fac-tools"><div class="pill-group" role="group" aria-label="Filter facilities">${[['all', 'All'], ['bed', 'Rooms & beds'], ['equipment', 'Equipment'], ['available', 'Available only']].map(([k, lbl]) => `<button type="button" class="btn sm ${state.filter === k ? 'g' : 'o dark'}" data-ff="${k}">${lbl}</button>`).join('')}</div>
      <input type="search" class="fac-search" placeholder="Search ward or equipment (e.g. ICU, ECG)..." value="${esc(state.q)}" aria-label="Search facilities"></div><div class="fac-body"></div>`;
  render();
  el$.querySelector('.fac-search').oninput = e => { state.q = e.target.value; render(); };
  el$.onclick = async e => {
    const ff = e.target.closest('[data-ff]');
    if (ff) { state.filter = ff.dataset.ff; el$.querySelectorAll('[data-ff]').forEach(x => { x.className = 'btn sm ' + (x === ff ? 'g' : 'o dark'); }); render(); return; }
    if (!editable) return;
    const b = e.target.closest('[data-set]'); if (!b) return;
    const sel = b.closest('.fcard').querySelector('select');
    const id = sel.value, label = sel.options[sel.selectedIndex]?.textContent.split(' (')[0] || 'Facility';
    busy(b, async () => {
      try {
        await api('/facilities/' + id, 'PATCH', { status: b.dataset.set });
        toast(`${label} marked ${b.dataset.set}.`);
        loadFac(el, true, doctorMode);
      } catch (x) { toast(x.message, 6000); }
    });
  };
}

/* ---------- booking & tracking ---------- */
async function init() {
  await DB.ready();
  [depts, doctors] = await Promise.all([api('/departments'), api('/doctors')]);
  $('#deptGrid').innerHTML = depts.map(d => `<button class="dept" data-dept="${d.id}"><img src="img/depts/${d.icon}" alt="">${esc(d.name)}</button>`).join('');
  $('#bDept').innerHTML = depts.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
  $('#qDept').innerHTML = '<option value="">Choose a department</option>' + depts.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
  $('#bDate').min = $('#bDate').value = today(); $('#hDate').value = DB.iso(DB.addDays(1));
  $('#qLegend').innerHTML = legend(LG_QUEUE); $('#statusLegend').innerHTML = legend(LG_STATUS, 'Status colors');
  buildTimes(); loadDocs(); startLive(); setInterval(() => { if (['home', 'queue'].includes(view)) renderQueue(); else if (view === 'book') loadMine(); }, 30000); await route();
}
function buildTimes() {
  const sel = $('#bTime'), keep = sel.value, hs = hoursFor($('#bDate').value);
  sel.innerHTML = timeOpts(hs);
  if (hs.some(h => String(h).padStart(2, '0') + ':00' === keep)) sel.value = keep;
}
async function loadDocs() {
  const dept = $('#bDept').value, date = $('#bDate').value, time = $('#bTime').value, sel = $('#bDoc');
  if (!date || !time) { sel.innerHTML = '<option value="">Pick a date and time first</option>'; $('#docHint').textContent = ''; return; }
  const l = await api(`/doctors?dept=${dept}&date=${date}&time=${encodeURIComponent(time)}`);
  sel.innerHTML = l.length ? l.map(d => `<option value="${d.id}">${esc(d.name)} (${esc(d.room)})</option>`).join('') : '<option value="">No doctor available</option>';
  $('#docHint').textContent = l.length ? `${l.length} doctor${l.length > 1 ? 's' : ''} available on ${date} at ${slot(time)}.` : 'No doctor is available then. Try another time or date.';
}
$('#bDept').onchange = $('#bTime').onchange = loadDocs;
$('#bDate').onchange = () => { buildTimes(); loadDocs(); };
$('#qDept').onchange = () => { renderQueue(); refreshLeave(); };
$('#deptGrid').onclick = e => { const b = e.target.closest('[data-dept]'); if (!b) return; sessionStorage.dept = b.dataset.dept; go('book'); };
$('#bookForm').onsubmit = e => {
  e.preventDefault(); const f = e.target, m = $('#bookMsg');
  busy(submitBtn(f), async () => {
    m.className = 'msg'; m.textContent = ''; $('#bookDone').innerHTML = '';
    const v = Object.fromEntries(new FormData(f));
    try {
      const r = await api('/appointments', 'POST', v);
      showBooked(r, v); $('#refIn').value = r.ref; f.reset(); $('#bDate').value = today(); prefill(); buildTimes(); loadDocs(); loadMine();
    } catch (x) { m.className = 'msg err'; m.textContent = x.message; }
  });
};
function showBooked(r, v) {
  const [y, mo, d] = v.date.split('-'), hh = v.time.slice(0, 2), end = String(+hh + 1).padStart(2, '0');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//KonsulTap//EN', 'BEGIN:VEVENT', `UID:${r.ref}@konsultap`, `DTSTAMP:${y}${mo}${d}T000000`, `DTSTART:${y}${mo}${d}T${hh}0000`, `DTEND:${y}${mo}${d}T${end}0000`, `SUMMARY:KonsulTap appointment (${r.ref})`, 'LOCATION:Batangas Medical Center', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  $('#bookDone').innerHTML = `<div class="done-card" role="status"><h3>Booking received</h3><p class="muted">Your reference code</p><p class="refcode">${esc(r.ref)}</p>
    <p>${r.emailed ? 'A confirmation letter was emailed to ' + esc(v.email) + '.' : 'We could not email you (' + esc(r.note) + '). Please save this code.'} The hospital will now confirm your doctor and queue number.</p>
    <div class="row"><button type="button" class="btn sm g" data-copy="${esc(r.ref)}">Copy code</button><button type="button" class="btn sm o dark" data-print="1">Print</button><a class="btn sm o dark" download="konsultap-${esc(r.ref)}.ics" href="data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}">Add to calendar</a></div></div>`;
  $('#bookDone').focus();
}
function prefill() { const f = $('#bookForm'); f.patient_name.value = ME.name; f.email.value = ME.email || ''; }
async function openBook() {
  prefill(); if (sessionStorage.dept) { $('#bDept').value = sessionStorage.dept; delete sessionStorage.dept; }
  $('#reschedPanel').innerHTML = ''; buildTimes(); loadDocs(); loadMine();
}
async function loadMine() {
  const box = $('#mine'); if (!box.innerHTML) loading(box, 'Loading your appointments...');
  try {
    const l = await api('/my/appointments'); myIds = new Set(l.map(a => a.id));
    box.innerHTML = l.length ? l.map(a => {
      const live = ['pending', 'confirmed'].includes(a.status) && a.date >= today(), here = a.status === 'confirmed' && a.date === today();
      return `<div class="appt-item"><div class="appt-info"><div class="appt-head"><strong class="appt-ref">${esc(a.ref)}</strong>${statusTag(a.status)}${a.checked_in_at ? '<span class="tag available">Arrived</span>' : ''}</div><small class="muted">${esc(a.dept)} &middot; ${a.date} ${slot(a.time)}${a.doctor ? ' &middot; ' + esc(a.doctor) : ''}${a.cancelled_by === 'system' ? ' &middot; closed automatically' : ''}</small>${estLine(a)}</div>
        <div class="actions"><button class="btn sm g" data-ref="${esc(a.ref)}">Track</button>${here && !a.checked_in_at ? `<button class="btn sm y" data-checkin="${a.id}">I'm here</button>` : ''}${live ? `<button class="btn sm o dark" data-resched="${a.id}" data-dept="${a.dept_id}" data-ref2="${esc(a.ref)}">Reschedule</button><button class="btn sm r" data-cancel="${a.id}">Cancel</button>` : ''}</div></div>`;
    }).join('') : '<div class="empty"><p><b>No appointments yet.</b></p><p>Book your first consultation with the form.</p></div>';
  } catch (x) { box.innerHTML = `<p class="msg err">${esc(x.message)} <button class="btn sm g" data-retry="1">Retry</button></p>`; }
}
$('#mine').onclick = e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.ref) { $('#refIn').value = t.dataset.ref; $('#trackBtn').click(); }
  else if (t.dataset.retry) loadMine();
  else if (t.dataset.checkin) busy(t, async () => { try { await api(`/appointments/${t.dataset.checkin}/checkin`, 'POST'); toast('Checked in. Please wait to be called.'); } catch (x) { toast(x.message, 7000); } loadMine(); });
  else if (t.dataset.cancel) { if (confirm('Cancel this appointment? The slot will be given to other patients.')) busy(t, async () => { try { await api(`/appointments/${t.dataset.cancel}/cancel`, 'POST'); toast('Appointment cancelled.'); } catch (x) { toast(x.message, 7000); } loadMine(); }); }
  else if (t.dataset.resched) openResched(t.dataset.resched, t.dataset.dept, t.dataset.ref2);
};
function openResched(id, dept, ref) {
  const p = $('#reschedPanel');
  p.innerHTML = `<form class="card inner" id="rsForm"><h3>Reschedule ${esc(ref)}</h3><div class="cols"><label>New date<input type="date" name="date" min="${today()}" value="${today()}" required></label><label>New time<select name="time" required></select></label></div>
    <label>Available doctor<select name="doctor_id" required></select></label><p class="muted">After rescheduling, the appointment goes back to "pending" until the hospital confirms it again.</p>
    <div class="row"><button class="btn g">Save new time</button><button type="button" class="btn o dark" data-close="1">Close</button></div><p class="msg" role="status"></p></form>`;
  const f = $('#rsForm'), m = $('.msg', f);
  const fillDocs = async () => {
    if (!f.date.value || !f.time.value) { f.doctor_id.innerHTML = '<option value="">Pick a date and time first</option>'; return; }
    const l = await api(`/doctors?dept=${dept}&date=${f.date.value}&time=${encodeURIComponent(f.time.value)}&except=${id}`);
    f.doctor_id.innerHTML = l.length ? l.map(d => `<option value="${d.id}">${esc(d.name)} (${esc(d.room)})</option>`).join('') : '<option value="">No doctor available</option>';
  };
  const fillTimes = () => { f.time.innerHTML = timeOpts(hoursFor(f.date.value)); fillDocs(); };
  f.date.onchange = fillTimes; f.time.onchange = fillDocs; fillTimes();
  f.onsubmit = e => { e.preventDefault(); busy(submitBtn(f), async () => {
    try { await api(`/appointments/${id}/reschedule`, 'POST', Object.fromEntries(new FormData(f))); toast('Rescheduled. Waiting for the hospital to confirm.'); p.innerHTML = ''; loadMine(); }
    catch (x) { m.className = 'msg err'; m.textContent = x.message; }
  }); };
  p.onclick = e => { if (e.target.closest('[data-close]')) p.innerHTML = ''; };
  f.date.focus();
}
$('#trackBtn').onclick = async () => {
  const o = $('#trackOut'); loading(o, 'Checking...');
  try {
    const a = await api('/track/' + encodeURIComponent($('#refIn').value.trim()));
    o.innerHTML = `<p>${statusTag(a.status)}${a.checked_in ? ' <span class="tag available">Arrived</span>' : ''} ${esc(a.dept)}, ${a.date} at ${slot(a.time)}</p>` +
      (a.doctor ? `<p><b>${esc(a.doctor)}</b> (${esc(a.room)})<br>Ticket number <b>${a.queue_no}</b>${a.ahead != null ? ` &middot; ${a.ahead} ahead of you` : ''}</p>` : '<p class="muted">Waiting for the hospital to confirm your doctor.</p>') +
      (a.wait_minutes != null && a.status !== 'serving' ? `<p>Estimated wait:${etaHTML({ ...a, _rx: Date.now() })}</p>` : '');
  } catch (x) { o.innerHTML = `<p class="msg err">${esc(x.message)}</p>`; }
};

/* ---------- doctor module ---------- */
function mountDoctor() {
  $('#dyn').append($('#tpl-doctor').content.cloneNode(true));
  const d = doctors.find(x => x.id == ME.ref_id);
  $('#docName').textContent = d ? `${d.name} - ${d.dept} (${d.room})` : ME.name;
  bindTabs($('#dyn')); $('#dq').onclick = dqClick; let pst; $('#pSearch').oninput = () => { clearTimeout(pst); pst = setTimeout(patientList, 350); }; $('#pList').onclick = pListClick; $('#pNew').onclick = () => profileForm(null);
  const ab = $('#absForm'); ab.date.min = ab.date.value = today();
  ab.onsubmit = e => {
    e.preventDefault(); const m = $('.msg', ab);
    if (!confirm('Report your absence? Your booked patients will be moved to another doctor or contacted by email.')) return;
    busy(submitBtn(ab), async () => {
      m.className = 'msg';
      try { const r = await api(`/doctors/${ME.ref_id}/leave`, 'POST', { date: ab.date.value, reason: ab.reason.value }); m.className = 'msg ok'; m.textContent = `Recorded. ${r.total} appointment(s): ${r.moved} moved to colleagues, ${r.unassigned} need rescheduling. Patients were emailed.`; docQueue(); }
      catch (x) { m.className = 'msg err'; m.textContent = x.message; }
    });
  };
  tabLoad.dq();
}
async function docQueue() {
  if (!$('#dq').innerHTML.trim()) loading($('#dq'), 'Loading your queue...');   // no flicker on live refreshes
  try {
    const rows = await api('/appointments?doctor=' + ME.ref_id + '&date=' + today());
    const act = rows.filter(r => ['confirmed', 'serving'].includes(r.status)), done = rows.filter(r => r.status === 'done').length, gone = rows.filter(r => ['no_show', 'cancelled'].includes(r.status)).length;
    $('#dq').innerHTML = legend(LG_STATUS, 'Status colors') + `<div class="bar" style="margin:0 0 .6rem"><p class="muted" style="margin:0">${act.length} in line, ${done} finished, ${gone} cancelled or no-show today. Patients are listed by appointment time.</p><button type="button" class="btn sm o dark" data-open-fac="1">Reserve bed / equipment</button></div><div class="scroll"><table><tr><th>Ticket</th><th>Patient</th><th>Time</th><th>Reason</th><th>Status</th><th></th></tr>` +
      (act.map(r => `<tr><td><b>${r.queue_no}</b></td><td>${esc(r.patient_name)}</td><td>${slot(r.time)}</td><td>${esc(r.reason)}</td><td>${statusTag(r.status)} ${r.checked_in_at ? '<span class="tag available">Arrived</span>' : '<span class="tag pending">Not arrived</span>'}</td>
      <td class="actions">${r.status === 'serving' ? `<button class="btn sm g" data-st="done" data-id="${r.id}">Finish</button>` : `<button class="btn sm g" data-st="serving" data-id="${r.id}">Call patient</button>${r.checked_in_at ? '' : `<button class="btn sm o dark" data-checkin="${r.id}">Mark arrived</button>`}`}<button class="btn sm r" data-st="no_show" data-id="${r.id}">No-show</button></td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">No patients in line. Newly confirmed patients appear here.</div></td></tr>') + '</table></div>';
  } catch (x) { $('#dq').innerHTML = `<p class="msg err">${esc(x.message)} <button class="btn sm g" data-retry="1">Retry</button></p>`; }
}
const dqClick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.openFac) { $('#doctor .tabs button[data-t="df"]')?.click(); return; }
  if (b.dataset.retry) return docQueue();
  if (b.dataset.st === 'no_show' && !confirm('Mark this patient as a no-show?')) return;
  if (b.dataset.st || b.dataset.checkin) busy(b, async () => {
    try { b.dataset.st ? await api(`/appointments/${b.dataset.id}/status`, 'POST', { status: b.dataset.st }) : await api(`/appointments/${b.dataset.checkin}/checkin`, 'POST'); }
    catch (x) { toast(x.message, 7000); }
    docQueue();
  });
};
/* ---------- doctor: patient records (the chart) ---------- */
let chart = null, chartTab = 'summary';
const LG_VITAL = [['available', 'Within typical adult range'], ['pending', '! Outside typical range'], ['cancelled', '!! Far outside the range: check promptly']];
const LG_SEV = [['cancelled', 'Severe'], ['pending', 'Moderate'], ['confirmed', 'Mild']];
const LG_CMS = [['available', 'Active / current'], ['pending', 'Chronic'], ['confirmed', 'Resolved / stopped']];
const FLAGCLS = { ok: 'available', warn: 'pending', crit: 'cancelled' }, FLAGMK = { ok: '', warn: '!', crit: '!!' };
const sevTag = v => `<span class="tag ${{ severe: 'cancelled', moderate: 'pending', mild: 'confirmed' }[v]}">${esc(v)}</span>`;
const cmsTag = v => `<span class="tag ${{ active: 'available', chronic: 'pending', resolved: 'confirmed' }[v] || 'confirmed'}">${esc(v)}</span>`;
const mine = r => r.recorded_by == null || r.recorded_by == ME.ref_id;

async function patientList() {
  const box = $('#pList'); if (!box.innerHTML.trim()) loading(box, 'Loading patients...');
  try {
    const l = await api('/patients?q=' + encodeURIComponent($('#pSearch').value));
    box.innerHTML = l.map(p => `<div class="qn"><span style="flex:1">${esc(p.name)} ${p.severe_allergies ? '<span class="tag cancelled" title="A severe allergy is recorded">Allergy</span>' : ''}<br><small class="muted">#${p.id} &middot; ${p.age != null ? p.age + ' y' : 'age unknown'}${p.sex ? ' ' + esc(p.sex) : ''}${p.blood_type ? ' &middot; ' + esc(p.blood_type) : ''}</small></span><button class="btn sm g" data-p="${p.id}">Open</button></div>`).join('')
      || '<div class="empty">No match. Try another name, phone or patient number.</div>';
  } catch (x) { box.innerHTML = `<p class="msg err">${esc(x.message)}</p>`; }
}
const pListClick = e => { const b = e.target.closest('[data-p]'); if (b) openChart(b.dataset.p); };
async function openChart(id, tab) {
  chartTab = tab || 'summary'; loading($('#chart'), 'Opening the chart...');
  try { chart = await api(`/patients/${id}/chart`); renderChart(); } catch (x) { $('#chart').innerHTML = `<p class="msg err">${esc(x.message)}</p>`; }
}
const reloadChart = async () => { chart = await api(`/patients/${chart.patient.id}/chart`); renderChart(); };
const TABS = [['summary', 'Summary'], ['visits', 'Visits'], ['vitals', 'Vitals'], ['allergies', 'Allergies'], ['conditions', 'Conditions'], ['medications', 'Medications'], ['profile', 'Profile']];
function renderChart() {
  const c = chart, p = c.patient, severe = c.allergies.some(a => a.severity === 'severe');
  $('#chart').innerHTML = `<h3 style="margin:0">${esc(p.name)} <small class="muted">#${p.id}</small></h3>
    <p class="muted" style="margin:.2rem 0">${p.age != null ? p.age + ' years' : 'Age unknown'}${p.sex ? ' &middot; ' + esc(p.sex) : ''}${p.blood_type ? ' &middot; Blood type ' + esc(p.blood_type) : ''}${p.contact ? ' &middot; ' + esc(p.contact) : ''}</p>
    ${c.allergies.length ? `<div class="banner ${severe ? 'bad' : 'warn'}" role="alert"><b>Allergies:</b> ${c.allergies.map(a => esc(a.substance) + (a.severity === 'severe' ? ' (SEVERE)' : '')).join(', ')}</div>` : '<p class="muted small">No allergies recorded. That does not confirm there are none: please ask the patient.</p>'}
    <div class="tabs" id="chartTabs" role="tablist">${TABS.map(([k, t]) => `<button role="tab" aria-selected="${k === chartTab}" data-ct="${k}" class="${k === chartTab ? 'on' : ''}">${t}</button>`).join('')}</div><div id="chartBody"></div>`;
  $('#chartTabs').onclick = e => { const b = e.target.closest('[data-ct]'); if (b) { chartTab = b.dataset.ct; renderChart(); } };
  ({ summary: tabSummary, visits: tabVisits, vitals: tabVitals, allergies: () => tabList('allergies'), conditions: () => tabList('conditions'), medications: () => tabList('medications'), profile: () => profileForm(chart.patient) })[chartTab]();
}
const fieldHTML = ([k, label, type, req, opts], v) => {
  const val = v == null ? '' : v, r = req ? ' required' : '';
  if (type === 'select') return `<label>${label}<select name="${k}"${r}>${opts.map(([o, t]) => `<option value="${o}" ${o === val ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
  if (type === 'textarea') return `<label>${label}<textarea name="${k}" rows="3" maxlength="4000"${r}>${esc(val)}</textarea></label>`;
  return `<label>${label}<input name="${k}" type="${type || 'text'}" value="${esc(val)}"${r}${type === 'number' ? ' step="any"' : ''}></label>`;
};
const cols2 = html => `<div class="cols">${html}</div>`;
const bodyOf = f => Object.fromEntries([...new FormData(f)].map(([k, v]) => [k, v]));
/** runs a save, shows errors in the form, reloads the chart on success */
const saveForm = (f, fn, okMsg) => busy(submitBtn(f), async () => { const m = $('.msg', f); m.className = 'msg'; m.textContent = ''; try { await fn(); toast(okMsg); await reloadChart(); } catch (x) { m.className = 'msg err'; m.textContent = x.message; } });

function vitalBoxes(v) {
  const items = [['Blood pressure', v.bp_sys != null ? `${v.bp_sys}/${v.bp_dia} mmHg` : null, 'bp'], ['Heart rate', v.heart_rate != null ? v.heart_rate + ' /min' : null, 'heart_rate'], ['Resp. rate', v.resp_rate != null ? v.resp_rate + ' /min' : null, 'resp_rate'],
    ['Temperature', v.temp_c != null ? v.temp_c + ' °C' : null, 'temp_c'], ['Oxygen (SpO2)', v.spo2 != null ? v.spo2 + ' %' : null, 'spo2'], ['Weight', v.weight_kg != null ? v.weight_kg + ' kg' : null], ['Height', v.height_cm != null ? v.height_cm + ' cm' : null], ['BMI', v.bmi != null ? v.bmi + (v.bmi_category ? ' (' + v.bmi_category + ')' : '') : null]];
  return `<div class="vgrid">${items.filter(i => i[1] != null).map(([l, val, k]) => { const f = k && v.flags[k]; return `<div class="vbox ${f ? FLAGCLS[f] : ''}"><small>${l}</small><b>${esc(val)}</b>${f && f !== 'ok' ? `<span class="mk">${f === 'crit' ? '!! check promptly' : '! outside range'}</span>` : ''}</div>`; }).join('')}</div><small class="muted">Recorded ${esc(v.recorded_at.slice(0, 16))}${v.recorded_by_name ? ' by ' + esc(v.recorded_by_name) : ''}</small>`;
}
function tabSummary() {
  const c = chart, v = c.vitals[0], conds = c.conditions.filter(x => x.status !== 'resolved'), meds = c.medications.filter(m => m.active), lv = c.visits[0];
  $('#chartBody').innerHTML = legend(LG_VITAL, 'Vitals highlighting') + `<h4>Latest vitals</h4>${v ? vitalBoxes(v) : '<p class="muted">No vitals recorded yet.</p>'}
    <div class="two"><div><h4>Current conditions</h4>${conds.length ? '<ul>' + conds.map(x => `<li>${esc(x.name)} ${cmsTag(x.status)}</li>`).join('') + '</ul>' : '<p class="muted">None recorded.</p>'}
      <h4>Current medications</h4>${meds.length ? '<ul>' + meds.map(m => `<li><b>${esc(m.name)}</b> ${esc([m.dose, m.frequency].filter(Boolean).join(', '))}</li>`).join('') + '</ul>' : '<p class="muted">None recorded.</p>'}</div>
      <div><h4>Last visit</h4>${lv ? `<p><b>${lv.date}</b> ${esc(lv.diagnosis)}<br><small class="muted">${esc(lv.doctor || '')}${lv.follow_up_date ? ' &middot; Follow-up ' + lv.follow_up_date : ''}</small></p>` : '<p class="muted">No visits yet.</p>'}
      ${chart.patient.family_history || chart.patient.social_history ? `<h4>History</h4>${chart.patient.family_history ? `<p><b>Family:</b> ${esc(chart.patient.family_history)}</p>` : ''}${chart.patient.social_history ? `<p><b>Social:</b> ${esc(chart.patient.social_history)}</p>` : ''}` : ''}</div></div>
    <p class="muted small">Highlighting uses typical adult ranges and is only a visual aid, not a diagnosis. It is not applied to children.</p>`;
}

/* ---- visits ---- */
const VISIT_FIELDS = [['chief_complaint', 'Chief complaint'], ['history', 'History of present illness', 'textarea'], ['examination', 'Examination', 'textarea'], ['diagnosis', 'Diagnosis', 'text', 1], ['plan', 'Plan / treatment', 'textarea'], ['follow_up_date', 'Follow-up date', 'date'], ['notes', 'Other notes', 'textarea']];
const visitCard = v => `<div class="vcard"><div class="bar" style="margin:0"><b>${v.date}</b>${v.amended_at ? '<span class="tag pending">Amended</span>' : ''}</div><p class="muted small">${esc(v.doctor || '')}</p>
  ${[['Complaint', v.chief_complaint], ['History', v.history], ['Examination', v.examination], ['Diagnosis', v.diagnosis], ['Plan', v.plan], ['Follow-up', v.follow_up_date], ['Notes', v.notes]].filter(x => x[1]).map(([l, t]) => `<p><b>${l}:</b> ${esc(t)}</p>`).join('')}
  <div class="actions" style="justify-content:flex-start">${v.doctor_id == ME.ref_id ? `<button class="btn sm o dark" data-vedit="${v.id}">Amend</button>` : ''}${v.amended_at ? `<button class="btn sm o dark" data-vhist="${v.id}">Earlier versions</button>` : ''}</div><div id="vh${v.id}"></div></div>`;
function visitForm(v) {
  const edit = !!v;
  $('#visitForm').innerHTML = `<form id="vForm" class="card inner"><h3>${edit ? 'Amend the visit note of ' + v.date : 'New visit note'}</h3>${edit ? '<p class="muted small">The earlier version is kept in the record history.</p>' : ''}
    ${VISIT_FIELDS.map(f => fieldHTML(f, v ? v[f[0]] : '')).join('')}<div class="row"><button class="btn g">${edit ? 'Save amendment' : 'Save visit note'}</button><button type="button" class="btn o dark" data-close="1">Cancel</button></div><p class="msg" role="status"></p></form>`;
  const f = $('#vForm'); f.querySelector('[data-close]').onclick = () => { $('#visitForm').innerHTML = ''; };
  f.onsubmit = e => { e.preventDefault(); saveForm(f, () => api(edit ? `/visits/${v.id}` : `/patients/${chart.patient.id}/visits`, edit ? 'PUT' : 'POST', bodyOf(f)), edit ? 'Visit note amended.' : 'Visit note saved.'); };
  f.diagnosis.focus();
}
function tabVisits() {
  const c = chart;
  $('#chartBody').innerHTML = `<div class="row"><button class="btn g sm" id="addVisit">Add visit note</button></div><div id="visitForm"></div>` + (c.visits.map(visitCard).join('') || '<div class="empty">No visit notes yet.</div>');
  $('#addVisit').onclick = () => visitForm(null);
  $('#chartBody').onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.vedit) visitForm(c.visits.find(x => x.id == b.dataset.vedit));
    if (b.dataset.vhist) busy(b, async () => {
      const box = $('#vh' + b.dataset.vhist);
      try { const r = await api(`/visits/${b.dataset.vhist}/revisions`); box.innerHTML = r.map(x => `<div class="card inner"><small class="muted">Before the amendment of ${esc(x.revised_at)} by ${esc(x.revised_by_name || '')}</small>${[['Complaint', x.before.chief_complaint], ['History', x.before.history], ['Examination', x.before.examination], ['Diagnosis', x.before.diagnosis], ['Plan', x.before.plan], ['Follow-up', x.before.follow_up_date], ['Notes', x.before.notes]].filter(y => y[1]).map(([l, t]) => `<p><b>${l}:</b> ${esc(t)}</p>`).join('')}</div>`).join('') || '<p class="muted">No earlier versions.</p>'; }
      catch (x) { toast(x.message, 6000); }
    });
  };
}

/* ---- vitals ---- */
const VITAL_FIELDS = [['bp_sys', 'BP top (systolic)', 'number'], ['bp_dia', 'BP bottom (diastolic)', 'number'], ['heart_rate', 'Heart rate (/min)', 'number'], ['resp_rate', 'Respiratory rate (/min)', 'number'], ['temp_c', 'Temperature (°C)', 'number'], ['spo2', 'Oxygen SpO2 (%)', 'number'], ['weight_kg', 'Weight (kg)', 'number'], ['height_cm', 'Height (cm)', 'number'], ['notes', 'Notes']];
function tabVitals() {
  const c = chart;
  const cell = (v, k, t) => t == null ? '<td></td>' : `<td class="vc ${v.flags[k] ? FLAGCLS[v.flags[k]] : ''}">${t}${v.flags[k] && v.flags[k] !== 'ok' ? `<sup>${FLAGMK[v.flags[k]]}</sup>` : ''}</td>`;
  $('#chartBody').innerHTML = `<form id="vitForm" class="card inner"><h3>Record vital signs</h3><div class="cols">${VITAL_FIELDS.map(f => fieldHTML(f, '')).join('')}</div><button class="btn g">Save vitals</button><p class="msg" role="status"></p></form>` + legend(LG_VITAL, 'Vitals highlighting') +
    `<div class="scroll"><table><tr><th>When</th><th>BP</th><th>HR</th><th>RR</th><th>Temp</th><th>SpO2</th><th>Weight</th><th>BMI</th><th>By</th><th></th></tr>` +
    (c.vitals.map(v => `<tr><td>${esc(v.recorded_at.slice(0, 16))}</td>${cell(v, 'bp', v.bp_sys != null ? v.bp_sys + '/' + v.bp_dia : null)}${cell(v, 'heart_rate', v.heart_rate)}${cell(v, 'resp_rate', v.resp_rate)}${cell(v, 'temp_c', v.temp_c != null ? v.temp_c + ' °C' : null)}${cell(v, 'spo2', v.spo2 != null ? v.spo2 + '%' : null)}<td>${v.weight_kg != null ? v.weight_kg + ' kg' : ''}</td><td>${v.bmi != null ? v.bmi : ''}</td><td>${esc(v.recorded_by_name || '')}</td><td>${mine(v) ? `<button class="btn sm r" data-verr="${v.id}">Entered in error</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="10"><div class="empty">No vitals recorded yet.</div></td></tr>') + '</table></div><p class="muted small">Shows the 10 most recent readings. Highlighting uses typical adult ranges and is only a visual aid.</p>';
  const f = $('#vitForm'); f.onsubmit = e => { e.preventDefault(); saveForm(f, () => api(`/patients/${c.patient.id}/vitals`, 'POST', bodyOf(f)), 'Vitals saved.'); };
  $('#chartBody').onclick = e => { const b = e.target.closest('[data-verr]'); if (b && confirm('Mark this reading as entered in error? It will be hidden from the chart (not deleted).')) busy(b, async () => { try { await api(`/patients/${c.patient.id}/vitals/${b.dataset.verr}`, 'DELETE'); toast('Marked as entered in error.'); await reloadChart(); } catch (x) { toast(x.message, 6000); } }); };
}

/* ---- allergies, conditions, medications ---- */
const REC = {
  allergies: { add: 'Add allergy', legend: LG_SEV, cols: ['Substance', 'Reaction', 'Severity', 'Notes'], row: a => [esc(a.substance), esc(a.reaction || ''), sevTag(a.severity), esc(a.notes || '')], empty: 'No allergies recorded.',
    fields: [['substance', 'Substance', 'text', 1], ['reaction', 'Reaction'], ['severity', 'Severity', 'select', 1, [['mild', 'Mild'], ['moderate', 'Moderate'], ['severe', 'Severe']]], ['notes', 'Notes']], list: c => c.allergies },
  conditions: { add: 'Add condition', legend: LG_CMS, cols: ['Condition', 'Status', 'Since', 'Notes'], row: a => [esc(a.name), cmsTag(a.status), esc(a.since_date || ''), esc(a.notes || '')], empty: 'No conditions recorded.',
    fields: [['name', 'Condition', 'text', 1], ['status', 'Status', 'select', 1, [['active', 'Active'], ['chronic', 'Chronic'], ['resolved', 'Resolved']]], ['since_date', 'Since', 'date'], ['notes', 'Notes']], list: c => c.conditions },
  medications: { add: 'Add medication', legend: LG_CMS, cols: ['Medicine', 'Dose', 'Frequency', 'Started', 'Stopped', 'Notes'], row: a => [`${esc(a.name)} ${a.active ? '<span class="tag available">current</span>' : '<span class="tag confirmed">stopped</span>'}`, esc(a.dose || ''), esc(a.frequency || ''), esc(a.start_date || ''), esc(a.end_date || ''), esc(a.notes || '')], empty: 'No medications recorded.',
    fields: [['name', 'Medicine', 'text', 1], ['dose', 'Dose'], ['frequency', 'Frequency'], ['start_date', 'Started', 'date'], ['end_date', 'Stopped (leave empty if still taking)', 'date'], ['notes', 'Notes']], list: c => c.medications }
};
function recForm(type, item) {
  const R = REC[type], edit = !!item;
  $('#recForm').innerHTML = `<form id="rForm" class="card inner"><h3>${edit ? 'Edit' : R.add}</h3><div class="cols">${R.fields.map(([k, l, t, req, opts]) => fieldHTML([k, l, t, req, opts], item ? item[k] : (k === 'severity' ? 'mild' : k === 'status' ? 'active' : ''))).join('')}</div>
    <div class="row"><button class="btn g">Save</button><button type="button" class="btn o dark" data-close="1">Cancel</button></div><p class="msg" role="status"></p></form>`;
  const f = $('#rForm'); f.querySelector('[data-close]').onclick = () => { $('#recForm').innerHTML = ''; };
  f.onsubmit = e => { e.preventDefault(); saveForm(f, () => api(edit ? `/patients/${chart.patient.id}/${type}/${item.id}` : `/patients/${chart.patient.id}/${type}`, edit ? 'PUT' : 'POST', bodyOf(f)), 'Saved.'); };
  f.querySelector('input,select').focus();
}
function tabList(type) {
  const R = REC[type], list = R.list(chart);
  $('#chartBody').innerHTML = `<div class="row"><button class="btn g sm" id="recAdd">${R.add}</button></div><div id="recForm"></div>` + legend(R.legend, 'Color legend') +
    `<div class="scroll"><table><tr>${R.cols.map(c => `<th>${c}</th>`).join('')}<th>Recorded by</th><th></th></tr>` +
    (list.map(a => `<tr>${R.row(a).map(t => `<td>${t}</td>`).join('')}<td>${esc(a.recorded_by_name || '')}</td><td class="actions"><button class="btn sm g" data-redit="${a.id}">Edit</button>${mine(a) ? `<button class="btn sm r" data-rerr="${a.id}">Entered in error</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="${R.cols.length + 2}"><div class="empty">${R.empty}</div></td></tr>`) + '</table></div>';
  $('#recAdd').onclick = () => recForm(type, null);
  $('#chartBody').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.redit) recForm(type, list.find(x => x.id == b.dataset.redit));
    if (b.dataset.rerr && confirm('Mark this entry as entered in error? It will be hidden from the chart (not deleted).')) busy(b, async () => { try { await api(`/patients/${chart.patient.id}/${type}/${b.dataset.rerr}`, 'DELETE'); toast('Marked as entered in error.'); await reloadChart(); } catch (x) { toast(x.message, 6000); } });
  };
}

/* ---- profile (also used to create a new patient) ---- */
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
function profileForm(p) {
  const edit = !!p, v = k => (p ? p[k] : ''), target = edit ? $('#chartBody') : $('#chart');
  target.innerHTML = `<form id="pForm" class="card inner"><h3>${edit ? 'Patient profile' : 'New patient'}</h3>
    ${cols2(fieldHTML(['name', 'Full name', 'text', 1], v('name')) + fieldHTML(['birthdate', 'Birthdate', 'date'], v('birthdate') ? String(v('birthdate')).slice(0, 10) : ''))}
    ${cols2(fieldHTML(['sex', 'Sex', 'select', 0, [['', 'Not stated'], ['F', 'Female'], ['M', 'Male']]], v('sex')) + fieldHTML(['blood_type', 'Blood type', 'select', 0, [['', 'Unknown'], ...BLOOD.map(b => [b, b])]], v('blood_type')))}
    ${cols2(fieldHTML(['contact', 'Contact number'], v('contact')) + fieldHTML(['address', 'Address'], v('address')))}
    ${cols2(fieldHTML(['emergency_name', 'Emergency contact name'], v('emergency_name')) + fieldHTML(['emergency_phone', 'Emergency contact number'], v('emergency_phone')))}
    ${fieldHTML(['family_history', 'Family history', 'textarea'], v('family_history'))}${fieldHTML(['social_history', 'Social history (smoking, alcohol, occupation...)', 'textarea'], v('social_history'))}
    ${edit ? '' : fieldHTML(['diagnosis', 'First visit diagnosis (optional)'], '') + fieldHTML(['notes', 'First visit notes (optional)', 'textarea'], '')}
    <div class="row"><button class="btn g">${edit ? 'Save profile' : 'Create patient'}</button>${edit ? '' : '<button type="button" class="btn o dark" data-close="1">Cancel</button>'}</div><p class="msg" role="status"></p></form>`;
  const f = $('#pForm'); if (!edit) f.querySelector('[data-close]').onclick = () => { $('#chart').innerHTML = '<p class="muted">Select a patient to open their chart.</p>'; };
  f.onsubmit = e => {
    e.preventDefault();
    if (edit) return saveForm(f, () => api(`/patients/${p.id}`, 'PUT', bodyOf(f)), 'Profile saved.');
    busy(submitBtn(f), async () => {
      const m = $('.msg', f); m.className = 'msg'; m.textContent = '';
      try {
        let r;
        try { r = await api('/patients', 'POST', bodyOf(f)); }
        catch (x) {
          if (x.data && x.data.requires_confirm && x.data.existing) {
            if (confirm(`${x.message}\n\n#${x.data.existing.id} ${x.data.existing.name}\n\nOK = create a new record anyway.\nCancel = open the existing record.`)) r = await api('/patients', 'POST', { ...bodyOf(f), confirm_duplicate: true });
            else { openChart(x.data.existing.id); return; }
          } else throw x;
        }
        toast('Patient created.'); patientList(); openChart(r.id);
      } catch (x) { m.className = 'msg err'; m.textContent = x.message; }
    });
  };
  f.name.focus();
}

/* ---------- admin module ---------- */
function mountAdmin() {
  $('#dyn').append($('#tpl-admin').content.cloneNode(true));
  $('#fDate').value = DB.iso(DB.addDays(1)); bindTabs($('#dyn'));
  $('#ar').onclick = arClick; $('#fBtn').onclick = forecast;
  tabLoad.ar();
}
async function requests() {
  loading($('#ar'), 'Loading requests...');
  try {
    const rows = await api('/appointments?status=pending');
    const opts = await Promise.all(rows.map(r => api(`/doctors?dept=${r.dept_id}&date=${r.date}&time=${r.time}&except=${r.id}`)));
    $('#ar').innerHTML = `<div class="scroll"><table><tr><th>Ref</th><th>Patient</th><th>Department</th><th>When</th><th>Assign doctor</th><th></th></tr>` +
      (rows.map((r, i) => `<tr><td>${esc(r.ref)}</td><td>${esc(r.patient_name)}<br><small class="muted">${esc(r.email)}</small></td><td>${esc(r.dept)}</td><td>${r.date}<br>${slot(r.time)}</td>
      <td><select id="as${r.id}" aria-label="Doctor for ${esc(r.ref)}">${opts[i].length ? opts[i].map(d => `<option value="${d.id}" ${d.id == r.pref_doctor_id ? 'selected' : ''}>${esc(d.name)}</option>`).join('') : '<option value="">No doctor available</option>'}</select></td>
      <td class="actions"><button class="btn sm g" data-ok="${r.id}">Confirm &amp; email</button><button class="btn sm r" data-no="${r.id}">Decline</button></td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">No pending requests. New bookings appear here.</div></td></tr>') + '</table></div>';
  } catch (x) { $('#ar').innerHTML = `<p class="msg err">${esc(x.message)} <button class="btn sm g" data-retry="1">Retry</button></p>`; }
}
const arClick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.retry) return requests();
  busy(b, async () => {
    try {
      if (b.dataset.ok) { const r = await api(`/appointments/${b.dataset.ok}/confirm`, 'POST', { doctor_id: $('#as' + b.dataset.ok).value }); toast(r.emailed ? `Confirmed. Ticket #${r.queue_no}. Email sent.` : `Confirmed. Ticket #${r.queue_no}. Email NOT sent: ${r.note}`, 6000); }
      if (b.dataset.no) await api(`/appointments/${b.dataset.no}/status`, 'POST', { status: 'cancelled' });
    } catch (x) { toast(x.message, 7000); }
    requests();
  });
};
async function monitor() {
  if (!$('#am').innerHTML.trim()) loading($('#am'), 'Loading...');
  try {
    const [q, lv, st] = await Promise.all([api('/queue'), api('/leave/today'), api('/queue/stats').catch(() => [])]), sm = Object.fromEntries(st.map(x => [x.doctor_id, x])), off = new Set(lv.map(x => x.doctor_id)), wd = (new Date().getDay() + 6) % 7;
    const onDuty = doctors.filter(d => d.days.includes(wd) || q.some(x => x.doctor_id === d.id) || off.has(d.id));
    $('#am').innerHTML = legend(LG_WAIT, 'Waiting-patient colors') + `<div class="scroll"><table><tr><th>Doctor</th><th>Department</th><th>Now serving</th><th>Waiting</th><th>Arrived</th><th>Avg visit</th><th>Queue clears in</th></tr>` + onDuty.map(d => {
      const l = q.filter(x => x.doctor_id === d.id), s = l.find(x => x.status === 'serving'), w = l.filter(x => x.status === 'confirmed');
      return `<tr><td>${esc(d.name)} ${off.has(d.id) ? '<span class="tag cancelled">On leave</span>' : ''}</td><td>${esc(d.dept)}</td><td>${s ? '#' + s.queue_no + ' ' + esc(s.patient_name) : '<span class="muted">none</span>'}</td><td><span class="tag ${w.length > 3 ? 'occupied' : w.length ? 'pending' : 'available'}">${w.length}</span></td><td>${w.filter(x => x.checked_in).length}</td><td>${sm[d.id] ? '~' + Math.round(sm[d.id].avg_minutes) + ' min' : '-'}</td><td>${sm[d.id] ? 'about ' + dur(nice(sm[d.id].clears_in_minutes)) : '-'}</td></tr>`;
    }).join('') + '</table></div>';
  } catch (x) { $('#am').innerHTML = `<p class="msg err">${esc(x.message)}</p>`; }
}
/* ---------- admin: manage doctors and schedules ---------- */
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LG_DOC = [['available', 'Active (can be booked) / login ready'], ['cancelled', 'Inactive (hidden from booking, cannot sign in)'], ['pending', 'Login not set up yet']];
function dayRuns(days) {
  const s = [...days].sort((a, b) => a - b), out = [];
  for (let i = 0; i < s.length;) { let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++; out.push(j === i ? DAY_NAMES[s[i]] : j === i + 1 ? DAY_NAMES[s[i]] + ', ' + DAY_NAMES[s[j]] : DAY_NAMES[s[i]] + ' to ' + DAY_NAMES[s[j]]); i = j + 1; }
  return out.join(', ');
}
const hoursText = d => d.start_hour != null ? `${fmtH(d.start_hour)} to ${fmtH(d.end_hour)}` : d.shift === 'am' ? '7 AM to 12 PM' : d.shift === 'pm' ? '12 PM to 5 PM' : '7 AM to 5 PM';
const docFilter = { q: '', dept: '', status: 'active' };
let docRows = [];
async function refreshDoctorsCache() { try { doctors = await api('/doctors'); const al = $('#al'); if (al) delete al.dataset.ready; } catch { /* keep the old list */ } }
async function doctorsTab() {
  const box = $('#ad');
  if (!box.dataset.ready) {
    box.dataset.ready = '1';
    box.innerHTML = `<div class="card"><div class="row"><label>Search<input id="dfQ" placeholder="Name or Doctor ID"></label><label>Department<select id="dfDept"><option value="">All departments</option>${depts.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>
      <label>Status<select id="dfStatus"><option value="active">Active</option><option value="inactive">Inactive</option><option value="">All</option></select></label><button class="btn g" id="dfAdd">Add doctor</button></div></div><div id="docFormBox"></div><div id="docList"></div>`;
    let t; $('#dfQ').oninput = e => { clearTimeout(t); t = setTimeout(() => { docFilter.q = e.target.value.trim(); loadDocList(); }, 300); };
    $('#dfDept').onchange = e => { docFilter.dept = e.target.value; loadDocList(); };
    $('#dfStatus').onchange = e => { docFilter.status = e.target.value; loadDocList(); };
    $('#dfAdd').onclick = () => docForm(null);
    $('#docList').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      const d = docRows.find(x => x.id == (b.dataset.edit || b.dataset.active || b.dataset.invite));
      if (b.dataset.retry) loadDocList();
      else if (b.dataset.edit) docForm(d);
      else if (b.dataset.active) busy(b, () => toggleDoctor(d));
      else if (b.dataset.invite) busy(b, async () => { try { const r = await api(`/admin/doctors/${d.id}/invite`, 'POST'); toast(r.ok ? `Password link sent to ${d.email}.` : 'Not sent: ' + r.note, 7000); } catch (x) { toast(x.message, 7000); } });
    };
  }
  loadDocList();
}
async function loadDocList() {
  const box = $('#docList'); if (!box.innerHTML.trim()) loading(box, 'Loading doctors...');
  const p = new URLSearchParams(); Object.entries(docFilter).forEach(([k, v]) => v && p.set(k, v));
  try {
    docRows = await api('/admin/doctors?' + p);
    box.innerHTML = legend(LG_DOC, 'Status colors') + `<div class="scroll"><table><tr><th>Doctor ID</th><th>Name</th><th>Department</th><th>Room</th><th>Schedule</th><th>Account</th><th>Upcoming</th><th>Status</th><th></th></tr>` +
      (docRows.map(d => `<tr><td><b>${esc(d.doctor_code || '-')}</b></td><td>${esc(d.name)}</td><td>${esc(d.dept)}</td><td>${esc(d.room)}</td><td>${esc(dayRuns(d.days))}<br><small class="muted">${hoursText(d)}</small></td>
        <td>${d.has_password ? '<span class="tag available">Login ready</span>' : '<span class="tag pending">Not set up</span>'}<br><small class="muted">${esc(d.email || 'no email')}</small></td><td>${d.upcoming}</td>
        <td>${d.on_duty ? '<span class="tag available">Active</span>' : '<span class="tag cancelled">Inactive</span>'}</td>
        <td class="actions"><button class="btn sm g" data-edit="${d.id}">Edit</button>${d.email ? `<button class="btn sm o dark" data-invite="${d.id}">Send password link</button>` : ''}<button class="btn sm ${d.on_duty ? 'r' : 'o dark'}" data-active="${d.id}">${d.on_duty ? 'Deactivate' : 'Reactivate'}</button></td></tr>`).join('') || '<tr><td colspan="9"><div class="empty">No doctors match. Try another filter or add a doctor.</div></td></tr>') + '</table></div>';
  } catch (x) { box.innerHTML = `<p class="msg err">${esc(x.message)} <button class="btn sm g" data-retry="1">Retry</button></p>`; }
}
/** Runs an API call; if the server says "this affects booked patients, confirm?", asks the admin and repeats with confirm:true. */
async function withConfirm(call) {
  try { return await call({}); }
  catch (x) { if (x.data && x.data.requires_confirm && confirm(x.message + '\n\nContinue?')) return call({ confirm: true }); throw x; }
}
const moveNote = r => r && r.reassigned ? ` ${r.reassigned.moved} patient(s) moved to another doctor, ${r.reassigned.unassigned} asked to reschedule (all emailed).` : '';
async function toggleDoctor(d) {
  const active = !d.on_duty;
  if (!confirm(active ? `Reactivate ${d.name}? They can be booked and sign in again.` : `Deactivate ${d.name}? They will be hidden from booking and cannot sign in.`)) return;
  try { const r = await withConfirm(x => api(`/admin/doctors/${d.id}/active`, 'POST', { active, ...x })); toast((active ? 'Doctor reactivated.' : 'Doctor deactivated.') + moveNote(r), 8000); await refreshDoctorsCache(); loadDocList(); }
  catch (x) { toast(x.message, 7000); }
}
function docForm(d) {
  const edit = !!d, days = new Set(d ? d.days : [0, 1, 2, 3, 4]), preset = !d ? 'full' : d.start_hour != null ? 'custom' : d.shift;
  const hrs = (a, b, v) => Array.from({ length: b - a + 1 }, (_, i) => a + i).map(h => `<option value="${h}" ${h === v ? 'selected' : ''}>${fmtH(h)}</option>`).join('');
  const box = $('#docFormBox');
  box.innerHTML = `<form id="docForm" class="card inner"><h3>${edit ? 'Edit ' + esc(d.name) : 'Add a doctor'}</h3>
    <div class="cols"><label>Full name<input name="name" required maxlength="120" value="${esc(d ? d.name : '')}" placeholder="Dr. Juan Dela Cruz"></label><label>Room<input name="room" required maxlength="30" value="${esc(d ? d.room : '')}" placeholder="Clinic 6A"></label></div>
    <div class="cols"><label>Department<select name="dept_id" required>${depts.map(x => `<option value="${x.id}" ${d && x.id === d.dept_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label><label>Email (the password link is sent here)<input name="email" type="email" maxlength="190" value="${esc(d ? d.email || '' : '')}"></label></div>
    <fieldset class="fs"><legend>Working days</legend><div class="chk-row">${DAY_NAMES.map((n, i) => `<label><input type="checkbox" name="day" value="${i}" ${days.has(i) ? 'checked' : ''}> ${n}</label>`).join('')}</div></fieldset>
    <div class="cols"><label>Hours<select name="preset"><option value="full">Full day (7 AM to 5 PM)</option><option value="am">Morning (7 AM to 12 PM)</option><option value="pm">Afternoon (12 PM to 5 PM)</option><option value="custom">Custom hours</option></select></label>
      <div class="cols ${preset === 'custom' ? '' : 'hidden'}" id="customHrs"><label>From<select name="start_hour">${hrs(7, 16, d && d.start_hour != null ? d.start_hour : 8)}</select></label><label>To<select name="end_hour">${hrs(8, 17, d && d.end_hour != null ? d.end_hour : 12)}</select></label></div></div>
    ${edit ? '<p class="muted small">If the new schedule leaves booked patients without a doctor, you will be asked to confirm and they will be moved or emailed.</p>' : '<label class="check"><input type="checkbox" name="send_invite" checked> Email a link so the doctor can create a password (needs an email)</label>'}
    <div class="row"><button class="btn g">${edit ? 'Save changes' : 'Add doctor'}</button><button type="button" class="btn o dark" data-close="1">Cancel</button></div><p class="msg" role="status"></p></form>`;
  const f = $('#docForm'), m = $('.msg', f); f.preset.value = preset;
  f.preset.onchange = () => $('#customHrs').classList.toggle('hidden', f.preset.value !== 'custom');
  f.querySelector('[data-close]').onclick = () => { box.innerHTML = ''; };
  f.onsubmit = e => {
    e.preventDefault();
    busy(submitBtn(f), async () => {
      m.className = 'msg'; m.textContent = '';
      const body = { name: f.name.value.trim(), room: f.room.value.trim(), dept_id: +f.dept_id.value, email: f.email.value.trim(), days: [...f.querySelectorAll('[name=day]:checked')].map(x => +x.value) };
      if (f.preset.value === 'custom') { body.start_hour = +f.start_hour.value; body.end_hour = +f.end_hour.value; } else { body.shift = f.preset.value; body.start_hour = null; body.end_hour = null; }
      if (!edit) body.send_invite = f.send_invite.checked;
      try {
        const r = await withConfirm(x => api(edit ? `/admin/doctors/${d.id}` : '/admin/doctors', edit ? 'PUT' : 'POST', { ...body, ...x }));
        toast(edit ? 'Saved.' + moveNote(r) : `Doctor added. Doctor ID: ${r.doctor_code}.` + (r.invite ? (r.invite.ok ? ' Password link emailed.' : ' Password link not sent: ' + r.invite.note) : ' Add an email and send the password link so they can sign in.'), 9000);
        box.innerHTML = ''; await refreshDoctorsCache(); loadDocList();
      } catch (x) { m.className = 'msg err'; m.textContent = x.message; }
    });
  };
  f.name.focus();
}
async function leaveTab() {
  const box = $('#al');
  if (!box.dataset.ready) {
    box.dataset.ready = '1';
    box.innerHTML = `<form id="lvForm" class="card"><h3>Record a doctor's leave or absence</h3><div class="cols"><label>Doctor<select name="doctor" required>${doctors.map(d => `<option value="${d.id}">${esc(d.name)} - ${esc(d.dept)}</option>`).join('')}</select></label><label>Date<input type="date" name="date" min="${today()}" value="${today()}" required></label></div>
      <label>Reason<input name="reason" maxlength="200" placeholder="e.g. sick leave, conference"></label><button class="btn g">Mark absent and reassign patients</button><p class="msg" role="status"></p></form><div id="lvList"></div>`;
    $('#lvForm').onsubmit = e => { e.preventDefault(); const f = e.target, m = $('.msg', f);
      busy(submitBtn(f), async () => {
        m.className = 'msg'; const v = Object.fromEntries(new FormData(f));
        try { const r = await api(`/doctors/${v.doctor}/leave`, 'POST', { date: v.date, reason: v.reason }); m.className = 'msg ok'; m.textContent = `Recorded. ${r.total} appointment(s) affected: ${r.moved} moved to another doctor, ${r.unassigned} need rescheduling (patients were emailed).`; leaveTab(); }
        catch (x) { m.className = 'msg err'; m.textContent = x.message; }
      }); };
    $('#lvList').onclick = e => { const b = e.target.closest('[data-rm]'); if (b && confirm('Remove this leave? Patients that were already moved are not moved back.')) busy(b, async () => { await api('/leave/' + b.dataset.rm, 'DELETE'); leaveTab(); }); };
  }
  loading($('#lvList'), 'Loading upcoming leave...');
  try {
    const l = await api('/leave');
    $('#lvList').innerHTML = `<h3>Upcoming leave</h3>` + (l.length ? `<div class="scroll"><table><tr><th>Date</th><th>Doctor</th><th>Department</th><th>Reason</th><th></th></tr>${l.map(x => `<tr><td>${x.date}</td><td>${esc(x.doctor)}</td><td>${esc(x.dept)}</td><td>${esc(x.reason)}</td><td><button class="btn sm r" data-rm="${x.id}">Remove</button></td></tr>`).join('')}</table></div>` : '<div class="empty">No upcoming leave recorded.</div>');
  } catch (x) { $('#lvList').innerHTML = `<p class="msg err">${esc(x.message)}</p>`; }
}
async function auditTab() {
  const box = $('#au'); loading(box, 'Loading the audit log...');
  try {
    const l = await api('/audit');
    box.innerHTML = `<p class="muted">The last 200 recorded actions. Every view or change of patient records is logged here.</p><div class="scroll"><table><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Detail</th><th>IP</th></tr>` +
      (l.map(a => `<tr><td>${esc(a.created_at)}</td><td>${esc(a.user_name || '-')} <small class="muted">${esc(a.role || '')}</small></td><td>${esc(a.action)}</td><td>${esc(a.entity || '')} ${a.entity_id ?? ''}</td><td>${esc(a.detail || '')}</td><td>${esc(a.ip || '')}</td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">Nothing logged yet.</div></td></tr>') + '</table></div>';
  } catch (x) { box.innerHTML = `<p class="msg err">${esc(x.message)}</p>`; }
}
const fcCache = {};
const LG_FC_PATIENT = [['peak', 'Busiest hours'], ['normal', 'Other hours']];
const fmtDay = d => new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' });
/* p = 'f': admin console (shows model details for staff); p = 'h': patient home (plain-language results only). */
async function drawForecast(p, date) {
  const staff = p === 'f', chart = $('#' + p + 'Chart'), info = $('#' + p + 'Info');
  date = date || $('#' + p + 'Date').value;
  info.textContent = staff ? 'Training the TensorFlow.js model on booking history...' : 'Checking how busy the hospital will be...'; chart.setAttribute('aria-busy', 'true');
  try {
    const f = fcCache[date] ||= await api('/forecast?date=' + date), mx = Math.max(...f.hours.map(h => staff ? (h.hi ?? h.yhat) : h.yhat), 1);
    const quiet = f.hours.filter(h => !f.peaks.includes(h.hour)).sort((a, b) => a.yhat - b.yhat).slice(0, 3).map(h => h.hour).sort((a, b) => a - b);
    info.textContent = staff ? `Engine: ${f.engine}. Learned from ${f.days_of_history} days of bookings. Thin lines show the likely range.` : `Expected crowd for ${fmtDay(f.date)}. Taller bars mean busier hours.`;
    chart.innerHTML = f.hours.map(h => `<div class="bc ${f.peaks.includes(h.hour) ? 'pk' : ''}">${staff ? `<b>${h.yhat}</b>` : ''}<div style="height:${h.yhat / mx * 85}%">${staff && h.hi != null ? `<i style="bottom:100%;height:${(h.hi - h.yhat) / mx * 100}%"></i>` : ''}</div></div>`).join('');
    chart.setAttribute('role', 'img'); chart.removeAttribute('aria-busy');
    chart.setAttribute('aria-label', staff ? 'Predicted patients per hour on ' + f.date + ': ' + f.hours.map(h => fmtH(h.hour) + ' ' + h.yhat).join(', ') + '. Busiest: ' + f.peaks.map(fmtH).join(', ')
      : `Expected crowd on ${fmtDay(f.date)}. Busiest at ${f.peaks.map(fmtH).join(', ')}. Quieter at ${quiet.map(fmtH).join(', ')}.`);
    $('#' + p + 'Ax').innerHTML = f.hours.map(h => `<span>${fmtH(h.hour)}</span>`).join('');
    $('#' + p + 'Peaks').innerHTML = staff
      ? legend(LG_FC, 'Chart colors') + `<b>Expected busiest hours on ${f.date}:</b> ${f.peaks.map(fmtH).join(', ')}. Consider assigning more doctors and spreading new bookings to quieter hours.`
      : legend(LG_FC_PATIENT, 'Chart colors') + `<b>Busiest:</b> ${f.peaks.map(fmtH).join(', ')}<br><b>Quieter times:</b> ${quiet.map(fmtH).join(', ')}. Book one of these for a shorter wait.`;
  } catch (x) {
    chart.removeAttribute('aria-busy');
    if (staff) { info.textContent = x.message; return; }
    info.textContent = 'Busy-hour predictions are not available right now. Please try again later.';
    chart.innerHTML = ''; $('#hAx').innerHTML = ''; $('#hPeaks').innerHTML = '';
  }
}
const forecast = () => drawForecast('f');
$('#hBtn').onclick = () => drawForecast('h');
async function emails() {
  loading($('#ae'), 'Loading emails...');
  let l; try { l = await api('/emails'); } catch (x) { $('#ae').innerHTML = `<p class="msg err">${esc(x.message)}</p>`; return; }
  $('#ae').innerHTML = legend(LG_MAIL, 'Email status colors') + (l.map(m => `<div class="card"><b>${esc(m.subject)}</b> <span class="tag ${m.delivered ? 'available' : 'pending'}">${m.delivered ? 'sent to patient' : 'not sent'}</span> <small class="muted">${esc(m.note || '')}</small><br><small class="muted">To ${esc(m.to_addr)} &middot; ${m.sent_at}</small><pre style="white-space:pre-wrap;font:inherit">${esc(m.body)}</pre></div>`).join('')) || '<p class="muted">No emails yet.</p>';
}
const tabLoad = { dq: docQueue, df: () => loadFac('#df', true, true), dr: patientList, ar: requests, am: monitor, af: () => loadFac('#af', true, false), aa: forecast, ad: doctorsTab, al: leaveTab, au: auditTab, ae: emails };
init();
