/* Live queue connection using Server-Sent Events (EventSource). The server pushes an event the moment a queue changes.
   The browser reconnects by itself after a drop; on every (re)connect the server first sends a full "snapshot". */
const Live = (() => {
  const URL_ = (window.KONSULTAP_API || '') + '/api/queue/stream';
  let es = null, on = false, opened = false, h = {};
  function connect(handlers) {
    h = handlers || h;
    if (!('EventSource' in window)) { h.state && h.state(false, 'unsupported'); return; }
    es = new EventSource(URL_);
    es.onopen = () => { on = true; opened = true; h.state && h.state(true); };
    es.onerror = () => {
      on = false;
      if (es.readyState === 2) {
        es.close();
        if (!opened) { h.state && h.state(false, 'unsupported'); return; }   // serverless host (e.g. Vercel): stop retrying and let polling take over
        h.state && h.state(false);
        setTimeout(() => connect(), 15000);   // server refused (e.g. at capacity): try again later
      } else { h.state && h.state(false); }
    };
    es.addEventListener('snapshot', e => { try { h.snapshot && h.snapshot(JSON.parse(e.data)); } catch {} });
    es.addEventListener('queue', e => { try { h.queue && h.queue(JSON.parse(e.data)); } catch {} });
  }
  return { connect, isLive: () => on };
})();
