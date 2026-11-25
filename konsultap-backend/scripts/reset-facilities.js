// Sets every bed and piece of equipment back to "available" for a clean, predictable demo:  npm run reset:facilities
// Safe to run any time; it does not touch patients, appointments or accounts.
const { pool } = require('../src/config/db');

(async () => {
  try {
    const [r] = await pool.query("UPDATE facilities SET status = 'available' WHERE status <> 'available'");
    const [[c]] = await pool.query('SELECT COUNT(*) AS n FROM facilities');
    console.log(`Done: ${r.affectedRows} changed to available. All ${c.n} facilities are now available.`);
  } catch (e) {
    console.error('Reset failed:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
