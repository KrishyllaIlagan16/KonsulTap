// Tests the pure helper functions (no database needed):  npm run test:logic
const assert = require('assert');
const L = require('../src/utils/logic');

const full = { days: '0,1,2,3,4,5', shift: 'full' }, am = { days: '0,2,4', shift: 'am' }, pm = { days: '1,3,5', shift: 'pm' };
assert.strictEqual(L.weekday('2026-11-23'), 0, 'Mon=0');            // 23 Nov 2026 is a Monday
assert.strictEqual(L.weekday('2026-11-29'), 6, 'Sun=6');
assert(L.works(full, '2026-11-23', 8) && L.works(full, '2026-11-28', 16), 'full shift Mon-Sat');
assert(!L.works(full, '2026-11-29', 8), 'nobody on Sunday');
assert(L.works(am, '2026-11-23', 11) && !L.works(am, '2026-11-23', 12), 'am doctor stops at noon');
assert(!L.works(am, '2026-11-24', 9), 'am doctor does not work Tuesday');
assert(L.works(pm, '2026-11-24', 12) && !L.works(pm, '2026-11-24', 11), 'pm doctor starts at noon');
assert(L.isDate('2026-11-23') && !L.isDate('2026-13-45') && !L.isDate('nope'), 'isDate');
assert(L.isTime('07:00') && L.isTime('16:00') && !L.isTime('17:00') && !L.isTime('08:30'), 'isTime');
assert.strictEqual(L.fmtT('13:00'), '1:00 PM'); assert.strictEqual(L.fmtT('07:00'), '7:00 AM');
assert(/November 23, 2026/.test(L.fmtD('2026-11-23')), 'fmtD');
const n = L.nowIn('Asia/Manila'); assert(/^\d{4}-\d{2}-\d{2}$/.test(n.date) && n.hour >= 0 && n.hour <= 23, 'nowIn');
const txt = L.letter({ ref: 'KT-ABC234', patient_name: 'Ana', date: '2026-11-23', time: '09:00' }, { name: 'Dr. X', room: 'Clinic 1A' }, 'Surgery', 3);
assert(txt.includes('KT-ABC234') && txt.includes('9:00 AM') && txt.includes('Queue number: 3') && txt.includes('Monday'), 'letter');
assert.strictEqual(L.hoursUntil('2026-11-23', '10:00', { date: '2026-11-23', hour: 8 }), 2, 'hoursUntil same day');
assert.strictEqual(L.hoursUntil('2026-11-24', '08:00', { date: '2026-11-23', hour: 20 }), 12, 'hoursUntil next day');
assert(L.hoursUntil('2026-11-23', '08:00', { date: '2026-11-23', hour: 9 }) < 0, 'past slot is negative');
// ---- confirmation email template ----
const T = require('../src/utils/emailTemplates');
const em = T.confirmationEmail({ patient_name: 'Ana <b>Cruz</b>', ref: 'KT-ABC234', date: '2026-11-23', time: '13:00', doctor: 'Dr. Maria Reyes', dept: 'Surgery', room: 'Clinic 2A', queue_no: 4 });
const SENTENCE = 'Please arrive at least 20 to 30 minutes before your scheduled appointment.';
for (const [name, body] of [['text', em.text], ['html', em.html]]) {
  assert(body.includes('Dr. Maria Reyes'), name + ': doctor name');
  assert(body.includes('KT-ABC234'), name + ': reference code');
  assert(body.includes('Monday, November 23, 2026') && body.includes('1:00 PM'), name + ': exact date and time');
  assert(body.includes(SENTENCE), name + ': arrival reminder (exact sentence)');
}
assert(em.subject.includes('KT-ABC234'), 'subject has the reference code');
assert(!em.html.includes('<b>Cruz</b>') && em.html.includes('&lt;b&gt;Cruz&lt;/b&gt;'), 'html escapes patient-supplied text');
// ---- medical records: vitals + field validation ----
const V = require('../src/utils/vitals'), { readFields } = require('../src/utils/recordFields');
let vv = V.validateVitals({ bp_sys: '120', bp_dia: 80, heart_rate: 72, temp_c: '36.84', weight_kg: 70, height_cm: 175 });
assert.deepStrictEqual([vv.bp_sys, vv.temp_c, vv.bmi, vv.spo2], [120, 36.8, 22.9, null], 'numbers are cleaned, BMI = kg / m^2, missing stays null');
for (const bad of [{}, { bp_sys: 120 }, { bp_sys: 80, bp_dia: 120 }, { heart_rate: 400 }, { temp_c: 'hot' }, { spo2: 101 }, { heart_rate: 72.5 }, { weight_kg: -5 }])
  assert.throws(() => V.validateVitals(bad), /./, 'rejects ' + JSON.stringify(bad));
assert.deepStrictEqual(V.flagsFor({ bp_sys: 118, bp_dia: 76, heart_rate: 70, resp_rate: 16, temp_c: 36.7, spo2: 98 }, 40), { bp: 'ok', heart_rate: 'ok', resp_rate: 'ok', temp_c: 'ok', spo2: 'ok' }, 'normal adult values');
let fl = V.flagsFor({ bp_sys: 150, bp_dia: 94, heart_rate: 110, temp_c: 38.4, spo2: 93 }, 50);
assert.deepStrictEqual([fl.bp, fl.heart_rate, fl.temp_c, fl.spo2], ['warn', 'warn', 'warn', 'warn'], 'values outside the typical adult range are highlighted');
fl = V.flagsFor({ bp_sys: 190, bp_dia: 100, heart_rate: 140, temp_c: 40.0, spo2: 85 }, 50);
assert.deepStrictEqual([fl.bp, fl.heart_rate, fl.temp_c, fl.spo2], ['crit', 'crit', 'crit', 'crit'], 'far outside the range is "check promptly"');
assert.deepStrictEqual(V.flagsFor({ bp_sys: 190, bp_dia: 100 }, 9), {}, 'no adult-range highlighting for children');
assert.deepStrictEqual(V.flagsFor({ bp_sys: 190, bp_dia: 100 }, null), {}, 'no highlighting when the age is unknown');
assert.deepStrictEqual([V.bmiCategory(17, 30), V.bmiCategory(22, 30), V.bmiCategory(27, 30), V.bmiCategory(33, 30), V.bmiCategory(33, 10)], ['underweight', 'normal', 'overweight', 'obese', null], 'BMI categories (adults only)');
assert.strictEqual(V.ageYears('1990-11-24', '2026-11-23'), 35, 'birthday tomorrow: still 35');
assert.strictEqual(V.ageYears('1990-11-23', '2026-11-23'), 36, 'birthday today: 36');
assert.strictEqual(V.ageYears(null, '2026-11-23'), null);
const SP = { name: { label: 'Name', max: 5, req: true }, sev: { label: 'Severity', enum: ['mild', 'severe'] }, since: { label: 'Since', date: true, notFuture: true } };
assert.deepStrictEqual(readFields(SP, { name: '  Penicillin  ', sev: 'severe', since: '2020-01-01' }, '2026-11-23'), { name: 'Penic', sev: 'severe', since: '2020-01-01' }, 'trims and limits length');
assert.throws(() => readFields(SP, { sev: 'mild' }, '2026-11-23'), /Name is required/, 'required field');
assert.throws(() => readFields(SP, { name: 'x', sev: 'deadly' }, '2026-11-23'), /Severity/, 'enum');
assert.throws(() => readFields(SP, { name: 'x', since: '2030-01-01' }, '2026-11-23'), /future/, 'no future dates');
assert.deepStrictEqual(readFields(SP, { sev: 'mild' }, '2026-11-23', true), { sev: 'mild' }, 'partial updates only read the fields sent');

// ---- admin management: schedules ----
const { parseSchedule } = require('../src/utils/schedule');
let ps = parseSchedule({ days: [4, 0, 2, 2], shift: 'am' });
assert.deepStrictEqual([ps.days, ps.shift, ps.start_hour, ps.end_hour], ['0,2,4', 'am', null, null], 'days are sorted and de-duplicated, preset shift kept');
ps = parseSchedule({ days: [0, 1], start_hour: 9, end_hour: 15 });
assert.deepStrictEqual([ps.shift, ps.start_hour, ps.end_hour], ['full', 9, 15], 'custom hours 9 to 3 PM');
assert.strictEqual(parseSchedule({ days: [0], start_hour: 8, end_hour: 12 }).shift, 'am', 'custom hours ending by noon are a morning shift');
assert.strictEqual(parseSchedule({ days: [0], start_hour: 13, end_hour: 17 }).shift, 'pm', 'custom afternoon hours');
ps = parseSchedule({ shift: 'pm', start_hour: null, end_hour: null }, { days: '0,1,2', shift: 'full', start_hour: 9, end_hour: 15 });
assert.deepStrictEqual([ps.days, ps.shift, ps.start_hour], ['0,1,2', 'pm', null], 'switching back to a preset clears custom hours and keeps the days');
for (const bad of [{ days: [] }, { days: [7] }, { days: ['x'] }, { days: [0], start_hour: 6, end_hour: 10 }, { days: [0], start_hour: 10, end_hour: 10 }, { days: [0], start_hour: 9, end_hour: 18 }, { days: [0], start_hour: 9 }])
  assert.throws(() => parseSchedule(bad), /day|Hours/, 'rejects ' + JSON.stringify(bad));
const custom = { days: '0,1', shift: 'full', start_hour: 9, end_hour: 15 };
assert(L.works(custom, '2026-11-23', 9) && L.works(custom, '2026-11-23', 14) && !L.works(custom, '2026-11-23', 8) && !L.works(custom, '2026-11-23', 15), 'custom hours: 9 up to (not including) 3 PM');
assert(!L.works(custom, '2026-11-25', 10), 'custom hours still respect working days (Wednesday off)');

// ---- password reset: rules, tokens, emails ----
const PW = require('../src/utils/password');
assert(PW.checkPassword('short') && PW.checkPassword('1234567'), 'too short is rejected');
assert(PW.checkPassword('password') && PW.checkPassword('Admin123') && PW.checkPassword('aaaaaaaaaa'), 'common / repeated passwords are rejected');
assert(PW.checkPassword('ana.cruz@mail.com1', { email: 'ana.cruz@mail.com' }), 'password containing the email is rejected');
assert(PW.checkPassword('x'.repeat(73)), 'longer than bcrypt limit is rejected');
assert.strictEqual(PW.checkPassword('Blue-Harbor-47', { username: 'ana', email: 'ana@x.com' }), null, 'a good password is accepted');
const t1 = PW.newToken(), t2 = PW.newToken();
assert(PW.validTokenShape(t1) && t1 !== t2 && t1.length >= 40, 'tokens are long and unique');
assert(/^[0-9a-f]{64}$/.test(PW.hashToken(t1)) && PW.hashToken(t1) !== t1 && PW.hashToken(t1) === PW.hashToken(t1), 'only a deterministic SHA-256 hash is stored');
assert(!PW.validTokenShape('abc') && !PW.validTokenShape("x'; DROP TABLE users;--" + 'a'.repeat(30)), 'malformed tokens are rejected before touching the database');
const RE = require('../src/utils/emailTemplates').passwordResetEmail({ name: 'Ana <i>', link: 'http://localhost:3000/#/reset/' + t1, minutes: 30 });
assert(RE.text.includes('/#/reset/' + t1) && RE.html.includes('/#/reset/' + t1) && RE.text.includes('30 minutes'), 'reset email has the link and the expiry');
assert(!RE.html.includes('<i>') && RE.html.includes('&lt;i&gt;'), 'reset email escapes the name');

// ---- wait-time estimates ----
const W = require('../src/utils/waittime');
const hist = (doctor_id, dept_id, arr) => arr.map(mins => ({ doctor_id, dept_id, mins }));
const stats = W.buildStats([...hist(5, 1, Array(30).fill(15)), ...hist(6, 1, Array(30).fill(10))]);
assert(Math.abs(W.minutesFor(stats, 5, 1).avg - 15) < 0.5 && W.minutesFor(stats, 5, 1).basis === 'doctor', 'doctor average from history');
assert(Math.abs(W.minutesFor(stats, 6, 1).avg - 10) < 0.5, 'second doctor is faster');
assert.strictEqual(W.minutesFor(stats, 99, 1).basis, 'department', 'new doctor falls back to department average');
assert.strictEqual(W.minutesFor(W.buildStats([]), 1, 1).avg, 15, 'no data at all: default 15 minutes');
assert(W.summarize([10, 10, 10, 10, 10, 10, 10, 10, 10, 500]).mean < 20, 'one absurd visit (500 min) cannot skew the average');
const mk = (id, st, q, time, extra = {}) => ({ doctor_id: 5, dept_id: 1, status: st, queue_no: q, time, id, ...extra });
const NOW = { minuteOfDay: 9 * 60, ts: 1000 };                       // 9:00 AM
let r = W.attachEstimates([mk(1, 'serving', 1, '09:00', { serving_secs: 300 }), mk(2, 'confirmed', 2, '09:00'), mk(3, 'confirmed', 3, '09:00'), mk(4, 'confirmed', 4, '09:00')], stats, NOW);
assert.strictEqual(r[0].wait_minutes, 0, 'patient being served has no wait');
assert(Math.abs(r[1].wait_minutes - 10) <= 1, 'first waiting: what is left of the current visit (15 - 5 = 10)');
assert(Math.abs(r[2].wait_minutes - 27) <= 1, 'second waiting: 10 + 15 + 2 hand-over');
assert(Math.abs(r[3].wait_minutes - 44) <= 1, 'third waiting: 27 + 15 + 2');
assert(r[3].wait_high - r[3].wait_low > r[1].wait_high - r[1].wait_low, 'uncertainty grows with every patient ahead');
r = W.attachEstimates([mk(1, 'serving', 1, '09:00', { serving_secs: 40 * 60 }), mk(2, 'confirmed', 2, '09:00')], stats, NOW);
assert(r[1].wait_minutes >= 2 && r[1].wait_minutes <= 6, 'visit running long (40 of 15 min): short remaining time assumed');
r = W.attachEstimates([mk(1, 'confirmed', 1, '09:00', { time: '09:30' })], stats, NOW);
assert.strictEqual(r[0].wait_minutes, 30, 'nobody is called before their appointment time');
r = W.attachEstimates([mk(1, 'confirmed', 1, '08:00'), mk(2, 'confirmed', 2, '09:00')], stats, NOW);
assert(r[0].wait_minutes === 0 && Math.abs(r[1].wait_minutes - 17) <= 1, 'doctor free and first patient waiting: 0 min, then 15 + 2');
r = W.attachEstimates([mk(1, 'confirmed', 1, '09:00'), { ...mk(2, 'confirmed', 1, '09:00'), doctor_id: 6 }], stats, NOW);
assert(r.every(x => x.wait_minutes === 0), 'different doctors have separate queues');

// ---- real-time queue: "next in line" + push hub (fake browsers, no database) ----
const { markNext, firstNames } = require('../src/utils/queue.pure');
const { EventEmitter } = require('events');
const rows = markNext([
  { id: 1, doctor_id: 5, status: 'serving', queue_no: 1, patient_name: 'Ana Cruz' },
  { id: 2, doctor_id: 5, status: 'confirmed', queue_no: 3, patient_name: 'Ben Lim' },
  { id: 3, doctor_id: 5, status: 'confirmed', queue_no: 2, patient_name: 'Cy Roa' },
  { id: 4, doctor_id: 6, status: 'confirmed', queue_no: 1, patient_name: 'Di Paz' }]);
assert.deepStrictEqual(rows.map(r => r.is_next), [0, 1, 0, 1], 'first waiting patient of each doctor is "next"');
assert.strictEqual(firstNames(rows)[0].patient_name, 'Ana', 'public screens get first names only');

const { createHub } = require('../src/utils/realtime');
const live = [{ id: 7, doctor_id: 5, status: 'confirmed', queue_no: 2, patient_name: 'Ben Lim', is_next: 1 }];
const hub = createHub({ getQueue: async ids => (!ids || ids.includes(5) ? live : []), maxClients: 2, maxPerIp: 5 });
const fakeBrowser = ip => { const out = []; const res = new EventEmitter(); res.status = () => res; res.set = () => res; res.flushHeaders = () => {}; res.write = t => out.push(t); const req = new EventEmitter(); req.ip = ip; return { req, res, out }; };
(async () => {
  const a = fakeBrowser('1.1.1.1'), b = fakeBrowser('2.2.2.2'), c = fakeBrowser('3.3.3.3');
  assert(await hub.addClient(a.req, a.res) && await hub.addClient(b.req, b.res), 'two browsers connect');
  assert(a.out.join('').includes('event: snapshot') && a.out.join('').includes('"patient_name":"Ben"'), 'new browser gets a snapshot with first names');
  assert.strictEqual(await hub.addClient(c.req, c.res), false, 'connection limit is enforced');
  a.out.length = 0; b.out.length = 0;
  await hub.notifyQueue([5], 'done');
  for (const x of [a, b]) { const t = x.out.join(''); assert(t.includes('event: queue') && t.includes('"doctor_id":5') && t.includes('"reason":"done"') && t.includes('"is_next":1'), 'every open browser receives the queue event'); }
  a.out.length = 0; await hub.notifyQueue([99], 'done');
  assert(a.out.join('').includes('"rows":[]'), 'an emptied queue is pushed as empty rows');
  a.res.emit('close'); assert.strictEqual(hub.size(), 1, 'closed browsers are removed');
  b.out.length = 0; hub.heartbeat(); assert(b.out.join('').includes(': ping'), 'heartbeat keeps the connection alive');
  console.log('All logic tests passed.');
})().catch(e => { console.error(e); process.exit(1); });
