/* Housekeeping that runs every 5 minutes:
   1. unconfirmed bookings that waited too long (or whose time already passed) are cancelled and the patient is emailed,
   2. yesterday's leftovers are closed: confirmed -> no_show, serving -> done, so old tickets never clog the queue. */
const { q } = require('../config/db');
const { tz, pendingExpireHours } = require('../config/env');
const { nowIn, letter } = require('../utils/logic');
const { sendMail } = require('../utils/mailer');

async function run() {
  const now = nowIn(tz), hh = String(now.hour).padStart(2, '0') + ':00';
  const stale = await q(`SELECT id, ref, patient_name, email, appt_date, appt_time FROM appointments WHERE status = 'pending'
    AND (appt_date < ? OR (appt_date = ? AND appt_time < ?) OR created_at < DATE_SUB(NOW(), INTERVAL ? HOUR)) LIMIT 100`, [now.date, now.date, hh, pendingExpireHours]);
  if (stale.length) {
    await q("UPDATE appointments SET status = 'cancelled', cancelled_by = 'system' WHERE id IN (?) AND status = 'pending'", [stale.map(a => a.id)]);
    for (const a of stale) await sendMail({ to: a.email, subject: `KonsulTap: booking not confirmed (${a.ref})`, body: `Dear ${a.patient_name},\n\nYour booking ${a.ref} for ${a.appt_date} at ${a.appt_time} was not confirmed in time and has been cancelled. Please sign in to KonsulTap and book a new time.\n\nBatangas Medical Center` });
  }
  await q('DELETE FROM password_resets WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)');   // old reset tokens
  await q("UPDATE appointments SET status = 'no_show', cancelled_by = 'system' WHERE appt_date < ? AND status = 'confirmed'", [now.date]);
  await q("UPDATE appointments SET status = 'done' WHERE appt_date < ? AND status = 'serving'", [now.date]);
}

function start() {
  const tick = () => run().catch(e => console.error('Housekeeping job failed:', e.message));
  tick(); setInterval(tick, 5 * 60e3);
}
module.exports = { start, run };
