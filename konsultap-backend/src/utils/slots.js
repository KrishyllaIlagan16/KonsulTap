/* Scheduling rules shared by booking, rescheduling, confirming, doctor leave and doctor management. */
const { q, tx } = require('../config/db');
const { HttpError } = require('./http');
const { CAP, works, fmtD, fmtT } = require('./logic');
const { sendMail } = require('./mailer');
const { notifyQueue } = require('./realtime');

const INACTIVE = "('cancelled','no_show')";

/** Throws unless doctor `doc` can take one more patient on `date` at `time` (inside the caller's transaction connection `c`). */
async function assertSlotOpen(c, doc, date, time, exceptId = 0) {
  if (!works(doc, date, +time.slice(0, 2))) throw new HttpError(409, 'That doctor does not work at that time. Please choose another.');
  const [[lv]] = await c.query('SELECT id FROM doctor_leave WHERE doctor_id = ? AND leave_date = ?', [doc.id, date]);
  if (lv) throw new HttpError(409, 'That doctor is on leave that day. Please choose another.');
  const [[cnt]] = await c.query(`SELECT COUNT(*) AS n FROM appointments WHERE appt_date = ? AND appt_time = ? AND status NOT IN ${INACTIVE} AND id <> ? AND COALESCE(doctor_id, pref_doctor_id) = ?`, [date, time, exceptId, doc.id]);
  if (cnt.n >= CAP) throw new HttpError(409, 'That doctor is no longer available at that time. Please choose another.');
}

const onLeaveSet = async date => new Set((await q('SELECT doctor_id FROM doctor_leave WHERE leave_date = ?', [date])).map(r => r.doctor_id));

/**
 * A doctor cannot see these appointments any more (leave, new schedule, deactivated): move each patient to a free colleague of the
 * same department at the same time, otherwise send them back to "pending" and email them. reason: 'leave' | 'schedule' | 'inactive'.
 */
async function reassignAppts(doc, appts, reason) {
  const [dept] = await q('SELECT name FROM departments WHERE id = ?', [doc.dept_id]);
  const peers = await q('SELECT * FROM doctors WHERE dept_id = ? AND on_duty = 1 AND id <> ? ORDER BY id', [doc.dept_id, doc.id]);
  const why = a => reason === 'leave' ? `${doc.name} is unavailable on ${fmtD(a.appt_date)}` : reason === 'schedule' ? `The clinic schedule of ${doc.name} has changed` : `${doc.name} is no longer available`;
  let moved = 0, unassigned = 0;
  const touched = new Set([doc.id]);
  for (const a of appts) {
    let to = null;
    for (const p of peers) {
      try {
        await tx(async c => {
          await c.query('SELECT id FROM doctors WHERE id = ? FOR UPDATE', [p.id]);
          await assertSlotOpen(c, p, a.appt_date, a.appt_time, a.id);
          if (a.status === 'confirmed') {
            const [[nx]] = await c.query("SELECT COALESCE(MAX(queue_no), 0) + 1 AS n FROM appointments WHERE doctor_id = ? AND appt_date = ? AND status IN ('confirmed','serving','done')", [p.id, a.appt_date]);
            await c.query('UPDATE appointments SET doctor_id = ?, pref_doctor_id = ?, queue_no = ?, checked_in_at = NULL WHERE id = ?', [p.id, p.id, nx.n, a.id]);
          } else await c.query('UPDATE appointments SET pref_doctor_id = ? WHERE id = ?', [p.id, a.id]);
        });
        to = p; break;
      } catch (e) { if (!(e instanceof HttpError)) throw e; }
    }
    const when = `${fmtD(a.appt_date)} at ${fmtT(a.appt_time)}`;
    if (to) {
      moved++; touched.add(to.id);
      await sendMail({ to: a.email, subject: `KonsulTap: your doctor has changed (${a.ref})`, body: `Dear ${a.patient_name},\n\n${why(a)}. Your appointment (${a.ref}, ${when}) has been moved to ${to.name} (${to.room}) in ${dept.name} at the same time. ${a.status === 'confirmed' ? 'You have a new ticket number. Check the KonsulTap live queue on the day.' : 'The hospital will confirm it by email.'}\n\nWe are sorry for the inconvenience.\n\nBatangas Medical Center` });
    } else {
      unassigned++;
      await q("UPDATE appointments SET status = 'pending', doctor_id = NULL, pref_doctor_id = NULL, queue_no = NULL, checked_in_at = NULL WHERE id = ?", [a.id]);
      await sendMail({ to: a.email, subject: `KonsulTap: please reschedule (${a.ref})`, body: `Dear ${a.patient_name},\n\n${why(a)}, and no other ${dept.name} doctor is free on ${when}. Your appointment (${a.ref}) needs a new time. Please sign in to KonsulTap, cancel or reschedule it, and choose another slot.\n\nWe are sorry for the inconvenience.\n\nBatangas Medical Center` });
    }
  }
  notifyQueue([...touched], reason);
  return { total: appts.length, moved, unassigned };
}

/** One day of absence. */
async function reassignForLeave(docId, date) {
  const [doc] = await q('SELECT * FROM doctors WHERE id = ?', [docId]);
  const appts = await q("SELECT * FROM appointments WHERE appt_date = ? AND status IN ('pending','confirmed') AND COALESCE(doctor_id, pref_doctor_id) = ?", [date, docId]);
  return reassignAppts(doc, appts, 'leave');
}

module.exports = { assertSlotOpen, onLeaveSet, reassignAppts, reassignForLeave, INACTIVE };
