require('dotenv').config();
const path = require('path');

const required = ['DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME', 'JWT_SECRET'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) { console.error('Missing environment variables:', missing.join(', ')); process.exit(1); }
if (process.env.JWT_SECRET.length < 32) { console.error('JWT_SECRET must be at least 32 characters.'); process.exit(1); }

const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
const envAppUrl = (process.env.APP_URL || '').trim();
// On Vercel, ignore an accidentally copied "http://localhost:3000" APP_URL and use the real Vercel HTTPS URL instead
const usableAppUrl = process.env.VERCEL && /^https?:\/\/(localhost|127\.0\.0\.1)\b/i.test(envAppUrl) ? '' : envAppUrl;
const publicUrl = usableAppUrl || process.env.RENDER_EXTERNAL_URL || (vercelUrl ? 'https://' + vercelUrl : '');
if (process.env.NODE_ENV === 'production' && !publicUrl) { console.error('APP_URL is required in production (the public address of the website, used in password-reset links).'); process.exit(1); }

module.exports = {
  appUrl: (publicUrl || 'http://localhost:' + (process.env.PORT || 3000)).replace(/\/+$/, ''),   // never built from request headers (prevents link poisoning)
  inviteTokenHours: Number(process.env.INVITE_TOKEN_HOURS) > 0 ? Number(process.env.INVITE_TOKEN_HOURS) : 72,   // how long a new doctor's "set your password" link works
  resetTokenMinutes: Number(process.env.RESET_TOKEN_MINUTES) > 0 ? Number(process.env.RESET_TOKEN_MINUTES) : 30,
  port: Number(process.env.PORT) || 3000,
  isProd: process.env.NODE_ENV === 'production',
  corsOrigin: (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean),
  tz: process.env.TZ_NAME || 'Asia/Manila',
  cancelCutoffHours: Number(process.env.CANCEL_CUTOFF_HOURS ?? 2),        // patients may cancel/reschedule up to this many hours before
  pendingExpireHours: Number(process.env.PENDING_EXPIRE_HOURS ?? 24),     // unconfirmed bookings are cancelled after this long
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : (process.env.VERCEL ? 1 : false),
  frontendDir: path.resolve(process.env.FRONTEND_DIR || '../konsultap'),
  jwtSecret: process.env.JWT_SECRET,
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  emailDnsCheck: process.env.EMAIL_DNS_CHECK !== 'false',   // sign-up: reject email domains that cannot receive mail
  mail: { user: process.env.MAIL_USER || '', pass: process.env.MAIL_APP_PASSWORD || '' },
  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined
  }
};
