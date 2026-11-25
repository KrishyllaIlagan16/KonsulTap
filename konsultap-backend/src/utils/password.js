/* Password rules and reset-token helpers (no database, easy to test). */
const crypto = require('crypto');

const COMMON = new Set(['password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123', 'qwertyuiop', 'iloveyou', 'abc12345', '11111111', '00000000',
  'admin123', 'doctor123', 'patient123', 'konsultap', 'konsultap123', 'batmc123', 'welcome1', 'letmein123', 'changeme', 'p@ssw0rd', 'passw0rd']);

/** Returns a problem message, or null if the password is acceptable. `who` = { username, email, name } to stop "password = my own name/email". */
function checkPassword(pw, who = {}) {
  if (typeof pw !== 'string') return 'Enter a password.';
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (Buffer.byteLength(pw) > 72) return 'Password is too long (72 characters at most).';
  const low = pw.toLowerCase();
  if (COMMON.has(low) || /^(.)\1+$/.test(pw)) return 'That password is too common. Please choose a less predictable one.';
  const bits = [who.username, who.email, who.email && String(who.email).split('@')[0], who.name].filter(Boolean).map(s => String(s).toLowerCase());
  if (bits.some(b => b.length >= 4 && (low === b || low.includes(b)))) return 'Your password must not contain your name, username or email.';
  return null;
}

/** 256-bit random token for the reset link. Only its SHA-256 hash is stored in the database. */
const newToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const validTokenShape = t => typeof t === 'string' && /^[A-Za-z0-9_-]{40,64}$/.test(t);

module.exports = { checkPassword, newToken, hashToken, validTokenShape };
