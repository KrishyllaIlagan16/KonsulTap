// Trims an EXISTING database to 3 doctors per department (keeping the first 3 in each department)
// and clears pre-set specializations so doctors can set their own in Doctor Profile.
// Usage:  npm run trim:doctors
const { pool, q } = require('../src/config/db');

(async () => {
  try {
    const docs = await q('SELECT id, dept_id FROM doctors ORDER BY dept_id, id');
    const byDept = {};
    const removeIds = [];
    for (const d of docs) {
      byDept[d.dept_id] ||= [];
      if (byDept[d.dept_id].length < 3) byDept[d.dept_id].push(d.id);
      else removeIds.push(d.id);
    }
    if (removeIds.length) {
      // Re-point any historical/active appointments of removed doctors to the first remaining doctor of their department
      for (const id of removeIds) {
        const d = docs.find(x => x.id === id);
        const keepId = byDept[d.dept_id][0];
        await pool.query('UPDATE appointments SET doctor_id = ? WHERE doctor_id = ?', [keepId, id]);
        await pool.query('UPDATE appointments SET pref_doctor_id = ? WHERE pref_doctor_id = ?', [keepId, id]);
        await pool.query('UPDATE visits SET doctor_id = ? WHERE doctor_id = ?', [keepId, id]);
      }
      await pool.query('DELETE FROM doctor_leave WHERE doctor_id IN (?)', [removeIds]);
      await pool.query("DELETE FROM users WHERE role = 'doctor' AND ref_id IN (?)", [removeIds]);
      await pool.query('DELETE FROM doctors WHERE id IN (?)', [removeIds]);
    }
    // Ensure specialization starts blank for doctors to fill in themselves
    const [hasCol] = await q("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'doctors' AND column_name = 'specialization'");
    if (hasCol && hasCol.n) await pool.query('UPDATE doctors SET specialization = NULL');

    const [[cnt]] = await pool.query('SELECT COUNT(*) AS n FROM doctors');
    console.log(`Done: removed ${removeIds.length} extra doctor(s). Total doctors now: ${cnt.n} (3 per department, specializations blank).`);
  } catch (e) {
    console.error('Trim failed:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
