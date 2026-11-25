# KonsulTap Backend (Express + MySQL / TiDB Cloud)

The **API** for KonsulTap. The website lives in its own folder, `konsultap` (separate zip). Unzip both **side by side**:
```
your-folder/
  konsultap-backend/   <- this folder (run it here)
  konsultap/           <- the website: index.html, css, js, img
```
The server then also serves the website, so you only open http://localhost:3000. Without the `konsultap` folder next to it, the server runs as an API only.

## Setup (first time)
1. Install **Node.js 18+** (nodejs.org, LTS).
2. Create the cloud database (TiDB Cloud Starter) or a local MySQL. Run once in its SQL editor:
   `CREATE DATABASE IF NOT EXISTS konsultap;`
3. In this folder run:  `npm install`
4. Copy `.env.example` to `.env` and fill it in:
   - `DB_HOST`, `DB_PORT` (TiDB uses 4000), `DB_USER` (TiDB users look like `abc123.root`), `DB_PASS` (quote it if it has symbols), `DB_NAME=konsultap`, `DB_SSL=true` (use `false` for local MySQL)
   - `JWT_SECRET`: run `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and paste the result
5. Create the tables:  `npm run migrate`
6. Add demo data:      `npm run seed`
7. Start:              `npm run dev`  then open http://localhost:3000

**Already ran the earlier version?** Run `npm run upgrade` once (adds the new columns/tables), then restart. Fresh installs only need `npm run migrate`.

Quick checks: http://localhost:3000/api/health should say `"database":"connected"`. `npm run test:logic` tests the scheduling/letter helpers without a database.

## Demo accounts (change these before any real use)
| Role | Login | Password |
|---|---|---|
| Admin | admin | admin123 |
| Doctor | D031 (any D001 to D072) | doctor123 |
| Patient | patient@demo.com (or register a new one) | patient123 |

## Automatic confirmation email (from konsultap.jjk@gmail.com)
The moment the admin confirms a booking, the server emails the patient (to the address they typed when booking): a short confirmation, the doctor's name, exact date and time, the reference code, and the reminder "Please arrive at least 20 to 30 minutes before your scheduled appointment." (HTML + plain-text versions in `src/utils/emailTemplates.js`).
If sending fails, it is retried every 2 minutes (up to 5 times, within 24 hours). Admins can also press resend: `POST /api/emails/:id/resend`.
Setup:
1. Run `npm run upgrade` once (adds the email-retry columns to the existing database).
2. Sign in to konsultap.jjk@gmail.com, turn on **2-Step Verification**, then create an **App password** (Google Account > Security > App passwords).
3. In `.env` set `MAIL_USER=konsultap.jjk@gmail.com` and `MAIL_APP_PASSWORD=` (the 16 letters, no spaces). Restart the server.
4. Test: `npm run test:email` (checks the Gmail login), then `npm run test:email -- your@email.com` (sends a sample).
Without step 3, bookings still work, and the emails wait in the admin Email outbox and are sent automatically once email is set up (if less than 24 hours old).
Gmail limits how many emails a normal account can send per day, so for real hospital use switch to a transactional email provider (only `src/utils/mailer.js` changes).

## Google sign-in (optional, patients only)
Backend routes are ready: `GET /api/auth/nonce` and `POST /api/auth/google`. Add your Google **Client ID** to `.env` (`GOOGLE_CLIENT_ID`). The Google button is not on the website yet; the flow follows the guide in our chat. Staff (doctor/admin) can never be created or signed in through Google.

## New in this version (from the system audit)
- **Patients can cancel and reschedule** (until `CANCEL_CUTOFF_HOURS` before the slot, default 2). Rescheduling puts the booking back to "pending" for re-confirmation.
- **Check-in ("I'm here")** by the patient, or "Mark arrived" by the doctor. The live queue shows who has arrived.
- **Fair queue order:** the live queue is ordered by appointment time; the ticket number is only a label.
- **No-show is its own status**, separate from cancelled. A cancelled/no-show record keeps who did it (`patient`, `doctor`, `admin`, `system`).
- **Doctor leave:** an admin (or the doctor) records an absence; booked patients are moved to a free colleague in the same department at the same time, or sent back to "pending" and emailed. Doctors on leave disappear from booking lists and show as a banner on the live queue.
- **Housekeeping job (every 5 minutes):** unconfirmed bookings older than `PENDING_EXPIRE_HOURS` (default 24) or whose time passed are cancelled and the patient is emailed; yesterday's leftover tickets are closed.
- **Admin cannot confirm a time slot that already passed.**
- **Audit log:** logins, failed logins, every doctor search/view/change of patient records, confirmations, status changes and leave are recorded (admin tab "Audit log").
- **Consent:** patient sign-up requires accepting the Privacy Notice (a draft page; the hospital's Data Privacy Officer must review it).
- Booking limits: a patient may hold at most 5 upcoming appointments (stops slot hoarding).

## Real-time live queue (no page refresh)
When a doctor or admin changes a queue (**Done/Completed**, Now serving, No-show, Cancelled, Arrived, Confirmed, reschedule, doctor leave), the server first saves it in the database, then immediately **pushes an event** to every open screen over Server-Sent Events (`GET /api/queue/stream`).
- Patients' Live Queue pages redraw by themselves: the finished patient disappears, the next patient becomes **Next** and then **Now serving** when the doctor calls them. A patient with an appointment in the queue also gets an on-screen alert ("You're next" / "It's your turn"). A "Live" badge shows the connection state; if it drops, the page shows "Reconnecting...", falls back to polling, and re-syncs with a full snapshot when it reconnects.
- "Next" = the first waiting patient of each doctor, ordered by appointment time. The API also accepts `status: "completed"` as another name for `"done"`.
- Public screens receive first names only. Doctor and admin dashboards refresh live too.
- Nothing to install. Optional `.env`: `LIVE_MAX_CLIENTS` (default 2000 open screens) and `LIVE_MAX_PER_IP` (default 20).
- Runs on a single server process. If you later run several copies, add a shared channel (for example Redis pub/sub). Behind Nginx, set `proxy_buffering off;` for `/api/queue/stream`.
- Try it from a terminal: `curl -N http://localhost:3000/api/queue/stream` (events appear as the queue changes).

## Wait-time estimates
Every patient in the live queue gets an estimate ("About 25 min", with a likely range and a call time). It is calculated on the server (`src/utils/waittime.js`) and pushed with the real-time queue events.
How it is calculated:
1. **Typical visit length** of each doctor = their average from the last 30 days (time between *Call patient* and *Finish*). Outliers are limited (1 to 120 min, and the fastest/slowest 10% ignored when there is enough data). With few visits it is blended toward the department average, or `DEFAULT_CONSULT_MINUTES` (default 15), so one odd visit cannot skew it.
2. **Time until the doctor is free** = what is left of the visit in progress (average minus time already spent; a visit that runs long is assumed to finish soon).
3. Each patient ahead adds **one typical visit plus a hand-over gap** (`QUEUE_TRANSITION_MINUTES`, default 2).
4. Nobody is called **before their appointment time**, so an estimate is never earlier than that.
5. The **likely range** widens with every patient ahead (about an 80% range).
The browser counts the estimate down by itself between pushes, so it stays fresh without extra requests. Hover over an estimate to see the range and the clock time.
- New columns `started_at` / `completed_at` record each visit: run **`npm run upgrade`** once. They fill in automatically as doctors use *Call patient* and *Finish*; until a doctor has data, the department average or the 15-minute default is used.
- Fresh demo data (`npm run seed -- --force`, wipes the database) includes 60 days of realistic visit lengths per department, so estimates look realistic on day one.
- Fields on queue rows (`GET /api/queue`, real-time events): `wait_minutes`, `wait_low`, `wait_high`, `ahead`, `avg_minutes`, `estimate_basis` (`doctor`, `department` or `default`). `GET /api/track/:ref` includes the same estimate for the appointment. Admins also get `GET /api/queue/stats` (average visit and when each doctor's queue should clear), shown in the Doctor queue monitor.
- Limits: estimates assume patients arrive and are called in order; no-shows, emergencies and long visits make them drift, and they are labelled "About". With no history at all they use the default length.

## Password reset (email token)
Flow: **Forgot your password?** on any sign-in portal -> the user enters their email (patients) or ID/username/email (staff) -> we email a one-time link -> they choose a new password -> every earlier login is signed out and they get a "password changed" notice.
Setup:
1. Run `npm run upgrade` once (adds `password_resets` and `users.password_changed_at`).
2. In `.env` set `APP_URL` to the public address of the website (for local testing `http://localhost:3000`; **required in production**). Optional: `RESET_TOKEN_MINUTES` (default 30) and `ADMIN_EMAIL`.
3. Email must be working (see "Automatic confirmation email"): the reset link is sent from konsultap.jjk@gmail.com.
4. Staff accounts can only reset by email if an email is on file. Doctors and the admin have none by default, so add one in the database, for example:
   `UPDATE users SET email='doctor@example.com' WHERE username='d031';` and `UPDATE users SET email='you@example.com' WHERE username='admin';`
   (Or, easier: Admin console > **Doctors** > Edit, then **Send password link**.) Without an email on file, the request is silently ignored; the user must ask an admin.
Test: request a reset for `patient@demo.com` after changing that account's email to your own (`UPDATE users SET email='you@example.com' WHERE username='patient@demo.com';`), open the emailed link, set a new password, then sign in. Try opening the same link again: it must say invalid.
Security design:
- The link holds a random 256-bit token; **only its SHA-256 hash is stored**, so a database leak cannot reset accounts. The token is in the URL fragment (`#/reset/...`), which browsers do not send to servers, and the page removes it from the address bar.
- Links expire (30 min), work **once**, and a newer request cancels older links. At most 3 links per account per hour; 10 requests per hour per IP; reset attempts are rate limited.
- "Forgot" answers the same way and just as fast whether or not the account exists (no user enumeration); the real work happens after the reply.
- The link is built from `APP_URL`, never from request headers (prevents poisoned links).
- A weak password is rejected without using up the link. Rules: 8 to 72 characters, not a common password, must not contain the user's name, username or email (also applied to new registrations).
- After a reset, all earlier logins stop working immediately, and the owner receives a "your password was changed" email.
- The emails table stores **no link** for reset emails (only a note), and reset emails can never be resent from the outbox. Requests, successes and no-matches are written to the audit log.
- Limits: anyone with access to the mailbox can reset the password, so mailbox security matters; there is no SMS or security-question option; staff without an email on file need an admin.

## Admin management of doctors and schedules
Admin console > **Doctors** tab (admin only, every change is audit-logged).
- **Add a doctor:** name, department, room, email, working days, and hours (full day, morning, afternoon, or **custom hours** such as 9 AM to 3 PM). The server creates the doctor **and** the login (Doctor ID like `D074`) and, if an email is given, emails a one-time **"create your password" link** (valid `INVITE_TOKEN_HOURS`, default 72). The doctor sets their own password; nobody ever sees it.
- **Edit** name, room, email, schedule. If the new schedule leaves already-booked patients outside the doctor's hours, the admin sees how many and must confirm; those patients are then moved to a free colleague at the same time, or sent back to "pending" and emailed.
- **Department change** is blocked while the doctor has upcoming appointments.
- **Deactivate / Reactivate:** an inactive doctor disappears from booking and cannot sign in (their history stays). Deactivating moves or notifies booked patients the same way.
- **Send password link:** emails a fresh link to the doctor's email on file (also works as an admin-triggered reset).
- Doctors are never deleted, so medical history and audit records stay intact.
Setup: run `npm run upgrade` once (adds `start_hour`, `end_hour` to doctors and `active` to users). New `.env` option: `INVITE_TOKEN_HOURS`. Email must be configured for the links to send.
API (admin only): `GET /api/admin/doctors?q=&dept=&status=`, `POST /api/admin/doctors`, `PUT /api/admin/doctors/:id`, `POST /api/admin/doctors/:id/active`, `POST /api/admin/doctors/:id/invite`. When a change affects booked patients the server answers `409` with `requires_confirm: true` and the number affected; repeat the request with `"confirm": true` to proceed.
Limits: patients per doctor per hour stays at 3 for everyone; departments and rooms are not managed here yet; custom hours are whole hours between 7 AM and 5 PM; one schedule per doctor (use **Doctor leave** for one-off absences).

## Richer medical records (doctors only)
Doctor dashboard > **Patient records**: search a patient (name, phone or patient number), open the **chart**, and use its tabs.
- **Summary:** allergy alert banner (red when a severe allergy exists), latest vitals, current conditions and medications, last visit, family and social history.
- **Visits:** full visit notes: chief complaint, history of present illness, examination, diagnosis, plan, follow-up date, notes. Only the doctor who wrote a note can **amend** it; the earlier version is kept and shown under "Earlier versions".
- **Vitals:** blood pressure, heart rate, respiratory rate, temperature, SpO2, weight, height (BMI is calculated). Impossible values are rejected. Readings outside **typical adult ranges** are highlighted (marked "!" outside range, "!!" check promptly, and colored, with a legend). This is only a visual aid, never a diagnosis, and is not applied to children or when the birthdate is unknown.
- **Allergies, Conditions, Medications:** add, edit, and mark "entered in error" (only by the doctor who recorded it). Nothing is ever deleted.
- **Profile:** demographics, blood type, address, emergency contact, family and social history. Creating a patient with the same name and birthdate as an existing one asks first (avoids duplicate charts).
- Every search, chart view, vitals view, and every change is written to the audit log (which fields changed, never their values).
Setup: run `npm run upgrade` once (adds the new columns and the tables `allergies`, `conditions`, `medications`, `vitals`, `visit_revisions`). `npm run seed -- --force` (wipes the database) adds demo records to the 10 demo patients.
API (doctor only): `GET /api/patients?q=`, `POST /api/patients`, `PUT /api/patients/:id`, `GET /api/patients/:id/chart`, `GET|POST /api/patients/:id/visits`, `PUT /api/visits/:id`, `GET /api/visits/:id/revisions`, `GET|POST|DELETE /api/patients/:id/vitals[/:vid]`, and `POST|PUT|DELETE /api/patients/:id/{allergies|conditions|medications}[/:rid]` (DELETE = mark as entered in error).
Limits: any doctor can open any patient's chart (it is logged, but there is no "treating doctor" restriction or emergency override yet); no lab results, imaging, attachments, prescriptions printing, immunizations or diagnosis codes; patients cannot see their own records online; the highlighting ranges are general adult references, so the hospital's clinicians should review them. Real patient data needs legal and security review.

## What the server enforces
- **Roles:** guests, patients, doctors and admins each get only their own endpoints (checked on every request; the role is read from the database, not from the token).
- **Doctor availability:** a doctor must work that weekday/shift and have fewer than 3 patients that hour. Booking and confirming lock the doctor's row so two people cannot take the last slot.
- **Queue numbers:** the admin's confirmation gives the next number for that doctor and day.
- **Passwords:** bcrypt hashes. Logins and sign-ups are rate limited. Tokens expire after 2 hours.
- **Privacy:** the public queue shows first names only; tracking by reference code returns no contact details.

## API summary (all under /api)
| Method + path | Who | Purpose |
|---|---|---|
| POST /login, /register, /logout; GET /me | everyone | accounts (register = patient only) |
| POST /password/forgot, GET /password/verify, POST /password/reset | everyone | password recovery with emailed token |
| GET /auth/nonce, POST /auth/google | everyone | Google sign-in |
| GET /departments, /doctors?dept&date&time | everyone | lists; doctors filtered by availability |
| GET /queue, /track/:ref, /facilities, /forecast/history | everyone | live queue, tracking, beds (staff also see equipment), booking history |
| POST /appointments; GET /my/appointments | patient | book; my bookings |
| POST /appointments/:id/cancel, /reschedule | patient (own) | cancel or move a booking |
| POST /appointments/:id/checkin | patient (own), doctor (own), admin | arrived |
| GET /appointments | doctor (own) / admin | lists |
| POST /appointments/:id/confirm | admin | assign doctor + queue number + email |
| POST /appointments/:id/status | doctor (own) / admin | serving, done, cancelled |
| GET/POST /patients, GET/POST /patients/:id/visits | doctor | medical records |
| PATCH /facilities/:id; GET /emails; GET /audit | admin | facilities; email outbox; audit log |
| POST /doctors/:id/leave | admin, or the doctor for themself | record absence + reassign patients |
| GET /patients/:id/chart, visits, vitals, allergies, conditions, medications (see "Richer medical records") | doctor | medical records |
| GET/POST /admin/doctors, PUT /admin/doctors/:id, POST /admin/doctors/:id/active, /invite | admin | manage doctors, schedules, logins |
| GET /leave, DELETE /leave/:id | admin | upcoming leave |
| GET /leave/today | everyone | doctors on leave today (queue banner) |

## Notes
- The TensorFlow.js peak-hour model still runs in the visitor's browser, trained on `/api/forecast/history` (dates and hours only, no personal data).
- No database foreign keys are declared, to stay compatible with all MySQL-style cloud databases; the code checks relationships itself.
- Use demo data only. Real patient records need proper legal and security review (Philippines Data Privacy Act).
- To host the website somewhere else, set `window.KONSULTAP_API` in the website's `js/config.js` and add the website's address to `CORS_ORIGIN` in `.env`.

## Known limitations (not built yet)
Email verification at sign-up, MFA for staff, SMS and reminders, walk-in/kiosk registration and priority lanes, wait-time estimates, strict Content Security Policy (currently off so CDN libraries load), automated tests beyond `npm run test:logic`, and a legal review of the privacy notice. Change the demo passwords and remove the seeded accounts before any real use.
