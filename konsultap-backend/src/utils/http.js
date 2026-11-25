const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
/** Lets async route handlers throw errors that reach the error middleware (Express 4). */
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newRef = () => 'KT-' + Array.from({ length: 6 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');

module.exports = { HttpError, wrap, clean, EMAIL_RE, newRef };
