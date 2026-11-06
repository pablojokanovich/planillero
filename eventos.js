'use strict';
window.AppAccess.ready.then(() => {
const L = window.Logistics;
const byId = id => document.getElementById(id);
const escape = L.escapeHTML;
let documents = [];
let loading = false;
let lastUpdated = '';
let selectedDay = '';
let calendarMonth = L.today().slice(0, 7);
let selectedEvent = '';
const cacheKey = window.AppAccess.isCalendar() ? 'cr_eventos_documentos_calendar_v1' : 'cr_eventos_documentos_v1';
try {
  const saved = JSON.parse(localStorage.getItem(cacheKey));
  if (Array.isArray(saved?.documents)) { documents = saved.documents; lastUpdated = saved.updated || ''; }
} catch (error) {}

function selectEventDay(day, eventKey = '', focus = false) {
  selectedDay = day;
  calendarMonth = day.slice(0, 7);
  selectedEvent = eventKey;
  renderEvents();
  if (focus) byId('event-calendar-grid').querySelector(`[data-select-day="${day}"]`)?.focus({ preventScroll: true });
}

function changeEventMonth(offset) {
  const [year, month] = calendarMonth.split('-').map(Number);
  calendarMonth = new Date(Date.UTC(year, month - 1 + offset, 1, 12)).toISOString().slice(0, 7);
  selectedDay = '';
  selectedEvent = '';
  renderEvents();
}

function renderEventCalendar(groups) {
  const month = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${calendarMonth}-01T12:00:00Z`));
  byId('event-calendar-title').textContent = month[0].toUpperCase() + month.slice(1);
  byId('events-selected-date').textContent = selectedDay ? L.dateLabel(selectedDay) : 'Todos los días';
  byId('event-all-days').hidden = !selectedDay;
  const dates = L.calendarDays(calendarMonth);
  const today = L.today();
  const label = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  let html = '<div class="calendar-week calendar-weekdays" role="row">' + ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(day => `<div role="columnheader">${day}</div>`).join('') + '</div>';
  for (let week = 0; week < 6; week++) {
    html += '<div class="calendar-week" role="row">';
    for (const day of dates.slice(week * 7, week * 7 + 7)) {
      const entries = groups.filter(group => L.eventOnDay(group, day));
      const fullLabel = label.format(new Date(`${day}T12:00:00Z`));
      html += `<div class="calendar-day${day.slice(0, 7) !== calendarMonth ? ' other-month' : ''}${day === selectedDay ? ' is-selected' : ''}${day === today ? ' is-today' : ''}" role="gridcell" aria-selected="${day === selectedDay}" data-calendar-date="${day}">
        <button class="calendar-day-number" type="button" data-select-day="${day}" aria-label="Ver eventos del ${escape(fullLabel)}" ${day === today ? 'aria-current="date"' : ''}>${Number(day.slice(8, 10))}</button>
        ${day === today ? '<span class="calendar-today-label">HOY</span>' : ''}
        <div class="calendar-entries">${entries.map(group => {
          const phase = day === group.start && day === group.end ? 'Armado y desarme' : day === group.start ? 'Armado' : day === group.end ? 'Desarme' : 'En curso';
          const loadedAreas = group.areas.length ? `Planillas cargadas: ${group.areas.join(', ')}` : 'Sin área informada';
          const title = `${group.order || 'Sin orden'} · ${group.name || 'Evento sin nombre'} · ${group.places.join(' / ')} · ${phase} · ${loadedAreas}`;
          const areas = group.areas.map(area => `<span class="calendar-area-check" aria-label="${escape(area)}: planilla cargada">✓ ${escape(area)}</span>`).join('');
          return `<button class="calendar-entry calendar-event ${group.expired ? 'ended' : group.ongoing ? 'ongoing' : 'upcoming'}" type="button" data-event-key="${escape(group.key)}" title="${escape(title)}" aria-label="Seleccionar evento ${escape(title)}"><span class="calendar-event-order">${escape(group.order || 'Sin orden')}</span><span class="calendar-event-name">${escape(group.name || 'Evento sin nombre')}</span><span class="calendar-event-place">${escape(group.places.join(' / ') || 'Sin locación')}</span><span class="calendar-event-phase">${phase}</span><span class="calendar-event-areas">${areas || '<span class="muted">Sin área informada</span>'}</span></button>`;
        }).join('')}</div>
      </div>`;
    }
    html += '</div>';
  }
  byId('event-calendar-grid').innerHTML = html;
  const selected = byId('event-calendar-grid').querySelector('.is-selected') || byId('event-calendar-grid').querySelector('.is-today');
  const viewport = byId('event-calendar-grid').parentElement;
  if (selected && viewport.scrollWidth > viewport.clientWidth) {
    const cell = selected.getBoundingClientRect();
    const bounds = viewport.getBoundingClientRect();
    if (cell.left < bounds.left) viewport.scrollLeft -= bounds.left - cell.left;
    else if (cell.right > bounds.right) viewport.scrollLeft += cell.right - bounds.right;
  }
}

function renderEvents() {
  const open = new Set([...document.querySelectorAll('.event[open]')].map(element => element.dataset.key));
  if (selectedEvent) open.add(selectedEvent);
  const query = L.normalizeOrder(byId('search').value).toLocaleLowerCase('es');
  const from = byId('date-from').value;
  const until = byId('date-to').value;
  if (from && until && from > until) {
    byId('events').innerHTML = '<div class="empty">El rango de fechas no es válido.</div>';
    byId('metrics').textContent = '';
    renderEventCalendar([]);
    return;
  }
  const groups = L.groupEvents(documents).filter(group => {
    const start = group.start || group.end;
    const end = group.end || group.start;
    const text = [group.order, group.name, ...group.places, ...group.documents.map(doc => `${doc.sala || ''} ${doc.area || ''}`)].join(' ').toLocaleLowerCase('es');
    return (!from || (end && end >= from)) && (!until || (start && start <= until)) && (!query || text.includes(query));
  });
  renderEventCalendar(groups);
  const pending = groups.filter(group => !group.expired);
  const visible = selectedDay ? pending.filter(group => L.eventOnDay(group, selectedDay)) : pending;
  byId('metrics').innerHTML = `<span><strong>${visible.length}</strong>pendientes de desarme</span><span><strong>${groups.length}</strong>eventos registrados</span><span><strong>${groups.filter(group => !group.start && !group.end).length}</strong>sin fecha</span>`;
  byId('events').innerHTML = visible.map(group => {
    const state = group.expired ? 'Finalizado' : group.ongoing ? 'En curso' : group.start ? 'Próximo' : 'Sin fecha';
    return `<details class="event" data-key="${escape(group.key)}" ${open.has(group.key) ? 'open' : ''}>
      <summary>
        <div class="order">${escape(group.order || 'Sin nro. de orden')}</div>
        <div class="event-info"><p class="event-title">${escape(group.name || 'Evento sin nombre')}</p><div class="places muted">${escape(group.places.join(' / ') || 'Sin locación')}</div></div>
        <div class="event-dates">${escape(L.dateLabel(group.start))}<span>Desarme: ${escape(L.dateLabel(group.end))}</span></div>
        <div class="event-count"><span class="badge ${group.ongoing ? '' : 'pending'}">${state}</span><span>${group.documents.length} PDF</span>${L.icon('chevron-down', '&#8964;')}</div>
      </summary>
      <div class="table-wrap"><table><thead><tr><th>Área</th><th>Sala</th><th>Lugar</th><th>Responsable</th><th>Archivo</th></tr></thead><tbody>
      ${group.documents.map(doc => {
        const url = L.pdfUrl(doc);
        return `<tr><td>${escape(doc.area || '—')}</td><td>${escape(doc.sala || '—')}</td><td>${escape(doc.lugar || '—')}</td><td>${escape(doc.lider || '—')}</td><td>${url ? `<a href="#" data-pdf-path="${escape(doc.storage_path || '')}">${escape(doc.filename || 'Ver PDF')}</a>` : 'PDF no disponible'}</td></tr>`;
      }).join('')}
      </tbody></table></div>
    </details>`;
  }).join('') || `<div class="empty"><strong>${selectedDay ? 'No hay eventos pendientes de desarme para este día' : 'No hay eventos pendientes de desarme'}</strong></div>`;
  L.icons();
}

async function refreshEvents() {
  if (loading) return;
  loading = true;
  byId('refresh').disabled = true;
  byId('status').textContent = 'Actualizando eventos...';
  try {
    documents = await L.fetchEventDocuments();
    lastUpdated = new Date().toISOString();
    let cached = true;
    try { localStorage.setItem(cacheKey, JSON.stringify({ documents, updated: lastUpdated })); } catch (error) { cached = false; }
    byId('status').textContent = cached ? 'Agenda sincronizada con las planillas guardadas.' : 'Agenda sincronizada. No se pudo guardar una copia local.';
    byId('status').classList.toggle('error', !cached);
  } catch (error) {
    const date = lastUpdated ? new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'short' }).format(new Date(lastUpdated)) : '';
    byId('status').textContent = date ? `Sin conexión. Mostrando la copia del ${date}.` : 'No se pudo cargar la agenda online. Reintentá con Actualizar.';
    byId('status').classList.add('error');
  } finally { loading = false; byId('refresh').disabled = false; renderEvents(); }
}

for (const id of ['search', 'date-from', 'date-to']) byId(id).addEventListener('input', renderEvents);
byId('event-all-days').addEventListener('click', () => { selectedDay = ''; selectedEvent = ''; renderEvents(); });
byId('event-calendar-prev').addEventListener('click', () => changeEventMonth(-1));
byId('event-calendar-next').addEventListener('click', () => changeEventMonth(1));
byId('event-calendar-today').addEventListener('click', () => selectEventDay(L.today()));
byId('event-calendar-grid').addEventListener('click', event => {
  const cell = event.target.closest('[data-calendar-date]');
  if (!cell) return;
  const entry = event.target.closest('[data-event-key]');
  selectEventDay(cell.dataset.calendarDate, entry?.dataset.eventKey || '', !entry);
});
byId('event-calendar-grid').addEventListener('keydown', event => {
  const button = event.target.closest('[data-select-day]');
  const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
  if (!button || !offset) return;
  event.preventDefault();
  const date = new Date(`${button.dataset.selectDay}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  selectEventDay(date.toISOString().slice(0, 10), '', true);
});
byId('refresh').addEventListener('click', refreshEvents);
byId('events').addEventListener('click', event => {
  const link = event.target.closest('[data-pdf-path]');
  if (link) { event.preventDefault(); window.AppAccess.openPdf(link.dataset.pdfPath); }
});
window.addEventListener('online', refreshEvents);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshEvents(); });
setInterval(() => { if (!document.hidden) refreshEvents(); }, 60000);
renderEvents();
refreshEvents();
}).catch(() => {});
