(function (root) {
  'use strict';
  const TRUCKS = ['Sprinter', 'Iveco', 'Mercedes Benz'];
  const CATALOG_DEFAULTS = [
    { id: 'driver-jonathan-robles', kind: 'driver', name: 'Jonathan Robles', address: '' },
    { id: 'driver-emanuel-ledesma', kind: 'driver', name: 'Emanuel Ledesma', address: '' },
    { id: 'destination-centro-convenciones', kind: 'destination', name: 'Centro de Convenciones', address: '' },
    { id: 'destination-la-rural', kind: 'destination', name: 'La Rural', address: '' },
    { id: 'destination-sheraton-retiro', kind: 'destination', name: 'Sheraton Retiro', address: '' },
    { id: 'destination-sheraton-greenville', kind: 'destination', name: 'Sheraton Greenville', address: '' },
    { id: 'destination-ba-ferial', kind: 'destination', name: 'BA Ferial', address: '' },
    { id: 'destination-deposito-central', kind: 'destination', name: 'Depósito Central', address: '' }
  ];
  function nameKey(value) { return String(value || '').trim().replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es'); }
  function snapshot(value) {
    if (value && typeof value === 'object') return value;
    try { return JSON.parse(value) || {}; } catch (error) { return {}; }
  }
  function isoDate(value) {
    const text = String(value || '').trim();
    let parts;
    if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(text)) parts = text.slice(0, 10).split('-').map(Number);
    else {
      const match = text.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
      if (!match) return '';
      parts = [Number(match[3]), Number(match[2]), Number(match[1])];
    }
    const [year, month, day] = parts;
    const check = new Date(Date.UTC(year, month - 1, day));
    return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day
      ? `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
  }
  function today() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = type => parts.find(item => item.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  function dateLabel(value) {
    const date = isoDate(value);
    return date ? date.split('-').reverse().join('/') : 'Sin fecha';
  }
  function dateTimeLabel(value) {
    return value ? `${dateLabel(value)} ${String(value).slice(11, 16)}` : 'Sin horario';
  }
  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }
  function icon(name, fallback) {
    return `<i data-lucide="${name}" aria-hidden="true">${fallback}</i>`;
  }
  function icons() { if (root.lucide) root.lucide.createIcons(); }
  function uuid() {
    return root.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
      const value = Math.floor(Math.random() * 16);
      return (char === 'x' ? value : (value & 3) | 8).toString(16);
    });
  }
  function normalizeOrder(value) {
    return String(value || '').trim().replace(/^2026\s*-\s*(?=\S)/, '').trim();
  }
  function shiftDate(day, offset) {
    if (!isoDate(day)) return '';
    const date = new Date(`${day}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }
  function dayDifference(from, to) {
    return Math.round((Date.parse(`${to.slice(0, 10)}T12:00:00Z`) - Date.parse(`${from.slice(0, 10)}T12:00:00Z`)) / 86400000);
  }
  function calendarDays(month) {
    const first = `${month.slice(0, 7)}-01`;
    if (!isoDate(first)) return [];
    const weekday = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, index) => shiftDate(first, index - weekday));
  }
  function departureSchedule(day, loadingTime, departureTime, stops, loadingExtraDays = 0) {
    const validTime = time => /^([01]\d|2[0-3]):[0-5]\d$/.test(time || '');
    const combine = (date, time) => isoDate(date) && validTime(time) ? `${date}T${time}` : '';
    const loadingDaysBack = (validTime(loadingTime) && validTime(departureTime) && loadingTime > departureTime ? 1 : 0) + loadingExtraDays;
    let currentDay = day;
    let previousTime = departureTime;
    return {
      loading_at: combine(shiftDate(day, -loadingDaysBack), loadingTime),
      departure_at: combine(day, departureTime),
      stops: stops.map(stop => {
        const rollover = validTime(stop.eta) && validTime(previousTime) && stop.eta < previousTime ? 1 : 0;
        currentDay = shiftDate(currentDay, rollover + (stop.extraDays || 0));
        if (validTime(stop.eta)) previousTime = stop.eta;
        return { destination: stop.destination.trim(), address: (stop.address || '').trim(), eta: combine(currentDay, stop.eta),
          ...(stop.event?.key ? { event: { key: stop.event.key, order: stop.event.order || '', name: stop.event.name || '' } } : {}) };
      })
    };
  }
  function groupEvents(documents, day = today()) {
    const groups = new Map();
    const sorted = [...documents].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    for (const doc of sorted) {
      const saved = snapshot(doc.event_data);
      const order = normalizeOrder(doc.os || saved.ev?.os);
      const validOrder = order && !['—', '-', 'SIN OS', 'SINOS'].includes(order.toUpperCase());
      const key = validOrder ? `os:${order.toUpperCase()}` : `event:${saved.event_id || doc.id}`;
      if (!groups.has(key)) groups.set(key, { key, order: validOrder ? order : '', name: '', start: '', end: '', places: new Set(), areas: new Set(), documents: [] });
      const group = groups.get(key);
      if (!group.name) group.name = String(saved.ev?.evento || '').replace(/^—$/, '').trim();
      if (!group.start) group.start = isoDate(doc.armado) || isoDate(saved.ev?.armado);
      if (!group.end) group.end = isoDate(doc.desarme) || isoDate(saved.ev?.desarme);
      const place = String(doc.lugar || saved.ev?.lugar || '').trim();
      if (place && place !== '—') group.places.add(place);
      const area = String(doc.area || '').trim().toLocaleUpperCase('es');
      if (area && !['—', '-'].includes(area)) group.areas.add(area);
      group.documents.push(doc);
    }
    return [...groups.values()].map(group => ({ ...group, places: [...group.places], areas: [...group.areas].sort((a, b) => {
      const order = ['CCTV', 'SONIDO', 'VIDEO', 'LUCES', 'TARIMAS'];
      return (order.includes(a) ? order.indexOf(a) : 4) - (order.includes(b) ? order.indexOf(b) : 4) || a.localeCompare(b, 'es');
    }),
      expired: Boolean(group.end && group.end < day),
      ongoing: Boolean(group.start && group.start <= day && (!group.end || group.end >= day))
    })).sort((a, b) => (a.start || a.end || '9999').localeCompare(b.start || b.end || '9999') || a.order.localeCompare(b.order, 'es', { numeric: true }));
  }
  function eventOnDay(group, day) {
    const start = group.start || group.end;
    const end = group.end && group.end >= start ? group.end : start;
    return Boolean(start && day >= start && day <= end);
  }

  function linkedEvents(row) {
    return [...new Map((row.stops || []).filter(stop => typeof stop.event?.key === 'string' && stop.event.key)
      .map(stop => [stop.event.key, stop.event])).values()];
  }
  function eventLabel(event) {
    return [event.order ? `OS ${event.order}` : '', event.name || 'Evento sin nombre'].filter(Boolean).join(' · ');
  }
  function validateDeparture(row) {
    if (!row.origin?.trim()) return 'Completá el lugar de salida.';
    if (!TRUCKS.includes(row.truck_type)) return 'Seleccioná el modelo de camión.';
    if (!row.driver?.trim()) return 'Completá el chofer.';
    const validTime = value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || '') && isoDate(value) && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60;
    if (!validTime(row.loading_at) || !validTime(row.departure_at)) return 'Completá fecha y hora de carga y salida.';
    if (row.loading_at > row.departure_at) return 'La carga no puede ser posterior a la salida.';
    if (!Array.isArray(row.stops) || !row.stops.length) return 'Agregá al menos un destino.';
    let previous = row.departure_at;
    for (const [index, stop] of row.stops.entries()) {
      if (!stop.destination?.trim()) return `Completá el destino de la parada ${index + 1}.`;
      if (!validTime(stop.eta)) return `Completá la llegada estimada a la parada ${index + 1}.`;
      if (stop.eta < previous) return `La llegada a la parada ${index + 1} no puede ser anterior al horario previo.`;
      previous = stop.eta;
    }
    return '';
  }
  async function request(path, options = {}) {
    const config = root.PDF_ARCHIVE_CONFIG;
    if (!config) throw new Error('No se encontró la configuración online.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${config.SUPABASE_URL}/rest/v1/${path}`, { ...options, signal: controller.signal,
        headers: { apikey: config.SUPABASE_KEY, Authorization: `Bearer ${config.SUPABASE_KEY}`, ...options.headers } });
      if (!res.ok) {
        const error = new Error(`No se pudo conectar (${res.status}).`);
        error.status = res.status;
        throw error;
      }
      return res.status === 204 ? null : await res.json();
    } finally { clearTimeout(timeout); }
  }
  async function fetchAll(table, select, order = 'created_at.desc') {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const page = await request(`${table}?select=${select}&order=${order}&limit=500&offset=${offset}`);
      rows.push(...page);
      if (page.length < 500) return rows;
    }
  }
  async function fetchEventDocuments() {
    if (root.AppAccess?.isCalendar()) return fetchAll('app_calendar_events', '*', 'created_at.desc,id.desc');
    const table = root.PDF_ARCHIVE_CONFIG.SUPABASE_TABLE;
    const fields = 'id,os,lugar,sala,area,armado,desarme,lider,filename,public_url,storage_path,created_at';
    try { return await fetchAll(table, `${fields},event_data`, 'created_at.desc,id.desc'); }
    catch (error) {
      if (error.status !== 400) throw error;
      return fetchAll(table, fields, 'created_at.desc,id.desc');
    }
  }
  function pdfUrl(doc) {
    let value = doc.public_url;
    if (!value && doc.storage_path) {
      const config = root.PDF_ARCHIVE_CONFIG;
      value = `${config.SUPABASE_URL}/storage/v1/object/public/${config.SUPABASE_BUCKET}/${doc.storage_path.split('/').map(encodeURIComponent).join('/')}`;
    }
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; }
    catch (error) { return ''; }
  }
  class DepartureStore {
    constructor(storage, options = {}) {
      this.storage = storage;
      this.key = options.key || 'cr_logistica_salidas_v1';
      this.readOnly = Boolean(root.AppAccess?.isCalendar());
      if (this.readOnly) this.key += '_calendar';
      this.tableKey = options.tableKey || 'LOGISTICS_DEPARTURES_TABLE';
      this.table = options.table || 'logistics_departures';
      this.order = options.order || 'departure_at.asc,id.asc';
      this.chain = Promise.resolve();
      let cached;
      try { cached = JSON.parse(storage.getItem(this.key)); } catch (error) {}
      this.state = { rows: Array.isArray(cached?.rows) ? cached.rows : [], pending: cached?.pending || {} };
      this.online = false;
    }
    persist() { this.storage.setItem(this.key, JSON.stringify(this.state)); }
    serial(task) {
      const result = this.chain.catch(() => {}).then(task);
      this.chain = result;
      return result;
    }
    rows() { return this.state.rows.filter(row => !row.deleted); }
    refresh() { return this.serial(() => this.sync()); }
    put(row) {
      if (this.readOnly) return Promise.reject(new Error('Este acceso solo permite consultar calendarios.'));
      return this.serial(async () => {
        const before = JSON.stringify(this.state);
        this.state.rows = this.state.rows.filter(item => item.id !== row.id).concat(row);
        this.state.pending[row.id] = row;
        try { this.persist(); } catch (error) { this.state = JSON.parse(before); throw new Error('No se pudo guardar en este navegador.'); }
        return this.sync();
      });
    }
    async sync() {
      const table = root.PDF_ARCHIVE_CONFIG[this.tableKey] || this.table;
      try {
        if (this.readOnly) {
          this.state.rows = (await fetchAll('app_calendar_departures', '*', 'departure_at.asc,id.asc')).map(row => ({ ...row, driver: row.driver || '', notes: '' }));
          this.persist(); this.online = true;
          return this.rows();
        }
        // Keep local changes until the server has acknowledged each one.
        for (const row of Object.values(this.state.pending)) {
          await request(`${table}?on_conflict=id`, { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(row) });
          delete this.state.pending[row.id];
          this.persist();
        }
        this.state.rows = await fetchAll(table, '*', this.order);
        this.persist();
        this.online = true;
      } catch (error) { this.online = false; }
      return this.rows();
    }
  }
  class CatalogStore extends DepartureStore {
    constructor(storage) {
      super(storage, { key: 'cr_logistica_catalogo_v1', tableKey: 'LOGISTICS_CATALOG_TABLE', table: 'logistics_catalog', order: 'name.asc,id.asc' });
    }
    rows() {
      const rows = new Map(CATALOG_DEFAULTS.map(row => [row.id, { ...row }]));
      for (const row of this.state.rows) rows.set(row.id, row);
      return [...rows.values()].filter(row => !row.deleted);
    }
    list(kind) {
      const unique = new Map();
      for (const row of this.rows().filter(row => row.kind === kind)) unique.set(nameKey(row.name), row);
      return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
    }
    add(kind, name, address = '') {
      name = String(name || '').trim().replace(/\s+/g, ' ');
      if (!['driver', 'destination'].includes(kind) || !name) return Promise.reject(new Error('Completá el nombre.'));
      if (this.list(kind).some(row => nameKey(row.name) === nameKey(name))) return Promise.reject(new Error('Ese nombre ya está en el listado.'));
      return this.put({ id: `${kind}-${nameKey(name)}`, kind, name, address: kind === 'destination' ? address.trim() : '', deleted: false, updated_at: new Date().toISOString() });
    }
  }
  const api = { TRUCKS, CATALOG_DEFAULTS, nameKey, snapshot, isoDate, today, dateLabel, dateTimeLabel, escapeHTML, icon, icons, uuid, normalizeOrder, dayDifference, calendarDays, departureSchedule, groupEvents, eventOnDay, linkedEvents, eventLabel, validateDeparture, fetchEventDocuments, pdfUrl, DepartureStore, CatalogStore };
  root.Logistics = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
