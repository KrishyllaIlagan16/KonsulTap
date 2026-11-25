/** For each doctor, flags the first waiting patient (by appointment time, then ticket) as "next in line". Rows must already be ordered. */
function markNext(rows) {
  const seen = new Set();
  for (const r of rows) {
    r.is_next = 0;
    if (r.status === 'confirmed' && !seen.has(r.doctor_id)) { r.is_next = 1; seen.add(r.doctor_id); }
  }
  return rows;
}
/** Public screens only ever get first names. */
const firstNames = rows => rows.map(r => ({ ...r, patient_name: String(r.patient_name).split(' ')[0] }));

module.exports = { markNext, firstNames };
