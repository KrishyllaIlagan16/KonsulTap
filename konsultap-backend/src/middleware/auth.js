const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');
const { q } = require('../config/db');
const { HttpError } = require('../utils/http');

const sign = u => jwt.sign({ sub: u.id, role: u.role }, jwtSecret, { expiresIn: '2h' });
const pub = u => u && { id: u.id, role: u.role, name: u.name, email: u.email, ref_id: u.ref_id };

/** Reads "Authorization: Bearer <token>". The user's role is always re-read from the database, never trusted from the token. */
async function authenticate(req, res, next) {
  req.user = null;
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try {
      const { sub, iat } = jwt.verify(h.slice(7), jwtSecret);
      const [u] = await q('SELECT id, role, name, email, ref_id, UNIX_TIMESTAMP(password_changed_at) AS pca, active FROM users WHERE id = ?', [sub]);
      // a password reset signs the account out everywhere: tokens issued before the change are rejected
      req.user = u && u.active !== 0 && !(u.pca && iat < u.pca) ? { id: u.id, role: u.role, name: u.name, email: u.email, ref_id: u.ref_id } : null;
    } catch { req.user = null; }
  }
  next();
}

/** Role-based access control: requireRole('admin'), requireRole('doctor', 'admin'), ... */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please sign in first.'));
  if (!roles.includes(req.user.role)) return next(new HttpError(403, `Access denied: ${req.user.role} accounts cannot do this.`));
  next();
};

module.exports = { sign, pub, authenticate, requireRole };
