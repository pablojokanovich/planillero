import { readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { passwordHash } from '../supabase/functions/_shared/shared-access.mjs';

const configPath = new URL('../supabase-config.js', import.meta.url);
const config = await readFile(configPath, 'utf8');
if (!/APP_ACCESS_ENABLED:\s*false/.test(config)) throw new Error('El acceso ya esta activo o falta su configuracion. No se modifico nada.');
const url = process.env.SUPABASE_URL || config.match(/SUPABASE_URL:\s*'([^']+)'/)[1];
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const site = process.env.APP_ORIGIN;
if (!serviceKey || !site || !/^https:\/\//.test(site)) throw new Error('Configurar SUPABASE_SERVICE_ROLE_KEY y APP_ORIGIN (sitio HTTPS). No se modifico el acceso.');
await access(configPath, constants.W_OK);
async function api(path, options = {}) {
  const response = await fetch(url + path, { ...options, signal: AbortSignal.timeout(15000), headers: {
    apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', ...options.headers
  } });
  if (!response.ok) throw new Error(`No se pudo preparar el acceso (${response.status}). El bloqueo no se activa.`);
  return response.status === 204 ? null : response.json();
}
await api('/rest/v1/app_access_credentials?select=role&limit=1');
async function secret(label) {
  if (!process.stdin.isTTY) throw new Error('Ejecutar desde una terminal interactiva para cargar las claves.');
  let muted = false;
  const output = new Writable({ write(chunk, encoding, done) { if (!muted) process.stdout.write(chunk); done(); } });
  const reader = createInterface({ input: process.stdin, output, terminal: true });
  process.stdout.write(label + ': '); muted = true;
  try { return await reader.question(''); }
  finally { muted = false; reader.close(); process.stdout.write('\n'); }
}
const passwords = { full: await secret('Clave de administrador'), calendar: await secret('Clave de consulta') };
if (!passwords.full || !passwords.calendar || passwords.full === passwords.calendar) throw new Error('Las claves deben ser distintas y no estar vacias.');
const accounts = { full: 'acceso-completo@planillero.invalid', calendar: 'calendarios@planillero.invalid' };
let users = [];
for (let page = 1; ; page++) {
  const batch = await api(`/auth/v1/admin/users?page=${page}&per_page=100`);
  users.push(...batch.users);
  if (batch.users.length < 100) break;
}
for (const role of ['full', 'calendar']) {
  let user = users.find(item => item.email === accounts[role]);
  if (!user) user = await api('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: accounts[role], email_confirm: true, password: randomBytes(32).toString('base64url') }) });
  user = user.user || user;
  if (!user.id) throw new Error('No se pudo verificar la cuenta tecnica. No se activo el bloqueo.');
  const salt = randomBytes(16).toString('hex');
  const hash = await passwordHash(passwords[role], salt);
  const upsertHeaders = { Prefer: 'resolution=merge-duplicates,return=minimal' };
  await api('/rest/v1/app_access_roles?on_conflict=user_id', { method: 'POST', headers: upsertHeaders, body: JSON.stringify({ user_id: user.id, role }) });
  await api('/rest/v1/app_access_credentials?on_conflict=role', { method: 'POST', headers: upsertHeaders,
    body: JSON.stringify({ role, email: accounts[role], salt, iterations: 310000, password_hash: hash }) });
  if (role === 'full') await api('/rest/v1/departure_notification_admins?on_conflict=user_id', { method: 'POST', headers: upsertHeaders, body: JSON.stringify({ user_id: user.id }) });
}
// Verify both real logins before changing any existing permissions or enabling the UI gate.
for (const kind of ['full', 'calendar']) {
  const response = await fetch(`${url}/functions/v1/app-access-login`, { method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', Origin: new URL(site).origin }, body: JSON.stringify({ kind, password: passwords[kind] }) });
  if (!response.ok) throw new Error(`Fallo la prueba del acceso ${kind}. No se activo el bloqueo.`);
  const session = await response.json();
  if (!session.access_token) throw new Error('La prueba no devolvio una sesion. No se activo el bloqueo.');
}
await api('/rest/v1/rpc/activate_app_access', { method: 'POST', body: '{}' });
await writeFile(configPath, config.replace(/APP_ACCESS_ENABLED:\s*false/, 'APP_ACCESS_ENABLED: true'), 'utf8');
console.log('Los dos accesos fueron verificados y activados. Publicar supabase-config.js actualizado junto con los archivos de acceso.');
