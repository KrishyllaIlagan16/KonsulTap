/* Every 2 minutes: re-send emails that failed (up to 5 tries, within 24 hours). */
const { retryFailed } = require('../utils/mailer');

function start() {
  const tick = () => retryFailed().then(n => { if (n) console.log(`Email retry: tried ${n} message(s)`); }).catch(e => console.error('Email retry job failed:', e.message));
  setTimeout(tick, 30e3);
  setInterval(tick, 2 * 60e3);
}
module.exports = { start };
