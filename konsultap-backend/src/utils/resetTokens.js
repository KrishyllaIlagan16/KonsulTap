/* One-time "set/reset your password" links, shared by password recovery and new-doctor invitations. Only the hash is stored. */
const { tx } = require('../config/db');
const { newToken, hashToken } = require('./password');

/** Creates a link token valid for `minutes`; any older open link of that user stops working. Returns the raw token (email it, never store it). */
async function createToken(userId, minutes, ip = '') {
  const token = newToken();
  await tx(async c => {
    await c.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [userId]);
    await c.query('INSERT INTO password_resets (user_id, token_hash, expires_at, ip) VALUES (?,?,DATE_ADD(NOW(), INTERVAL ? MINUTE),?)', [userId, hashToken(token), minutes, String(ip || '').slice(0, 45)]);
  });
  return token;
}
module.exports = { createToken };
