'use strict';
window.AppAccess.ready.then(() => {
const L = window.Logistics;
const store = new L.DepartureStore(localStorage);
const catalog = new L.CatalogStore(localStorage);
const byId = id => document.getElementById(id);
const escape = L.escapeHTML;
let draft = null;
let loadingExtraDays = 0;
let saving = false;
let refreshing = false;
let viewError = '';
let selectedDay = L.today();
let calendarMonth = selectedDay.slice(0, 7);

function selectCalendarDay(day, focus = false) {
  selectedDay = day;
  calendarMonth = day.slice(0, 7);
  renderDepartures();
  if (focus) byId('calendar-grid').querySelector(`[data-select-day="${day}"]`)?.focus({ preventScroll: true });
}

function changeCalendarMonth(offset) {
  const [year, month] = calendarMonth.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month + offset, 0)).getUTCDate();
  const day = Math.min(Number(selectedDay.slice(8, 10)), lastDay);
  selectCalendarDay(new Date(Date.UTC(year, month - 1 + offset, day, 12)).toISOString().slice(0, 10));
}

function renderCalendar(rows) {
  const monthLabel = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${calendarMonth}-01T12:00:00Z`));
  byId('calendar-title').textContent = monthLabel[0].toUpperCase() + monthLabel.slice(1);
  byId('selected-date-label').textContent = L.dateLabel(selectedDay);
  const grouped = new Map();
  for (const row of rows) {
    const day = row.departure_at.slice(0, 10);
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day).push(row);
  }
  const dates = L.calendarDays(calendarMonth);
  const today = L.today();
  const label = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  let html = '<div class="calendar-week calendar-weekdays" role="row">' + ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(day => `<div role="columnheader">${day}</div>`).join('') + '</div>';
  for (let week = 0; week < 6; week++) {
    html += '<div class="calendar-week" role="row">';
    for (const day of dates.slice(week * 7, week * 7 + 7)) {
      const departures = grouped.get(day) || [];
      const fullLabel = label.format(new Date(`${day}T12:00:00Z`));
      html += `<div class="calendar-day${day.slice(0, 7) !== calendarMonth ? ' other-month' : ''}${day === selectedDay ? ' is-selected' : ''}${day === today ? ' is-today' : ''}" role="gridcell" aria-selected="${day === selectedDay}" data-calendar-date="${day}">
        <button class="calendar-day-number" type="button" data-select-day="${day}" aria-label="Ver salidas del ${escape(fullLabel)}" ${day === today ? 'aria-current="date"' : ''}>${Number(day.slice(8, 10))}</button>
        <div class="calendar-entries">${departures.slice(0, 2).map(row => {
          const type = ({ Sprinter: 'sprinter', Iveco: 'iveco', 'Mercedes Benz': 'mercedes' })[row.truck_type] || '';
          const loading = row.loading_at.slice(0, 10) === day ? row.loading_at.slice(11, 16) : L.dateTimeLabel(row.loading_at);
          const destinations = row.stops.map(stop => stop.destination).join(' → ');
          const title = `Carga: ${loading} · Salida: ${row.departure_at.slice(11, 16)} · Camión: ${row.truck_type} · Destino: ${destinations}`;
          return `<button class="calendar-entry ${type}" type="button" data-departure-id="${escape(row.id)}" title="${escape(title)}" aria-label="Editar salida ${escape(title)}"><span class="calendar-entry-loading">Carga: ${escape(loading)}</span><span class="calendar-entry-time">Salida: ${escape(row.departure_at.slice(11, 16))}</span><span class="calendar-entry-truck">${escape(row.truck_type)}</span><span class="calendar-entry-destination">${escape(destinations)}</span></button>`;
        }).join('')}</div>
        ${departures.length > 2 ? `<button class="calendar-more" type="button" data-select-day="${day}">+${departures.length - 2} más</button>` : ''}
      </div>`;
    }
    html += '</div>';
  }
  byId('calendar-grid').innerHTML = html;
  const selected = byId('calendar-grid').querySelector('.is-selected');
  const viewport = byId('calendar-grid').parentElement;
  if (selected && viewport.scrollWidth > viewport.clientWidth) {
    const cell = selected.getBoundingClientRect();
    const bounds = viewport.getBoundingClientRect();
    if (cell.left < bounds.left) viewport.scrollLeft -= bounds.left - cell.left;
    else if (cell.right > bounds.right) viewport.scrollLeft += cell.right - bounds.right;
  }
}

function showStatus() {
  const pending = Object.keys(store.state.pending).length;
  byId('status').textContent = viewError || (store.online
    ? 'Salidas sincronizadas.'
    : `Guardado local en este navegador.${pending ? ` ${pending} cambio(s) pendiente(s) de sincronizar.` : ''} Sin conexión con el registro compartido.`);
  byId('status').classList.toggle('error', Boolean(viewError) || !store.online);
}

function renderDrivers(selected = byId('driver').value) {
  const names = new Map();
  for (const name of [...catalog.list('driver').map(row => row.name), ...store.rows().map(row => row.driver), selected].filter(Boolean)) {
    if (!names.has(L.nameKey(name))) names.set(L.nameKey(name), name);
  }
  byId('driver').innerHTML = '<option value="">Elegir chofer</option>' + [...names.values()].sort((a, b) => a.localeCompare(b, 'es'))
    .map(name => `<option value="${escape(name)}">${escape(name)}</option>`).join('');
  byId('driver').value = names.get(L.nameKey(selected)) || '';
}

function readOrigin() {
  return (byId('origin').value === '__manual__' ? byId('origin-manual').value : byId('origin').value).trim();
}

function renderOrigin(selected) {
  const keepManual = selected === undefined && byId('origin').value === '__manual__';
  if (selected === undefined) selected = readOrigin();
  const destinations = catalog.list('destination');
  const known = destinations.find(row => L.nameKey(row.name) === L.nameKey(selected));
  const manual = keepManual || Boolean(selected && !known);
  byId('origin').innerHTML = '<option value="">Elegir lugar de salida</option>'
    + destinations.map(row => `<option value="${escape(row.name)}">${escape(row.name)}</option>`).join('')
    + '<option value="__manual__">Otro lugar...</option>';
  byId('origin').value = manual ? '__manual__' : (known?.name || '');
  byId('origin-manual').value = manual ? selected : '';
  byId('origin-manual-field').hidden = !manual;
  byId('origin-manual').disabled = !manual;
  byId('origin-manual').required = manual;
}

function renderSettings(message = '') {
  byId('settings-drivers').innerHTML = catalog.list('driver').map(row => `<li>${escape(row.name)}</li>`).join('');
  byId('settings-destinations').innerHTML = catalog.list('destination').map(row => `<li>${escape(row.name)}${row.address ? `<span class="muted">${escape(row.address)}</span>` : ''}</li>`).join('');
  byId('settings-status').textContent = `${message ? message + ' ' : ''}${catalog.online ? 'Listado sincronizado.' : 'Guardado local en este navegador.'}`;
  byId('settings-status').classList.remove('error');
  L.icons();
}

function renderDepartures() {
  const from = byId('date-from').value;
  const until = byId('date-to').value;
  const truck = byId('truck-filter').value;
  const query = byId('search').value.trim().toLocaleLowerCase('es');
  const activeFilters = [from, until, truck, query].filter(Boolean).length;
  byId('filters-title').textContent = activeFilters ? `Filtros (${activeFilters} activos)` : 'Filtros';
  if (from && until && from > until) {
    byId('departures').innerHTML = '<div class="empty">El rango de fechas no es válido.</div>';
    byId('metrics').textContent = '';
    renderCalendar([]);
    return;
  }
  const rows = store.rows().filter(row => {
    const date = row.departure_at.slice(0, 10);
    const text = [row.origin, row.driver, row.truck_type, row.notes, ...row.stops.map(stop => `${stop.destination} ${stop.address || ''}`)].join(' ').toLocaleLowerCase('es');
    return (!from || date >= from) && (!until || date <= until) && (!truck || row.truck_type === truck) && (!query || text.includes(query));
  }).sort((a, b) => a.departure_at.localeCompare(b.departure_at) || a.id.localeCompare(b.id));
  renderCalendar(rows);
  const dayRows = rows.filter(row => row.departure_at.slice(0, 10) === selectedDay);
  byId('metrics').innerHTML = `<span><strong>${dayRows.length}</strong>${dayRows.length === 1 ? 'salida del día' : 'salidas del día'}</span><span><strong>${dayRows.reduce((total, row) => total + row.stops.length, 0)}</strong>destinos</span>`;
  byId('departures').innerHTML = dayRows.map(row => {
    const day = row.departure_at.slice(0, 10);
    return `<article class="departure" data-id="${escape(row.id)}">
      <div><div class="departure-time">${escape(row.departure_at.slice(11, 16))}</div><div class="muted">Salida</div></div>
      <div><p class="truck-name">${escape(row.truck_type)}</p><p>${escape(row.driver)}</p><p class="muted">Carga: ${escape(L.dateTimeLabel(row.loading_at))}</p></div>
      <div class="departure-route"><p><span class="muted">Desde </span>${escape(row.origin)}</p>
        <ol class="route">${row.stops.map((stop, index) => `<li><span class="stop-number">${index + 1}.</span><div>${escape(stop.destination)}${stop.address ? `<div class="muted">${escape(stop.address)}</div>` : ''}</div><time>${escape(stop.eta.slice(0, 10) === day ? stop.eta.slice(11, 16) : L.dateTimeLabel(stop.eta))}</time></li>`).join('')}</ol>
        ${row.notes ? `<p class="muted">${escape(row.notes)}</p>` : ''}
      </div>
      <div class="actions"><button class="icon-button" data-action="edit" title="Editar salida" aria-label="Editar salida">${L.icon('pencil', '&#9998;')}</button><button class="icon-button danger" data-action="delete" title="Eliminar salida" aria-label="Eliminar salida">${L.icon('trash-2', '&times;')}</button></div>
    </article>`;
  }).join('') || '<div class="empty"><strong>No hay salidas para este día</strong></div>';
  renderDrivers();
  renderOrigin();
  L.icons();
}

function readSchedule() {
  return L.departureSchedule(byId('trip-date').value, byId('loading-at').value, byId('departure-at').value, draft.stops, loadingExtraDays);
}

function updateScheduleDays() {
  if (!draft) return;
  const schedule = readSchedule();
  const day = byId('trip-date').value;
  const showDay = (element, dateTime) => {
    const date = dateTime.slice(0, 10);
    element.hidden = !date || date === day;
    if (!element.hidden) {
      const difference = L.dayDifference(day, date);
      const label = difference === -1 ? 'Día anterior' : difference === 1 ? 'Día siguiente' : 'Fecha';
      element.textContent = `${label}: ${L.dateLabel(date)}`;
    }
  };
  showDay(byId('loading-day'), schedule.loading_at);
  byId('stop-editors').querySelectorAll('[data-stop-day]').forEach((element, index) => showDay(element, schedule.stops[index].eta));
}

function renderStops(focusLast = false) {
  const destinations = catalog.list('destination');
  byId('stop-editors').innerHTML = draft.stops.map((stop, index) => {
    const known = destinations.find(row => L.nameKey(row.name) === L.nameKey(stop.destination));
    const manual = Boolean(stop.manualDestination || (stop.destination && !known));
    return `<div class="stop-editor" data-index="${index}">
    <strong>${index + 1}</strong>
    <div class="stop-fields">
      <label>Destino<select data-role="destination-choice" aria-label="Destino ${index + 1}" required>
        <option value="" ${!manual && !known ? 'selected' : ''}>Elegir destino</option>
        ${destinations.map(row => `<option value="${escape(row.id)}" ${!manual && known?.id === row.id ? 'selected' : ''}>${escape(row.name)}</option>`).join('')}
        <option value="__manual__" ${manual ? 'selected' : ''}>Otro destino...</option>
      </select></label>
      <label>Hora de llegada<input data-field="eta" aria-label="Hora de llegada ${index + 1}" type="time" value="${escape(stop.eta)}" required><span class="schedule-day" data-stop-day hidden></span></label>
      <label class="full" ${manual ? '' : 'hidden'}>Nombre del destino<input data-field="destination" aria-label="Nombre del destino ${index + 1}" value="${escape(stop.destination)}" ${manual ? 'required' : 'disabled'} maxlength="250"></label>
      <label class="full">Dirección<input data-field="address" aria-label="Dirección ${index + 1}" value="${escape(stop.address || '')}" maxlength="350"></label>
    </div>
    <div class="stop-tools">
      <button class="icon-button" type="button" data-move="-1" title="Subir destino" aria-label="Subir destino ${index + 1}" ${index === 0 ? 'disabled' : ''}>${L.icon('arrow-up', '&#8593;')}</button>
      <button class="icon-button" type="button" data-move="1" title="Bajar destino" aria-label="Bajar destino ${index + 1}" ${index === draft.stops.length - 1 ? 'disabled' : ''}>${L.icon('arrow-down', '&#8595;')}</button>
      <button class="icon-button danger" type="button" data-remove title="Quitar destino" aria-label="Quitar destino ${index + 1}" ${draft.stops.length === 1 ? 'disabled' : ''}>${L.icon('x', '&times;')}</button>
    </div>
  </div>`;
  }).join('');
  updateScheduleDays();
  L.icons();
  if (focusLast) byId('stop-editors').lastElementChild.querySelector('select').focus();
}

function openDeparture(row) {
  draft = row ? JSON.parse(JSON.stringify(row)) : { id: L.uuid(), loading_at: '', departure_at: '', origin: '', truck_type: L.TRUCKS[0], driver: '', notes: '', stops: [{ destination: '', address: '', eta: '' }], deleted: false };
  draft.loading_at = draft.loading_at.slice(0, 16);
  draft.departure_at = draft.departure_at.slice(0, 16);
  const day = row ? draft.departure_at.slice(0, 10) : selectedDay;
  const loadingTime = draft.loading_at.slice(11, 16);
  const departureTime = draft.departure_at.slice(11, 16);
  loadingExtraDays = row ? Math.max(0, L.dayDifference(draft.loading_at, draft.departure_at) - (loadingTime > departureTime ? 1 : 0)) : 0;
  let previous = draft.departure_at;
  draft.stops.forEach(stop => {
    const original = stop.eta.slice(0, 16);
    const time = original.slice(11, 16);
    stop.extraDays = row ? Math.max(0, L.dayDifference(previous, original) - (time < previous.slice(11, 16) ? 1 : 0)) : 0;
    stop.eta = time;
    previous = original;
  });
  byId('dialog-title').textContent = row ? 'Editar salida' : 'Nueva salida';
  byId('trip-date').value = day;
  byId('loading-at').value = loadingTime;
  byId('departure-at').value = departureTime;
  renderDrivers(draft.driver);
  renderOrigin(draft.origin);
  for (const [id, field] of [['truck-type', 'truck_type'], ['notes', 'notes']]) byId(id).value = draft[field];
  byId('notes-section').open = Boolean(draft.notes);
  byId('form-error').hidden = true;
  renderStops();
  byId('departure-dialog').showModal();
}

async function refreshDepartures() {
  if (refreshing || saving) return;
  refreshing = true;
  byId('refresh').disabled = true;
  try { await Promise.all([store.refresh(), window.AppAccess.isCalendar() ? Promise.resolve() : catalog.refresh()]); if (store.online && window.AppAccess.isFull()) window.DepartureAlerts.observe(store.rows()); }
  finally { refreshing = false; byId('refresh').disabled = false; showStatus(); renderDepartures(); if (byId('settings-dialog').open) renderSettings(); }
}

byId('calendar-prev').addEventListener('click', () => changeCalendarMonth(-1));
byId('calendar-next').addEventListener('click', () => changeCalendarMonth(1));
byId('calendar-today').addEventListener('click', () => selectCalendarDay(L.today()));
byId('calendar-grid').addEventListener('click', event => {
  const cell = event.target.closest('[data-calendar-date]');
  if (!cell) return;
  const entry = event.target.closest('[data-departure-id]');
  const row = entry && store.rows().find(item => item.id === entry.dataset.departureId);
  selectCalendarDay(cell.dataset.calendarDate, !entry);
  if (row && !window.AppAccess.isCalendar()) openDeparture(row);
});
byId('calendar-grid').addEventListener('keydown', event => {
  const button = event.target.closest('[data-select-day]');
  const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
  if (!button || !offset) return;
  event.preventDefault();
  const date = new Date(`${button.dataset.selectDay}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  selectCalendarDay(date.toISOString().slice(0, 10), true);
});
byId('new-departure').addEventListener('click', () => openDeparture());
byId('origin').addEventListener('change', () => {
  const manual = byId('origin').value === '__manual__';
  byId('origin-manual-field').hidden = !manual;
  byId('origin-manual').disabled = !manual;
  byId('origin-manual').required = manual;
  if (manual) byId('origin-manual').focus();
});
byId('refresh').addEventListener('click', () => { viewError = ''; refreshDepartures(); });
byId('print').addEventListener('click', () => window.print());
for (const id of ['close-dialog', 'cancel']) byId(id).addEventListener('click', () => { if (!saving) byId('departure-dialog').close(); });
byId('departure-dialog').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
for (const id of ['date-from', 'date-to', 'truck-filter', 'search']) byId(id).addEventListener('input', renderDepartures);
byId('add-stop').addEventListener('click', () => { draft.stops.push({ destination: '', address: '', eta: '' }); renderStops(true); });
for (const id of ['trip-date', 'loading-at', 'departure-at']) byId(id).addEventListener('input', updateScheduleDays);
byId('stop-editors').addEventListener('input', event => {
  const field = event.target.dataset.field;
  if (field) draft.stops[Number(event.target.closest('.stop-editor').dataset.index)][field] = event.target.value;
  updateScheduleDays();
});
byId('stop-editors').addEventListener('change', event => {
  if (event.target.dataset.role !== 'destination-choice') return;
  const index = Number(event.target.closest('.stop-editor').dataset.index);
  const stop = draft.stops[index];
  const destination = catalog.list('destination').find(row => row.id === event.target.value);
  stop.manualDestination = event.target.value === '__manual__';
  stop.destination = destination?.name || '';
  stop.address = destination?.address || '';
  renderStops();
  if (stop.manualDestination) byId('stop-editors').children[index].querySelector('[data-field="destination"]').focus();
});
byId('stop-editors').addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  const index = Number(button.closest('.stop-editor').dataset.index);
  if (button.hasAttribute('data-remove')) draft.stops.splice(index, 1);
  else { const other = index + Number(button.dataset.move); [draft.stops[index], draft.stops[other]] = [draft.stops[other], draft.stops[index]]; }
  renderStops();
});
byId('departure-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (saving) return;
  const row = { ...draft, ...readSchedule(),
    origin: readOrigin(), truck_type: byId('truck-type').value, driver: byId('driver').value.trim(), notes: byId('notes').value.trim(),
    updated_at: new Date().toISOString(), deleted: false };
  const error = L.validateDeparture(row);
  byId('form-error').textContent = error;
  byId('form-error').hidden = !error;
  if (error) return;
  saving = true;
  byId('save').disabled = true;
  byId('departure-form').querySelector('.form-body').inert = true;
  try {
    await store.put(row);
    if (store.online) window.DepartureAlerts.observe(store.rows());
    viewError = '';
    byId('departure-dialog').close();
    // Keep a newly saved departure visible even when it is outside the current filters.
    if (byId('date-from').value && row.departure_at.slice(0, 10) < byId('date-from').value) byId('date-from').value = row.departure_at.slice(0, 10);
    if (byId('date-to').value && row.departure_at.slice(0, 10) > byId('date-to').value) byId('date-to').value = row.departure_at.slice(0, 10);
    byId('truck-filter').value = '';
    byId('search').value = '';
    selectedDay = row.departure_at.slice(0, 10);
    calendarMonth = selectedDay.slice(0, 7);
  } catch (failure) { byId('form-error').textContent = failure.message; byId('form-error').hidden = false; }
  finally { saving = false; byId('save').disabled = false; byId('departure-form').querySelector('.form-body').inert = false; renderDepartures(); showStatus(); }
});
byId('departures').addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const row = store.rows().find(item => item.id === button.closest('[data-id]').dataset.id);
  if (!row) return;
  if (button.dataset.action === 'edit') { openDeparture(row); return; }
  if (!confirm(`¿Eliminar la salida de ${row.truck_type}, ${L.dateTimeLabel(row.departure_at)}?`)) return;
  button.disabled = true;
  try { await store.put({ ...row, deleted: true, updated_at: new Date().toISOString() }); viewError = ''; }
  catch (error) { viewError = error.message; }
  showStatus(); renderDepartures();
});
byId('open-settings').addEventListener('click', () => { renderSettings(); byId('settings-dialog').showModal(); });
byId('close-settings').addEventListener('click', () => byId('settings-dialog').close());
for (const [formId, kind, nameId] of [['add-driver-form', 'driver', 'new-driver-name'], ['add-destination-form', 'destination', 'new-destination-name']]) {
  byId(formId).addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    try {
      await catalog.add(kind, byId(nameId).value, kind === 'destination' ? byId('new-destination-address').value : '');
      event.target.reset();
      renderDrivers();
      renderOrigin();
      renderSettings(kind === 'driver' ? 'Chofer agregado.' : 'Destino agregado.');
      byId(nameId).focus();
    } catch (error) {
      byId('settings-status').textContent = error.message;
      byId('settings-status').classList.add('error');
    } finally { button.disabled = false; }
  });
}
if (window.AppAccess.isFull()) window.DepartureAlerts.init({ onOpen: row => { selectCalendarDay(row.departure_at.slice(0, 10)); openDeparture(row); } });
window.addEventListener('online', refreshDepartures);
setInterval(() => { if (!document.hidden || window.DepartureAlerts.enabled()) refreshDepartures(); }, 5 * 60 * 1000);
L.icons();
renderDepartures();
showStatus();
refreshDepartures();
}).catch(() => {});
