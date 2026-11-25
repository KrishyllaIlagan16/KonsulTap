const nodemailer = require('nodemailer');
const { mail } = require('../config/env');
const { pool } = require('../config/db');

const transport = mail.user && mail.pass
  ? nodemailer.createTransport({ service: 'gmail', auth: { user: mail.user, pass: mail.pass }, pool: true, maxConnections: 3, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000 })
  : null;

/** Tries to deliver one stored email and records the result. Never throws. */
async function deliver(id, m) {
  let ok = false, note;
  if (!transport) note = 'Email is not set up yet: add MAIL_USER and MAIL_APP_PASSWORD to .env. It will be sent automatically once set up.';
  else {
    try {
      await transport.sendMail({ from: `"KonsulTap - Batangas Medical Center" <${mail.user}>`, to: m.to, subject: m.subject, text: m.body, html: m.html || undefined });
      ok = true; note = 'Sent from ' + mail.user;
    } catch (e) { note = 'Email failed (will retry automatically): ' + e.message; }
  }
  try { await pool.query('UPDATE emails SET delivered = ?, note = ?, attempts = attempts + ?, last_attempt_at = NOW() WHERE id = ?', [ok ? 1 : 0, note.slice(0, 250), transport ? 1 : 0, id]); } catch {}
  return { ok, note, id };
}

/** Saves the email in the `emails` table (the outbox) and sends it immediately. */
async function sendMail({ to, subject, body, html = null, kind = 'general', appointmentId = null, sensitive = false }) {
  let id = null;
  try {
    // sensitive = contains a secret link: the outbox keeps only a note (not the link), and it is never retried or resent
    id = (await pool.query('INSERT INTO emails (to_addr, subject, body, html, kind, appointment_id, delivered, attempts, note) VALUES (?,?,?,?,?,?,0,?,?)',
      [to, subject, sensitive ? '[Content hidden for security: contains a private link]' : body, sensitive ? null : html, kind, appointmentId, sensitive ? 5 : 0, 'Queued']))[0].insertId;
  } catch { /* outbox write failed: still try to send */ }
  if (!id) return transport ? deliver(0, { to, subject, body, html }) : { ok: false, note: 'Email is not set up yet.', id: null };
  return deliver(id, { to, subject, body, html });
}

/** Called by a background job: re-sends emails that failed (or were queued before email was set up). */
async function retryFailed() {
  if (!transport) return 0;
  const [rows] = await pool.query(`SELECT id, to_addr, subject, body, html FROM emails
    WHERE delivered = 0 AND attempts < 5 AND sent_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      AND (last_attempt_at IS NULL OR last_attempt_at < DATE_SUB(NOW(), INTERVAL 2 MINUTE)) ORDER BY id LIMIT 20`);
  for (const r of rows) await deliver(r.id, { to: r.to_addr, subject: r.subject, body: r.body, html: r.html });
  return rows.length;
}

/** Admin "Resend" button: sends a stored email again. */
async function resendEmail(id) {
  const [[r]] = await pool.query('SELECT id, to_addr, subject, body, html, kind FROM emails WHERE id = ?', [id]);
  if (r && ['password_reset', 'invite'].includes(r.kind)) return { ok: false, note: 'Emails with private links cannot be resent. Send a new link instead.', id };
  return r ? deliver(r.id, { to: r.to_addr, subject: r.subject, body: r.body, html: r.html }) : null;
}

const isConfigured = () => !!transport;
module.exports = { sendMail, retryFailed, resendEmail, isConfigured, transport };
