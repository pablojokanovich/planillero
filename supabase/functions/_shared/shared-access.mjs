export async function passwordHash(password, salt, iterations = 310000) {
  const saltBytes = Uint8Array.from(salt.match(/.{2}/g) || [], value => parseInt(value, 16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations }, key, 256);
  return Array.from(new Uint8Array(bits), value => value.toString(16).padStart(2, '0')).join('');
}
export async function sharedAccessLogin(request, services) {
  const origin = request.headers.get('origin') || '';
  const allowed = services.origins.includes(origin);
  const headers = { 'Access-Control-Allow-Origin': allowed ? origin : 'null', Vary: 'Origin', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Headers': 'content-type, apikey, authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  const reply = (status, body) => Response.json(body, { status, headers });
  if (!allowed) return reply(403, { error: 'Origin not allowed' });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' });
  let body;
  try { body = await request.json(); } catch (error) { return reply(400, { error: 'Invalid request' }); }
  if (!body || !['full', 'calendar'].includes(body.kind) || typeof body.password !== 'string' || !body.password || body.password.length > 256) return reply(400, { error: 'Invalid request' });
  try {
    if (!(await services.consumeAttempt(body.kind, request))) return reply(429, { error: 'Too many attempts' });
    const credentials = await services.credentials(body.kind);
    if (!credentials) return reply(503, { error: 'Access not installed' });
    const actual = await passwordHash(body.password, credentials.salt, credentials.iterations);
    const expected = credentials.password_hash;
    let mismatch = actual.length ^ expected.length;
    for (let index = 0; index < actual.length; index++) mismatch |= actual.charCodeAt(index) ^ (expected.charCodeAt(index) || 0);
    if (mismatch) return reply(401, { error: 'Invalid credentials' });
    return reply(200, await services.session(credentials.email));
  } catch (error) { return reply(503, { error: 'Access service unavailable' }); }
}
