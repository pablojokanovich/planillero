(function () {
  'use strict';
  const config = window.PDF_ARCHIVE_CONFIG;
  if (config.SHOW_TRUCK_DEPARTURES === false) document.documentElement.dataset.trucksHidden = 'true';
  const nativeFetch = window.fetch.bind(window);
  const key = 'cr_app_access_v1';
  const page = location.pathname.split('/').pop() || 'index.html';
  const isLogin = page === 'acceso.html';
  if (config.APP_ACCESS_ENABLED !== true) {
    const publicPdf = path => `${config.SUPABASE_URL}/storage/v1/object/public/${config.SUPABASE_BUCKET}/${String(path || '').split('/').map(encodeURIComponent).join('/')}`;
    window.AppAccess = {
      enabled: false, ready: Promise.resolve('full'), isFull: () => true, isCalendar: () => false,
      token: async () => config.SUPABASE_KEY,
      login: async () => { location.replace('index.html'); }, logout: async () => {},
      signedPdfUrl: async path => publicPdf(path),
      openPdf: path => { if (path) window.open(publicPdf(path), '_blank', 'noopener,noreferrer'); }
    };
    delete document.documentElement.dataset.accessPending;
    if (isLogin) location.replace('index.html');
    return;
  }
  const calendarPages = new Set(['index.html', 'archivo.html', 'salidas.html', 'eventos.html']);
  let session = null;
  let role = '';
  let refreshing = null;
  try { session = JSON.parse(sessionStorage.getItem(key)); } catch (error) {}
  if (!isLogin) document.documentElement.dataset.accessPending = 'true';

  async function raw(path, options = {}, token) {
    return nativeFetch(`${config.SUPABASE_URL}${path}`, { ...options, signal: options.signal || AbortSignal.timeout(12000),
      headers: { apikey: config.SUPABASE_KEY, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  }
  function save() { sessionStorage.setItem(key, JSON.stringify(session)); }
  function clear() { session = null; role = ''; sessionStorage.removeItem(key); sessionStorage.removeItem('cr_avisos_admin_session'); }
  function goLogin() {
    document.documentElement.dataset.accessPending = 'true';
    if (!isLogin) location.replace(`acceso.html?next=${encodeURIComponent(page + location.search + location.hash)}`);
  }
  async function token() {
    if (!session || session.until <= Date.now()) { clear(); goLogin(); throw new Error('Sesión vencida.'); }
    if (session.expires_at > Date.now() + 60000) return session.access_token;
    if (!refreshing) refreshing = (async () => {
      const response = await raw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }) });
      if (!response.ok) { clear(); goLogin(); throw new Error('Iniciá sesión nuevamente.'); }
      const auth = await response.json();
      session = { ...session, access_token: auth.access_token, refresh_token: auth.refresh_token, expires_at: Date.now() + auth.expires_in * 1000 };
      save(); return session.access_token;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  async function verify() {
    const accessToken = await token();
    const userResponse = await raw('/auth/v1/user', {}, accessToken);
    if (!userResponse.ok) throw new Error('La sesión no es válida.');
    const user = await userResponse.json();
    const roleResponse = await raw(`/rest/v1/app_access_roles?user_id=eq.${encodeURIComponent(user.id)}&select=role`, {}, accessToken);
    if (!roleResponse.ok) throw new Error('El acceso de la app no está configurado.');
    const rows = await roleResponse.json();
    if (!['full', 'calendar'].includes(rows[0]?.role)) throw new Error('Esta cuenta no tiene acceso.');
    role = rows[0].role;
    return role;
  }
  function allowed(href) {
    const url = new URL(href, location.href);
    return url.origin === location.origin && (role === 'full' || calendarPages.has(url.pathname.split('/').pop() || 'index.html'));
  }
  function apply() {
    document.documentElement.dataset.accessRole = role;
    for (const link of document.querySelectorAll('.main-nav a, .home-menu a')) link.hidden = !allowed(link.href);
    if (role === 'calendar') {
      for (const element of document.querySelectorAll('[data-access="full"]')) element.hidden = true;
    }
    if (!document.getElementById('app-logout')) {
      const button = document.createElement('button');
      button.id = 'app-logout'; button.type = 'button'; button.textContent = 'Salir'; button.onclick = logout;
      document.querySelector('header')?.appendChild(button);
    }
    delete document.documentElement.dataset.accessPending;
  }
  async function login(password, kind) {
    if (!['full', 'calendar'].includes(kind)) throw new Error('Elegí el tipo de acceso.');
    const response = await raw('/functions/v1/app-access-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, password }) });
    if (!response.ok) throw new Error(response.status === 429 ? 'Demasiados intentos. Esperá unos minutos.' : 'La contraseña no es correcta o el acceso no está habilitado.');
    const auth = await response.json();
    session = { access_token: auth.access_token, refresh_token: auth.refresh_token, expires_at: Date.now() + auth.expires_in * 1000, until: Date.now() + 8 * 60 * 60 * 1000 };
    try { await verify(); if (role !== kind) throw new Error('El tipo de acceso no coincide.'); save(); }
    catch (error) { clear(); throw error; }
    const next = new URLSearchParams(location.search).get('next') || 'index.html';
    const target = new URL(next, location.href);
    location.replace(allowed(target.href) && target.pathname.split('/').pop() !== 'acceso.html' ? target.href : 'index.html');
  }
  async function logout() {
    const localKeys = Object.keys(localStorage).filter(name => name.startsWith('cr_'));
    if (localKeys.length && !confirm('Al salir se borrarán los borradores y copias locales de este navegador. Los datos online no se borran. ¿Cerrar sesión?')) return;
    try { if (session) await raw('/auth/v1/logout?scope=local', { method: 'POST' }, session.access_token); } catch (error) {}
    localKeys.forEach(name => localStorage.removeItem(name));
    Object.keys(sessionStorage).filter(name => name.startsWith('cr_')).forEach(name => sessionStorage.removeItem(name));
    clear(); document.documentElement.dataset.accessPending = 'true'; location.replace('acceso.html');
  }
  async function signedPdfUrl(path) {
    if (!['full', 'calendar'].includes(role)) throw new Error('Acceso no permitido.');
    const file = String(path || '').split('/').map(encodeURIComponent).join('/');
    if (!file) throw new Error('El PDF no tiene una ruta guardada.');
    const response = await window.fetch(`${config.SUPABASE_URL}/storage/v1/object/sign/${config.SUPABASE_BUCKET}/${file}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 300 }) });
    if (!response.ok) throw new Error('No se pudo autorizar la descarga.');
    const data = await response.json();
    const value = data.signedURL || data.signedUrl;
    const url = new URL(value?.startsWith('/object/') ? `/storage/v1${value}` : value, config.SUPABASE_URL);
    if (url.origin !== new URL(config.SUPABASE_URL).origin || !value) throw new Error('Enlace de descarga inválido.');
    return url.href;
  }
  async function openPdf(path) {
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try { const url = await signedPdfUrl(path); if (tab) tab.location.replace(url); else location.assign(url); }
    catch (error) { tab?.close(); alert(error.message); }
  }
  let ready;
  if (isLogin) ready = Promise.resolve();
  else ready = verify().then(() => {
    if (!allowed(location.href)) { location.replace('index.html'); return new Promise(() => {}); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true }); else apply();
    return role;
  }).catch(error => { clear(); goLogin(); throw error; });
  // Attach a rejection handler even on pages whose only startup work is navigation.
  ready.catch(() => {});
  window.AppAccess = { ready, login, logout, token, isCalendar: () => role === 'calendar', isFull: () => role === 'full', openPdf, signedPdfUrl };
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    const project = new URL(config.SUPABASE_URL);
    if (url.origin !== project.origin || !/^\/(rest|storage)\/v1\//.test(url.pathname)) return nativeFetch(input, options);
    await ready;
    const accessToken = await token();
    const headers = new Headers(input instanceof Request ? input.headers : {});
    new Headers(options.headers).forEach((value, name) => headers.set(name, value));
    headers.set('apikey', config.SUPABASE_KEY); headers.set('Authorization', `Bearer ${accessToken}`);
    const method = (options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const signPdf = method === 'POST' && url.pathname.startsWith(`/storage/v1/object/sign/${config.SUPABASE_BUCKET}/`);
    if (role === 'calendar' && !['GET', 'HEAD'].includes(method) && !signPdf) return new Response(null, { status: 403 });
    const response = await nativeFetch(input, { ...options, headers });
    if (response.status === 401) { clear(); goLogin(); }
    return response;
  };
  if (!isLogin) setInterval(() => { if (session?.until <= Date.now()) { clear(); goLogin(); } }, 30000);
})();
