const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { corsOrigin, isProd, frontendDir, trustProxy } = require('./config/env');
const { pool } = require('./config/db');
const { authenticate } = require('./middleware/auth');

const app = express();
app.disable('x-powered-by');
if (trustProxy) app.set('trust proxy', trustProxy);
app.use(helmet({ contentSecurityPolicy: false, crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' } })); // CSP off so the site can load TensorFlow.js / Google fonts from their CDNs
if (corsOrigin.length) app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '10kb' }));

app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok', database: 'connected' }); }
  catch { res.status(503).json({ status: 'error', database: 'unreachable' }); }
});

app.use('/api', authenticate, require('./routes/auth'), require('./routes/password'), require('./routes/admin'), require('./routes/records'), require('./routes/public'), require('./routes/appointments'), require('./routes/staff'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Route not found' }));

if (fs.existsSync(frontendDir)) app.use(express.static(frontendDir)); // serves the website from ./public

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That record already exists.' });
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : (isProd ? 'Server error' : err.message), ...(err.extra || {}) });
});

module.exports = app;
