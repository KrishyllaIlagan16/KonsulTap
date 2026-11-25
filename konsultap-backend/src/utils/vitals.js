/* Vital signs: validation, BMI, and "outside typical range" highlighting. Pure functions (no database).
   The highlighting uses typical ADULT reference ranges and is only a visual aid for the doctor, never a diagnosis.
   It is not applied to children or when the birthdate is unknown. */
const { HttpError } = require('./http');

const FIELDS = {   // key: [min, max, label, mustBeWholeNumber]
  bp_sys: [50, 260, 'Systolic blood pressure', true], bp_dia: [30, 160, 'Diastolic blood pressure', true], heart_rate: [20, 250, 'Heart rate', true],
  resp_rate: [4, 80, 'Respiratory rate', true], temp_c: [30, 45, 'Temperature', false], spo2: [50, 100, 'Oxygen saturation', true],
  weight_kg: [0.3, 400, 'Weight', false], height_cm: [30, 250, 'Height', false]
};

/** Returns clean numeric values (null when not measured) plus BMI. Throws HttpError(400) for impossible values. */
function validateVitals(b = {}) {
  const v = {};
  for (const [k, [min, max, label, whole]] of Object.entries(FIELDS)) {
    const raw = b[k];
    if (raw === undefined || raw === null || raw === '') { v[k] = null; continue; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label} must be between ${min} and ${max}.`);
    if (whole && !Number.isInteger(n)) throw new HttpError(400, `${label} must be a whole number.`);
    v[k] = whole ? n : Math.round(n * 10) / 10;
  }
  if (Object.values(v).every(x => x === null)) throw new HttpError(400, 'Enter at least one measurement.');
  if ((v.bp_sys == null) !== (v.bp_dia == null)) throw new HttpError(400, 'Enter both blood pressure numbers (top and bottom).');
  if (v.bp_sys != null && v.bp_sys <= v.bp_dia) throw new HttpError(400, 'The top blood pressure number must be higher than the bottom one.');
  v.bmi = v.weight_kg != null && v.height_cm != null ? Math.round(v.weight_kg / ((v.height_cm / 100) ** 2) * 10) / 10 : null;
  return v;
}

const RANK = { ok: 0, warn: 1, crit: 2 };
const worst = (...l) => l.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'ok');
/** single value: crit outside [critLow, critHigh], warn outside [warnLow, warnHigh] (bounds themselves are fine) */
const level = (x, critLow, warnLow, warnHigh, critHigh) => x == null ? null : (x < critLow || x > critHigh) ? 'crit' : (x < warnLow || x > warnHigh) ? 'warn' : 'ok';

/** { bp, heart_rate, resp_rate, temp_c, spo2 } -> 'ok' | 'warn' | 'crit'. Empty for children / unknown age. */
function flagsFor(v, age) {
  if (age == null || age < 18) return {};
  const f = {};
  if (v.bp_sys != null) f.bp = worst(
    v.bp_sys >= 180 || v.bp_sys < 80 || v.bp_dia >= 120 ? 'crit' : 'ok',
    v.bp_sys >= 140 || v.bp_sys < 90 || v.bp_dia >= 90 || v.bp_dia < 60 ? 'warn' : 'ok');
  const add = (k, l) => { if (l) f[k] = l; };
  add('heart_rate', level(v.heart_rate, 40, 60, 100, 130));
  add('resp_rate', level(v.resp_rate, 8, 12, 20, 30));
  add('temp_c', level(v.temp_c, 35, 36, 37.9, 39.4));      // 38.0 and above = fever; 39.5 and above = high fever
  add('spo2', level(v.spo2, 90, 95, 100, 100));
  return f;
}
const bmiCategory = (bmi, age) => bmi == null || age == null || age < 18 ? null : bmi < 18.5 ? 'underweight' : bmi < 25 ? 'normal' : bmi < 30 ? 'overweight' : 'obese';

/** Age in whole years on `today` (YYYY-MM-DD), or null when the birthdate is missing. */
function ageYears(birthdate, today) {
  if (!birthdate || !today) return null;
  const [by, bm, bd] = String(birthdate).slice(0, 10).split('-').map(Number), [ty, tm, td] = today.split('-').map(Number);
  if (!by) return null;
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}
module.exports = { validateVitals, flagsFor, bmiCategory, ageYears, FIELDS };
