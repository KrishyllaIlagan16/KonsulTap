/* Password recovery (email token) + authenticated Change Password. */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { q, tx } = require('../config/db');
const { appUrl, resetTokenMinutes } = require('../config/env');
const { sign, requireRole } = require('../middleware/auth');
const { wrap, HttpError, EMAIL_RE } = require('../utils/http');
const { checkPassword, hashToken, validTokenShape } = require('../utils/password');
const { passwordResetEmail, passwordChangedEmail } = require('../utils/emailTemplates');
const { sendMail } = require('../utils/mailer');
const { audit } = require('../utils/audit');
const { createToken } = require('../utils/resetTokens');

const limit = (windowMs, max, message) => rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, message: { error: message } });
const forgotLimiter = limit(3600e3, 10, 'Too many reset requests from this device. Please try again later.');
const resetLimiter = limit(600e3, 20, 'Too many attempts. Please wait a few minutes.');

// ---- Forgot Password: verifies the account exists in the database before sending a reset link ----
router.post('/password/forgot', forgotLimiter, wrap(async (req, res) => {
  const { role, identifier } = req.body || {};
  if (!['patient', 'doctor', 'admin'].includes(role) || typeof identifier !== 'string' || !identifier.trim()) {
    throw new HttpError(400, role === 'patient' ? 'Enter your email address.' : 'Enter your ID or email.');
  }
  const id = identifier.trim().toLowerCase().slice(0, 190);
  const [u] = await q('SELECT id, role, name, email, active FROM users WHERE role = ? AND (LOWER(username) = ? OR LOWER(email) = ?) LIMIT 1', [role, id, id]);
  if (!u) {
    await audit(req, 'password_reset_no_match', 'user', null, `${role}:${id.slice(0, 60)}`, null);
    throw new HttpError(404, role === 'patient' ? 'No account found with this email address.' : 'No account found with that ID or email.');
  }
  if (u.active === 0) throw new HttpError(403, 'This account is inactive. Please contact the hospital administrator.');
  if (!u.email || !EMAIL_RE.test(u.email)) throw new HttpError(400, 'No email address is on file for this account. Please contact the hospital administrator.');

  const [recent] = await q('SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)', [u.id]);
  if (recent.n >= 3) {
    await audit(req, 'password_reset_throttled', 'user', u.id, null, null);
    throw new HttpError(429, 'Too many reset requests for this account. Please wait an hour and try again.');
  }

  const token = await createToken(u.id, resetTokenMinutes, req.ip);
  const mail = passwordResetEmail({ name: u.name, link: `${appUrl}/#/reset/${token}`, minutes: resetTokenMinutes });
  const sent = await sendMail({ to: u.email, subject: mail.subject, body: mail.text, html: mail.html, kind: 'password_reset', sensitive: true });
  await audit(req, 'password_reset_requested', 'user', u.id, null, null);

  if (!sent.ok) {
    throw new HttpError(503, 'We found your account, but could not send the reset email right now. Please try again later.');
  }
  res.json({ ok: true, message: `A password reset link has been sent to your email. It expires in ${resetTokenMinutes} minutes. Please also check your Spam folder.` });
}));

// Lets the page show "this link has expired" before the user types a new password.
router.get('/password/verify', resetLimiter, wrap(async (req, res) => {
  const token = req.query.token;
  if (!validTokenShape(token)) return res.json({ valid: false });
  const [r] = await q('SELECT u.role FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > NOW()', [hashToken(token)]);
  res.json(r ? { valid: true, role: r.role } : { valid: false });
}));

// ---- Reset Password (from emailed token) ----
router.post('/password/reset', resetLimiter, wrap(async (req, res) => {
  const { token, password } = req.body || {};
  if (!validTokenShape(token)) throw new HttpError(400, 'This reset link is invalid or has expired. Please request a new one.');
  if (typeof password !== 'string' || !password) throw new HttpError(400, 'Enter a new password.');
  const user = await tx(async c => {
    const [[pr]] = await c.query(
      'SELECT id, user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() FOR UPDATE',
      [hashToken(token)]
    );
    if (!pr) throw new HttpError(400, 'This reset link is invalid or has expired. Please request a new one.');
    const [[u]] = await c.query('SELECT id AS user_id, username, email, name, role FROM users WHERE id = ?', [pr.user_id]);
    if (!u) throw new HttpError(404, 'Account not found.');
    const problem = checkPassword(password, u);
    if (problem) throw new HttpError(400, problem);
    const hash = await bcrypt.hash(password, 10);
    const changedSec = Math.floor(Date.now() / 1000) - 2;   // UTC epoch matching JWT iat, avoids TiDB/Node timezone skew
    await c.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [u.user_id]);
    const [upd] = await c.query(
      'UPDATE users SET password_hash = ?, password_changed_at = FROM_UNIXTIME(?) WHERE id = ?',
      [hash, changedSec, u.user_id]
    );
    if (!upd.affectedRows) throw new HttpError(500, 'Could not update your password. Please try again.');
    return u;
  });
  await audit(req, 'password_reset_done', 'user', user.user_id, null, null);
  if (user.email) {
    const m = passwordChangedEmail({ name: user.name });
    await sendMail({ to: user.email, subject: m.subject, body: m.text, html: m.html, kind: 'password_changed' }).catch(() => {});
  }
  res.json({ ok: true, role: user.role });
}));

// ---- Change Password (for signed-in patient or doctor; removed from Admin dashboard) ----
router.post('/password/change', requireRole('patient', 'doctor'), resetLimiter, wrap(async (req, res) => {
  const b = req.body || {};
  const currentPassword = String(b.currentPassword || '');
  const newPassword = String(b.newPassword || '');
  const confirm = typeof b.confirm === 'string' ? b.confirm : null;

  if (!currentPassword || !newPassword) throw new HttpError(400, 'Enter your current password and a new password.');
  if (confirm !== null && confirm !== newPassword) throw new HttpError(400, 'The new passwords do not match.');
  if (currentPassword === newPassword) throw new HttpError(400, 'Your new password must be different from your current password.');

  const [u] = await q('SELECT id, role, username, name, email, password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!u || !u.password_hash) throw new HttpError(400, 'This account does not have a local password set.');
  const valid = await bcrypt.compare(currentPassword, u.password_hash);
  if (!valid) throw new HttpError(400, 'Your current password is incorrect.');

  const problem = checkPassword(newPassword, u);
  if (problem) throw new HttpError(400, problem);

  const hash = await bcrypt.hash(newPassword, 10);
  const changedSec = Math.floor(Date.now() / 1000) - 2;   // UTC epoch matching JWT iat, so the fresh token below is always valid
  const upd = await q('UPDATE users SET password_hash = ?, password_changed_at = FROM_UNIXTIME(?) WHERE id = ?', [hash, changedSec, u.id]);
  if (!upd.affectedRows) throw new HttpError(500, 'Could not update your password. Please try again.');
  await audit(req, 'password_changed', 'user', u.id, u.role);
  if (u.email) {
    const m = passwordChangedEmail({ name: u.name });
    await sendMail({ to: u.email, subject: m.subject, body: m.text, html: m.html, kind: 'password_changed' }).catch(() => {});
  }
  res.json({ ok: true, token: sign(u), message: 'Your password has been updated.' });
}));

module.exports = router;
