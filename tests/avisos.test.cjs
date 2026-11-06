const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const modulePath = pathToFileURL(path.resolve(__dirname, '../supabase/functions/_shared/departure-mailer.mjs')).href;
const id = '11111111-1111-4111-8111-111111111111';
const record = { id, created_by: 'admin', loading_at: '2026-11-03T08:00', departure_at: '2026-11-03T09:00',
  truck_type: 'Sprinter', driver: 'Jonathan Robles', origin: 'Deposito', stops: [{ destination: 'CEC', eta: '2026-11-03T10:00' }] };
const env = { supabaseUrl: 'https://example.test', serviceKey: 'server-only', resendKey: 'provider-only', webhookSecret: 'webhook-only', from: 'avisos@example.test' };
function request(payload, secret = 'webhook-only') { return new Request('https://example.test/notify', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': secret }, body: JSON.stringify(payload) }); }
const payload = { type: 'INSERT', table: 'logistics_departures', schema: 'public', record };

test('webhook rechaza acceso sin secreto y no envia por ediciones o creadores anonimos', async () => {
  const { handleDepartureEmail } = await import(modulePath);
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json([{ ...record, created_by: null }]); };
  assert.equal((await handleDepartureEmail(request(payload, 'bad'), env, fetcher)).status, 401);
  assert.equal(calls, 0);
  assert.equal((await handleDepartureEmail(request({ ...payload, type: 'UPDATE' }), env, fetcher)).status, 200);
  assert.equal(calls, 0);
  assert.equal((await (await handleDepartureEmail(request(payload), env, fetcher)).json()).skipped, true);
  assert.equal(calls, 1);
});

test('envia solo a destinatarios de la base, separados, y registra entregas para no repetir', async () => {
  const { handleDepartureEmail } = await import(modulePath);
  const deliveries = [];
  const mails = [];
  const fetcher = async (url, options = {}) => {
    if (url === 'https://api.resend.com/emails') {
      assert.match(options.headers['Idempotency-Key'], /^departure-/);
      mails.push(JSON.parse(options.body)); return Response.json({ id: 'provider-id' });
    }
    assert.equal(options.headers.Authorization, 'Bearer server-only');
    if (url.includes('/logistics_departures?')) return Response.json([record]);
    if (url.includes('/departure_notification_admins?')) return Response.json([{ user_id: 'admin' }]);
    if (url.includes('/departure_notification_recipients?')) return Response.json([{ id: 'a', email: 'uno@example.test' }, { id: 'b', email: 'dos@example.test' }]);
    if (options.method === 'POST') { deliveries.push(JSON.parse(options.body)); return new Response(null, { status: 204 }); }
    return Response.json(deliveries);
  };
  const result = await handleDepartureEmail(request({ ...payload, recipients: ['atacante@example.test'] }), env, fetcher);
  assert.equal(result.status, 200);
  assert.equal(mails.length, 2);
  assert.deepEqual(mails[0].to, ['uno@example.test']);
  assert.deepEqual(mails[1].to, ['dos@example.test']);
  assert.match(mails[0].text, /Jonathan Robles/);
  assert.match(mails[0].text, /Carga: 03\/11\/2026 08:00/);
  assert.match(mails[0].text, /CEC/);
  await handleDepartureEmail(request(payload), env, fetcher);
  assert.equal(mails.length, 2);
});

test('un fallo del proveedor no queda marcado como enviado ni expone secretos en el error', async () => {
  const { handleDepartureEmail } = await import(modulePath);
  const fetcher = async url => {
    if (url.includes('/logistics_departures?')) return Response.json([record]);
    if (url.includes('/departure_notification_admins?')) return Response.json([{ user_id: 'admin' }]);
    if (url.includes('/departure_notification_recipients?')) return Response.json([{ id: 'a', email: 'uno@example.test' }]);
    if (url.includes('/departure_notification_deliveries?')) return Response.json([]);
    return Response.json({ error: 'provider-only' }, { status: 500 });
  };
  const result = await handleDepartureEmail(request(payload), env, fetcher);
  assert.equal(result.status, 502);
  assert.deepEqual(await result.json(), { sent: 0, failed: 1 });
});

test('Microsoft 365 usa OAuth de servidor, el buzon de prueba y acepta la respuesta vacia 202', async () => {
  const { handleDepartureEmail } = await import(modulePath);
  const graphEnv = { ...env, provider: 'microsoft365', from: 'pjokanovich@congressrental.com',
    microsoftTenantId: 'tenant-test', microsoftClientId: 'client-test', microsoftClientSecret: 'secret-test' };
  const deliveries = [];
  const messages = [];
  let tokenCalls = 0;
  const fetcher = async (url, options = {}) => {
    if (url.startsWith('https://login.microsoftonline.com/')) {
      tokenCalls++;
      const params = new URLSearchParams(options.body);
      assert.equal(params.get('grant_type'), 'client_credentials');
      assert.equal(params.get('scope'), 'https://graph.microsoft.com/.default');
      assert.equal(params.get('client_secret'), 'secret-test');
      assert.equal(params.has('password'), false);
      return Response.json({ access_token: 'graph-token-test', expires_in: 3600 });
    }
    if (url.startsWith('https://graph.microsoft.com/')) {
      assert.equal(url, 'https://graph.microsoft.com/v1.0/users/pjokanovich%40congressrental.com/sendMail');
      assert.equal(options.headers.Authorization, 'Bearer graph-token-test');
      assert.equal('Idempotency-Key' in options.headers, false);
      const body = JSON.parse(options.body);
      assert.equal(body.saveToSentItems, true);
      assert.equal(body.message.body.contentType, 'Text');
      messages.push(body.message);
      return new Response(null, { status: 202 });
    }
    if (url.includes('/logistics_departures?')) return Response.json([record]);
    if (url.includes('/departure_notification_admins?')) return Response.json([{ user_id: 'admin' }]);
    if (url.includes('/departure_notification_recipients?')) return Response.json([{ id: 'a', email: 'uno@example.test' }, { id: 'b', email: 'dos@example.test' }]);
    if (options.method === 'POST') { deliveries.push(JSON.parse(options.body)); return new Response(null, { status: 204 }); }
    return Response.json(deliveries);
  };
  const result = await handleDepartureEmail(request(payload), graphEnv, fetcher);
  assert.equal(result.status, 200);
  assert.equal(tokenCalls, 1);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0].toRecipients, [{ emailAddress: { address: 'uno@example.test' } }]);
  assert.match(deliveries[0].provider_id, /^microsoft365:accepted:/);
  await handleDepartureEmail(request(payload), graphEnv, fetcher);
  assert.equal(tokenCalls, 1);
  assert.equal(messages.length, 2);
});

test('Microsoft 365 no envia ante credenciales faltantes o fallos de autorizacion', async () => {
  const { handleDepartureEmail } = await import(modulePath);
  const { createMailSender } = await import(new URL('./mail-transport.mjs', modulePath).href);
  let calls = 0;
  const graphEnv = { ...env, provider: 'microsoft365', microsoftTenantId: 'tenant', microsoftClientId: 'client' };
  const unavailable = await handleDepartureEmail(request(payload), graphEnv, async () => { calls++; });
  assert.equal(unavailable.status, 503);
  assert.equal(calls, 0);
  const sender = createMailSender({ ...graphEnv, microsoftClientSecret: 'secret' }, async url => {
    calls++;
    assert(url.startsWith('https://login.microsoftonline.com/'));
    return Response.json({ error: 'secret' }, { status: 401 });
  });
  await assert.rejects(sender({ email: 'uno@example.test' }, { subject: 'Prueba', text: 'Texto' }, 'test'), /authorization failed/);
  assert.equal(calls, 1);
});
