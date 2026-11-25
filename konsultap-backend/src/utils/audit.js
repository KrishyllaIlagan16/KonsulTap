const { pool } = require('../config/db');

/** Writes one row to the audit log. Never throws. Use for every view/change of patient data and key admin actions. */
async function audit(req, action, entity = null, entityId = null, detail = null, user = req.user) {
  try {
    await pool.query('INSERT INTO audit_log (user_id, role, action, entity, entity_id, detail, ip) VALUES (?,?,?,?,?,?,?)',
      [user ? user.id : null, user ? user.role : null, action, entity, entityId, detail ? String(detail).slice(0, 190) : null, String(req.ip || '').slice(0, 45)]);
  } catch { /* logging must never break a request */ }
}
module.exports = { audit };
