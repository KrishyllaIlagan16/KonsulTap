const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const { q } = require('../config/db');
const { jwtSecret, googleClientId, emailDnsCheck } = require('../config/env');
const { sign, pub } = require('../middleware/auth');
const { wrap, HttpError, clean } = require('../utils/http');
const { isValidEmail, domainAcceptsMail } = require('../utils/email');
const { audit } = require('../utils/audit');
const { checkPassword } = require('../utils/password');

const limiter = rateLimit({ windowMs: 60e3, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please wait a minute and try again.' } });
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10); // keeps timing similar when the username does not exist
const google = googleClientId ? new OAuth2Client(googleClientId) : null;
const session = u => ({ user: pub(u), token: sign(u) });

// Each role signs in through its own portal: the role must match the account.
router.post('/login', limiter, wrap(async (req, res) => {
  const { role, username, password } = req.body || {};
  if (!['patient', 'doctor', 'admin'].includes(role) || typeof username !== 'string' || typeof password !== 'string') throw new HttpError(400, 'Enter your login details.');
  const [u] = await q('SELECT * FROM users WHERE role=? AND username=?', [role, username.trim().toLowerCase()]);
  const ok = await bcrypt.compare(password, (u && u.password_hash) || DUMMY_HASH);
  if (!u || !u.password_hash || !ok || u.active === 0) { await audit(req, 'login_failed', 'user', null, `${role}:${username}`.slice(0, 120), null); throw new HttpError(401, 'Incorrect login details for this portal.'); }
  await q('UPDATE users SET last_login=NOW() WHERE id=?', [u.id]);
  await audit(req, 'login', 'user', u.id, role, u);
  res.json(session(u));
}));

// Public sign-up creates PATIENT accounts only. Doctor and admin accounts are created by the hospital (seed script / admin).
router.post('/register', limiter, wrap(async (req, res) => {
  const b = req.body || {}, name = clean(b.name, 120), email = clean(b.email, 190).toLowerCase(), password = String(b.password || '');
  if (!name || !isValidEmail(email)) throw new HttpError(400, 'Enter your name and a valid email.');
  if (typeof b.confirm === 'string' && b.confirm !== password) throw new HttpError(400, 'The passwords do not match.');
  const pwProblem = checkPassword(password, { username: email, email, name }); if (pwProblem) throw new HttpError(400, pwProblem);
  if (b.consent !== true) throw new HttpError(400, 'Please accept the Privacy Notice to create an account.');
  const domain = email.split('@')[1];
  if (emailDnsCheck && !(await domainAcceptsMail(domain))) throw new HttpError(400, `The email domain "${domain}" cannot receive email. Please check your address for typos.`);
  const [dup] = await q("SELECT id FROM users WHERE role='patient' AND username=?", [email]);
  if (dup) throw new HttpError(409, 'An account with that email already exists.');
  const hash = await bcrypt.hash(password, 10);
  const r = (await q("INSERT INTO users (role, username, name, email, password_hash, consent_at) VALUES ('patient',?,?,?,?,NOW())", [email, name, email, hash]));
  const [u] = await q('SELECT * FROM users WHERE id=?', [r.insertId]);
  res.status(201).json(session(u));
}));

router.post('/logout', (req, res) => res.json({ ok: true })); // tokens are stateless: the client just discards its token
router.get('/me', (req, res) => res.json(pub(req.user)));

// ---- Google sign-in (patients only) ----
router.get('/auth/nonce', (req, res) => {
  const nonce = crypto.randomBytes(16).toString('hex');
  res.json({ nonce, nonceToken: jwt.sign({ n: nonce }, jwtSecret, { expiresIn: '5m' }) });
});

router.post('/auth/google', limiter, wrap(async (req, res) => {
  if (!google) throw new HttpError(503, 'Google sign-in is not configured on this server.');
  const { credential, nonceToken } = req.body || {};
  if (typeof credential !== 'string' || typeof nonceToken !== 'string') throw new HttpError(400, 'Missing token.');
  let expected;
  try { expected = jwt.verify(nonceToken, jwtSecret).n; } catch { throw new HttpError(401, 'Sign-in expired. Please try again.'); }
  let p;
  try { p = (await google.verifyIdToken({ idToken: credential, audience: googleClientId })).getPayload(); }
  catch { throw new HttpError(401, 'Invalid Google sign-in.'); }
  if (!p.email_verified) throw new HttpError(401, 'Your Google email is not verified.');
  if (p.nonce !== expected) throw new HttpError(401, 'Invalid sign-in request.');
  const email = p.email.toLowerCase();

  let [u] = await q('SELECT * FROM users WHERE google_sub=?', [p.sub]);                       // returning Google user
  if (!u) {
    [u] = await q('SELECT * FROM users WHERE username=? AND role=?', [email, 'patient']);       // link an existing patient account
    if (u) await q('UPDATE users SET google_sub=? WHERE id=?', [p.sub, u.id]);
    else {
      const [staff] = await q("SELECT id FROM users WHERE email=? AND role<>'patient'", [email]);
      if (staff) throw new HttpError(403, 'This email belongs to a staff account. Use the Doctor or Administrator portal.');
      const r = await q("INSERT INTO users (role, username, name, email, google_sub) VALUES ('patient',?,?,?,?)", [email, clean(p.name || email, 120), email, p.sub]);
      [u] = await q('SELECT * FROM users WHERE id=?', [r.insertId]);                         // first-time user
    }
  }
  if (u.role !== 'patient') throw new HttpError(403, 'Google sign-in is for patients only.');
  if (u.active === 0) throw new HttpError(403, 'This account has been disabled.');
  await q('UPDATE users SET last_login=NOW() WHERE id=?', [u.id]);
  res.json(session(u));
}));

module.exports = router;
