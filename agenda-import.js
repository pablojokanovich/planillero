(function (root) {
  'use strict';
  function text(value, limit = 2000) {
    if (typeof value !== 'string' || value.length > limit) throw new Error('Datos de evento no validos.');
    return value.replace(/\0/g, '').trim();
  }
  function date(value) {
    const result = text(value, 10);
    if (!result) return '';
    const parsed = new Date(result + 'T12:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) throw new Error('Fecha de evento no valida.');
    return result.split('-').reverse().join('-');
  }
  function read(hash) {
    const raw = new URLSearchParams(String(hash).replace(/^#/, '')).get('agenda');
    if (raw === null) return null;
    if (raw.length > 100000) throw new Error('El evento es demasiado grande.');
    const value = JSON.parse(raw);
    if (!value || value.source !== 'agenda-cctv' || value.version !== 1 || !value.ev || !Array.isArray(value.salas) || value.salas.length > 200) throw new Error('Precarga no valida.');
    const ev = {};
    for (const field of ['os', 'evento', 'lugar', 'lider']) ev[field] = text(value.ev[field]);
    ev.notas = text(value.ev.notas, 60000);
    ev.armado = date(value.ev.armado);
    ev.desarme = date(value.ev.desarme);
    if (!ev.os && !ev.evento) throw new Error('Falta el nombre o la orden del evento.');
    return { eventKey: text(value.eventKey, 250), ev, salas: value.salas.map(name => text(name, 1000)).filter(Boolean) };
  }
  function draft(payload, eventId) {
    const salas = (payload.salas.length ? payload.salas : ['SALA A']).map((name, index) => ({ id: 'sala-' + (index + 1), name }));
    return {
      version: 2, eventId, agendaEventKey: payload.eventKey, ev: { ...payload.ev }, salas,
      salaCounter: salas.length, currentSalaId: salas[0].id, currentArea: 'cctv',
      quantities: {}, observations: {}, bultos: [], bultoCounter: 0, remitoNumero: '', archiveRemitoItems: []
    };
  }
  root.CongressAgendaImport = Object.freeze({ read, draft });
})(globalThis);
