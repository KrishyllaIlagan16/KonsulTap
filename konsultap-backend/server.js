const app = require('./src/app');
const { port } = require('./src/config/env');
const { pool, testConnection } = require('./src/config/db');

(async () => {
  try {
    await testConnection();
    console.log('Database connected');
    require('./src/jobs/expire').start();
    require('./src/jobs/emailRetry').start();
    const server = app.listen(port, () => console.log(`KonsulTap running on http://localhost:${port}`));
    const shutdown = () => server.close(async () => { await pool.end(); process.exit(0); });
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('Database connection failed:', err.message);
    process.exit(1);
  }
})();
