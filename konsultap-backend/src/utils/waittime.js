/* Wait-time estimates for the live queue. Pure functions (no database), so they are easy to test.

   How a patient's wait is estimated
   1. Typical visit length of the doctor = average of that doctor's recent visits (last 30 days, from started_at to completed_at).
      Odd values are limited (1 to 120 min; the fastest and slowest 10% are ignored when there is enough data).
      With few visits recorded, the average is blended toward the department average (or a default) so one odd visit cannot skew it.
   2. Time until the doctor is free = what is left of the patient being served now (average minus time already spent;
      if the visit is running long, a short remaining time is assumed).
   3. Each patient ahead adds one typical visit plus a short hand-over gap.
   4. Nobody is called before their appointment time, so the estimate is never earlier than that.
   5. The uncertainty grows with every patient ahead (square root of the summed variances), giving a likely range. */

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const CFG = {
  defaultMinutes: num(process.env.DEFAULT_CONSULT_MINUTES, 15),   // used when a doctor and department have no recorded visits yet
  transition: num(process.env.QUEUE_TRANSITION_MINUTES, 2),       // gap between finishing one patient and starting the next
  shrink: 5,                                                       // "k": how many visits it takes to trust a doctor's own average
  minRemaining: 2, overrunFraction: 0.3, minMinutes: 1, maxMinutes: 120
};

/** Mean and standard deviation of visit lengths (minutes), with outliers limited. */
function summarize(list) {
  let a = list.map(Number).filter(Number.isFinite).map(x => Math.min(CFG.maxMinutes, Math.max(CFG.minMinutes, x))).sort((x, y) => x - y);
  if (a.length >= 10) { const cut = Math.floor(a.length * 0.1); a = a.slice(cut, a.length - cut); }
  const n = a.length;
  if (!n) return { n: 0, mean: 0, sd: 0 };
  const mean = a.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, sd };
}

/** rows: [{ doctor_id, dept_id, mins }] -> summaries per doctor, per department and overall. */
function buildStats(rows) {
  const g = (key) => { const m = {}; rows.forEach(r => (m[r[key]] ||= []).push(r.mins)); return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, summarize(v)])); };
  return { byDoctor: g('doctor_id'), byDept: g('dept_id'), all: summarize(rows.map(r => r.mins)) };
}

/** Typical visit length for one doctor: their own average, blended toward the department (or default) average when data is thin. */
function minutesFor(stats, doctorId, deptId) {
  const d = (stats && stats.byDoctor && stats.byDoctor[doctorId]) || { n: 0, mean: 0, sd: 0 };
  const dep = (stats && stats.byDept && stats.byDept[deptId]) || { n: 0, mean: 0 };
  const prior = dep.n >= 5 ? dep.mean : CFG.defaultMinutes;
  const avg = d.n ? (d.n * d.mean + CFG.shrink * prior) / (d.n + CFG.shrink) : prior;
  const sd = d.n >= 5 && d.sd > 0 ? d.sd : 0.4 * avg;
  return { avg, sd, n: d.n, basis: d.n >= 5 ? 'doctor' : dep.n >= 5 ? 'department' : 'default' };
}

/**
 * Adds estimates to today's queue rows (mutates and returns them).
 * rows: [{ doctor_id, dept_id, status: 'serving'|'confirmed', time: 'HH:00', queue_no, serving_secs }]
 * now:  { minuteOfDay, ts }  (hospital clock; ts = epoch ms)
 * Adds: wait_minutes, wait_low, wait_high, ahead, finish_minutes, avg_minutes, estimate_basis, est_at
 */
function attachEstimates(rows, stats, now) {
  const byDoc = new Map();
  for (const r of rows) { if (!byDoc.has(r.doctor_id)) byDoc.set(r.doctor_id, []); byDoc.get(r.doctor_id).push(r); }
  for (const list of byDoc.values()) {
    const { avg, sd, basis } = minutesFor(stats, list[0].doctor_id, list[0].dept_id);
    list.sort((a, b) => (a.status === 'serving' ? -1 : 0) - (b.status === 'serving' ? -1 : 0) || String(a.time).localeCompare(String(b.time)) || a.queue_no - b.queue_no);
    let free = 0, varSum = 0, ahead = 0;     // free = minutes from now until the doctor can start the next patient
    for (const r of list) {
      r.avg_minutes = Math.round(avg * 10) / 10; r.estimate_basis = basis; r.est_at = now.ts;
      if (r.status === 'serving') {
        const spent = (Number(r.serving_secs) || 0) / 60;
        free = Math.max(CFG.minRemaining, spent < avg ? avg - spent : CFG.overrunFraction * avg);
        varSum = sd * sd;
        Object.assign(r, { wait_minutes: 0, wait_low: 0, wait_high: 0, ahead: 0, finish_minutes: Math.round(free) });
        continue;
      }
      const untilAppt = Math.max(0, Number(String(r.time).slice(0, 2)) * 60 + Number(String(r.time).slice(3, 5) || 0) - now.minuteOfDay);   // never called before the appointment time
      const start = Math.max(free, untilAppt);
      const spread = untilAppt > free ? 3 : Math.max(2, 1.28 * Math.sqrt(varSum));                                                             // about an 80% range
      Object.assign(r, { wait_minutes: Math.round(start), wait_low: Math.max(0, Math.round(start - spread)), wait_high: Math.round(start + spread), ahead, finish_minutes: Math.round(start + avg) });
      free = start + avg + CFG.transition; varSum += sd * sd; ahead++;
    }
  }
  return rows;
}

module.exports = { CFG, summarize, buildStats, minutesFor, attachEstimates };
