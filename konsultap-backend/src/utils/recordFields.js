/* Reads and validates a record's fields from a request body using a small spec. Pure (no database).
   spec: { field: { label, max?, req?, enum?, date?, notFuture? } }   partial = true for updates (only fields present are read) */
const { HttpError } = require('./http');
const { isDate } = require('./logic');
const { clean } = require('./http');

function readFields(spec, body = {}, today, partial = false) {
  const out = {};
  for (const [k, f] of Object.entries(spec)) {
    if (partial && !(k in body)) continue;
    let v = body[k];
    if (v === undefined || v === null || String(v).trim() === '') {
      if (f.req) throw new HttpError(400, `${f.label} is required.`);
      out[k] = null; continue;
    }
    if (f.enum) { if (!f.enum.includes(v)) throw new HttpError(400, `${f.label}: choose one of ${f.enum.join(', ')}.`); }
    else if (f.date) {
      if (!isDate(String(v))) throw new HttpError(400, `${f.label} must be a valid date.`);
      if (f.notFuture && String(v) > today) throw new HttpError(400, `${f.label} cannot be in the future.`);
    } else v = clean(v, f.max || 255);
    out[k] = v;
  }
  return out;
}
module.exports = { readFields };
