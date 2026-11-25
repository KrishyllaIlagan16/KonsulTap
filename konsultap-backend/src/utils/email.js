// Sign-up email checks: strict format + a lightweight "can this domain receive mail?" DNS lookup.
// No third-party service and no email is sent; it just catches typos like "juan@gmial.con" or made-up domains.
const dns = require('dns').promises;

const EMAIL_STRICT = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;
const isValidEmail = e => typeof e === 'string' && e.length <= 190 && EMAIL_STRICT.test(e);

const NOT_FOUND = new Set(['ENOTFOUND', 'ENODATA']);
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(Object.assign(new Error('DNS timeout'), { code: 'ETIMEOUT' })), ms))]);

/** true = domain can receive mail (or DNS was unreachable, so we don't block sign-up); false = domain clearly cannot. */
async function domainAcceptsMail(domain, ms = 3000) {
  try {
    const mx = await withTimeout(dns.resolveMx(domain), ms);
    if (mx.length) return mx.some(r => r.exchange && r.exchange !== '.');   // a "null MX" means the domain refuses mail
  } catch (e) {
    if (e.code === 'ENOTFOUND') return false;                              // the domain does not exist
    if (!NOT_FOUND.has(e.code)) return true;                               // DNS trouble (offline, timeout): fail open
  }
  try { await withTimeout(dns.resolve4(domain), ms); return true; }        // no MX record: mail falls back to the A record
  catch (e) { return !NOT_FOUND.has(e.code); }
}

module.exports = { isValidEmail, domainAcceptsMail };
