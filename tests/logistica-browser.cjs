const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const L = require('../logistica.js');
const root = path.resolve(__dirname, '..');

(async () => {
  const server = http.createServer((req, res) => {
    const requested = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!requested.startsWith(root + path.sep) || !fs.existsSync(requested) || !fs.statSync(requested).isFile()) { res.writeHead(404).end(); return; }
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
    res.setHeader('Content-Type', types[path.extname(requested)] || 'application/octet-stream');
    fs.createReadStream(requested).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Argentina/Buenos_Aires' });
    await context.addInitScript(() => {
      window.__testNotifications = [];
      class TestNotification {
        static get permission() { return localStorage.getItem('__testNotificationPermission') || 'default'; }
        static async requestPermission() { localStorage.setItem('__testNotificationPermission', 'granted'); return 'granted'; }
        constructor(title, options) { window.__testNotifications.push({ title, ...options }); }
        close() {}
      }
      Object.defineProperty(window, 'Notification', { configurable: true, value: TestNotification });
    });
    let rows = [];
    let catalogRows = [];
    let recipients = [];
    let connected = true;
    const day = L.today();
    const date = offset => {
      const value = new Date(day + 'T12:00:00Z'); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10);
    };
    const documents = [
      { id: 'a', os: '42', lugar: 'CEC', sala: 'SALA A', area: 'CCTV', armado: date(1), desarme: date(2), event_data: { ev: { evento: 'Evento de prueba' } }, created_at: day, filename: 'CCTV.pdf', public_url: 'https://example.test/a.pdf' },
      { id: 'b', os: '2026-42', lugar: 'CEC', sala: 'SALA A', area: 'SONIDO', armado: date(1), desarme: date(2), event_data: JSON.stringify({ ev: { evento: 'Evento de prueba' } }), created_at: day, filename: 'Sonido.pdf', public_url: 'https://example.test/b.pdf' },
      { id: 'c', os: '99', lugar: 'Hotel', sala: 'SALA B', area: 'VIDEO', armado: date(-2), desarme: date(-1), event_data: { ev: { evento: 'Evento finalizado' } }, created_at: day },
      { id: 'd', os: '88', lugar: 'Centro', sala: 'SALA C', area: 'LUCES', armado: '', desarme: '', event_data: { ev: { evento: 'Pendiente de fecha' } }, created_at: day }
    ];
    await context.route('**/rest/v1/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.endsWith('/logistics_departures')) {
        if (!connected) { await route.fulfill({ status: 404, json: {} }); return; }
        if (request.method() === 'POST') {
          const row = request.postDataJSON();
          rows = rows.filter(item => item.id !== row.id).concat(row);
          await route.fulfill({ status: 201, json: [row] });
        } else await route.fulfill({ json: rows });
      } else if (url.pathname.endsWith('/logistics_catalog')) {
        if (!connected) { await route.fulfill({ status: 404, json: {} }); return; }
        if (request.method() === 'POST') {
          const row = request.postDataJSON();
          catalogRows = catalogRows.filter(item => item.id !== row.id).concat(row);
          await route.fulfill({ status: 201, json: [row] });
        } else await route.fulfill({ json: catalogRows });
      } else if (url.pathname.endsWith('/departure_notification_admins')) await route.fulfill({ json: [{ user_id: 'admin-test' }] });
      else if (url.pathname.endsWith('/departure_notification_recipients')) {
        assert.match(request.headers().authorization, /^Bearer \S+$/);
        if (request.method() === 'POST') {
          recipients.push({ id: 'recipient-1', ...request.postDataJSON() });
          await route.fulfill({ status: 201, json: [] });
        } else if (request.method() === 'PATCH') {
          Object.assign(recipients[0], request.postDataJSON()); await route.fulfill({ status: 204 });
        } else await route.fulfill({ json: recipients });
      } else if (url.pathname.endsWith('/pdf_documents')) await route.fulfill({ json: documents });
      else await route.fulfill({ json: [] });
    });
    await context.route('**/auth/v1/token?*', route => route.fulfill({ json: { access_token: 'admin-test-token', expires_in: 3600, user: { id: 'admin-test' } } }));
    // Asset failures must not make the operating controls disappear.
    await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
    await context.route('https://unpkg.com/**', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(base + '/salidas.html');
    await page.waitForFunction(() => document.getElementById('status').textContent === 'Salidas sincronizadas.');
    await page.getByRole('button', { name: 'Configuración', exact: true }).click();
    await page.getByLabel('Notificar en esta computadora', { exact: true }).check();
    await page.waitForFunction(() => document.getElementById('desktop-alerts-status').textContent.includes('activados'));
    assert.equal(await page.evaluate(() => window.__testNotifications.length), 0);
    await page.waitForFunction(() => !document.getElementById('email-settings').hidden);
    await page.getByLabel('Correo que recibirá los avisos', { exact: true }).fill('logistica@example.test');
    await page.getByRole('button', { name: 'Agregar correo', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('email-status').textContent.includes('Correo agregado'));
    await page.getByLabel('Avisar a logistica@example.test', { exact: true }).uncheck();
    await page.waitForFunction(() => !document.querySelector('#email-recipients input').disabled);
    assert.equal(recipients[0].enabled, false);
    assert.equal(await page.locator('#settings-drivers li').count(), 2);
    assert.equal(await page.locator('#settings-destinations li').count(), 6);
    await page.getByLabel('Nombre del nuevo chofer', { exact: true }).fill('Chofer de prueba');
    await page.getByRole('button', { name: 'Agregar chofer', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('settings-status').textContent.includes('Chofer agregado'));
    await page.getByLabel('Nombre del nuevo destino', { exact: true }).fill('Teatro de prueba');
    await page.getByLabel('Dirección (opcional)', { exact: true }).fill('Av. Principal 123');
    await page.getByRole('button', { name: 'Agregar destino habitual', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('settings-status').textContent.includes('Destino agregado'));
    fs.mkdirSync(path.join(root, '.verification'), { recursive: true });
    await page.screenshot({ path: path.join(root, '.verification/configuracion-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.querySelector('#settings-dialog').scrollWidth <= document.querySelector('#settings-dialog').clientWidth));
    await page.screenshot({ path: path.join(root, '.verification/configuracion-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByLabel('Cerrar configuración', { exact: true }).click();
    await page.reload();
    await page.waitForFunction(() => document.getElementById('status').textContent === 'Salidas sincronizadas.');
    await page.getByRole('button', { name: 'Nueva salida', exact: true }).click();
    assert.equal(await page.locator('#departure-form input[type="date"]').count(), 1);
    assert.equal(await page.locator('#departure-form input[type="datetime-local"]').count(), 0);
    await page.getByLabel('Fecha de salida', { exact: true }).fill(day);
    await page.getByLabel('Hora de carga', { exact: true }).fill('08:00');
    await page.getByLabel('Hora de salida', { exact: true }).fill('09:00');
    await page.getByLabel('Lugar de salida', { exact: true }).selectOption({ label: 'Depósito Central' });
    await page.getByLabel('Modelo de camión', { exact: true }).selectOption('Sprinter');
    await page.getByLabel('Chofer', { exact: true }).selectOption({ label: 'Chofer de prueba' });
    await page.getByLabel('Destino 1', { exact: true }).selectOption({ label: 'Teatro de prueba' });
    assert.equal(await page.getByLabel('Dirección 1', { exact: true }).inputValue(), 'Av. Principal 123');
    await page.getByLabel('Destino 1', { exact: true }).selectOption({ label: 'Centro de Convenciones' });
    await page.getByLabel('Hora de llegada 1', { exact: true }).fill('10:00');
    await page.getByLabel('Dirección 1', { exact: true }).fill('Av. de prueba 100');
    await page.getByRole('button', { name: 'Agregar destino', exact: true }).click();
    await page.getByLabel('Destino 2', { exact: true }).selectOption('__manual__');
    await page.getByLabel('Nombre del destino 2', { exact: true }).fill('Hotel');
    await page.getByLabel('Hora de llegada 2', { exact: true }).fill('11:00');
    await page.getByLabel('Bajar destino 1', { exact: true }).click();
    assert.equal(await page.getByLabel('Nombre del destino 1', { exact: true }).inputValue(), 'Hotel');
    await page.getByLabel('Subir destino 2', { exact: true }).click();
    await page.getByRole('button', { name: 'Guardar salida', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('dialog').open);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].stops.length, 2);
    assert.equal(rows[0].origin, 'Depósito Central');
    assert.equal(await page.locator('#new-departure-alert').isVisible(), true);
    assert.equal(await page.evaluate(() => window.__testNotifications.length), 1);
    await page.reload();
    await page.waitForSelector('.departure');
    assert.equal(await page.locator('.departure-time').textContent(), '09:00');
    assert.equal(await page.locator('#calendar-grid [role="gridcell"]').count(), 42);
    const calendarEntry = page.locator(`[data-calendar-date="${day}"] .calendar-entry`).first();
    assert.equal(await calendarEntry.locator('.calendar-entry-loading').innerText(), 'Carga: 08:00');
    assert.equal(await calendarEntry.locator('.calendar-entry-time').innerText(), 'Salida: 09:00');
    assert.equal(await calendarEntry.locator('.calendar-entry-truck').innerText(), 'Sprinter');
    assert.match(await calendarEntry.locator('.calendar-entry-destination').innerText(), /Centro de Convenciones.*Hotel/);
    const sidebar = await page.locator('.departure-sidebar').boundingBox();
    const calendar = await page.locator('.departure-calendar').boundingBox();
    assert(sidebar.x < calendar.x && sidebar.width < calendar.width);
    await page.locator(`[data-select-day="${date(1)}"]`).first().click();
    assert.equal(await page.locator('.departure').count(), 0);
    await page.getByRole('button', { name: 'Nueva salida', exact: true }).click();
    assert.equal(await page.getByLabel('Fecha de salida', { exact: true }).inputValue(), date(1));
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.locator(`[data-calendar-date="${day}"] [data-departure-id]`).click();
    assert.equal(await page.getByLabel('Hora de salida', { exact: true }).inputValue(), '09:00');
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.locator(`[data-select-day="${day}"]`).first().press('ArrowRight');
    assert.equal(await page.locator('[aria-selected="true"]').getAttribute('data-calendar-date'), date(1));
    const monthTitle = await page.locator('#calendar-title').textContent();
    await page.getByLabel('Mes siguiente', { exact: true }).click();
    assert.notEqual(await page.locator('#calendar-title').textContent(), monthTitle);
    await page.getByLabel('Mes anterior', { exact: true }).click();
    assert.equal(await page.locator('#calendar-title').textContent(), monthTitle);
    await page.getByRole('button', { name: 'Hoy', exact: true }).click();
    rows.push({ ...rows[0], id: 'calendar-iveco', truck_type: 'Iveco', driver: 'Jonathan Robles', departure_at: day + 'T12:00', stops: [{ destination: 'La Rural', eta: day + 'T13:00' }] },
      { ...rows[0], id: 'calendar-mercedes', truck_type: 'Mercedes Benz', driver: 'Emanuel Ledesma', departure_at: day + 'T15:00', stops: [{ destination: 'BA Ferial', eta: day + 'T16:00' }] });
    await page.getByLabel('Actualizar salidas', { exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.departure').length === 3);
    assert.equal(await page.locator(`[data-calendar-date="${day}"] .calendar-entry`).count(), 2);
    await page.locator(`[data-calendar-date="${day}"] .calendar-more`).click();
    assert.equal(await page.locator('.departure').count(), 3);
    fs.mkdirSync(path.join(root, '.verification'), { recursive: true });
    await page.screenshot({ path: path.join(root, '.verification/salidas-desktop.png'), fullPage: true });
    rows = rows.filter(row => !row.id.startsWith('calendar-'));
    await page.getByLabel('Actualizar salidas', { exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.departure').length === 1);
    await page.getByRole('button', { name: 'Editar salida', exact: true }).click();
    assert.equal(await page.getByLabel('Lugar de salida', { exact: true }).inputValue(), 'Depósito Central');
    await page.getByLabel('Lugar de salida', { exact: true }).selectOption('__manual__');
    await page.getByLabel('Otro lugar de salida', { exact: true }).fill('Origen manual de prueba');
    await page.getByLabel('Chofer', { exact: true }).selectOption({ label: 'Emanuel Ledesma' });
    connected = false;
    await page.getByRole('button', { name: 'Guardar salida', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('dialog').open);
    assert.match(await page.locator('#status').textContent(), /Guardado local/);
    await page.reload();
    await page.waitForFunction(() => document.getElementById('departures').textContent.includes('Emanuel Ledesma'));
    connected = true;
    await page.getByLabel('Actualizar salidas', { exact: true }).click();
    await page.waitForFunction(() => document.getElementById('status').textContent === 'Salidas sincronizadas.');
    assert.equal(rows[0].driver, 'Emanuel Ledesma');
    assert.equal(rows[0].origin, 'Origen manual de prueba');
    assert.equal(await page.evaluate(() => window.__testNotifications.length), 0);
    await page.getByRole('button', { name: 'Editar salida', exact: true }).click();
    assert.equal(await page.getByLabel('Lugar de salida', { exact: true }).inputValue(), '__manual__');
    assert.equal(await page.getByLabel('Otro lugar de salida', { exact: true }).inputValue(), 'Origen manual de prueba');
    await page.getByLabel('Lugar de salida', { exact: true }).selectOption({ label: 'Teatro de prueba' });
    await page.getByLabel('Hora de carga', { exact: true }).fill('22:00');
    await page.getByLabel('Hora de salida', { exact: true }).fill('23:30');
    await page.getByLabel('Hora de llegada 1', { exact: true }).fill('00:15');
    await page.getByLabel('Hora de llegada 2', { exact: true }).fill('01:00');
    assert.match(await page.locator('[data-stop-day]').first().textContent(), /Día siguiente/);
    await page.getByLabel('Fecha de salida', { exact: true }).fill(date(1));
    await page.getByRole('button', { name: 'Guardar salida', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('dialog').open);
    assert.equal(rows[0].departure_at, date(1) + 'T23:30');
    assert.equal(rows[0].stops[0].eta, date(2) + 'T00:15');
    assert.equal(rows[0].stops[1].eta, date(2) + 'T01:00');
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const mobileList = await page.locator('.departure-sidebar').boundingBox();
    const mobileCalendar = await page.locator('.departure-calendar').boundingBox();
    assert(mobileCalendar.y < mobileList.y);
    const mobileEntry = page.locator('.is-selected .calendar-entry').first();
    assert.equal(await mobileEntry.locator('.calendar-entry-truck').isVisible(), true);
    assert.equal(await mobileEntry.locator('.calendar-entry-destination').isVisible(), true);
    assert.match(await mobileEntry.innerText(), /Carga: 22:00/);
    await page.screenshot({ path: path.join(root, '.verification/salidas-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: 'Editar salida', exact: true }).click();
    assert(await page.evaluate(() => document.querySelector('dialog').scrollWidth <= document.querySelector('dialog').clientWidth));
    await page.screenshot({ path: path.join(root, '.verification/salida-form-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByLabel('Eliminar salida', { exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.departure'));
    assert.equal(rows[0].deleted, true);
    await page.goto(base + '/eventos.html');
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('Agenda sincronizada'));
    assert.equal(await page.locator('.event').count(), 2);
    assert.equal(await page.locator('#event-calendar-grid [role="gridcell"]').count(), 42);
    assert.equal(await page.locator(`#event-calendar-grid [data-calendar-date="${date(1)}"] [data-event-key="os:42"]`).count(), 1);
    assert.equal(await page.locator(`#event-calendar-grid [data-calendar-date="${date(2)}"] [data-event-key="os:42"]`).count(), 1);
    assert.equal(await page.locator('#event-calendar-grid [data-event-key="os:88"]').count(), 0);
    await page.locator(`#event-calendar-grid [data-calendar-date="${date(2)}"] [data-event-key="os:42"]`).click();
    assert.equal(await page.locator('.event').count(), 1);
    assert.equal(await page.locator('.event[open] tbody tr').count(), 2);
    await page.getByRole('button', { name: 'Hoy', exact: true }).click();
    assert.equal(await page.locator('.event').count(), 0);
    await page.getByRole('button', { name: 'Ver todos', exact: true }).click();
    assert.equal(await page.locator('.event').count(), 2);
    const eventMonth = await page.locator('#event-calendar-title').textContent();
    await page.getByLabel('Mes siguiente', { exact: true }).click();
    assert.notEqual(await page.locator('#event-calendar-title').textContent(), eventMonth);
    await page.getByLabel('Mes anterior', { exact: true }).click();
    assert.equal(await page.locator('#event-calendar-title').textContent(), eventMonth);
    await page.locator(`#event-calendar-grid [data-select-day="${date(1)}"]`).press('ArrowRight');
    assert.equal(await page.locator('#event-calendar-grid [aria-selected="true"]').getAttribute('data-calendar-date'), date(2));
    await page.getByRole('button', { name: 'Ver todos', exact: true }).click();
    await page.getByLabel('Buscar', { exact: true }).fill('42');
    assert.equal(await page.locator('.event').count(), 1);
    if (await page.locator('.event').getAttribute('open') === null) await page.locator('.event summary').click();
    assert.equal(await page.locator('tbody tr').count(), 2);
    await page.getByLabel('Buscar', { exact: true }).fill('2026-42');
    assert.equal(await page.locator('.event').count(), 1);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(root, '.verification/eventos-mobile.png'), fullPage: true });
    await page.getByLabel('Buscar', { exact: true }).fill('');
    assert.equal(await page.locator('#events [data-key="os:99"]').count(), 0);
    assert(await page.locator('#event-calendar-grid [data-event-key="os:99"]').count() > 0);
    assert.equal(await page.locator('#event-calendar-grid .is-today .calendar-today-label').textContent(), 'HOY');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(root, '.verification/eventos-desktop.png'), fullPage: true });
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('OK: calendario, seleccion de dias, cambio de mes, teclado, lista compacta, alta y edicion desde calendario; configuracion, recorridos, guardado offline, sincronizacion y agenda. Sin errores JS ni desborde desktop/mobile.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
