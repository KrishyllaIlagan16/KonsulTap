// Checks your Gmail settings and sends a sample confirmation email:   npm run test:email -- you@example.com
const { transport, isConfigured } = require('../src/utils/mailer');
const { mail } = require('../src/config/env');
const { confirmationEmail } = require('../src/utils/emailTemplates');

(async () => {
  const to = process.argv[2];
  if (!isConfigured()) { console.error('Email is not set up. Add MAIL_USER and MAIL_APP_PASSWORD to .env first.'); process.exit(1); }
  try { await transport.verify(); console.log('Login to Gmail works (' + mail.user + ').'); }
  catch (e) { console.error('Gmail login failed:', e.message, '\nUse a Gmail App Password (16 letters, no spaces), not the normal password.'); process.exit(1); }
  if (!to) { console.log('Login OK. To send a sample email run:  npm run test:email -- your@email.com'); process.exit(0); }
  const d = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  const m = confirmationEmail({ patient_name: 'Sample Patient', ref: 'KT-TEST42', date: d, time: '09:00', doctor: 'Dr. Maria Reyes', dept: 'Internal Medicine', room: 'Clinic 6A', queue_no: 3 });
  try { await transport.sendMail({ from: `"KonsulTap - Batangas Medical Center" <${mail.user}>`, to, subject: m.subject, text: m.text, html: m.html }); console.log('Sample email sent to ' + to + '. Check the inbox (and Spam).'); }
  catch (e) { console.error('Sending failed:', e.message); process.exit(1); }
  process.exit(0);
})();
