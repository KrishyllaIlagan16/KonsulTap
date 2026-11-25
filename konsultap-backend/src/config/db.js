const mysql = require('mysql2/promise');
const { db } = require('./env');

const pool = mysql.createPool({
  ...db,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  connectTimeout: 15000,
  enableKeepAlive: true,
  dateStrings: true          // DATE/TIMESTAMP come back as plain strings like "2026-11-21"
});

/** Run a query and return just the rows. */
const q = async (sql, params = []) => (await pool.query(sql, params))[0];

/** Run fn(connection) inside a transaction; commits on success, rolls back on any error. */
async function tx(fn) {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const result = await fn(c);
    await c.commit();
    return result;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}

async function testConnection() {
  const c = await pool.getConnection();
  try { await c.ping(); } finally { c.release(); }
}

module.exports = { pool, q, tx, testConnection };
