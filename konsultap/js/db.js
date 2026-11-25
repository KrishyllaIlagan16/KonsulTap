/* KonsulTap data layer, connected to the real backend (Express + MySQL/TiDB).
   Same interface the website already uses: DB.api(path, method, body). Every call goes to /api/... on the server,
   and the server enforces roles, availability, queue numbers and emails. */
const DB = (() => {
  const API = (window.KONSULTAP_API || '') + '/api';   // same address as the website by default
  const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  let token = null; try { token = sessionStorage.getItem('kt_token'); } catch {}
  const setToken = t => { token = t; try { t ? sessionStorage.setItem('kt_token', t) : sessionStorage.removeItem('kt_token'); } catch {} };

  const iso = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
  const today = () => iso(new Date());
  const addDays = (n, from = new Date()) => { const d = new Date(from); d.setDate(d.getDate() + n); return d; };

  async function call(path, method = 'GET', body) {
    let r;
    try {
      r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch { throw new Error('Cannot reach the server. Check your internet connection and that the backend is running.'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401 && token && !/^\/(login|register|auth|password)/.test(path)) { setToken(null); window.dispatchEvent(new Event('kt-session-expired')); }   // token expired
      const err = new Error(data.error || 'Something went wrong. Please try again.'); err.data = data; throw err;   // data carries extra fields such as requires_confirm
    }
    return data;
  }

  async function api(u, method = 'GET', body) {
    const path = new URL(u, 'http://x'), p = path.pathname;
    if (p === '/forecast') {                         // the TensorFlow.js model runs in the browser on anonymous booking history
      const rows = await call('/forecast/history');
      return Forecast.run(path.searchParams.get('date') || iso(addDays(1)), rows, HOURS);
    }
    if (p === '/reset') throw new Error('Reset is only available in the browser-only demo. Use "npm run seed -- --force" on the server.');
    const data = await call(u, method, body);
    if (['/login', '/register', '/auth/google'].includes(p) && data.token) { setToken(data.token); return { user: data.user }; }
    if (p === '/logout') setToken(null);
    return data;
  }

  return { ready: async () => {}, api, today, iso, addDays };
})();
