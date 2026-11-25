# KonsulTap website (HTML + CSS + JavaScript)
Front end of the KonsulTap hospital queue system for Batangas Medical Center.

- index.html, css/style.css, js/app.js (screens), js/db.js (talks to the backend), js/forecast.js (TensorFlow.js peak-hour model), js/config.js (backend address), img/ (BatMC logo, photo, department icons)

## Run
This website needs the backend (zip: konsultap-backend). Unzip both side by side, follow the backend README, then open http://localhost:3000.

## Pages
Home (AI peak-hour prediction, departments), Book + My appointments (patients), Live queue (by department), Doctor clinic, Admin console, and separate Patient / Doctor / Administrator sign-in portals. Every color-coded indicator has a legend.

## Google sign-in button (optional)
Paste your Google OAuth Client ID into `js/config.js` (`window.KONSULTAP_GOOGLE_CLIENT_ID`), and set `GOOGLE_CLIENT_ID` in the backend `.env`. Leave it empty to hide the button. Not tested with a real Google account yet.

## What the website now includes (from the audit)
Cancel/reschedule and "I'm here" for patients, booking confirmation card (copy, print, add to calendar), doctor absence reporting, admin Doctor leave and Audit log tabs, loading/empty/error states, disabled buttons while sending, a "connection lost" banner on the live queue with automatic retry, session-expiry handling, Privacy Notice page and consent checkbox, keyboard/screen-reader improvements (skip link, page titles and focus, tab roles, labelled facility dots and chart), and larger touch targets on phones.

## Real-time live queue
The Live Queue and the home page board update by themselves (`js/realtime.js`, Server-Sent Events). The badge shows "Live" or "Reconnecting...". The next patient is highlighted as **Next**, then **Now serving**, and a patient is alerted when their turn is near.

## Wait-time estimates
Each waiting patient shows "About N min" (or "Any moment now") on the Live Queue, the home board, tracking, and My appointments. Hover for the likely range and call time. Each doctor's column shows their average visit length. The admin Doctor queue monitor adds "Avg visit" and "Queue clears in".

## Password reset
"Forgot your password?" links on the Patient, Doctor and Administrator sign-in pages lead to a request form; the emailed link opens a page to choose a new password (`#/reset`). Passwords must be 8 to 72 characters.

## Admin: manage doctors
Admin console > Doctors: search/filter, add a doctor (with login and emailed password link), edit details and schedule (including custom hours), deactivate/reactivate, and send a password link. Changes that affect booked patients ask for confirmation first.

## Patient chart (doctors)
Doctor dashboard > Patient records opens a chart with Summary, Visits (amendable notes with history), Vitals (typical-range highlighting with a legend), Allergies, Conditions, Medications and Profile. An allergy banner appears at the top of every chart.
