/* Admin management of doctors and their schedules. Every route is admin-only and every change is written to the audit log.
   Doctors are never deleted (their history must stay): they are deactivated instead. */
const router = require('express').Router();
const { q, tx } = require('../config/db');
const { tz, appUrl, inviteTokenHours } = require('../config/env');
const { requireRole } = require('../middleware/auth');
const { wrap, HttpError, clean, EMAIL_RE } = require('../utils/http');
const { works, nowIn } = require('../utils/logic');
const { parseSchedule } = require('../utils/schedule');
const { reassignAppts } = require('../utils/slots');
const { createToken } = require('../utils/resetTokens');
const { doctorInviteEmail } = require('../utils/emailTemplates');
const { sendMail } = require('../utils/mailer');
const { audit } = require('../utils/audit');

const admin = requireRole('admin');
const docRow = async id => (await q('SELECT * FROM doctors WHERE id = ?', [id]))[0];
const shape = d => ({ ...d, days: String(d.days).split(',').map(Number) });

/** Pending/confirmed appointments of a doctor that have not happened yet (this hour onwards). */
async function upcoming(docId) {
  const now = nowIn(tz);
  return q(`SELECT * FROM appointments WHERE status IN ('pending','confirmed') AND COALESCE(doctor_id, pref_doctor_id) = ?
    AND (appt_date > ? OR (appt_date = ? AND appt_time >= ?)) ORDER BY appt_date, appt_time`, [docId, now.date, now.date, String(now.hour).padStart(2, '0') + ':00']);
}

/** Emails a one-time "create your password" link to the doctor's account email. */
async function sendInvite(docId, req) {
  const [u] = await q("SELECT id, name, username, email FROM users WHERE role = 'doctor' AND ref_id = ?", [docId]);
  if (!u) throw new HttpError(404, 'This doctor has no login account.');
  if (!u.email || !EMAIL_RE.test(u.email)) throw new HttpError(400, 'Add an email address for this doctor first.');
  const token = await createToken(u.id, inviteTokenHours * 60, req.ip);
  const m = doctorInviteEmail({ name: u.name, doctorId: u.username.toUpperCase(), link: `${appUrl}/#/reset/${token}`, hours: inviteTokenHours });
  const r = await sendMail({ to: u.email, subject: m.subject, body: m.text, html: m.html, kind: 'invite', sensitive: true });
  await audit(req, 'doctor_invite', 'doctor', docId, u.email);
  return { ok: r.ok, note: r.note };
}

// ---- list (with account state and how many upcoming appointments each doctor has) ----
router.get('/admin/doctors', admin, wrap(async (req, res) => {
  const where = ['1 = 1'], params = [nowIn(tz).date];
  if (Number(req.query.dept)) { where.push('d.dept_id = ?'); params.push(Number(req.query.dept)); }
  if (req.query.status === 'active') where.push('d.on_duty = 1'); else if (req.query.status === 'inactive') where.push('d.on_duty = 0');
  if (req.query.q) { const like = '%' + String(req.query.q).replace(/[\\%_]/g, '\\$&').slice(0, 60) + '%'; where.push('(d.name LIKE ? OR u.username LIKE ?)'); params.push(like, like); }
  const rows = await q(`SELECT d.id, d.name, d.dept_id, p.name AS dept, d.room, d.days, d.shift, d.start_hour, d.end_hour, d.on_duty,
      u.username, u.email, u.last_login, (u.password_hash IS NOT NULL) AS has_password,
      (SELECT COUNT(*) FROM appointments a WHERE a.status IN ('pending','confirmed') AND a.appt_date >= ? AND COALESCE(a.doctor_id, a.pref_doctor_id) = d.id) AS upcoming
    FROM doctors d JOIN departments p ON p.id = d.dept_id LEFT JOIN users u ON u.role = 'doctor' AND u.ref_id = d.id
    WHERE ${where.join(' AND ')} ORDER BY p.name, d.name LIMIT 300`, params);
  res.json(rows.map(r => ({ ...shape(r), doctor_code: r.username ? r.username.toUpperCase() : null })));
}));

// ---- add a doctor: creates the doctor, the login account, and (optionally) emails the "create your password" link ----
router.post('/admin/doctors', admin, wrap(async (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 120), room = clean(b.room, 30), email = clean(b.email, 190).toLowerCase(), deptId = Number(b.dept_id);
  if (name.length < 2 || !room || !deptId) throw new HttpError(400, 'Enter the name, department and room.');
  if (email && !EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  const sched = parseSchedule(b);
  if (!(await q('SELECT id FROM departments WHERE id = ?', [deptId])).length) throw new HttpError(400, 'Choose a department.');
  let created = null;
  for (let i = 0; i < 5 && !created; i++) {                      // new id = highest + 1; retry if two admins add at the same moment
    try {
      created = await tx(async c => {
        const [[mx]] = await c.query('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM doctors');
        await c.query('INSERT INTO doctors (id, name, dept_id, room, days, shift, start_hour, end_hour, on_duty) VALUES (?,?,?,?,?,?,?,?,1)', [mx.n, name, deptId, room, sched.days, sched.shift, sched.start_hour, sched.end_hour]);
        const username = 'd' + String(mx.n).padStart(3, '0');
        await c.query("INSERT INTO users (role, username, name, email, ref_id) VALUES ('doctor',?,?,?,?)", [username, name, email || null, mx.n]);   // no password yet: the doctor sets it from the emailed link
        return { id: mx.n, username };
      });
    } catch (e) { if (e.code !== 'ER_DUP_ENTRY') throw e; }
  }
  if (!created) throw new HttpError(500, 'Could not add the doctor. Please try again.');
  await audit(req, 'doctor_create', 'doctor', created.id, name);
  const invite = email && b.send_invite !== false ? await sendInvite(created.id, req).catch(e => ({ ok: false, note: e.message })) : null;
  res.status(201).json({ id: created.id, doctor_code: created.username.toUpperCase(), invite });
}));

// ---- edit details and schedule. If the new schedule leaves booked patients without a doctor, the admin must confirm first. ----
router.put('/admin/doctors/:id', admin, wrap(async (req, res) => {
  const id = Number(req.params.id), b = req.body || {}, doc = await docRow(id);
  if (!doc) throw new HttpError(404, 'Doctor not found.');
  const name = b.name !== undefined ? clean(b.name, 120) : doc.name, room = b.room !== undefined ? clean(b.room, 30) : doc.room;
  const deptId = b.dept_id !== undefined ? Number(b.dept_id) : doc.dept_id;
  const email = b.email !== undefined ? clean(b.email, 190).toLowerCase() : undefined;
  if (name.length < 2 || !room) throw new HttpError(400, 'Enter the name and room.');
  if (email && !EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  const sched = parseSchedule(b, doc);
  const booked = await upcoming(id);
  if (deptId !== doc.dept_id) {
    if (!(await q('SELECT id FROM departments WHERE id = ?', [deptId])).length) throw new HttpError(400, 'Choose a department.');
    if (booked.length) throw new HttpError(409, `This doctor has ${booked.length} upcoming appointment(s). Move or cancel them before changing the department.`);
  }
  const updated = { ...doc, ...sched, name, room, dept_id: deptId };
  const conflicts = booked.filter(a => !works(updated, a.appt_date, +a.appt_time.slice(0, 2)));
  if (conflicts.length && !b.confirm) {
    const e = new HttpError(409, `${conflicts.length} upcoming appointment(s) fall outside the new schedule. They will be moved to another doctor or the patients will be asked to reschedule.`);
    e.extra = { requires_confirm: true, conflicts: conflicts.length }; throw e;
  }
  await tx(async c => {
    await c.query('UPDATE doctors SET name = ?, dept_id = ?, room = ?, days = ?, shift = ?, start_hour = ?, end_hour = ? WHERE id = ?', [name, deptId, room, sched.days, sched.shift, sched.start_hour, sched.end_hour, id]);
    await c.query("UPDATE users SET name = ?, email = COALESCE(?, email) WHERE role = 'doctor' AND ref_id = ?", [name, email === undefined ? null : (email || null), id]);
    if (email === '') await c.query("UPDATE users SET email = NULL WHERE role = 'doctor' AND ref_id = ?", [id]);
  });
  const reassigned = conflicts.length ? await reassignAppts(updated, conflicts, 'schedule') : null;
  await audit(req, 'doctor_update', 'doctor', id, name);
  res.json({ ok: true, reassigned });
}));

// ---- deactivate / reactivate (also disables / enables the login) ----
router.post('/admin/doctors/:id/active', admin, wrap(async (req, res) => {
  const id = Number(req.params.id), active = (req.body || {}).active !== false && (req.body || {}).active !== 0, doc = await docRow(id);
  if (!doc) throw new HttpError(404, 'Doctor not found.');
  const booked = active ? [] : await upcoming(id);
  if (booked.length && !(req.body || {}).confirm) {
    const e = new HttpError(409, `This doctor has ${booked.length} upcoming appointment(s). They will be moved to another doctor or the patients will be asked to reschedule.`);
    e.extra = { requires_confirm: true, conflicts: booked.length }; throw e;
  }
  await tx(async c => {
    await c.query('UPDATE doctors SET on_duty = ? WHERE id = ?', [active ? 1 : 0, id]);
    await c.query("UPDATE users SET active = ? WHERE role = 'doctor' AND ref_id = ?", [active ? 1 : 0, id]);
  });
  const reassigned = booked.length ? await reassignAppts({ ...doc, on_duty: 0 }, booked, 'inactive') : null;
  await audit(req, active ? 'doctor_activate' : 'doctor_deactivate', 'doctor', id, doc.name);
  res.json({ ok: true, active, reassigned });
}));

// ---- (re)send the "create your password" link ----
router.post('/admin/doctors/:id/invite', admin, wrap(async (req, res) => {
  if (!(await docRow(Number(req.params.id)))) throw new HttpError(404, 'Doctor not found.');
  res.json(await sendInvite(Number(req.params.id), req));
}));

module.exports = router;
