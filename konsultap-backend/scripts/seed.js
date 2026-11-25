// Fills the database with demo data:  npm run seed        (add --force to wipe and re-seed)
// Creates 12 departments, 72 doctors (6 each), accounts, facilities, patients, 60 days of booking history and today's demo queue.
const bcrypt = require('bcryptjs');
const { pool, q } = require('../src/config/db');
const { tz } = require('../src/config/env');
const { nowIn } = require('../src/utils/logic');

const DEPTS = [['Anesthesia', 'anesthesia'], ['Surgery', 'surgery'], ['Psychiatry', 'psychiatry'], ['Radiology', 'radiology'], ['Urology', 'urology'], ['Internal Medicine', 'internal-medicine'],
  ['Laboratory Medicine', 'laboratory-medicine'], ['OB-GYN', 'ob-gyn'], ['Ophthalmology', 'ophthalmology'], ['Pediatrics', 'pediatrics'], ['Orthopedics', 'orthopedics'], ['ENT', 'ent']];
const SURN = ['Reyes', 'Santos', 'Dela Cruz', 'Garcia', 'Mendoza', 'Bautista', 'Aquino', 'Villanueva', 'Castillo', 'Ramos', 'Torres', 'Navarro', 'Flores', 'Macaraig', 'Lopez', 'Pascual', 'Manalo', 'Salazar', 'Magsino', 'Dimaano', 'Ilagan', 'Atienza', 'Perez', 'Cruz', 'Agoncillo', 'Alvarez', 'Banaag', 'Caraan', 'Dizon', 'Evangelista', 'Fernandez', 'Gonzales', 'Hernandez', 'Isip', 'Javier', 'Katigbak'];
const FIRST = ['Maria', 'Jose', 'Ana', 'Paolo', 'Liza', 'Carlo', 'Grace', 'Miguel', 'Rica', 'Noel', 'Bea', 'Luis'];
const SCHED = [['0,1,2,3,4,5', 'full'], ['0,1,2,3,4', 'full'], ['0,2,4', 'am'], ['1,3,5', 'pm'], ['0,1,2,3,4', 'am'], ['0,1,2,3,4', 'pm']];

const MEAN_MIN = [25, 30, 35, 15, 20, 18, 10, 22, 15, 14, 20, 15]; // typical visit minutes per department (demo)
let s = 314; // fixed seed: same demo data every time
const rnd = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const gauss = (m, sd) => m + sd * Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const pick = (arr, w) => { let r = rnd() * w.reduce((x, y) => x + y), i = 0; while ((r -= w[i]) > 0) i++; return arr[i]; };
const insert = async (table, cols, rows) => { for (let i = 0; i < rows.length; i += 500) await pool.query(`INSERT INTO ${table} (${cols}) VALUES ?`, [rows.slice(i, i + 500)]); };

(async () => {
  try {
    const [{ n }] = await q('SELECT COUNT(*) AS n FROM departments');
    if (n > 0 && !process.argv.includes('--force')) { console.log('Database already has data. Use "npm run seed -- --force" to wipe and re-seed.'); return; }
    for (const t of ['emails', 'audit_log', 'doctor_leave', 'password_resets', 'visit_revisions', 'vitals', 'medications', 'conditions', 'allergies', 'appointments', 'visits', 'patients', 'facilities', 'users', 'doctors', 'departments']) await pool.query(`TRUNCATE TABLE ${t}`);

    await insert('departments', 'id, name, icon', DEPTS.map(([n, slug], i) => [i + 1, n, slug + '.png']));
    const docs = [];
    DEPTS.forEach((_, i) => { for (let k = 0; k < 6; k++) { const x = i * 6 + k; docs.push([x + 1, `Dr. ${FIRST[(x * 7 + Math.floor(x / 36) * 5) % 12]} ${SURN[x % 36]}`, i + 1, `Clinic ${i + 1}${'ABCDEF'[k]}`, SCHED[k][0], SCHED[k][1]]); } });
    await insert('doctors', 'id, name, dept_id, room, days, shift', docs);   // explicit ids: doctor N is always "D00N"

    const hAdmin = bcrypt.hashSync('admin123', 10), hDoc = bcrypt.hashSync('doctor123', 10), hPat = bcrypt.hashSync('patient123', 10);
    await insert('users', 'role, username, name, email, password_hash, ref_id', [
      ['admin', 'admin', 'Hospital Administrator', process.env.ADMIN_EMAIL || null, hAdmin, null],
      ...docs.map(d => ['doctor', 'd' + String(d[0]).padStart(3, '0'), d[1], null, hDoc, d[0]]),
      ['patient', 'patient@demo.com', 'Demo Patient', 'patient@demo.com', hPat, null]]);

    const fac = [];
    [['ICU', 6], ['Medical Ward', 12], ['Surgical Ward', 10], ['Pediatric Ward', 8], ['OB Ward', 8], ['Private Rooms', 6]].forEach(([w, n]) => { for (let b = 1; b <= n; b++) fac.push(['bed', w, `${w} Bed ${b}`, 'available']); });
    [['Ventilator', 6], ['ECG Machine', 4], ['Portable X-ray', 2], ['Ultrasound', 3], ['Infusion Pump', 10], ['Defibrillator', 3]].forEach(([e, n]) => { for (let b = 1; b <= n; b++) fac.push(['equipment', e, `${e} #${b}`, 'available']); });
    await insert('facilities', 'kind, group_name, name, status', fac);

    const names = ['Juan Dela Peña', 'Rosa Macalintal', 'Eduardo Silva', 'Carmela Ocampo', 'Ben Alcantara', 'Teresita Lim', 'Ramon Padilla', 'Joy Hernandez', 'Mario Quiambao', 'Nena Zamora'];
    await insert('patients', 'name, birthdate, sex, contact', names.map(n => [n, `${ri(1950, 2015)}-0${ri(1, 9)}-1${ri(0, 9)}`, pick(['M', 'F'], [1, 1]), '09' + ri(100000000, 999999999)]));
    const base = new Date(nowIn(tz).date + 'T00:00:00Z'), isoOf = back => new Date(base.getTime() - back * 864e5).toISOString().slice(0, 10);
    const visits = [];
    for (let p = 1; p <= 10; p++) for (let k = ri(1, 3); k > 0; k--) visits.push([p, ri(1, 72), isoOf(ri(20, 400)), pick(['Hypertension, controlled', 'Acute bronchitis', 'Type 2 diabetes follow-up', 'Mild gastritis', 'Lumbar strain'], [1, 1, 1, 1, 1]), 'Advised rest, hydration and a 2-week follow-up. (demo record)']);
    await insert('visits', 'patient_id, doctor_id, visit_date, diagnosis, notes', visits);

    // demo medical records (fake) so the patient chart has something to show
    await insert('allergies', 'patient_id, substance, reaction, severity, recorded_by', [[1, 'Penicillin', 'Rash and swelling', 'severe', 31], [1, 'Shellfish', 'Hives', 'moderate', 31], [3, 'Ibuprofen', 'Stomach upset', 'mild', 31], [5, 'Sulfa drugs', 'Difficulty breathing', 'severe', 31]]);
    await insert('conditions', 'patient_id, name, status, since_date, recorded_by', [[1, 'Hypertension', 'chronic', '2019-03-01', 31], [1, 'Asthma', 'chronic', '2008-06-15', 31], [3, 'Type 2 diabetes', 'chronic', '2021-01-10', 31], [4, 'Acute bronchitis', 'resolved', '2026-09-02', 31], [5, 'Migraine', 'active', '2023-05-20', 31]]);
    await insert('medications', 'patient_id, name, dose, frequency, start_date, end_date, recorded_by', [[1, 'Amlodipine', '5 mg', 'Once daily', '2019-03-05', null, 31], [1, 'Salbutamol inhaler', '2 puffs', 'As needed', '2008-06-20', null, 31], [3, 'Metformin', '500 mg', 'Twice daily', '2021-01-12', null, 31], [4, 'Amoxicillin', '500 mg', 'Three times daily', '2026-09-02', '2026-09-09', 31]]);
    await insert('vitals', 'patient_id, recorded_by, recorded_at, bp_sys, bp_dia, heart_rate, resp_rate, temp_c, spo2, weight_kg, height_cm, bmi', [
      [1, 31, `${isoOf(30)} 09:10:00`, 150, 94, 82, 16, 36.8, 97, 78.0, 165.0, 28.7], [1, 31, `${isoOf(3)} 09:20:00`, 138, 88, 76, 16, 36.7, 98, 77.5, 165.0, 28.5],
      [3, 31, `${isoOf(10)} 10:05:00`, 128, 82, 88, 18, 36.6, 96, 91.0, 170.0, 31.5], [5, 31, `${isoOf(5)} 11:00:00`, 118, 76, 68, 14, 38.4, 97, 60.0, 160.0, 23.4]]);
    // 60 days of fake booking history so the TensorFlow.js model has something to learn from
    const w = { 7: 3, 8: 6, 9: 10, 10: 11, 11: 8, 12: 3, 13: 7, 14: 8, 15: 5, 16: 3 }, hist = [];
    let n2 = 0;
    for (let back = 60; back >= 1; back--) {
      const wd = (new Date(isoOf(back) + 'T00:00:00Z').getUTCDay() + 6) % 7, f = wd >= 5 ? 0.4 : wd === 0 ? 1.25 : 1;
      for (const [h, wt] of Object.entries(w)) for (let c = Math.max(0, Math.trunc(gauss(wt * f * 1.6, 1.5))); c > 0; c--) {
        const dept = ri(1, 12); n2++;
        const dur = Math.max(5, Math.round(gauss(MEAN_MIN[dept - 1], MEAN_MIN[dept - 1] * 0.3))), t0 = Date.parse(`${isoOf(back)}T${String(h).padStart(2, '0')}:00:00Z`) + ri(0, 10) * 60000;
        const stamp = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
        hist.push(['H' + n2, 'Demo Patient', 'demo@example.com', dept, dept * 6 - ri(0, 5), isoOf(back), String(h).padStart(2, '0') + ':00', 'History (demo)', 'done', stamp(t0), stamp(t0 + dur * 60000)]);
      }
    }
    await insert('appointments', 'ref, patient_name, email, dept_id, doctor_id, appt_date, appt_time, reason, status, started_at, completed_at', hist);

    const today = nowIn(tz).date;
    await insert('appointments', 'ref, patient_name, email, dept_id, doctor_id, appt_date, appt_time, reason, status, queue_no', [
      ['KT-D000', 'Anna Rivera', 'demo@example.com', 6, 31, today, '08:00', 'Consultation (demo)', 'serving', 1],
      ['KT-D001', 'Luis Bondoc', 'demo@example.com', 6, 31, today, '08:00', 'Consultation (demo)', 'confirmed', 2],
      ['KT-D002', 'Mae Tolentino', 'demo@example.com', 6, 31, today, '09:00', 'Consultation (demo)', 'confirmed', 3],
      ['KT-D003', 'Rey Abad', 'demo@example.com', 2, 7, today, '08:00', 'Consultation (demo)', 'serving', 1],
      ['KT-D004', 'Joan Sison', 'demo@example.com', 2, 7, today, '09:00', 'Consultation (demo)', 'confirmed', 2],
      ['KT-D005', 'Ed Cabral', 'demo@example.com', 4, 19, today, '09:00', 'Consultation (demo)', 'confirmed', 1],
      ['KT-D006', 'Pia Lazaro', 'demo@example.com', 4, 19, today, '10:00', 'Consultation (demo)', 'confirmed', 2],
      ['KT-D007', 'Noel Dizon', 'demo@example.com', 10, 55, today, '10:00', 'Consultation (demo)', 'confirmed', 1]]);
    await insert('appointments', 'ref, patient_name, email, dept_id, pref_doctor_id, appt_date, appt_time, reason, status', [
      ['KT-P000', 'Grace Mercado', 'demo@example.com', 6, 32, today, '11:00', 'Check-up (demo)', 'pending'],
      ['KT-P001', 'Tony Pineda', 'demo@example.com', 10, 56, today, '11:00', 'Check-up (demo)', 'pending']]);

    await pool.query("UPDATE appointments SET started_at = DATE_SUB(NOW(), INTERVAL 6 MINUTE) WHERE ref IN ('KT-D000','KT-D003')");   // demo patients being served started 6 minutes ago
    console.log('Seed finished. Logins: admin/admin123 | doctor D031/doctor123 | patient patient@demo.com/patient123');
  } catch (e) {
    console.error('Seed failed:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
