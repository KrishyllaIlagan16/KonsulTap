const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { q } = require('../config/db');
const { tz } = require('../config/env');
const { wrap, HttpError } = require('../utils/http');
const { CAP, works, isDate, isTime, nowIn } = require('../utils/logic');
const { onLeaveSet } = require('../utils/slots');
const { todaysQueue } = require('../utils/queue');
const { firstNames } = require('../utils/queue.pure');
const realtime = require('../utils/realtime');

const trackLimiter = rateLimit({ windowMs: 60e3, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many lookups. Please wait a minute.' } });

router.get('/departments', wrap(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
  res.json(await q('SELECT id, name, icon FROM departments ORDER BY id'));
}));

// Doctors of a department. With ?date=&time= only doctors who work then and still have room (max 3 patients per hour).
router.get('/doctors', wrap(async (req, res) => {
  const { dept, date, time } = req.query, except = Number(req.query.except) || 0;
  if (!date && !time) res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  const params = [];
  let sql = 'SELECT d.id, d.name, d.dept_id, d.room, d.days, d.shift, d.start_hour, d.end_hour, p.name AS dept FROM doctors d JOIN departments p ON p.id = d.dept_id WHERE d.on_duty = 1';
  if (dept) { sql += ' AND d.dept_id = ?'; params.push(Number(dept)); }
  let docs = (await q(sql + ' ORDER BY d.id', params)).map(d => ({ ...d, days: String(d.days).split(',').map(Number) }));
  if (date) {
    if (!isDate(date)) throw new HttpError(400, 'Invalid date.');
    const off = await onLeaveSet(date);
    docs = docs.filter(d => !off.has(d.id));
  }
  if (date && time) {
    if (!isTime(time)) throw new HttpError(400, 'Invalid time.');
    docs = docs.filter(d => works(d, date, +time.slice(0, 2)));
    if (docs.length) {
      const rows = await q(`SELECT COALESCE(doctor_id, pref_doctor_id) AS did, COUNT(*) AS n FROM appointments
        WHERE appt_date = ? AND appt_time = ? AND status NOT IN ('cancelled','no_show') AND id <> ? AND COALESCE(doctor_id, pref_doctor_id) IN (?)
        GROUP BY COALESCE(doctor_id, pref_doctor_id)`, [date, time, except, docs.map(d => d.id)]);
      const used = Object.fromEntries(rows.map(r => [r.did, r.n]));
      docs = docs.filter(d => (used[d.id] || 0) < CAP);
    }
  }
  res.json(docs);
}));

// Public live queue. Patients' names are shortened to a first name; only admins see full names.
router.get('/queue', wrap(async (req, res) => {
  const rows = await todaysQueue();
  res.json(req.user && req.user.role === 'admin' ? rows : firstNames(rows));
}));

// Real-time stream (Server-Sent Events): the browser keeps this open and receives an event whenever a queue changes.
router.get('/queue/stream', wrap(async (req, res) => {
  if (process.env.VERCEL) return res.status(204).end();   // Vercel serverless cannot hold persistent SSE streams; frontend falls back to auto-refresh polling
  const ok = await realtime.addClient(req, res);
  if (!ok) res.status(503).json({ error: 'Too many live connections right now. Please try again shortly.' });
}));

// Track one appointment by its reference code (no contact details are returned).
router.get('/track/:ref', trackLimiter, wrap(async (req, res) => {
  const ref = String(req.params.ref).trim().toUpperCase().slice(0, 12);
  const [a] = await q(`SELECT a.id AS _id, a.ref, a.status, a.queue_no, a.cancelled_by, (a.checked_in_at IS NOT NULL) AS checked_in, a.doctor_id, a.appt_date AS \`date\`, a.appt_time AS \`time\`, p.name AS dept, d.name AS doctor, d.room
    FROM appointments a JOIN departments p ON p.id = a.dept_id LEFT JOIN doctors d ON d.id = a.doctor_id WHERE a.ref = ?`, [ref]);
  if (!a) throw new HttpError(404, 'No appointment with that reference code.');
  a.ahead = null;
  if (a.doctor_id && ['confirmed', 'serving'].includes(a.status)) {
    const [r] = await q("SELECT COUNT(*) AS n FROM appointments WHERE doctor_id = ? AND appt_date = ? AND (appt_time < ? OR (appt_time = ? AND queue_no < ?)) AND status IN ('confirmed','serving')", [a.doctor_id, a.date, a.time, a.time, a.queue_no]);
    a.ahead = Number(r.n);
  }
  if (a.doctor_id && a.date === nowIn(tz).date && ['confirmed', 'serving'].includes(a.status)) {   // wait-time estimate for this appointment
    const me = (await todaysQueue([a.doctor_id])).find(r => r.id === a._id);
    if (me) Object.assign(a, { wait_minutes: me.wait_minutes, wait_low: me.wait_low, wait_high: me.wait_high, est_at: me.est_at });
  }
  delete a.doctor_id; delete a._id;
  res.json(a);
}));

// Doctors on leave today (shown as a banner on the live queue page).
router.get('/leave/today', wrap(async (req, res) => {
  res.json(await q(`SELECT l.doctor_id, d.name AS doctor, d.dept_id, p.name AS dept, l.reason FROM doctor_leave l
    JOIN doctors d ON d.id = l.doctor_id JOIN departments p ON p.id = d.dept_id WHERE l.leave_date = ?`, [nowIn(tz).date]));
}));

// Beds are public (in-patient facility viewer); equipment is for doctors and admins only.
router.get('/facilities', wrap(async (req, res) => {
  const staff = req.user && ['doctor', 'admin'].includes(req.user.role);
  res.json(await q(`SELECT id, kind, group_name, name, status FROM facilities ${staff ? '' : "WHERE kind = 'bed'"} ORDER BY kind, group_name, id`));
}));

// Anonymous booking history (date + hour only) used by the TensorFlow.js peak-hour model in the browser.
router.get('/forecast/history', wrap(async (req, res) => {
  const today = nowIn(tz).date;
  res.json(await q("SELECT appt_date AS `date`, appt_time AS `time` FROM appointments WHERE status <> 'cancelled' AND appt_date < ? AND appt_date >= DATE_SUB(?, INTERVAL 120 DAY)", [today, today]));
}));

module.exports = router;
