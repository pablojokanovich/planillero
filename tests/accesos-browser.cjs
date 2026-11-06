const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream');
    let body = fs.readFileSync(file);
    if (file.endsWith('supabase-config.js')) body = body.toString().replace('APP_ACCESS_ENABLED: false', 'APP_ACCESS_ENABLED: true');
    res.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const context = await browser.newContext();
    const errors = [], writes = [];
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.hostname === '127.0.0.1') return route.continue();
      if (url.pathname === '/functions/v1/app-access-login') {
        const { kind, password } = req.postDataJSON();
        return route.fulfill({ status: password === ({ full: 'cr2026', calendar: '1667' })[kind] ? 200 : 401,
          json: { access_token: kind, refresh_token: 'refresh', expires_in: 3600 } });
      }
      const role = req.headers().authorization?.replace('Bearer ', '');
      if (url.pathname === '/auth/v1/user') return route.fulfill({ json: { id: role } });
      if (url.pathname === '/rest/v1/app_access_roles') return route.fulfill({ json: [{ role }] });
      if (url.pathname === '/auth/v1/logout') return route.fulfill({ json: {} });
      if (url.pathname.startsWith('/storage/v1/object/sign/')) return route.fulfill({ json: { signedURL: '/object/sign/planillas/test.pdf?token=mock' } });
      if (url.pathname.startsWith('/rest/v1/')) {
        if (req.method() !== 'GET') writes.push(req.url());
        return route.fulfill({ json: url.pathname.endsWith('/pdf_documents') ? [{ id: 'test', os: '123', storage_path: 'test.pdf', filename: 'test.pdf', created_at: '2026-11-03', area: 'CCTV' }] : [] });
      }
      return route.fulfill({ body: '', contentType: 'text/javascript' });
    });
    const page = await context.newPage();
    page.on('dialog', dialog => dialog.accept());
    page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(base + '/index.html');
    await page.waitForURL('**/acceso.html?next=*');
    await page.locator('[value="calendar"]').check();
    await page.locator('#access-password').fill('mala');
    await page.locator('#login-submit').click();
    await page.locator('#login-error:not([hidden])').waitFor();
    await page.locator('#access-password').fill('1667');
    await page.locator('#login-submit').click();
    await page.waitForURL('**/index.html');
    await page.waitForFunction(() => document.documentElement.dataset.accessRole === 'calendar');
    assert.equal(await page.locator('.home-action:visible').count(), 2);
    assert(!(await page.evaluate(() => sessionStorage.getItem('cr_app_access_v1'))).includes('1667'));
    await page.goto(base + '/archivo.html');
    await page.locator('.file-actions .pdf-link').waitFor();
    assert.equal(await page.locator('.file-actions button').count(), 0);
    const result = await page.evaluate(async () => ({
      write: (await fetch(PDF_ARCHIVE_CONFIG.SUPABASE_URL + '/rest/v1/pdf_documents', { method: 'DELETE' })).status,
      pdf: await AppAccess.signedPdfUrl('test.pdf')
    }));
    assert.equal(result.write, 403); assert.match(result.pdf, /token=mock/);
    for (const file of ['salidas.html', 'eventos.html']) {
      await page.goto(base + '/' + file);
      await page.waitForFunction(() => document.documentElement.dataset.accessRole === 'calendar');
      assert.equal(await page.locator('.departure-sidebar:visible, .event-sidebar:visible, dialog:visible, [data-access="full"]:visible').count(), 0);
    }
    await page.goto(base + '/planillero.html');
    await page.waitForURL('**/index.html');
    await page.waitForFunction(() => document.documentElement.dataset.accessRole === 'calendar');
    await page.locator('#app-logout').click();
    await page.waitForURL('**/acceso.html');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('cr_app_access_v1')), null);
    await page.locator('#access-password').fill('cr2026');
    await page.locator('#login-submit').click();
    await page.waitForURL('**/index.html');
    await page.waitForFunction(() => document.documentElement.dataset.accessRole === 'full');
    assert.equal(await page.locator('.home-action:visible').count(), 5);
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    console.log('OK: login por perfil, clave incorrecta, consulta sin escrituras, PDF firmado, calendarios, restriccion de paginas y administrador. Servidor simulado.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
