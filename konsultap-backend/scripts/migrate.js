// Creates all tables:  npm run migrate   (safe to run again: uses CREATE TABLE IF NOT EXISTS)
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '../sql/schema.sql'), 'utf8');
    const statements = sql.split(/;\s*(?:\r?\n|$)/).map(s => s.trim()).filter(Boolean);
    for (const s of statements) {
      await pool.query(s);
      console.log('OK  ', s.match(/EXISTS (\w+)/)[1]);
    }
    console.log('Migration finished.');
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
