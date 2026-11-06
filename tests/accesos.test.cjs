const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pbkdf2Sync } = require('node:crypto');
const modulePromise = import('../supabase/functions/_shared/shared-access.mjs');
const origin = 'https://app.example.test';
function request(body, site = origin) {
  return new Request(origin, { method: 'POST', headers: { origin: site, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
test('claves elegidas: hash compatible y sesiones separadas sin guardar texto plano', async () => {
  const { passwordHash, sharedAccessLogin } = await modulePromise;
  const salt = '18a9706f519bc25a4fa3e8fab49506ba';
  const passwords = { full: 'cr2026', calendar: '1667' };
  const records = {};
  for (const role of Object.keys(passwords)) {
    const hash = await passwordHash(passwords[role], salt);
    assert.equal(hash, pbkdf2Sync(passwords[role], Buffer.from(salt, 'hex'), 310000, 32, 'sha256').toString('hex'));
    records[role] = { email: role, salt, iterations: 310000, password_hash: hash };
  }
  let sessions = 0;
  const services = { origins: [origin], consumeAttempt: async () => true,
    credentials: async kind => records[kind], session: async email => { sessions++; return { access_token: email, refresh_token: 'refresh', expires_in: 3600 }; } };
  for (const kind of Object.keys(passwords)) {
    const response = await sharedAccessLogin(request({ kind, password: passwords[kind] }), services);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).access_token, kind);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await sharedAccessLogin(request({ kind: 'full', password: '1667' }), services)).status, 401);
  assert.equal(sessions, 2);
  assert.equal((await sharedAccessLogin(request({ kind: 'full', password: 'cr2026' }, 'https://otro.test'), services)).status, 403);
  assert.equal((await sharedAccessLogin(request(null), services)).status, 400);
  assert.equal((await sharedAccessLogin(request({ kind: 'full', password: 'cr2026' }), { ...services, consumeAttempt: async () => false })).status, 429);
  const failure = await sharedAccessLogin(request({ kind: 'full', password: 'cr2026' }), { ...services, credentials: async () => { throw Error('PRIVATE SECRET'); } });
  assert.equal(failure.status, 503);
  assert(!JSON.stringify(await failure.json()).includes('PRIVATE'));
  assert.equal(sessions, 2);
});
