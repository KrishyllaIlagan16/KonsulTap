const router = require('express').Router();
const { q, tx } = require('../config/db');
const { tz, cancelCutoffHours } = require('../config/env');
const { requireRole } = require('../middleware/auth');
const { wrap, HttpError, clean, EMAIL_RE, newRef } = require('../utils/http');
const { isDate, isTime, nowIn, letter, hoursUntil } = require('../utils/logic');
const { assertSlotOpen } = require('../utils/slots');
const { sendMail } = require('../utils/mailer');
const { confirmationEmail } = require('../utils/emailTemplates');
const { notifyQueue } = require('../utils/realtime');
const { invalidate: refreshWaitStats } = require('../utils/waitStats');
const { audit } = require('../utils/audit');

const SELECT = joinDoc => `SELECT a.id, a.ref, a.user_id, a.patient_name, a.email, a.phone, a.dept_id, a.doctor_id, a.pref_doctor_id,
  a.appt_date AS \`date\`, a.appt_time AS \`time\`, a.reason, a.status, a.queue_no, a.cancelled_by, a.checked_in_at, a.created_at, p.name AS dept, d.name AS doctor, d.room
  FROM appointments a JOIN departments p ON p.id = a.dept_id LEFT JOIN doctors d ON d.id = ${joinDoc}`;

const futureSlot = (date, time) => {
  if (!isDate(date) || !isTime(time)) throw new HttpError(400, 'Choose a valid date and time.');
  const now = nowIn(tz);
  if (date < now.date || (date === now.date && +time.slice(0, 2) <= now.hour)) throw new HttpError(400, 'Choose a future time slot.');
};
const beforeCutoff = a => {
  if (hoursUntil(a.appt_date, a.appt_time, nowIn(tz)) < cancelCutoffHours)
    throw new HttpError(409, `Changes must be made at least ${cancelCutoffHours} hours before the appointment. Please call the hospital.`);
};
const mine = async (req, id) => {
  const [a] = await q('SELECT * FROM appointments WHERE id = ? AND user_id = ?', [id, req.user.id]);
  if (!a) throw new HttpError(404, 'Appointment not found.');
  return a;
};

// PATIENT: book with a doctor who is available at that date and time.
router.post('/appointments', requireRole('patient'), wrap(async (req, res) => {
  const b = req.body || {};
  const name = clean(b.patient_name, 120), email = clean(b.email, 190).toLowerCase(), phone = clean(b.phone, 40), reason = clean(b.reason, 500);
  const deptId = Number(b.dept_id), docId = Number(b.doctor_id), { date, time } = b;
  if (!name || !EMAIL_RE.test(email) || !deptId || !docId || !date || !time) throw new HttpError(400, 'Please fill in name, email, department, date and time.');
  futureSlot(date, time);
  const [open] = await q("SELECT COUNT(*) AS n FROM appointments WHERE user_id = ? AND status IN ('pending','confirmed') AND appt_date >= ?", [req.user.id, nowIn(tz).date]);
  if (open.n >= 5) throw new HttpError(429, 'You already have 5 upcoming appointments. Please cancel one before booking another.'); // stops slot hoarding

  const out = await tx(async c => {
    const [[doc]] = await c.query('SELECT * FROM doctors WHERE id = ? AND on_duty = 1 FOR UPDATE', [docId]); // lock: two patients cannot take the last slot
    if (!doc || doc.dept_id !== deptId) throw new HttpError(400, 'Choose an available doctor.');
    await assertSlotOpen(c, doc, date, time);
    for (let i = 0; i < 5; i++) {
      const ref = newRef();
      try {
        await c.query('INSERT INTO appointments (ref, user_id, patient_name, email, phone, dept_id, pref_doctor_id, appt_date, appt_time, reason, status) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          [ref, req.user.id, name, email, phone, deptId, docId, date, time, reason, 'pending']);
        return { ref, doc };
      } catch (e) { if (e.code !== 'ER_DUP_ENTRY') throw e; }
    }
    throw new HttpError(500, 'Could not create a reference code. Please try again.');
  });
  const [dept] = await q('SELECT name FROM departments WHERE id = ?', [deptId]);
  const m = await sendMail({ to: email, subject: `KonsulTap: booking confirmation (${out.ref})`, body: letter({ ref: out.ref, patient_name: name, date, time }, out.doc, dept.name, 0) });
  res.status(201).json({ ref: out.ref, emailed: m.ok, note: m.note });
}));

router.get('/my/appointments', requireRole('patient'), wrap(async (req, res) => {
  res.json(await q(SELECT('COALESCE(a.doctor_id, a.pref_doctor_id)') + ' WHERE a.user_id = ? ORDER BY a.appt_date DESC, a.appt_time DESC LIMIT 100', [req.user.id]));
}));

// PATIENT: cancel (until the cutoff). Frees the slot immediately.
router.post('/appointments/:id/cancel', requireRole('patient'), wrap(async (req, res) => {
  const a = await mine(req, Number(req.params.id));
  if (!['pending', 'confirmed'].includes(a.status)) throw new HttpError(409, `This appointment is already ${a.status.replace('_', ' ')}.`);
  beforeCutoff(a);
  const r = await q("UPDATE appointments SET status = 'cancelled', cancelled_by = 'patient' WHERE id = ? AND status IN ('pending','confirmed')", [a.id]);
  if (!r.affectedRows) throw new HttpError(409, 'This appointment just changed. Please refresh.');
  await audit(req, 'cancel_appointment', 'appointment', a.id);
  if (a.doctor_id) notifyQueue([a.doctor_id], 'cancelled');
  await sendMail({ to: a.email, subject: `KonsulTap: appointment cancelled (${a.ref})`, body: `Dear ${a.patient_name},\n\nYour appointment ${a.ref} on ${a.appt_date} at ${a.appt_time} has been cancelled as you requested. You can book a new time anytime on KonsulTap.\n\nBatangas Medical Center` });
  res.json({ ok: true });
}));

// PATIENT: reschedule = move to another slot/doctor of the same department. It goes back to "pending" for the admin to re-confirm.
router.post('/appointments/:id/reschedule', requireRole('patient'), wrap(async (req, res) => {
  const a = await mine(req, Number(req.params.id)), b = req.body || {}, docId = Number(b.doctor_id);
  if (!['pending', 'confirmed'].includes(a.status)) throw new HttpError(409, `This appointment is already ${a.status.replace('_', ' ')}.`);
  beforeCutoff(a); futureSlot(b.date, b.time);
  const doc = await tx(async c => {
    const [[d]] = await c.query('SELECT * FROM doctors WHERE id = ? AND on_duty = 1 FOR UPDATE', [docId]);
    if (!d || d.dept_id !== a.dept_id) throw new HttpError(400, 'Choose an available doctor.');
    await assertSlotOpen(c, d, b.date, b.time, a.id);
    const r = await c.query("UPDATE appointments SET appt_date = ?, appt_time = ?, pref_doctor_id = ?, doctor_id = NULL, queue_no = NULL, checked_in_at = NULL, status = 'pending' WHERE id = ? AND status IN ('pending','confirmed')", [b.date, b.time, docId, a.id]);
    if (!r[0].affectedRows) throw new HttpError(409, 'This appointment just changed. Please refresh.');
    return d;
  });
  const [dept] = await q('SELECT name FROM departments WHERE id = ?', [a.dept_id]);
  await audit(req, 'reschedule_appointment', 'appointment', a.id);
  if (a.doctor_id) notifyQueue([a.doctor_id], 'rescheduled');
  await sendMail({ to: a.email, subject: `KonsulTap: appointment rescheduled (${a.ref})`, body: letter({ ref: a.ref, patient_name: a.patient_name, date: b.date, time: b.time }, doc, dept.name, 0).replace('Your appointment booking has been received and recorded.', 'Your appointment was moved to the new time below. It needs the hospital to confirm it again.') });
  res.json({ ok: true });
}));

// PATIENT (or front desk): "I have arrived". Only confirmed appointments, only on the day itself.
router.post('/appointments/:id/checkin', requireRole('patient', 'doctor', 'admin'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const [a] = await q('SELECT * FROM appointments WHERE id = ?', [id]);
  if (!a || (req.user.role === 'patient' && a.user_id !== req.user.id) || (req.user.role === 'doctor' && a.doctor_id !== req.user.ref_id)) throw new HttpError(404, 'Appointment not found.');
  if (a.appt_date !== nowIn(tz).date) throw new HttpError(409, 'You can check in on the day of the appointment.');
  if (a.status !== 'confirmed') throw new HttpError(409, a.status === 'pending' ? 'This appointment is not confirmed yet.' : `This appointment is ${a.status.replace('_', ' ')}.`);
  await q('UPDATE appointments SET checked_in_at = COALESCE(checked_in_at, NOW()) WHERE id = ?', [id]);
  if (a.doctor_id) notifyQueue([a.doctor_id], 'checkin');
  res.json({ ok: true });
}));

// DOCTOR (own patients only) / ADMIN (everyone).
router.get('/appointments', requireRole('doctor', 'admin'), wrap(async (req, res) => {
  const where = ["(a.status <> 'done' OR a.appt_date = ?)"], params = [nowIn(tz).date];
  const doctor = req.user.role === 'doctor' ? req.user.ref_id : Number(req.query.doctor) || 0;
  if (doctor) { where.push('a.doctor_id = ?'); params.push(doctor); }
  if (req.query.status) { where.push('a.status = ?'); params.push(String(req.query.status)); }
  if (req.query.date) { if (!isDate(req.query.date)) throw new HttpError(400, 'Invalid date.'); where.push('a.appt_date = ?'); params.push(req.query.date); }
  res.json(await q(SELECT('a.doctor_id') + ` WHERE ${where.join(' AND ')} ORDER BY a.appt_date, a.appt_time, a.queue_no LIMIT 300`, params));
}));

// ADMIN: assign a doctor and confirm. Gives the next ticket number for that doctor and day, then emails the patient.
router.post('/appointments/:id/confirm', requireRole('admin'), wrap(async (req, res) => {
  const id = Number(req.params.id), docId = Number((req.body || {}).doctor_id);
  if (!id || !docId) throw new HttpError(400, 'Choose a doctor to assign.');
  const out = await tx(async c => {
    const [[doc]] = await c.query('SELECT * FROM doctors WHERE id = ? AND on_duty = 1 FOR UPDATE', [docId]);
    const [[a]] = await c.query('SELECT * FROM appointments WHERE id = ? FOR UPDATE', [id]);
    if (!a) throw new HttpError(404, 'Appointment not found.');
    if (!doc || doc.dept_id !== a.dept_id) throw new HttpError(400, 'Choose a doctor from the same department.');
    if (a.status !== 'pending') throw new HttpError(409, `This appointment is already ${a.status.replace('_', ' ')}.`);
    const now = nowIn(tz);
    if (a.appt_date < now.date || (a.appt_date === now.date && +a.appt_time.slice(0, 2) < now.hour)) throw new HttpError(409, 'This time slot has already passed. Decline it and ask the patient to rebook.');
    await assertSlotOpen(c, doc, a.appt_date, a.appt_time, id);
    const [[nx]] = await c.query("SELECT COALESCE(MAX(queue_no), 0) + 1 AS n FROM appointments WHERE doctor_id = ? AND appt_date = ? AND status IN ('confirmed','serving','done','no_show')", [docId, a.appt_date]);
    await c.query("UPDATE appointments SET doctor_id = ?, queue_no = ?, status = 'confirmed' WHERE id = ?", [docId, nx.n, id]);
    return { a, doc, qn: nx.n };
  });
  await audit(req, 'confirm_appointment', 'appointment', id);
  notifyQueue([docId], 'confirmed');   // the patient appears in the live queue immediately
  const [dept] = await q('SELECT name FROM departments WHERE id = ?', [out.a.dept_id]);
  // Automatic confirmation email, sent the moment the admin confirms (HTML + plain-text versions).
  const mail = confirmationEmail({ patient_name: out.a.patient_name, ref: out.a.ref, date: out.a.appt_date, time: out.a.appt_time, doctor: out.doc.name, dept: dept.name, room: out.doc.room, queue_no: out.qn });
  const m = await sendMail({ to: out.a.email, subject: mail.subject, body: mail.text, html: mail.html, kind: 'confirmation', appointmentId: id });
  res.json({ ok: true, queue_no: out.qn, emailed: m.ok, note: m.note });
}));

// DOCTOR (own patients) / ADMIN: confirmed -> serving -> done, or cancelled / no_show.
const ALLOWED_FROM = { serving: ['confirmed'], done: ['serving'], confirmed: ['serving'], cancelled: ['pending', 'confirmed', 'serving'], no_show: ['confirmed', 'serving'] };
router.post('/appointments/:id/status', requireRole('doctor', 'admin'), wrap(async (req, res) => {
  const id = Number(req.params.id), raw = (req.body || {}).status, status = raw === 'completed' ? 'done' : raw;   // "completed" is accepted as another name for "done"
  if (!ALLOWED_FROM[status]) throw new HttpError(400, 'Invalid status.');
  const appt = await tx(async c => {
    const [[a]] = await c.query('SELECT * FROM appointments WHERE id = ? FOR UPDATE', [id]);
    if (!a) throw new HttpError(404, 'Appointment not found.');
    if (req.user.role === 'doctor' && a.doctor_id !== req.user.ref_id) throw new HttpError(403, 'Access denied: this is not your patient.');
    if (!ALLOWED_FROM[status].includes(a.status)) throw new HttpError(409, `Cannot change a ${a.status.replace('_', ' ')} appointment to ${status.replace('_', ' ')}.`);
    if (status === 'serving') await c.query("UPDATE appointments SET status = 'done', completed_at = NOW() WHERE doctor_id = ? AND appt_date = ? AND status = 'serving'", [a.doctor_id, a.appt_date]); // one patient at a time
    if (status === 'cancelled' || status === 'no_show') await c.query('UPDATE appointments SET status = ?, cancelled_by = ? WHERE id = ?', [status, req.user.role, id]);
    else await c.query(`UPDATE appointments SET status = ?, started_at = IF(? = 'serving', NOW(), IF(? = 'confirmed', NULL, started_at)), completed_at = IF(? = 'done', NOW(), completed_at) WHERE id = ?`, [status, status, status, status, id]);   // the database is updated here; start/end times feed the wait-time estimates
    return a;
  });
  await audit(req, 'status_' + status, 'appointment', id);
  if (status === 'done') refreshWaitStats();   // visit lengths changed: use them in the next estimate
  if (appt.doctor_id) notifyQueue([appt.doctor_id], status);   // push to every open screen right away: the next patient becomes "Next" / "Now serving"
  let emailed = null, note = null;
  if (status === 'cancelled' && appt.email) {
    const [dept] = await q('SELECT name FROM departments WHERE id = ?', [appt.dept_id]);
    const deptName = dept ? dept.name : 'Outpatient Department';
    const body = `Dear ${appt.patient_name},\n\nWe regret to inform you that your consultation appointment (${appt.ref}) for ${deptName} on ${appt.appt_date} at ${appt.appt_time} has been cancelled by the hospital.\n\nPlease log in to KonsulTap if you would like to book a new schedule.\n\nThank you,\nKonsulTap`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #d7e0d9;border-radius:10px;overflow:hidden"><div style="background:#0d6b3f;color:#fff;padding:18px 22px;border-bottom:4px solid #f2d900"><h2 style="margin:0;font-size:19px">Appointment Cancelled</h2></div><div style="padding:20px 22px;color:#15251c;line-height:1.55"><p>Dear <b>${appt.patient_name}</b>,</p><p>Your consultation appointment has been cancelled by the hospital:</p><ul style="background:#f4f7f3;padding:12px 18px 12px 32px;border-radius:8px"><li><b>Reference Code:</b> ${appt.ref}</li><li><b>Department:</b> ${deptName}</li><li><b>Schedule:</b> ${appt.appt_date} at ${appt.appt_time}</li></ul><p>Please visit KonsulTap to book a new consultation slot at your convenience.</p></div></div>`;
    const m = await sendMail({ to: appt.email, subject: `KonsulTap: Appointment Cancelled (${appt.ref})`, body, html, kind: 'cancellation', appointmentId: id });
    emailed = m.ok; note = m.note;
  }
  res.json({ ok: true, emailed, note });
}));

module.exports = router;
