const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const context = vm.createContext({ URLSearchParams });
vm.runInContext(readFileSync(join(__dirname, '..', 'agenda-import.js'), 'utf8'), context);
const api = context.CongressAgendaImport;
const plain = value => JSON.parse(JSON.stringify(value));
const payload = () => ({ source: 'agenda-cctv', version: 1, eventKey: 'agenda:7', ev: { os: '0029', evento: 'Congreso & TV', lugar: 'CEC', armado: '2026-10-28', desarme: '2026-10-30', lider: 'Maca', notas: 'Sala A\nCamarografos: Lucas' }, salas: ['A', 'B'] });
const fragment = value => '#' + new URLSearchParams({ agenda: JSON.stringify(value) });

test('receives event data and rooms without importing equipment or executing markup', () => {
  const input = payload(); input.salas[0] = '<img src=x onerror=alert(1)>';
  const parsed = api.read(fragment(input));
  const draft = plain(api.draft(parsed, 'new-event-id'));
  assert.equal(draft.ev.os, '0029');
  assert.equal(draft.ev.armado, '28-10-2026');
  assert.equal(draft.ev.desarme, '30-10-2026');
  assert.equal(draft.agendaEventKey, 'agenda:7');
  assert.equal(draft.eventId, 'new-event-id');
  assert.equal(draft.salas[0].name, input.salas[0]);
  assert.deepEqual(draft.salas.map(room => room.id), ['sala-1', 'sala-2']);
  assert.deepEqual(draft.quantities, {});
  assert.deepEqual(draft.bultos, []);
  assert.equal(draft.ev.notas, input.ev.notas);
});

test('ignores unrelated hashes and rejects malformed or unsupported imports', () => {
  assert.equal(api.read('#remito-manual'), null);
  assert.throws(() => api.read('#agenda=not-json'));
  for (const invalid of [null, {}, { ...payload(), source: 'other' }, { ...payload(), version: 2 }, { ...payload(), salas: [42] }]) assert.throws(() => api.read(fragment(invalid)));
  const invalid = payload(); invalid.ev.armado = '2026-02-31';
  assert.throws(() => api.read(fragment(invalid)));
});

test('always supplies safe room IDs and preserves partial event dates', () => {
  const input = payload(); input.salas = []; input.ev.armado = '';
  const draft = plain(api.draft(api.read(fragment(input)), 'id'));
  assert.deepEqual(draft.salas, [{ id: 'sala-1', name: 'SALA A' }]);
  assert.equal(draft.ev.armado, '');
});

test('the direct planner page imports after recovery, preserving existing drafts', () => {
  const html = readFileSync(join(__dirname, '..', 'planillero.html'), 'utf8');
  assert.match(html, /<script src="agenda-import.js"><\/script>/);
  assert.match(html, /const recovered = loadState\(\);\s*const imported = applyAgendaPreload\(recovered\)/);
  const state = new Map([['cr_deposito', '{"previous":true}']]);
  const location = { hash: fragment(payload()), pathname: '/planillero.html', search: '' };
  const sandbox = vm.createContext({
    CongressAgendaImport: api, URLSearchParams, window: { location },
    history: { replaceState: (_, __, url) => { location.hash = new URL(url, 'https://example.test').hash; } },
    document: { body: { classList: { contains: () => false } } },
    agendaEventKey: 'agenda:6', eventId: 'old', agendaImportNotice: '',
    isArchivedRemito: () => false, confirm: () => false, createEventId: () => 'new',
    plannerDraftKey: () => 'cr_deposito',
    plannerDraftStorage: () => ({ getItem: key => state.get(key), setItem: (key, value) => state.set(key, value) }),
    loadState: () => true
  });
  vm.runInContext(html.match(/function applyAgendaPreload\(recovered\) \{[\s\S]*?\n\}/)[0], sandbox);
  assert.equal(sandbox.applyAgendaPreload(true), false);
  assert.equal(state.get('cr_deposito'), '{"previous":true}');
  sandbox.confirm = () => true;
  assert.equal(sandbox.applyAgendaPreload(true), true);
  assert.equal(state.get('cr_agenda_backup:agenda%3A6'), '{"previous":true}');
  const draft = JSON.parse(state.get('cr_deposito'));
  assert.equal(draft.ev.os, '0029');
  assert.equal(draft.ev.evento, 'Congreso & TV');
  assert.deepEqual(draft.salas.map(room => room.name), ['A', 'B']);
  assert.equal(location.hash, '');
  location.hash = fragment(payload());
  sandbox.agendaEventKey = 'agenda:7';
  sandbox.confirm = () => { throw new Error('Same event must not prompt'); };
  draft.quantities.camera = 2;
  state.set('cr_deposito', JSON.stringify(draft));
  assert.equal(sandbox.applyAgendaPreload(true), true);
  assert.equal(JSON.parse(state.get('cr_deposito')).quantities.camera, 2);
});
