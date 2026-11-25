/* Email templates. Each returns { subject, text, html } so the message looks right in every mail app. */
const { fmtD, fmtT } = require('./logic');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ARRIVE_NOTE = 'Please arrive at least 20 to 30 minutes before your scheduled appointment.';

/**
 * Sent automatically the moment the admin confirms an appointment.
 * a = { patient_name, ref, date: 'YYYY-MM-DD', time: 'HH:00', doctor, dept, room, queue_no }
 */
function confirmationEmail(a) {
  const when = `${fmtD(a.date)} at ${fmtT(a.time)} (Philippine Time)`;
  const subject = `Appointment Confirmed: ${a.ref} | Batangas Medical Center`;

  const text = `Dear ${a.patient_name},

Good day! We are pleased to confirm your appointment at Batangas Medical Center.

Doctor:          ${a.doctor}
Department:      ${a.dept} (${a.room})
Date and time:   ${when}
Reference code:  ${a.ref}${a.queue_no ? `\nTicket number:   ${a.queue_no}` : ''}

IMPORTANT: ${ARRIVE_NOTE}

Please present your reference code at the reception. If you can no longer attend, please cancel or reschedule on KonsulTap so that another patient can take your slot.

Thank you and we look forward to serving you.

Batangas Medical Center
Department of Health, Republic of the Philippines

This is an automated message from KonsulTap.`;

  const row = (label, value) => `<tr><td style="padding:8px 0;color:#5a6b61;width:140px;vertical-align:top">${label}</td><td style="padding:8px 0;color:#15251c;font-weight:600">${value}</td></tr>`;
  const html = `<!DOCTYPE html><html lang="en"><body style="margin:0;background:#f4f7f3;font-family:Arial,Helvetica,sans-serif">
<span style="display:none;max-height:0;overflow:hidden">Your appointment with ${esc(a.doctor)} is confirmed. Reference ${esc(a.ref)}.</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f3;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #d7e0d9">
  <tr><td style="background:#0d6b3f;padding:20px 24px;border-bottom:4px solid #f2d900"><div style="color:#ffffff;font-size:20px;font-weight:700">Appointment Confirmed</div><div style="color:#d9efe2;font-size:13px;margin-top:2px">Batangas Medical Center &middot; KonsulTap</div></td></tr>
  <tr><td style="padding:24px">
    <p style="margin:0 0 12px;color:#15251c;font-size:15px">Dear ${esc(a.patient_name)},</p>
    <p style="margin:0 0 16px;color:#15251c;font-size:15px;line-height:1.5">Good day! We are pleased to confirm your appointment at Batangas Medical Center. Here are your details:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e4ece6;border-bottom:1px solid #e4ece6;font-size:15px">
      ${row('Doctor', esc(a.doctor))}${row('Department', `${esc(a.dept)} (${esc(a.room)})`)}${row('Date and time', esc(when))}
      ${row('Reference code', `<span style="font-size:20px;letter-spacing:2px;background:#eef7f1;padding:2px 8px;border-radius:6px">${esc(a.ref)}</span>`)}${a.queue_no ? row('Ticket number', esc(a.queue_no)) : ''}
    </table>
    <div style="margin:18px 0;padding:14px 16px;background:#fbe9c4;border:1px solid #e0a935;border-radius:8px;color:#6b4a0a;font-size:15px;line-height:1.5"><b>IMPORTANT:</b> ${esc(ARRIVE_NOTE)}</div>
    <p style="margin:0 0 12px;color:#15251c;font-size:14px;line-height:1.5">Please present your reference code at the reception. If you can no longer attend, please cancel or reschedule on KonsulTap so that another patient can take your slot.</p>
    <p style="margin:16px 0 0;color:#15251c;font-size:14px">Thank you and we look forward to serving you.</p>
  </td></tr>
  <tr><td style="background:#f4f7f3;padding:14px 24px;color:#5a6b61;font-size:12px;line-height:1.5">Batangas Medical Center &middot; Department of Health, Republic of the Philippines<br>This is an automated message from KonsulTap.</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, text, html };
}


/** Password-reset email. link = full https URL containing the one-time token. */
function passwordResetEmail({ name, link, minutes }) {
  const subject = 'Reset your KonsulTap password';
  const text = `Dear ${name},

We received a request to reset the password of your KonsulTap account at Batangas Medical Center.

Reset your password using this link (valid for ${minutes} minutes, can be used once):
${link}

If you did not ask for this, you can safely ignore this email: your password will not change. Never share this link with anyone. KonsulTap staff will never ask for it.

Batangas Medical Center
This is an automated message from KonsulTap.`;
  const html = `<!DOCTYPE html><html lang="en"><body style="margin:0;background:#f4f7f3;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f3;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #d7e0d9">
  <tr><td style="background:#0d6b3f;padding:20px 24px;border-bottom:4px solid #f2d900"><div style="color:#ffffff;font-size:20px;font-weight:700">Reset your password</div><div style="color:#d9efe2;font-size:13px;margin-top:2px">Batangas Medical Center &middot; KonsulTap</div></td></tr>
  <tr><td style="padding:24px;color:#15251c;font-size:15px;line-height:1.5">
    <p style="margin:0 0 12px">Dear ${esc(name)},</p>
    <p style="margin:0 0 18px">We received a request to reset the password of your KonsulTap account. This link is valid for <b>${esc(minutes)} minutes</b> and can be used once.</p>
    <p style="margin:0 0 18px"><a href="${esc(link)}" style="background:#0d6b3f;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">Choose a new password</a></p>
    <p style="margin:0 0 12px;font-size:13px;color:#5a6b61;word-break:break-all">If the button does not work, copy this address into your browser:<br>${esc(link)}</p>
    <div style="margin:16px 0;padding:12px 14px;background:#fbe9c4;border:1px solid #e0a935;border-radius:8px;color:#6b4a0a;font-size:14px">If you did not ask for this, ignore this email: your password will not change. Never share this link with anyone.</div>
  </td></tr>
  <tr><td style="background:#f4f7f3;padding:14px 24px;color:#5a6b61;font-size:12px">Batangas Medical Center &middot; This is an automated message from KonsulTap.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

/** Security notice sent after a password was changed. */
function passwordChangedEmail({ name }) {
  const subject = 'Your KonsulTap password was changed';
  const text = `Dear ${name},

The password of your KonsulTap account was just changed, and you were signed out on all devices.

If this was you, no action is needed. If it was not you, please contact the hospital immediately and request a new password reset.

Batangas Medical Center
This is an automated message from KonsulTap.`;
  const html = `<!DOCTYPE html><html lang="en"><body style="margin:0;background:#f4f7f3;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #d7e0d9"><tr><td style="background:#0d6b3f;padding:18px 24px;border-bottom:4px solid #f2d900;color:#ffffff;font-size:19px;font-weight:700">Your password was changed</td></tr>
<tr><td style="padding:24px;color:#15251c;font-size:15px;line-height:1.5"><p style="margin:0 0 12px">Dear ${esc(name)},</p><p style="margin:0 0 12px">The password of your KonsulTap account was just changed, and you were signed out on all devices.</p>
<p style="margin:0;padding:12px 14px;background:#fbe9c4;border:1px solid #e0a935;border-radius:8px;color:#6b4a0a">If this was not you, contact the hospital immediately and request a new password reset.</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

/** Welcome email for a newly added doctor: shows the Doctor ID and a one-time link to create the password. */
function doctorInviteEmail({ name, doctorId, link, hours }) {
  const subject = 'Your KonsulTap doctor account';
  const text = `Dear ${name},

An account was created for you on KonsulTap at Batangas Medical Center.

Your Doctor ID: ${doctorId}

Create your password with this link (valid for ${hours} hours, can be used once):
${link}

Then sign in on the Doctor portal using your Doctor ID and your new password. If you were not expecting this, ignore this email. Never share this link.

Batangas Medical Center
This is an automated message from KonsulTap.`;
  const html = `<!DOCTYPE html><html lang="en"><body style="margin:0;background:#f4f7f3;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #d7e0d9">
<tr><td style="background:#0d6b3f;padding:20px 24px;border-bottom:4px solid #f2d900"><div style="color:#ffffff;font-size:20px;font-weight:700">Welcome to KonsulTap</div><div style="color:#d9efe2;font-size:13px">Batangas Medical Center</div></td></tr>
<tr><td style="padding:24px;color:#15251c;font-size:15px;line-height:1.5"><p style="margin:0 0 12px">Dear ${esc(name)},</p><p style="margin:0 0 12px">An account was created for you on KonsulTap.</p>
<p style="margin:0 0 16px">Your Doctor ID: <b style="font-size:18px;letter-spacing:1px;background:#eef7f1;padding:2px 8px;border-radius:6px">${esc(doctorId)}</b></p>
<p style="margin:0 0 18px"><a href="${esc(link)}" style="background:#0d6b3f;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">Create your password</a></p>
<p style="margin:0 0 12px;font-size:13px;color:#5a6b61;word-break:break-all">This link is valid for ${esc(hours)} hours and works once. If the button does not work, copy this address:<br>${esc(link)}</p>
<p style="margin:0;font-size:13px;color:#5a6b61">If you were not expecting this, ignore this email. Never share this link.</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

module.exports = { confirmationEmail, passwordResetEmail, passwordChangedEmail, doctorInviteEmail, ARRIVE_NOTE, esc };
