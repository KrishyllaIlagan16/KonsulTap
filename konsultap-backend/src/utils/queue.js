/* Today's live queue: one place that builds it, used by GET /api/queue and by the real-time pushes. */
const { q } = require('../config/db');
const { tz } = require('../config/env');
const { nowIn } = require('./logic');
const { markNext, firstNames } = require('./queue.pure');
const { attachEstimates } = require('./waittime');
const { getStats } = require('./waitStats');

const COLS = `a.id, a.status, a.queue_no, a.doctor_id, a.patient_name, a.appt_time AS \`time\`, a.dept_id,
  (a.checked_in_at IS NOT NULL) AS checked_in, IF(a.status = 'serving', TIMESTAMPDIFF(SECOND, a.started_at, NOW()), NULL) AS serving_secs, d.name AS doctor, d.room, p.name AS dept, p.icon`;

/** Confirmed + now-serving patients for today, ordered per doctor by appointment time. Optionally only some doctors. */
async function todaysQueue(doctorIds = null) {
  const params = [nowIn(tz).date];
  let extra = '';
  if (doctorIds && doctorIds.length) { extra = ' AND a.doctor_id IN (?)'; params.push(doctorIds); }
  const rows = await q(`SELECT ${COLS} FROM appointments a JOIN doctors d ON d.id = a.doctor_id JOIN departments p ON p.id = a.dept_id
    WHERE a.appt_date = ? AND a.status IN ('confirmed','serving')${extra} ORDER BY a.doctor_id, a.appt_time, a.queue_no`, params);
  const n = nowIn(tz);
  return attachEstimates(markNext(rows), await getStats(), { minuteOfDay: n.hour * 60 + n.minute, ts: Date.now() });   // wait-time estimates
}

module.exports = { todaysQueue, markNext, firstNames };
