/* Validates a doctor's weekly schedule coming from the admin screen. Pure (no database).
   days: weekdays Mon=0 ... Sun=6.   Hours: either a preset shift (am / pm / full) or custom hours start_hour..end_hour
   (bookable hours are 7 to 17; end is exclusive, so 8 to 12 means patients can be booked at 8, 9, 10 and 11). */
const { HttpError } = require('./http');

const MIN_H = 7, MAX_H = 17;

function parseSchedule(b = {}, base = {}) {
  const rawDays = b.days !== undefined ? b.days : base.days;
  const list = Array.isArray(rawDays) ? rawDays : String(rawDays ?? '').split(',').filter(x => x !== '');
  const days = [...new Set(list.map(Number))];
  if (!days.length || days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw new HttpError(400, 'Choose at least one working day.');
  days.sort((a, c) => a - c);

  let start = base.start_hour ?? null, end = base.end_hour ?? null, shift = b.shift !== undefined ? b.shift : base.shift;
  if ('start_hour' in b || 'end_hour' in b) { start = b.start_hour === '' ? null : b.start_hour ?? null; end = b.end_hour === '' ? null : b.end_hour ?? null; }
  if (start != null || end != null) {
    start = Number(start); end = Number(end);
    if (![start, end].every(Number.isInteger) || start < MIN_H || end > MAX_H || start >= end) throw new HttpError(400, `Hours must be whole hours between ${MIN_H} AM and 5 PM, and the end must be after the start.`);
    shift = end <= 12 ? 'am' : start >= 12 ? 'pm' : 'full';        // keep the preset in step with the custom hours
  } else {
    start = end = null;
    if (!['am', 'pm', 'full'].includes(shift)) shift = 'full';
  }
  return { days: days.join(','), shift, start_hour: start, end_hour: end };
}
module.exports = { parseSchedule, MIN_H, MAX_H };
