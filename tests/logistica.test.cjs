const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logistica.js');

function memoryStorage() {
  const data = new Map();
  return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
}
function departure() {
  return { id: 'test-id', origin: 'Deposito', driver: 'Chofer', truck_type: 'Iveco',
    loading_at: '2026-11-03T23:00', departure_at: '2026-11-03T23:30', notes: '', deleted: false,
    stops: [{ destination: 'CEC', address: '', eta: '2026-11-04T00:15' }, { destination: 'Hotel', address: '', eta: '2026-11-04T01:00' }] };
}
function response(body, status = 200) { return { ok: status < 400, status, json: async () => body }; }

test('carga, salida y destinos admiten cambio de dia y rechazan horarios incompatibles', () => {
  const row = departure();
  assert.equal(L.validateDeparture(row), '');
  assert.match(L.validateDeparture({ ...row, loading_at: '2026-11-04T00:00' }), /carga/);
  assert.match(L.validateDeparture({ ...row, truck_type: 'Otro' }), /modelo/);
  assert.match(L.validateDeparture({ ...row, driver: ' ' }), /chofer/);
  assert.match(L.validateDeparture({ ...row, stops: [] }), /destino/);
  assert.match(L.validateDeparture({ ...row, stops: [...row.stops].reverse() }), /parada 2/);
  assert.equal(L.isoDate('31/02/2026'), '');
  assert.equal(L.isoDate('29/02/2024'), '2024-02-29');
  assert.equal(L.isoDate('04-11-2026'), '2026-11-04');
});

test('agenda agrupa ordenes, usa datos recientes y conserva eventos hasta el dia de desarme inclusive', () => {
  const doc = (id, os, armado, desarme, created, name) => ({ id, os, armado, desarme, created_at: created, event_data: { ev: { evento: name } } });
  const groups = L.groupEvents([
    doc('a', '100', '01/11/2026', '03/11/2026', '2026-11-01', 'Anterior'),
    doc('b', '100', '02/11/2026', '04/11/2026', '2026-11-02', 'Actualizado'),
    doc('c', '101', '01/11/2026', '02/11/2026', '2026-11-01', 'Finalizado'),
    doc('d', '102', '05/11/2026', '', '2026-11-01', 'Sin desarme'),
    doc('e', '', '', '', '2026-11-01', 'Sin OS uno'),
    doc('f', '', '', '', '2026-11-01', 'Sin OS dos')
  ], '2026-11-03');
  assert.equal(groups.length, 5);
  const current = groups.find(group => group.order === '100');
  assert.equal(current.documents.length, 2);
  assert.equal(current.name, 'Actualizado');
  assert.equal(current.start, '2026-11-02');
  assert.equal(current.expired, false);
  assert.equal(groups.find(group => group.order === '101').expired, true);
  assert.equal(groups.find(group => group.order === '102').expired, false);
  assert.equal(L.groupEvents([doc('g', '200', '01/11/2026', '03/11/2026', '', '')], '2026-11-03')[0].expired, false);
  assert.equal(L.groupEvents([doc('g', '200', '', '03/11/2026', '', '')], '2026-11-04')[0].expired, true);
});

test('URLs de PDFs no aceptan protocolos ejecutables y los nombres se escapan', () => {
  assert.equal(L.pdfUrl({ public_url: 'javascript:alert(1)' }), '');
  assert.equal(L.pdfUrl({ public_url: 'https://example.test/a.pdf' }), 'https://example.test/a.pdf');
  assert.equal(L.escapeHTML('<script>"&'), '&lt;script&gt;&quot;&amp;');
});

test('ordenes con prefijo 2026 se agrupan con el numero sin anio', () => {
  const groups = L.groupEvents([
    { id: 'a', os: '2026-123', created_at: '2026-11-03' },
    { id: 'b', os: '123', created_at: '2026-11-02' },
    { id: 'c', os: ' 2026- 123 ', created_at: '2026-11-01' },
    { id: 'd', os: '124' },
    { id: 'e', os: '2025-123' }
  ]);
  assert.equal(groups.length, 3);
  assert.equal(groups.find(group => group.order === '123').documents.length, 3);
  assert.equal(L.normalizeOrder('2026-ABC-12'), 'ABC-12');
  assert.equal(L.normalizeOrder('2026-'), '2026-');
  assert.equal(L.normalizeOrder(null), '');
});

test('una sola fecha combina horas, calcula medianoche y conserva viajes anteriores de varios dias', () => {
  const schedule = L.departureSchedule('2026-11-30', '22:00', '23:00', [
    { destination: 'A', eta: '23:45' }, { destination: 'B', eta: '00:30' }, { destination: 'C', eta: '02:00' }
  ]);
  assert.equal(schedule.loading_at, '2026-11-30T22:00');
  assert.equal(schedule.departure_at, '2026-11-30T23:00');
  assert.equal(schedule.stops[1].eta, '2026-12-01T00:30');
  assert.equal(schedule.stops[2].eta, '2026-12-01T02:00');
  assert.equal(L.validateDeparture({ ...departure(), ...schedule }), '');
  const previousDay = L.departureSchedule('2026-01-01', '23:00', '01:00', []);
  assert.equal(previousDay.loading_at, '2025-12-31T23:00');
  const extended = L.departureSchedule('2026-11-03', '08:00', '09:00', [{ destination: 'Lejos', eta: '12:00', extraDays: 2 }]);
  assert.equal(extended.stops[0].eta, '2026-11-05T12:00');
  assert.equal('extraDays' in extended.stops[0], false);
  assert.equal(L.departureSchedule('', '08:00', '09:00', []).departure_at, '');
});

test('guardado offline persiste al recargar, sincroniza una sola vez y conserva la eliminacion logica', async () => {
  const previous = global.fetch;
  global.PDF_ARCHIVE_CONFIG = { SUPABASE_URL: 'https://example.test', SUPABASE_KEY: 'test', LOGISTICS_DEPARTURES_TABLE: 'departures' };
  try {
    global.fetch = async () => response({}, 404);
    const storage = memoryStorage();
    const store = new L.DepartureStore(storage);
    await store.put(departure());
    assert.equal(store.online, false);
    assert.equal(store.rows().length, 1);
    const restored = new L.DepartureStore(storage);
    assert.equal(Object.keys(restored.state.pending).length, 1);
    let writes = 0;
    let remote = [];
    global.fetch = async (url, options = {}) => {
      if (options.method === 'POST') {
        writes++;
        const row = JSON.parse(options.body);
        remote = remote.filter(item => item.id !== row.id).concat(row);
        return response([row], 201);
      }
      return response(remote);
    };
    await restored.refresh();
    assert.equal(restored.online, true);
    assert.equal(writes, 1);
    assert.equal(Object.keys(restored.state.pending).length, 0);
    await restored.refresh();
    assert.equal(writes, 1);
    await restored.put({ ...departure(), deleted: true });
    assert.equal(restored.rows().length, 0);
    assert.equal(remote[0].deleted, true);
    const broken = new L.DepartureStore({ getItem: () => null, setItem: () => { throw new Error('quota'); } });
    await assert.rejects(broken.put(departure()), /guardar/);
    assert.equal(broken.rows().length, 0);
  } finally { global.fetch = previous; }
});

test('catalogo inicial, altas offline, nombres duplicados y sincronizacion sin perder las opciones iniciales', async () => {
  const previous = global.fetch;
  global.PDF_ARCHIVE_CONFIG = { SUPABASE_URL: 'https://example.test', SUPABASE_KEY: 'test', LOGISTICS_CATALOG_TABLE: 'logistics_catalog' };
  try {
    const storage = memoryStorage();
    const store = new L.CatalogStore(storage);
    assert.equal(store.list('driver').length, 2);
    assert.equal(store.list('destination').length, 6);
    await assert.rejects(store.add('driver', ' jonathan   ROBLES '), /ya está/);
    global.fetch = async () => response({}, 404);
    await store.add('driver', 'Nuevo Chofer');
    await store.add('destination', 'Teatro', ' Calle 123 ');
    assert.equal(store.online, false);
    const restored = new L.CatalogStore(storage);
    assert.equal(restored.list('driver').length, 3);
    assert.equal(restored.list('destination').find(row => row.name === 'Teatro').address, 'Calle 123');
    const remote = [];
    global.fetch = async (url, options = {}) => {
      assert.match(url, /logistics_catalog/);
      if (options.method === 'POST') { const row = JSON.parse(options.body); remote.push(row); return response([row], 201); }
      return response(remote);
    };
    await restored.refresh();
    assert.equal(restored.online, true);
    assert.equal(remote.length, 2);
    assert.equal(restored.list('driver').length, 3);
    assert.equal(restored.list('destination').length, 7);
    await restored.refresh();
    assert.equal(remote.length, 2);
  } finally { global.fetch = previous; }
});

test('calendario mensual mantiene seis semanas de lunes a domingo y cubre meses bisiestos', () => {
  const leap = L.calendarDays('2024-02');
  assert.equal(leap.length, 42);
  assert.equal(leap[0], '2024-01-29');
  assert(leap.includes('2024-02-29'));
  assert.equal(new Date(leap[41] + 'T12:00:00Z').getUTCDay(), 0);
  for (let index = 1; index < leap.length; index++) assert.equal(L.dayDifference(leap[index - 1], leap[index]), 1);
  assert(L.calendarDays('2026-12').some(day => day.startsWith('2027-01')));
  assert.deepEqual(L.calendarDays('invalido'), []);
});

test('eventos aparecen en cada dia de armado a desarme, sin ubicar eventos sin fecha', () => {
  const event = { start: '2026-11-03', end: '2026-11-05' };
  assert.equal(L.eventOnDay(event, '2026-11-02'), false);
  for (const day of ['2026-11-03', '2026-11-04', '2026-11-05']) assert.equal(L.eventOnDay(event, day), true);
  assert.equal(L.eventOnDay(event, '2026-11-06'), false);
  assert.equal(L.eventOnDay({ start: '', end: '' }, '2026-11-03'), false);
  assert.equal(L.eventOnDay({ start: '', end: '2026-11-03' }, '2026-11-03'), true);
  assert.equal(L.eventOnDay({ start: '2026-11-03', end: '' }, '2026-11-04'), false);
  assert.equal(L.eventOnDay({ start: '2026-11-03', end: '2026-11-01' }, '2026-11-03'), true);
});

test('archivo se pagina mas alla de 1000 documentos y admite esquemas sin event_data', async () => {
  const previous = global.fetch;
  global.PDF_ARCHIVE_CONFIG = { SUPABASE_URL: 'https://example.test', SUPABASE_KEY: 'test', SUPABASE_TABLE: 'pdf_documents' };
  try {
    const all = Array.from({ length: 1002 }, (_, id) => ({ id }));
    global.fetch = async url => {
      const offset = Number(new URL(url).searchParams.get('offset'));
      return response(all.slice(offset, offset + 500));
    };
    assert.equal((await L.fetchEventDocuments()).length, 1002);
    global.fetch = async url => new URL(url).searchParams.get('select').includes('event_data') ? response({}, 400) : response([{ id: 1 }]);
    assert.equal((await L.fetchEventDocuments()).length, 1);
  } finally { global.fetch = previous; }
});
