// End-to-end API smoke test:  npm run test:api
// Optional custom URL (e.g. after deploying to Render):  node scripts/test-api.js https://your-app.onrender.com
// Uses only read-only checks + invalid-input checks so it never pollutes your demo data.

const BASE = (process.argv[2] || process.env.API_URL || 'http://localhost:3000').replace(/\/+$/, '');
let passed = 0, failed = 0;

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, data };
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL  ${name}\n      ${e.message}`);
  }
}

const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

(async () => {
  console.log(`Testing KonsulTap API at ${BASE}\n`);

  // 1. Health & static frontend
  await test('GET / (frontend served by Express)', async () => {
    const r = await req('/');
    expect(r.status === 200 && typeof r.data === 'string' && r.data.includes('KonsulTap'), `Expected 200 HTML, got ${r.status}`);
  });
  await test('GET /api/health (Express + DB connected)', async () => {
    const r = await req('/api/health');
    expect(r.status === 200 && r.data?.status === 'ok' && r.data?.database === 'connected', `Got ${r.status}: ${JSON.stringify(r.data)}`);
  });
  await test('GET /api/does-not-exist -> 404 JSON', async () => {
    const r = await req('/api/does-not-exist');
    expect(r.status === 404 && r.data?.error === 'Route not found', `Got ${r.status}: ${JSON.stringify(r.data)}`);
  });

  // 2. Public endpoints
  await test('GET /api/departments', async () => {
    const r = await req('/api/departments');
    expect(r.status === 200 && Array.isArray(r.data) && r.data.length > 0, `Expected non-empty array, got ${r.status}`);
  });
  await test('GET /api/doctors', async () => {
    const r = await req('/api/doctors');
    expect(r.status === 200 && Array.isArray(r.data) && r.data.length > 0, `Expected non-empty array, got ${r.status}`);
  });
  let sampleRef = 'KT-D000';
  await test('GET /api/queue', async () => {
    const r = await req('/api/queue');
    expect(r.status === 200 && Array.isArray(r.data), `Expected array, got ${r.status}`);
    if (r.data[0]?.ref) sampleRef = r.data[0].ref;
  });
  await test(`GET /api/track/${sampleRef}`, async () => {
    const r = await req('/api/track/' + encodeURIComponent(sampleRef));
    expect(r.status === 200 || r.status === 404, `Unexpected status ${r.status}`);
  });
  await test('GET /api/leave/today', async () => {
    const r = await req('/api/leave/today');
    expect(r.status === 200 && Array.isArray(r.data), `Expected array, got ${r.status}`);
  });
  await test('GET /api/facilities (public: beds only)', async () => {
    const r = await req('/api/facilities');
    expect(r.status === 200 && Array.isArray(r.data) && r.data.every(f => f.kind === 'bed'), `Expected beds-only array, got ${r.status}`);
  });
  await test('GET /api/forecast/history', async () => {
    const r = await req('/api/forecast/history');
    expect(r.status === 200 && Array.isArray(r.data), `Expected array, got ${r.status}`);
  });
  await test('GET /api/password/verify?token=invalid', async () => {
    const r = await req('/api/password/verify?token=invalid');
    expect(r.status === 200 && r.data?.valid === false, `Got ${r.status}: ${JSON.stringify(r.data)}`);
  });

  // 3. Unauthenticated & validation guards
  await test('GET /api/me (logged out -> null)', async () => {
    const r = await req('/api/me');
    expect(r.status === 200 && r.data === null, `Got ${r.status}: ${JSON.stringify(r.data)}`);
  });
  await test('GET /api/admin/doctors (logged out -> 401)', async () => {
    const r = await req('/api/admin/doctors');
    expect(r.status === 401, `Expected 401, got ${r.status}`);
  });
  await test('POST /api/register rejects invalid email -> 400', async () => {
    const r = await req('/api/register', { method: 'POST', body: { name: 'Test', email: 'not-an-email', password: 'Str0ngPassword!', confirm: 'Str0ngPassword!', consent: true } });
    expect(r.status === 400, `Expected 400, got ${r.status}`);
  });
  await test('POST /api/register rejects mismatched confirm -> 400', async () => {
    const r = await req('/api/register', { method: 'POST', body: { name: 'Test', email: 'test@gmail.com', password: 'Str0ngPassword!', confirm: 'DifferentPass!', consent: true } });
    expect(r.status === 400, `Expected 400, got ${r.status}`);
  });
  await test('POST /api/login rejects wrong password -> 401', async () => {
    const r = await req('/api/login', { method: 'POST', body: { role: 'patient', username: 'patient@demo.com', password: 'wrong-password' } });
    expect(r.status === 401, `Expected 401, got ${r.status}`);
  });

  // 4. Patient role
  let patToken = null;
  await test('POST /api/login (patient)', async () => {
    const r = await req('/api/login', { method: 'POST', body: { role: 'patient', username: 'patient@demo.com', password: 'patient123' } });
    expect(r.status === 200 && r.data?.token && r.data?.user?.role === 'patient', `Got ${r.status}: ${JSON.stringify(r.data)}`);
    patToken = r.data.token;
  });
  if (patToken) {
    await test('GET /api/my/appointments (patient)', async () => {
      const r = await req('/api/my/appointments', { token: patToken });
      expect(r.status === 200 && Array.isArray(r.data), `Got ${r.status}`);
    });
    await test('RBAC: patient blocked from /api/admin/doctors -> 403', async () => {
      const r = await req('/api/admin/doctors', { token: patToken });
      expect(r.status === 403, `Expected 403, got ${r.status}`);
    });
    await test('RBAC: patient blocked from /api/patients -> 403', async () => {
      const r = await req('/api/patients', { token: patToken });
      expect(r.status === 403, `Expected 403, got ${r.status}`);
    });
  }

  // 5. Doctor role
  let docToken = null;
  await test('POST /api/login (doctor D031)', async () => {
    const r = await req('/api/login', { method: 'POST', body: { role: 'doctor', username: 'D031', password: 'doctor123' } });
    expect(r.status === 200 && r.data?.token && r.data?.user?.role === 'doctor', `Got ${r.status}: ${JSON.stringify(r.data)}`);
    docToken = r.data.token;
  });
  if (docToken) {
    await test('GET /api/appointments (doctor)', async () => {
      const r = await req('/api/appointments', { token: docToken });
      expect(r.status === 200 && Array.isArray(r.data), `Got ${r.status}`);
    });
    await test('GET /api/patients (doctor)', async () => {
      const r = await req('/api/patients', { token: docToken });
      expect(r.status === 200 && Array.isArray(r.data), `Got ${r.status}`);
    });
    await test('GET /api/facilities (doctor sees equipment too)', async () => {
      const r = await req('/api/facilities', { token: docToken });
      expect(r.status === 200 && r.data.some(f => f.kind === 'equipment'), `Expected equipment rows, got ${r.status}`);
    });
    await test('RBAC: doctor blocked from /api/admin/doctors -> 403', async () => {
      const r = await req('/api/admin/doctors', { token: docToken });
      expect(r.status === 403, `Expected 403, got ${r.status}`);
    });
  }

  // 6. Admin role
  let adminToken = null;
  await test('POST /api/login (admin)', async () => {
    const r = await req('/api/login', { method: 'POST', body: { role: 'admin', username: 'admin', password: 'admin123' } });
    expect(r.status === 200 && r.data?.token && r.data?.user?.role === 'admin', `Got ${r.status}: ${JSON.stringify(r.data)}`);
    adminToken = r.data.token;
  });
  if (adminToken) {
    for (const ep of ['/api/appointments', '/api/admin/doctors', '/api/leave', '/api/audit', '/api/queue/stats', '/api/emails']) {
      await test(`GET ${ep} (admin)`, async () => {
        const r = await req(ep, { token: adminToken });
        expect(r.status === 200, `Got ${r.status}: ${JSON.stringify(r.data)}`);
      });
    }
    await test('RBAC: admin blocked from doctor-only /api/patients -> 403', async () => {
      const r = await req('/api/patients', { token: adminToken });
      expect(r.status === 403, `Expected 403, got ${r.status}`);
    });
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
})();
