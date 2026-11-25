/* Loads recent visit lengths from the database (cached for 5 minutes) and turns them into per-doctor statistics. */
const { q } = require('../config/db');
const { tz } = require('../config/env');
const { nowIn } = require('./logic');
const { buildStats } = require('./waittime');

let cache = null, at = 0;
const invalidate = () => { cache = null; };

async function getStats() {
  if (cache && Date.now() - at < 5 * 60e3) return cache;
  const rows = await q(`SELECT doctor_id, dept_id, TIMESTAMPDIFF(SECOND, started_at, completed_at) / 60 AS mins FROM appointments
    WHERE status = 'done' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND completed_at > started_at AND appt_date >= DATE_SUB(?, INTERVAL 30 DAY)`, [nowIn(tz).date]);
  cache = buildStats(rows.map(r => ({ ...r, mins: Number(r.mins) }))); at = Date.now();
  return cache;
}
module.exports = { getStats, invalidate };
