# KonsulTap — Hospital Queue Management System

An online consultation booking, real-time queue tracking, and hospital clinic management web application built for **Batangas Medical Center** *(IT 314 Group 12 · Batangas State University)*.

---

## Features

### Patient Portal
- **Online Consultation Booking:** Choose a department, date, time slot, and available doctor, then receive a unique reference code (`KT-XXXXXX`) with calendar export (`.ics`) and printable confirmation.
- **Appointment Management:** View upcoming bookings, track queue position and estimated wait time, check in on arrival (*"I'm here"*), reschedule, or cancel.
- **Live Queue Board:** View who is currently being served and who is next per department, with automatic real-time updates (Server-Sent Events with serverless auto-refresh fallback).
- **Best Time to Visit:** Peak-hour prediction chart showing the busiest and quietest clinic hours so patients can choose shorter wait times.
- **Account Security:** Show/hide password toggle, confirm-password matching, strict email validation with typo suggestions and DNS mail-domain checks, plus email-based password recovery.

### Doctor Dashboard
- **Clinic Queue & Appointments:** Call the next patient, mark patients arrived, finish consultations, or record no-shows.
- **Facility & Equipment Checker:** Search and filter rooms, beds, and medical equipment, and reserve or release units directly during consultations (all updates are audited).
- **Patient Medical Records (EHR):** Search/create patient profiles and manage visits (with amendment history), vitals (with range indicators), allergies, conditions, and medications.
- **Absence / Leave Reporting:** Report leave dates to automatically reassign affected appointments to available colleagues and notify patients.

### Admin Console
- **Booking Requests & Queue Monitor:** Confirm pending appointments, assign doctors, and monitor live waiting counts, average visit times, and estimated queue clearance.
- **Facilities & Equipment Management:** Manage real-time availability of hospital beds and medical equipment.
- **Peak-Hour Forecast:** View predicted patient volume per hour to assist with doctor scheduling.
- **Doctor Management & Leave:** Add/edit doctors, configure custom working schedules, activate/deactivate accounts, and send password setup links.
- **Audit Log & Email Outbox:** Track all clinical record access and staff actions, and inspect or resend system emails.

### Security & Access Control
- **Role-Based Access Control (RBAC):** Server-side role enforcement (`patient`, `doctor`, `admin`) re-verified against the database on every request.
- **Isolated Staff Authentication:** Staff sign-in is separated from the public patient login screen.
- **Hardened Express API:** `helmet` security headers, rate limiting on auth/tracking endpoints, bcrypt password hashing, and stateless JWT authentication with password-change invalidation.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend** | HTML5, CSS3 (responsive across phone, tablet, and desktop), Vanilla JavaScript, TensorFlow.js |
| **Backend** | Node.js (>= 18), Express 4, `mysql2`, `jsonwebtoken`, `bcryptjs`, `helmet`, `cors`, `express-rate-limit`, `nodemailer` |
| **Database** | MySQL / TiDB Cloud |
| **Deployment** | Vercel (Serverless Functions + CDN) or Render (Blueprint Web Service) |

---

## Project Structure

```text
Hospital Queue System/
├── api/
│   └── index.js             # Vercel serverless entry point
├── konsultap/               # Static frontend
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js           # Views, routing, and UI logic
│   │   ├── config.js        # API base URL & optional Google OAuth Client ID
│   │   ├── db.js            # API client & auth token handling
│   │   ├── forecast.js      # Peak-hour prediction engine
│   │   └── realtime.js      # SSE client with polling fallback
│   └── img/                 # Logos, hero banner, and department icons
├── konsultap-backend/       # Express REST API
│   ├── server.js            # Local/persistent HTTP server entry point
│   ├── src/
│   │   ├── app.js           # Express app setup & middleware
│   │   ├── config/          # Environment & MySQL/TiDB pool config
│   │   ├── middleware/      # JWT authentication & RBAC guards
│   │   ├── routes/          # auth, password, public, appointments, records, staff, admin
│   │   ├── jobs/            # Background expiry & email retry jobs
│   │   └── utils/           # Queue math, wait times, email, validation, audit logging
│   ├── sql/schema.sql       # Full database schema
│   └── scripts/             # migrate, upgrade, seed, reset-facilities, test-logic, test-api, test-email
├── package.json             # Root dependencies for Vercel
├── vercel.json              # Vercel static + API routing config
└── render.yaml              # Render Blueprint deployment config
```

---

## Local Setup

### Prerequisites
- **Node.js** v18 or higher
- A **MySQL** or **TiDB Cloud** database

### 1. Install dependencies
```bash
cd konsultap-backend
npm install
```

### 2. Configure environment variables
Copy `.env.example` to `.env` and fill in your database credentials and a 32+ character `JWT_SECRET`:
```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 3. Initialize the database
```bash
npm run migrate            # Create tables (safe to run on a new database)
npm run upgrade            # Apply any schema updates to an existing database
npm run seed               # Load demo departments, doctors, accounts, and history
npm run reset:facilities   # Reset all beds and equipment to "available"
```
*(The `seed` script prints the local demo login credentials in the terminal.)*

### 4. Start the development server
```bash
npm run dev
```
Open **http://localhost:3000** in your browser.

---

## Testing

With the backend running locally (or deployed), run from `konsultap-backend`:

```bash
npm run test:logic                                  # Unit tests for scheduling & queue logic
npm run test:api                                    # End-to-end API & RBAC smoke test (local)
node scripts/test-api.js https://your-app.vercel.app  # Run smoke test against live deployment
npm run test:email                                  # Verify SMTP / Gmail configuration (optional)
```

---

## Deployment

### Vercel (Recommended for quick demos)
1. Push this repository to GitHub.
2. Import the repository in [Vercel](https://vercel.com) with **Framework Preset: Other** and **Root Directory: `./`**.
3. Add your environment variables (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME`, `DB_SSL=true`, `JWT_SECRET`, `TZ_NAME=Asia/Manila`, and optional `MAIL_USER` / `MAIL_APP_PASSWORD`).
4. Ensure your TiDB Cloud **IP Access List** allows `0.0.0.0/0`, then click **Deploy**.

### Render (Persistent server with live SSE & background jobs)
1. In [Render](https://render.com), click **New + → Blueprint** and select this repository (`render.yaml` is pre-configured).
2. Enter your prompted TiDB Cloud credentials and click **Deploy Blueprint**.

---

## Disclaimer

This project is an academic demonstration system developed for **IT 314 (Group 12)** at **Batangas State University**. It is **not** intended for real clinical use or storing actual patient health information.
