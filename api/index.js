// Vercel Serverless Function entry point: forwards all /api/* requests to the Express app.
const app = require('../konsultap-backend/src/app');
module.exports = app;
