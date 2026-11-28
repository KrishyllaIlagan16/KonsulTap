// Upgrades an EXISTING database to the latest schema:  npm run upgrade   (safe to run more than once)
// (New installs only need `npm run migrate`.)
const fs = require('fs');
const path = require('path');
const { pool, q } = require('../src/config/db');

const hasCol = async (t, c) => (await q('SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?', [t, c]))[0].n > 0;

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '../sql/schema.sql'), 'utf8');
    for (const s of sql.split(/;\s*(?:\r?\n|$)/).map(x => x.trim()).filter(Boolean)) await pool.query(s); // creates any missing tables
    if (!(await hasCol('appointments', 'cancelled_by'))) await pool.query("ALTER TABLE appointments ADD COLUMN cancelled_by VARCHAR(12) NULL");
    if (!(await hasCol('appointments', 'checked_in_at'))) await pool.query('ALTER TABLE appointments ADD COLUMN checked_in_at TIMESTAMP NULL DEFAULT NULL');
    for (const c of ['started_at', 'completed_at']) if (!(await hasCol('appointments', c))) await pool.query(`ALTER TABLE appointments ADD COLUMN ${c} TIMESTAMP NULL DEFAULT NULL`);
    for (const c of ['start_hour', 'end_hour']) if (!(await hasCol('doctors', c))) await pool.query(`ALTER TABLE doctors ADD COLUMN ${c} TINYINT NULL`);
    for (const [c, ddl] of [['contact', 'VARCHAR(40) NULL'], ['specialization', 'VARCHAR(120) NULL']])
      if (!(await hasCol('doctors', c))) await pool.query(`ALTER TABLE doctors ADD COLUMN ${c} ${ddl}`);
    if (!(await hasCol('users', 'active'))) await pool.query('ALTER TABLE users ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1');
    for (const [c, ddl] of [['blood_type', 'VARCHAR(3) NULL'], ['address', 'VARCHAR(255) NULL'], ['emergency_name', 'VARCHAR(120) NULL'], ['emergency_phone', 'VARCHAR(40) NULL'], ['family_history', 'TEXT NULL'], ['social_history', 'TEXT NULL'], ['updated_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP']])
      if (!(await hasCol('patients', c))) await pool.query(`ALTER TABLE patients ADD COLUMN ${c} ${ddl}`);
    for (const [c, ddl] of [['chief_complaint', 'VARCHAR(255) NULL'], ['history', 'TEXT NULL'], ['examination', 'TEXT NULL'], ['plan', 'TEXT NULL'], ['follow_up_date', 'DATE NULL'], ['appointment_id', 'INT NULL'], ['amended_at', 'TIMESTAMP NULL DEFAULT NULL'], ['created_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP']])
      if (!(await hasCol('visits', c))) await pool.query(`ALTER TABLE visits ADD COLUMN ${c} ${ddl}`);
    if (!(await hasCol('users', 'password_changed_at'))) await pool.query('ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMP NULL DEFAULT NULL');
    if (!(await hasCol('users', 'consent_at'))) await pool.query('ALTER TABLE users ADD COLUMN consent_at TIMESTAMP NULL DEFAULT NULL');
    for (const [c, ddl] of [['kind', "VARCHAR(30) NULL"], ['appointment_id', 'INT NULL'], ['html', 'MEDIUMTEXT NULL'], ['attempts', 'INT NOT NULL DEFAULT 0'], ['last_attempt_at', 'TIMESTAMP NULL DEFAULT NULL']])
      if (!(await hasCol('emails', c))) await pool.query(`ALTER TABLE emails ADD COLUMN ${c} ${ddl}`);
    await pool.query("ALTER TABLE appointments MODIFY COLUMN status ENUM('pending','confirmed','serving','done','cancelled','no_show') NOT NULL DEFAULT 'pending'");
    console.log('Upgrade finished.');
  } catch (e) { console.error('Upgrade failed:', e.message); process.exitCode = 1; } finally { await pool.end(); }
})();
