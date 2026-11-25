/* Real-time push to the browsers using Server-Sent Events (SSE): one open HTTP connection per visitor,
   the server writes an event whenever the queue changes. Browsers reconnect by themselves if the connection drops.
   Works on a single server process. (Several server copies would need a shared channel such as Redis pub/sub.) */
const { markNext, firstNames } = require('./queue.pure');

function createHub({ getQueue, maxClients = Number(process.env.LIVE_MAX_CLIENTS) || 2000, maxPerIp = Number(process.env.LIVE_MAX_PER_IP) || 20 }) {
  const clients = new Set(), perIp = new Map();
  let seq = 0;

  const send = (res, event, data, id) => res.write(`${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const drop = c => { if (clients.delete(c)) { const n = (perIp.get(c.ip) || 1) - 1; n > 0 ? perIp.set(c.ip, n) : perIp.delete(c.ip); } };

  /** Opens a stream for one browser. Returns false if the server is at its connection limit. */
  async function addClient(req, res) {
    const ip = req.ip || 'unknown';
    if (clients.size >= maxClients || (perIp.get(ip) || 0) >= maxPerIp) return false;
    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write('retry: 3000\n\n');                                   // browser waits 3 s before reconnecting
    const c = { res, ip }; clients.add(c); perIp.set(ip, (perIp.get(ip) || 0) + 1);
    res.on('close', () => drop(c));                                  // (res, not req: req 'close' can fire early on modern Node)
    try { send(res, 'snapshot', { seq, rows: firstNames(await getQueue()), at: Date.now() }); } catch { drop(c); }   // full picture on connect / reconnect
    return true;
  }

  /** Call after any change to a doctor's queue (done, serving, confirmed, cancelled, arrived...). Never throws. */
  async function notifyQueue(doctorIds, reason = 'update') {
    try {
      const ids = [...new Set((doctorIds || []).filter(Boolean))];
      if (!ids.length || !clients.size) return 0;
      const rows = firstNames(await getQueue(ids));
      const ev = ++seq;
      for (const id of ids) {
        const payload = { seq: ev, reason, doctor_id: id, rows: rows.filter(r => r.doctor_id === id), at: Date.now() };   // empty rows = that doctor's queue is now empty
        for (const c of clients) { try { send(c.res, 'queue', payload, ev); } catch { drop(c); } }
      }
      return clients.size;
    } catch (e) { console.error('Real-time push failed:', e.message); return 0; }
  }

  /** Keeps proxies and browsers from closing idle connections. */
  const heartbeat = () => { for (const c of clients) { try { c.res.write(': ping\n\n'); } catch { drop(c); } } };
  const timer = setInterval(heartbeat, 25000); timer.unref();

  return { addClient, notifyQueue, heartbeat, size: () => clients.size };
}

module.exports = createHub({ getQueue: (...a) => require('./queue').todaysQueue(...a) });
module.exports.createHub = createHub;
