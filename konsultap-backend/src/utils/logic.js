/* Pure helpers (no database), so they are easy to test: npm run test:logic */
const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const CAP = 3; // max patients one doctor accepts per hour

const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const isTime = s => typeof s === 'string' && /^(0[7-9]|1[0-6]):00$/.test(s);
const weekday = d => (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
const daysOf = d => Array.isArray(d.days) ? d.days : String(d.days).split(',').map(Number);

/** Does this doctor work on that date at that hour? (shift: am = before 12, pm = 12 and later, full = all day) */
const works = (doc, date, hour) => {
  if (!daysOf(doc).includes(weekday(date))) return false;
  if (doc.start_hour != null && doc.end_hour != null) return hour >= doc.start_hour && hour < doc.end_hour;   // custom hours set by the admin
  return doc.shift === 'full' || (doc.shift === 'am' ? hour < 12 : hour >= 12);
};

/** Current date (YYYY-MM-DD) and hour in the hospital's time zone. */
function nowIn(tz) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const g = t => p.find(x => x.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: +g('hour'), minute: +g('minute') };
}

const fmtT = t => { const h = +t.slice(0, 2); return (h % 12 || 12) + ':00 ' + (h < 12 ? 'AM' : 'PM'); };
const fmtD = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

/** The confirmation letter. qn = queue number (0 for the first "booking received" letter). */
const letter = (a, doc, deptName, qn) => `Dear ${a.patient_name},

${qn ? 'Your doctor and queue number are now CONFIRMED.' : 'Thank you for booking with KonsulTap. Your appointment booking has been received and recorded.'} Here are your details:

Reference code: ${a.ref}
Date: ${fmtD(a.date)}
Time: ${fmtT(a.time)}
Department: ${deptName}
Doctor: ${doc.name} (${doc.room})${qn ? '\nQueue number: ' + qn : ''}

${qn ? 'Please arrive 15 minutes early and follow your place in line on the KonsulTap live queue.' : 'The hospital admin will confirm your doctor and queue number by email.'}
Keep your reference code. You need it to track your queue.

Batangas Medical Center
Department of Health, Republic of the Philippines`;

/** Whole hours from `now` until the slot starts (negative if it already started). */
const hoursUntil = (date, time, now) => Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(now.date + 'T00:00:00Z')) / 36e5) + (+time.slice(0, 2) - now.hour);

module.exports = { hoursUntil, HOURS, CAP, isDate, isTime, weekday, works, nowIn, fmtT, fmtD, letter };
