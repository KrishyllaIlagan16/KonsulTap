/* Where is the KonsulTap backend?
   - Leave '' when the backend serves this website (put this folder next to konsultap-backend and run the backend).
   - If you open/host this website somewhere else, set the backend address, e.g. 'http://localhost:3000' or 'https://api.yourschool.edu',
     and add this website's address to CORS_ORIGIN in the backend's .env. */
window.KONSULTAP_API = '';

/* Optional: Google sign-in for patients. Paste your Google OAuth Client ID (not the secret). Leave '' to hide the button. */
window.KONSULTAP_GOOGLE_CLIENT_ID = '';
