const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', type[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const archiveDoc = { id: 'pdf-home-test', os: '123', sala: 'SALA A', area: 'CCTV', lugar: 'CEC', total_units: 2,
      filename: 'prueba.pdf', created_at: '2026-11-03', public_url: 'https://example.test/prueba.pdf', armado: '03/11/2026', desarme: '04/11/2026',
      event_data: { ev: { os: '123', evento: 'Evento guardado', lugar: 'CEC' }, salas: [{ id: 's1', name: 'SALA A' }],
        quantities: { 's1::cctv::Camaras::Camara de prueba': 2 }, observations: {},
        deposit_items: [{ sala: 'SALA A', area: 'CCTV', category: 'Camaras', equipment: 'Camara de prueba', quantity: 2, observations: '' }] } };
    let calendarFixtures = [archiveDoc];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1') { await route.continue(); return; }
      if (url.pathname.includes('/rest/v1/')) {
        if (url.pathname.includes('/inventory_')) { await route.fulfill({ status: 404, json: {} }); return; }
        if (url.pathname.endsWith('/pdf_documents')) { await route.fulfill({ json: calendarFixtures }); return; }
        if (url.pathname.endsWith('/freelancers')) { await route.fulfill({ json: [{ id: 1, nombre: 'Operador', area: 'CCTV', telefono: '', alimentacion: 'comun' }] }); return; }
        await route.fulfill({ json: [] }); return;
      }
      await route.fulfill({ contentType: route.request().resourceType() === 'stylesheet' ? 'text/css' : 'text/javascript', body: '' });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    const navLabels = ['inicio', 'generar planilla', 'planillas hechas', 'citaciones freelancers', 'eventos cargados', 'remitos'];
    const navPaths = ['index.html', 'planillero.html', 'archivo.html', 'citaciones.html', 'eventos.html', 'planillero.html?remito=manual'];
    async function checkNavigation(name) {
      const links = page.locator('.main-nav a:visible');
      assert.equal(await page.locator('a[href="salidas.html"]:visible').count(), 0);
      assert.deepEqual((await links.allTextContents()).map(text => text.trim().toLocaleLowerCase('es')), navLabels, name);
      assert.deepEqual(await links.evaluateAll(elements => elements.map(element => element.getAttribute('href'))), navPaths, name);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        assert(await links.evaluateAll(elements => {
          const boxes = elements.map(element => element.getBoundingClientRect());
          return boxes.every(box => box.width > 0 && box.left >= 0 && box.right <= innerWidth + 1)
            && boxes.every((box, index) => boxes.slice(index + 1).every(other => box.right <= other.left + 1 || other.right <= box.left + 1 || box.bottom <= other.top + 1 || other.bottom <= box.top + 1));
        }), `${name}: menu fuera de pantalla o superpuesto (${width}px)`);
      }
      await page.screenshot({ path: path.join(root, `.verification/menu-${name}-mobile.png`), fullPage: false });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await page.goto(base + '/index.html');
    const labels = ['GENERAR PLANILLA', 'PLANILLAS HECHAS', 'CITACIONES FREELANCERS', 'EVENTOS CARGADOS', 'REMITOS'];
    assert.deepEqual(await page.locator('.home-action:visible span').allTextContents(), labels);
    assert(await page.locator('.home-action img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)));
    fs.mkdirSync(path.join(root, '.verification'), { recursive: true });
    for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844], ['small-mobile', 320, 740]]) {
      await page.setViewportSize({ width, height });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert(await page.locator('.home-action:visible span').evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth)));
      await page.screenshot({ path: path.join(root, `.verification/inicio-${name}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => {
      localStorage.setItem('cr_deposito', JSON.stringify({ version: 2, eventId: 'existing-event', ev: { os: '123', evento: 'Borrador existente', lugar: 'CEC' },
        salas: [{ id: 's1', name: 'SALA A' }], salaCounter: 1, currentSalaId: 's1', currentArea: 'cctv', quantities: {}, observations: {} }));
      localStorage.setItem('cr_remito_manual', JSON.stringify({ evento: 'Remito existente', locacion: 'CEC', numero: '0001', fecha: '2026-11-03', bultos: [{ name: 'BULTO 1', items: [{ name: 'Camara', qty: 2 }] }] }));
    });
    await page.getByRole('link', { name: 'GENERAR PLANILLA', exact: true }).click();
    assert.match(page.url(), /planillero\.html$/);
    await page.waitForFunction(() => document.getElementById('ev-evento').value === 'Borrador existente');
    await checkNavigation('planillero');
    await page.getByRole('link', { name: 'Inicio', exact: true }).click();
    await page.getByRole('link', { name: 'REMITOS', exact: true }).click();
    await page.waitForFunction(() => document.body.classList.contains('manual-remito-mode'));
    const day = require('../logistica.js').today();
    calendarFixtures = Array.from({ length: 10 }, (_, index) => ({ ...archiveDoc, id: `calendar-test-${index}`, os: `900${index}`, armado: day, desarme: day,
      event_data: { ev: { evento: `Evento visible ${index + 1}` } } }));
    calendarFixtures.push(...['SONIDO', 'VIDEO', 'LUCES', ' cctv '].map((area, index) => ({ ...calendarFixtures[0], id: `area-${index}`, os: '2026-9000', area })));
    const previousDate = new Date(day + 'T12:00:00Z'); previousDate.setUTCDate(previousDate.getUTCDate() - 1);
    const pastDay = previousDate.toISOString().slice(0, 10);
    calendarFixtures.push({ ...archiveDoc, id: 'past-event', os: '8000', armado: pastDay, desarme: pastDay, event_data: { ev: { evento: 'Evento ya desarmado' } } },
      { ...archiveDoc, id: 'no-date-event', os: '8001', armado: '', desarme: '', event_data: { ev: { evento: 'Evento sin fecha' } } });
    await page.goto(base + '/eventos.html');
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('Agenda sincronizada'));
    assert.equal(await page.locator('#events .event').count(), 11);
    assert.equal(await page.locator('#events [data-key="os:8000"]').count(), 0);
    assert.equal(await page.locator('#events [data-key="os:8001"]').count(), 1);
    assert.equal(await page.locator('#event-calendar-grid .is-today .calendar-today-label').textContent(), 'HOY');
    assert(await page.locator('#event-calendar-grid .is-today').evaluate(element => getComputedStyle(element).boxShadow !== 'none'));
    const previousMonth = pastDay.slice(0, 7) !== day.slice(0, 7) && !require('../logistica.js').calendarDays(day.slice(0, 7)).includes(pastDay);
    if (previousMonth) await page.getByLabel('Mes anterior', { exact: true }).click();
    assert.equal(await page.locator(`#event-calendar-grid [data-calendar-date="${pastDay}"] [data-event-key="os:8000"]`).count(), 1);
    await page.locator(`#event-calendar-grid [data-calendar-date="${pastDay}"] [data-event-key="os:8000"]`).click();
    assert.equal(await page.locator('#events .event').count(), 0);
    await page.getByRole('button', { name: 'Hoy', exact: true }).click();
    await page.getByRole('button', { name: 'Ver todos', exact: true }).click();
    const cell = page.locator(`#event-calendar-grid [data-calendar-date="${day}"]`);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await cell.locator('[data-event-key]').count(), 10);
      const checks = cell.locator('[data-event-key="os:9000"] .calendar-area-check');
      assert.deepEqual(await checks.allTextContents(), ['✓ CCTV', '✓ SONIDO', '✓ VIDEO', '✓ LUCES']);
      assert.deepEqual(await cell.locator('[data-event-key="os:9001"] .calendar-area-check').allTextContents(), ['✓ CCTV']);
      assert(await checks.evaluateAll(elements => elements.every(element => {
        const box = element.getBoundingClientRect(), parent = element.closest('button').getBoundingClientRect();
        return box.left >= parent.left && box.right <= parent.right + 1 && box.bottom <= parent.bottom + 1;
      })));
      assert.equal(await page.locator('#event-calendar-grid .calendar-more').count(), 0);
      assert(await cell.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const entries = [...element.querySelectorAll('[data-event-key]')].map(item => item.getBoundingClientRect());
        return entries.every((box, index) => box.top >= bounds.top && box.bottom <= bounds.bottom + 1 && (!index || entries[index - 1].bottom <= box.top));
      }));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await cell.screenshot({ path: path.join(root, `.verification/eventos-todos-${width}.png`) });
    }
    calendarFixtures = [archiveDoc];
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base + '/planillero.html?remito=manual');
    await page.waitForFunction(() => document.body.classList.contains('manual-remito-mode'));
    assert.equal(await page.locator('#manual-remito-evento').inputValue(), 'Remito existente');
    assert.equal(await page.locator('#manual-remito-numero').inputValue(), '0001');
    assert.equal(await page.locator('#panel-remito-manual').isVisible(), true);
    await checkNavigation('remitos');
    assert.equal(await page.locator('.manual-equipment-row').count(), 0);
    assert.equal(await page.locator('#manual-equipment-search').isDisabled(), true);
    for (const area of ['cctv', 'sonido', 'video', 'luces']) {
      await page.getByLabel('Área del remito', { exact: true }).selectOption(area);
      assert(await page.locator('.manual-equipment-row').count() > 0);
      const label = await page.locator('#manual-remito-area option:checked').textContent();
      assert((await page.locator('.manual-equipment-category summary').allTextContents()).every(text => text.startsWith(label + ' / ')));
    }
    await page.getByLabel('Área del remito', { exact: true }).selectOption('cctv');
    const equipmentName = await page.locator('.manual-equipment-row > span').first().textContent();
    await page.locator('.manual-equipment-row input').first().fill('2');
    await page.locator('.manual-equipment-row button').first().click();
    const savedRemito = await page.evaluate(() => JSON.parse(localStorage.getItem('cr_remito_manual')));
    assert(savedRemito.bultos[0].items.some(item => item.name === equipmentName && item.qty === 2));
    assert(savedRemito.bultos[0].items.some(item => item.name === 'Camara' && item.qty === 2));
    await page.locator('#manual-equipment-search').fill('busqueda-inexistente');
    assert.equal(await page.locator('.manual-equipment-row').count(), 0);
    await page.getByLabel('Área del remito', { exact: true }).selectOption('sonido');
    assert.equal(await page.locator('#manual-equipment-search').inputValue(), '');
    await page.reload();
    await page.waitForFunction(() => document.getElementById('manual-remito-area').value === 'sonido');
    assert((await page.locator('.manual-equipment-category summary').allTextContents()).every(text => text.startsWith('SONIDO / ')));
    assert.equal(await page.evaluate(() => createManualRemito().area), '');
    await page.getByRole('link', { name: 'Inicio', exact: true }).click();
    for (const [label, destination] of [['PLANILLAS HECHAS', 'archivo.html'], ['CITACIONES FREELANCERS', 'citaciones.html'], ['EVENTOS CARGADOS', 'eventos.html']]) {
      await page.getByRole('link', { name: label, exact: true }).click();
      assert(page.url().endsWith('/' + destination));
      await checkNavigation(destination.replace('.html', ''));
      await page.getByRole('link', { name: 'Inicio', exact: true }).click();
      assert.equal(await page.locator('.home-action:visible').count(), 5);
    }
    await page.goto(base + '/deposito.html');
    await checkNavigation('deposito');
    await page.getByRole('link', { name: 'Inicio', exact: true }).click();
    await page.getByRole('link', { name: 'PLANILLAS HECHAS', exact: true }).click();
    await page.getByRole('button', { name: 'GENERAR REMITO', exact: true }).click();
    await page.waitForURL('**/planillero.html?remitoArchivo=1');
    await page.waitForFunction(() => document.getElementById('panel-step4').classList.contains('active'));
    assert.match(await page.locator('#bultos-pool').textContent(), /Camara de prueba/);
    const mainDraft = await page.evaluate(() => JSON.parse(localStorage.getItem('cr_deposito')));
    assert.equal(mainDraft.ev.evento, 'Borrador existente');
    await page.goto(base + '/index.html?remito=manual');
    await page.waitForURL('**/planillero.html?remito=manual');
    await page.waitForFunction(() => document.body.classList.contains('manual-remito-mode'));
    assert.equal(errors.length, 0, errors.join('\n'));
    await page.goto(base + '/planillero.html');
    await page.waitForFunction(() => salas.length > 0);
    assert.deepEqual(await page.evaluate(() => AREAS.tarimas.data), []);
    await page.evaluate(() => { goToStep(2); switchAreaInSala(currentSalaId, 'tarimas'); });
    assert.equal(await page.locator('[id$="-area-tarimas"] .equipo-row').count(), 0);
    assert.match(await page.locator('[id$="-area-tarimas"]').textContent(), /todavía no tiene equipos/);
    await page.evaluate(() => openAdminPanel());
    await page.locator('.admin-tab').getByText('TARIMAS', { exact: true }).click();
    await page.locator('#new-cat-tarimas').fill('Estructuras');
    await page.locator('#new-cat-tarimas').press('Enter');
    await page.locator('#admin-panel-tarimas .admin-cat-header').click();
    await page.locator('#new-item-tarimas-0').fill('Tarima de prueba');
    await page.locator('#new-item-tarimas-0').press('Enter');
    await page.evaluate(() => closeModal('modal-admin'));
    const tarimaInput = page.locator('[id$="-area-tarimas"] .equipo-qty');
    await tarimaInput.fill('2');
    await tarimaInput.dispatchEvent('input');
    assert.equal(await page.locator('[id$="-count-tarimas"]').textContent(), '1');
    assert.match(await page.locator('#float-rows').textContent(), /TARIMAS/);
    await page.evaluate(() => goToStep(3));
    assert.equal(await page.getByRole('button', { name: /PDF .*TARIMAS/ }).count(), 1);
    await page.reload();
    await page.waitForFunction(() => AREAS.tarimas.data.length === 1);
    assert.equal(await page.evaluate(() => Object.entries(quantities).find(([key]) => key.includes('::tarimas::'))?.[1]), 2);
    await page.goto(base + '/planillero.html?remito=manual');
    await page.waitForFunction(() => document.body.classList.contains('manual-remito-mode'));
    await page.getByLabel('Área del remito', { exact: true }).selectOption('tarimas');
    assert.match(await page.locator('.manual-equipment-row').textContent(), /TARIMA DE PRUEBA/);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('OK: calendario con historicos, lista solo con pendientes, hoy resaltado, diez eventos por dia sin agrupar; menu completo, borradores y remitos conservados.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
