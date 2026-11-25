const router = require('express').Router();
const { q, tx } = require('../config/db');
const { tz } = require('../config/env');
const { requireRole } = require('../middleware/auth');
const { wrap, HttpError, clean } = require('../utils/http');
const { isDate, nowIn } = require('../utils/logic');
const { audit } = require('../utils/audit');
const { reassignForLeave } = require('../utils/slots');
const { resendEmail } = require('../utils/mailer');
const { todaysQueue } = require('../utils/queue');

// ---------- ADMIN ----------
router.patch('/facilities/:id', requireRole('admin'), wrap(async (req, res) => {
  const status = (req.body || {}).status;
  if (!['available', 'occupied', 'maintenance'].includes(status)) throw new HttpError(400, 'Invalid status.');
  const r = await q('UPDATE facilities SET status = ? WHERE id = ?', [status, Number(req.params.id)]);
  if (!r.affectedRows) throw new HttpError(404, 'Facility not found.');
  res.json({ ok: true });
}));

// ---------- DOCTOR LEAVE (admin for anyone; a doctor for themself) ----------
router.post('/doctors/:id/leave', requireRole('admin', 'doctor'), wrap(async (req, res) => {
  const id = Number(req.params.id), b = req.body || {}, date = b.date || nowIn(tz).date;
  if (req.user.role === 'doctor' && req.user.ref_id !== id) throw new HttpError(403, 'Access denied: you can only report your own absence.');
  if (!isDate(date) || date < nowIn(tz).date) throw new HttpError(400, 'Choose today or a later date.');
  const [doc] = await q('SELECT id FROM doctors WHERE id = ?', [id]);
  if (!doc) throw new HttpError(404, 'Doctor not found.');
  try { await q('INSERT INTO doctor_leave (doctor_id, leave_date, reason, created_by) VALUES (?,?,?,?)', [id, date, clean(b.reason, 200), req.user.id]); }
  catch (e) { if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'That leave is already recorded.'); throw e; }
  await audit(req, 'doctor_leave', 'doctor', id, date);
  res.status(201).json({ ok: true, ...(await reassignForLeave(id, date)) });
}));

router.get('/leave', requireRole('admin'), wrap(async (req, res) => {
  res.json(await q(`SELECT l.id, l.doctor_id, d.name AS doctor, p.name AS dept, l.leave_date AS \`date\`, l.reason FROM doctor_leave l
    JOIN doctors d ON d.id = l.doctor_id JOIN departments p ON p.id = d.dept_id WHERE l.leave_date >= ? ORDER BY l.leave_date, d.name LIMIT 100`, [nowIn(tz).date]));
}));

router.delete('/leave/:id', requireRole('admin'), wrap(async (req, res) => {
  await q('DELETE FROM doctor_leave WHERE id = ?', [Number(req.params.id)]);
  await audit(req, 'remove_leave', 'leave', Number(req.params.id));
  res.json({ ok: true });
}));

router.get('/audit', requireRole('admin'), wrap(async (req, res) => {
  res.json(await q(`SELECT a.id, a.created_at, a.role, u.name AS user_name, a.action, a.entity, a.entity_id, a.detail, a.ip
    FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200`));
}));

// ADMIN: typical visit length and when each doctor's queue should clear (for the Doctor queue monitor).
router.get('/queue/stats', requireRole('admin'), wrap(async (req, res) => {
  const by = {};
  for (const r of await todaysQueue()) {
    const d = (by[r.doctor_id] ||= { doctor_id: r.doctor_id, avg_minutes: r.avg_minutes, basis: r.estimate_basis, waiting: 0, clears_in_minutes: 0 });
    if (r.status !== 'serving') d.waiting++;
    d.clears_in_minutes = Math.max(d.clears_in_minutes, r.finish_minutes || 0);
  }
  res.json(Object.values(by));
}));

router.get('/emails', requireRole('admin'), wrap(async (req, res) => {
  res.json(await q('SELECT id, to_addr, subject, body, delivered, note, sent_at, kind, attempts FROM emails ORDER BY id DESC LIMIT 30'));
}));

// ADMIN: send a stored email again (for example after fixing the email settings).
router.post('/emails/:id/resend', requireRole('admin'), wrap(async (req, res) => {
  const r = await resendEmail(Number(req.params.id));
  if (!r) throw new HttpError(404, 'Email not found.');
  await audit(req, 'resend_email', 'email', Number(req.params.id));
  res.json({ ok: r.ok, note: r.note });
}));

module.exports = router;
