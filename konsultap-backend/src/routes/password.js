/* Password recovery with email verification tokens.
   Security design:
   - the reset link carries a random 256-bit token; only its SHA-256 hash is stored (a database leak cannot be used to reset accounts)
   - links expire (RESET_TOKEN_MINUTES, default 30), work once, and a newer request cancels older links
   - "forgot" always answers the same way, and does its work after answering, so nobody can learn which accounts exist
   - limits per visitor IP and per account; the link is built from APP_URL, never from request headers
   - after a reset every earlier login is signed out, and the owner gets a "password changed" notice */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { q, tx } = require('../config/db');
const { appUrl, resetTokenMinutes } = require('../config/env');
const { wrap, HttpError, EMAIL_RE } = require('../utils/http');
const { checkPassword, newToken, hashToken, validTokenShape } = require('../utils/password');
const { passwordResetEmail, passwordChangedEmail } = require('../utils/emailTemplates');
const { sendMail } = require('../utils/mailer');
const { audit } = require('../utils/audit');
const { createToken } = require('../utils/resetTokens');

const limit = (windowMs, max, message) => rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, message: { error: message } });
const forgotLimiter = limit(3600e3, 10, 'Too many reset requests from this device. Please try again later.');
const resetLimiter = limit(600e3, 20, 'Too many attempts. Please wait a few minutes.');

const GENERIC = { ok: true, message: 'If an account matches, we have emailed a password reset link. It expires in ' + resetTokenMinutes + ' minutes. Please also check your Spam folder.' };

async function issueReset(req, role, identifier) {
  const id = identifier.trim().toLowerCase().slice(0, 190);
  const [u] = await q('SELECT id, role, name, email, active FROM users WHERE role = ? AND (username = ? OR email = ?) LIMIT 1', [role, id, id]);
  if (!u || u.active === 0 || !u.email || !EMAIL_RE.test(u.email)) { await audit(req, 'password_reset_no_match', 'user', null, `${role}:${id.slice(0, 60)}`, null); return; }   // staff without an email on file must ask an admin
  const [recent] = await q('SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)', [u.id]);
  if (recent.n >= 3) { await audit(req, 'password_reset_throttled', 'user', u.id, null, null); return; }                                         // at most 3 links per hour per account
  const token = await createToken(u.id, resetTokenMinutes, req.ip);                    // only the newest link works
  const mail = passwordResetEmail({ name: u.name, link: `${appUrl}/#/reset/${token}`, minutes: resetTokenMinutes });   // the token sits in the URL fragment: it is not sent to servers or logs
  await sendMail({ to: u.email, subject: mail.subject, body: mail.text, html: mail.html, kind: 'password_reset', sensitive: true });
  await audit(req, 'password_reset_requested', 'user', u.id, null, null);
}

router.post('/password/forgot', forgotLimiter, wrap(async (req, res) => {
  const { role, identifier } = req.body || {};
  if (!['patient', 'doctor', 'admin'].includes(role) || typeof identifier !== 'string' || !identifier.trim()) throw new HttpError(400, 'Enter your email or ID.');
  res.json(GENERIC);                                                                    // answer first (same reply and speed for every input) ...
  setImmediate(() => issueReset(req, role, identifier).catch(e => console.error('Password reset request failed:', e.message)));   // ... then do the work
}));

// Lets the page show "this link has expired" before the user types a new password.
router.get('/password/verify', resetLimiter, wrap(async (req, res) => {
  const token = req.query.token;
  if (!validTokenShape(token)) return res.json({ valid: false });
  const [r] = await q('SELECT u.role FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > NOW()', [hashToken(token)]);
  res.json(r ? { valid: true, role: r.role } : { valid: false });
}));

router.post('/password/reset', resetLimiter, wrap(async (req, res) => {
  const { token, password } = req.body || {};
  if (!validTokenShape(token)) throw new HttpError(400, 'This reset link is invalid or has expired. Please request a new one.');
  const user = await tx(async c => {
    const [[r]] = await c.query(`SELECT r.id, r.user_id, u.username, u.email, u.name, u.role FROM password_resets r JOIN users u ON u.id = r.user_id
      WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > NOW() FOR UPDATE`, [hashToken(token)]);
    if (!r) throw new HttpError(400, 'This reset link is invalid or has expired. Please request a new one.');
    const problem = checkPassword(password, r);
    if (problem) throw new HttpError(400, problem);                                     // rolls back: the link stays usable so the user can try again
    const hash = await bcrypt.hash(password, 10);
    await c.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [r.user_id]);   // this link and any other open ones are now dead
    await c.query('UPDATE users SET password_hash = ?, password_changed_at = NOW() WHERE id = ?', [hash, r.user_id]);   // also signs out every earlier login
    return r;
  });
  await audit(req, 'password_reset_done', 'user', user.user_id, null, null);
  if (user.email) { const m = passwordChangedEmail({ name: user.name }); sendMail({ to: user.email, subject: m.subject, body: m.text, html: m.html, kind: 'password_changed' }); }   // security notice
  res.json({ ok: true, role: user.role });
}));

module.exports = router;
