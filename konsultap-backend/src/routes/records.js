/* Medical records (doctors only). Every view and every change is written to the audit log.
   Records are never deleted: a wrong entry is marked "entered in error" (hidden) and an amended visit note keeps its earlier versions. */
const router = require('express').Router();
const { q, tx } = require('../config/db');
const { tz } = require('../config/env');
const { requireRole } = require('../middleware/auth');
const { wrap, HttpError, clean } = require('../utils/http');
const { nowIn } = require('../utils/logic');
const { readFields } = require('../utils/recordFields');
const { validateVitals, flagsFor, bmiCategory, ageYears } = require('../utils/vitals');
const { audit } = require('../utils/audit');

const doctor = requireRole('doctor');
const today = () => nowIn(tz).date;
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const PATIENT = {
  name: { label: 'Name', max: 120, req: true }, birthdate: { label: 'Birthdate', date: true, notFuture: true }, sex: { label: 'Sex', enum: ['M', 'F'] },
  contact: { label: 'Contact number', max: 40 }, blood_type: { label: 'Blood type', enum: BLOOD }, address: { label: 'Address', max: 255 },
  emergency_name: { label: 'Emergency contact', max: 120 }, emergency_phone: { label: 'Emergency phone', max: 40 },
  family_history: { label: 'Family history', max: 4000 }, social_history: { label: 'Social history', max: 4000 }
};
const VISIT = {
  visit_date: { label: 'Visit date', date: true, notFuture: true }, chief_complaint: { label: 'Chief complaint', max: 255 },
  history: { label: 'History of present illness', max: 4000 }, examination: { label: 'Examination', max: 4000 },
  diagnosis: { label: 'Diagnosis', max: 255, req: true }, plan: { label: 'Plan / treatment', max: 4000 },
  follow_up_date: { label: 'Follow-up date', date: true }, notes: { label: 'Notes', max: 4000 }
};
const { visit_date: _omit, ...VISIT_EDIT } = VISIT;           // the date of a visit cannot be changed afterwards
const SUB = {
  allergies: { fields: { substance: { label: 'Substance', max: 120, req: true }, reaction: { label: 'Reaction', max: 255 }, severity: { label: 'Severity', enum: ['mild', 'moderate', 'severe'], req: true }, notes: { label: 'Notes', max: 500 } } },
  conditions: { fields: { name: { label: 'Condition', max: 160, req: true }, status: { label: 'Status', enum: ['active', 'chronic', 'resolved'], req: true }, since_date: { label: 'Since', date: true, notFuture: true }, notes: { label: 'Notes', max: 500 } } },
  medications: { fields: { name: { label: 'Medicine', max: 160, req: true }, dose: { label: 'Dose', max: 80 }, frequency: { label: 'Frequency', max: 80 }, start_date: { label: 'Start date', date: true, notFuture: true }, end_date: { label: 'Stop date', date: true }, notes: { label: 'Notes', max: 500 } } }
};
const VISIT_COLS = `v.id, v.patient_id, v.doctor_id, v.visit_date AS \`date\`, v.chief_complaint, v.history, v.examination, v.diagnosis, v.plan, v.follow_up_date, v.notes, v.amended_at, d.name AS doctor`;

const getPatient = async id => { const [p] = await q('SELECT * FROM patients WHERE id = ?', [id]); if (!p) throw new HttpError(404, 'Patient not found.'); return p; };
const shapeVital = (r, age) => { const v = { ...r }; ['temp_c', 'weight_kg', 'height_cm', 'bmi'].forEach(k => { if (v[k] != null) v[k] = Number(v[k]); }); v.flags = flagsFor(v, age); v.bmi_category = bmiCategory(v.bmi, age); return v; };

// ---------- patients ----------
router.get('/patients', doctor, wrap(async (req, res) => {
  const raw = String(req.query.q || '').trim().slice(0, 80);
  await audit(req, 'search_patients', 'patient', null, raw);
  const like = '%' + raw.replace(/[\\%_]/g, '\\$&') + '%';
  const rows = await q(`SELECT p.id, p.name, p.birthdate, p.sex, p.contact, p.blood_type,
      (SELECT COUNT(*) FROM allergies a WHERE a.patient_id = p.id AND a.severity = 'severe' AND a.entered_in_error = 0) AS severe_allergies
    FROM patients p WHERE p.name LIKE ? OR p.contact LIKE ? OR p.id = ? ORDER BY p.name LIMIT 30`, [like, like, /^\d+$/.test(raw) ? Number(raw) : 0]);
  res.json(rows.map(r => ({ ...r, age: ageYears(r.birthdate, today()) })));
}));

router.post('/patients', doctor, wrap(async (req, res) => {
  const b = req.body || {}, v = readFields(PATIENT, b, today());
  if (v.birthdate) {        // same name + birthdate = probably the same person: ask before creating a duplicate record
    const [dup] = await q('SELECT id, name FROM patients WHERE LOWER(name) = LOWER(?) AND birthdate = ? LIMIT 1', [v.name, v.birthdate]);
    if (dup && !b.confirm_duplicate) { const e = new HttpError(409, 'A patient with the same name and birthdate already exists. Open that record instead?'); e.extra = { requires_confirm: true, existing: dup }; throw e; }
  }
  const first = b.diagnosis ? readFields(VISIT, { ...b, visit_date: undefined }, today()) : null;     // optional first visit note
  const id = await tx(async c => {
    const cols = Object.keys(v);
    const [r] = await c.query(`INSERT INTO patients (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map(k => v[k]));
    if (first) await c.query('INSERT INTO visits (patient_id, doctor_id, visit_date, chief_complaint, history, examination, diagnosis, plan, follow_up_date, notes) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [r.insertId, req.user.ref_id, today(), first.chief_complaint, first.history, first.examination, first.diagnosis, first.plan, first.follow_up_date, first.notes]);
    return r.insertId;
  });
  await audit(req, 'create_patient', 'patient', id);
  res.status(201).json({ id });
}));

router.put('/patients/:id', doctor, wrap(async (req, res) => {
  const id = Number(req.params.id); await getPatient(id);
  const v = readFields(PATIENT, req.body || {}, today(), true);
  const cols = Object.keys(v);
  if (!cols.length) throw new HttpError(400, 'Nothing to update.');
  await q(`UPDATE patients SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ?`, [...cols.map(c => v[c]), id]);
  await audit(req, 'update_patient', 'patient', id, cols.join(','));       // which fields changed, never their values
  res.json({ ok: true });
}));

// The whole chart in one call: profile, allergies, conditions, medications, latest vitals, recent visits.
router.get('/patients/:id/chart', doctor, wrap(async (req, res) => {
  const id = Number(req.params.id), p = await getPatient(id), t = today(), age = ageYears(p.birthdate, t);
  const [allergies, conditions, meds, vitals, visits] = await Promise.all([
    q(`SELECT a.id, a.substance, a.reaction, a.severity, a.notes, a.recorded_by, d.name AS recorded_by_name, a.created_at FROM allergies a LEFT JOIN doctors d ON d.id = a.recorded_by
       WHERE a.patient_id = ? AND a.entered_in_error = 0 ORDER BY FIELD(a.severity, 'severe', 'moderate', 'mild'), a.id DESC`, [id]),
    q(`SELECT c.id, c.name, c.status, c.since_date, c.notes, c.recorded_by, d.name AS recorded_by_name FROM conditions c LEFT JOIN doctors d ON d.id = c.recorded_by
       WHERE c.patient_id = ? AND c.entered_in_error = 0 ORDER BY FIELD(c.status, 'active', 'chronic', 'resolved'), c.id DESC`, [id]),
    q(`SELECT m.id, m.name, m.dose, m.frequency, m.start_date, m.end_date, m.notes, m.recorded_by, d.name AS recorded_by_name FROM medications m LEFT JOIN doctors d ON d.id = m.recorded_by
       WHERE m.patient_id = ? AND m.entered_in_error = 0 ORDER BY m.start_date DESC, m.id DESC`, [id]),
    q(`SELECT v.*, d.name AS recorded_by_name FROM vitals v LEFT JOIN doctors d ON d.id = v.recorded_by WHERE v.patient_id = ? AND v.entered_in_error = 0 ORDER BY v.recorded_at DESC, v.id DESC LIMIT 10`, [id]),
    q(`SELECT ${VISIT_COLS} FROM visits v LEFT JOIN doctors d ON d.id = v.doctor_id WHERE v.patient_id = ? ORDER BY v.visit_date DESC, v.id DESC LIMIT 20`, [id])
  ]);
  await audit(req, 'view_record', 'patient', id);
  res.json({ patient: { ...p, age }, today: t, allergies, conditions,
    medications: meds.map(m => ({ ...m, active: !m.end_date || m.end_date >= t })),
    vitals: vitals.map(v => shapeVital(v, age)), visits });
}));

// ---------- allergies, conditions, medications (same rules for all three) ----------
for (const [name, spec] of Object.entries(SUB)) {
  const cross = v => { if (v.start_date && v.end_date && v.end_date < v.start_date) throw new HttpError(400, 'The stop date cannot be before the start date.'); };
  router.post(`/patients/:id/${name}`, doctor, wrap(async (req, res) => {
    const pid = Number(req.params.id); await getPatient(pid);
    const v = readFields(spec.fields, req.body, today()); cross(v);
    const cols = Object.keys(v);
    const r = await q(`INSERT INTO ${name} (patient_id, recorded_by, ${cols.join(',')}) VALUES (?, ?, ${cols.map(() => '?').join(',')})`, [pid, req.user.ref_id, ...cols.map(k => v[k])]);
    await audit(req, 'add_' + name, 'patient', pid, String(r.insertId));
    res.status(201).json({ id: r.insertId });
  }));
  router.put(`/patients/:id/${name}/:rid`, doctor, wrap(async (req, res) => {
    const pid = Number(req.params.id), rid = Number(req.params.rid);
    const v = readFields(spec.fields, req.body, today(), true), cols = Object.keys(v);
    if (!cols.length) throw new HttpError(400, 'Nothing to update.');
    cross(v);
    const r = await q(`UPDATE ${name} SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ? AND patient_id = ? AND entered_in_error = 0`, [...cols.map(c => v[c]), rid, pid]);
    if (!r.affectedRows) throw new HttpError(404, 'Record not found.');
    await audit(req, 'update_' + name, 'patient', pid, String(rid));
    res.json({ ok: true });
  }));
  router.delete(`/patients/:id/${name}/:rid`, doctor, wrap(async (req, res) => {      // "remove" = mark as entered in error; only the doctor who recorded it
    const pid = Number(req.params.id), rid = Number(req.params.rid);
    const [r] = await q(`SELECT recorded_by FROM ${name} WHERE id = ? AND patient_id = ? AND entered_in_error = 0`, [rid, pid]);
    if (!r) throw new HttpError(404, 'Record not found.');
    if (r.recorded_by != null && r.recorded_by !== req.user.ref_id) throw new HttpError(403, 'Only the doctor who recorded this entry can mark it as entered in error.');
    await q(`UPDATE ${name} SET entered_in_error = 1 WHERE id = ?`, [rid]);
    await audit(req, 'error_' + name, 'patient', pid, String(rid));
    res.json({ ok: true });
  }));
}

// ---------- vitals ----------
router.post('/patients/:id/vitals', doctor, wrap(async (req, res) => {
  const pid = Number(req.params.id), p = await getPatient(pid), v = validateVitals(req.body);
  const r = await q('INSERT INTO vitals (patient_id, visit_id, recorded_by, bp_sys, bp_dia, heart_rate, resp_rate, temp_c, spo2, weight_kg, height_cm, bmi, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [pid, Number(req.body.visit_id) || null, req.user.ref_id, v.bp_sys, v.bp_dia, v.heart_rate, v.resp_rate, v.temp_c, v.spo2, v.weight_kg, v.height_cm, v.bmi, clean(req.body.notes, 255) || null]);
  await audit(req, 'add_vitals', 'patient', pid, String(r.insertId));
  const age = ageYears(p.birthdate, today());
  res.status(201).json({ id: r.insertId, bmi: v.bmi, flags: flagsFor(v, age), bmi_category: bmiCategory(v.bmi, age) });
}));
router.get('/patients/:id/vitals', doctor, wrap(async (req, res) => {
  const pid = Number(req.params.id), p = await getPatient(pid), age = ageYears(p.birthdate, today());
  await audit(req, 'view_vitals', 'patient', pid);
  const rows = await q(`SELECT v.*, d.name AS recorded_by_name FROM vitals v LEFT JOIN doctors d ON d.id = v.recorded_by WHERE v.patient_id = ? AND v.entered_in_error = 0 ORDER BY v.recorded_at DESC, v.id DESC LIMIT ?`, [pid, Math.min(Number(req.query.limit) || 50, 200)]);
  res.json(rows.map(r => shapeVital(r, age)));
}));
router.delete('/patients/:id/vitals/:vid', doctor, wrap(async (req, res) => {
  const pid = Number(req.params.id), vid = Number(req.params.vid);
  const [r] = await q('SELECT recorded_by FROM vitals WHERE id = ? AND patient_id = ? AND entered_in_error = 0', [vid, pid]);
  if (!r) throw new HttpError(404, 'Record not found.');
  if (r.recorded_by != null && r.recorded_by !== req.user.ref_id) throw new HttpError(403, 'Only the doctor who recorded this reading can mark it as entered in error.');
  await q('UPDATE vitals SET entered_in_error = 1 WHERE id = ?', [vid]);
  await audit(req, 'error_vitals', 'patient', pid, String(vid));
  res.json({ ok: true });
}));

// ---------- visit notes (SOAP-style) ----------
router.get('/patients/:id/visits', doctor, wrap(async (req, res) => {
  const pid = Number(req.params.id); await getPatient(pid);
  await audit(req, 'view_record', 'patient', pid);
  res.json(await q(`SELECT ${VISIT_COLS} FROM visits v LEFT JOIN doctors d ON d.id = v.doctor_id WHERE v.patient_id = ? ORDER BY v.visit_date DESC, v.id DESC`, [pid]));
}));

router.post('/patients/:id/visits', doctor, wrap(async (req, res) => {
  const pid = Number(req.params.id); await getPatient(pid);
  const v = readFields(VISIT, req.body, today()); v.visit_date = v.visit_date || today();
  if (v.follow_up_date && v.follow_up_date < v.visit_date) throw new HttpError(400, 'The follow-up date cannot be before the visit date.');
  const r = await q('INSERT INTO visits (patient_id, doctor_id, visit_date, chief_complaint, history, examination, diagnosis, plan, follow_up_date, notes, appointment_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [pid, req.user.ref_id, v.visit_date, v.chief_complaint, v.history, v.examination, v.diagnosis, v.plan, v.follow_up_date, v.notes, Number(req.body.appointment_id) || null]);
  await audit(req, 'add_visit', 'patient', pid, String(r.insertId));
  res.status(201).json({ id: r.insertId });
}));

// Only the doctor who wrote a note may amend it; the previous version is kept.
router.put('/visits/:vid', doctor, wrap(async (req, res) => {
  const vid = Number(req.params.vid), v = readFields(VISIT_EDIT, req.body, today(), true), cols = Object.keys(v);
  if (!cols.length) throw new HttpError(400, 'Nothing to update.');
  const pid = await tx(async c => {
    const [[old]] = await c.query('SELECT * FROM visits WHERE id = ? FOR UPDATE', [vid]);
    if (!old) throw new HttpError(404, 'Visit not found.');
    if (old.doctor_id !== req.user.ref_id) throw new HttpError(403, 'Only the doctor who wrote this note can amend it.');
    const merged = { ...old, ...v };
    if (merged.follow_up_date && merged.follow_up_date < old.visit_date) throw new HttpError(400, 'The follow-up date cannot be before the visit date.');
    await c.query('INSERT INTO visit_revisions (visit_id, revised_by, snapshot) VALUES (?,?,?)', [vid, req.user.ref_id, JSON.stringify(old)]);
    await c.query(`UPDATE visits SET ${cols.map(k => k + ' = ?').join(', ')}, amended_at = NOW() WHERE id = ?`, [...cols.map(k => v[k]), vid]);
    return old.patient_id;
  });
  await audit(req, 'amend_visit', 'patient', pid, String(vid));
  res.json({ ok: true });
}));

router.get('/visits/:vid/revisions', doctor, wrap(async (req, res) => {
  const vid = Number(req.params.vid), [vis] = await q('SELECT patient_id FROM visits WHERE id = ?', [vid]);
  if (!vis) throw new HttpError(404, 'Visit not found.');
  await audit(req, 'view_revisions', 'patient', vis.patient_id, String(vid));
  const rows = await q('SELECT r.id, r.revised_at, d.name AS revised_by_name, r.snapshot FROM visit_revisions r LEFT JOIN doctors d ON d.id = r.revised_by WHERE r.visit_id = ? ORDER BY r.id DESC', [vid]);
  res.json(rows.map(r => { let s = {}; try { s = JSON.parse(r.snapshot); } catch {} return { id: r.id, revised_at: r.revised_at, revised_by_name: r.revised_by_name, before: s }; }));
}));

module.exports = router;
