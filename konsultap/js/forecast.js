/* Peak-hour prediction with TensorFlow.js.
   A small neural network learns "patients per hour" from past bookings (hour of day + day of week),
   then predicts every clinic hour for the chosen date. Training runs in the browser. */
const Forecast = {
  features(dateStr, h, hours) {
    const dow = (new Date(dateStr + 'T00:00:00').getDay() + 6) % 7;
    return [...hours.map(x => +(x === h)), ...Array.from({ length: 7 }, (_, i) => +(i === dow))];
  },
  async run(target, rows, hours) {
    if (!rows.length) throw new Error('Not enough booking history yet.');
    const cnt = {}; rows.forEach(a => { const k = a.date + '|' + +a.time.slice(0, 2); cnt[k] = (cnt[k] || 0) + 1; });
    const days = [...new Set(rows.map(a => a.date))].sort();
    const X = [], Y = [];
    days.forEach(d => hours.forEach(h => { X.push(this.features(d, h, hours)); Y.push(cnt[d + '|' + h] || 0); }));
    const hasTF = typeof tf !== 'undefined', top = o => [...o].sort((a, b) => b.yhat - a.yhat).slice(0, 3).map(r => r.hour).sort((a, b) => a - b);
    let out, engine, loss = null;
    if (hasTF) {
      const scale = Math.max(...Y, 1), xs = tf.tensor2d(X), ys = tf.tensor2d(Y.map(y => [y / scale]));
      const model = tf.sequential({ layers: [
        tf.layers.dense({ inputShape: [X[0].length], units: 24, activation: 'relu' }),
        tf.layers.dense({ units: 12, activation: 'relu' }),
        tf.layers.dense({ units: 1 })] });
      model.compile({ optimizer: tf.train.adam(0.02), loss: 'meanSquaredError' });
      const h = await model.fit(xs, ys, { epochs: 80, batchSize: 32, shuffle: true, verbose: 0 });
      loss = h.history.loss.at(-1);
      const ft = model.predict(xs), fit = ft.dataSync(), sd = Math.sqrt(Y.reduce((s, y, i) => s + (y - fit[i] * scale) ** 2, 0) / Y.length);
      const xt = tf.tensor2d(hours.map(x => this.features(target, x, hours))), pt = model.predict(xt), pr = pt.dataSync();
      out = hours.map((hr, i) => { const y = Math.max(0, pr[i] * scale); return { hour: hr, yhat: +y.toFixed(1), lo: +Math.max(0, y - 1.28 * sd).toFixed(1), hi: +(y + 1.28 * sd).toFixed(1) }; });
      [xs, ys, ft, xt, pt].forEach(t => t.dispose()); model.dispose(); engine = 'TensorFlow.js neural network (trained in your browser, final loss ' + loss.toFixed(4) + ')';
    } else {
      const dow = this.features(target, hours[0], hours).slice(hours.length).indexOf(1);
      out = hours.map(hr => { const v = days.filter(d => this.features(d, hr, hours).slice(hours.length).indexOf(1) === dow).map(d => cnt[d + '|' + hr] || 0); return { hour: hr, yhat: +(v.reduce((a, b) => a + b, 0) / (v.length || 1)).toFixed(1), lo: null, hi: null }; });
      engine = 'Hourly average (fallback: TensorFlow.js could not load, so check your internet connection)';
    }
    return { engine, date: target, hours: out, peaks: top(out), days_of_history: days.length };
  }
};
