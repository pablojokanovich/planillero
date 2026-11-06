(function () {
  'use strict';
  const config = window.PDF_ARCHIVE_CONFIG;
  const byId = id => document.getElementById(id);
  const preferenceKey = 'cr_avisos_salidas_v1';
  let preferences = { enabled: false, initialized: false, seen: [] };
  let onOpen = () => {};
  try { preferences = { ...preferences, ...JSON.parse(localStorage.getItem(preferenceKey)) }; } catch (error) {}
  if (!Array.isArray(preferences.seen)) preferences.seen = [];
  function persist() { try { localStorage.setItem(preferenceKey, JSON.stringify(preferences)); } catch (error) {} }
  function enabled() { return Boolean(preferences.enabled && 'Notification' in window && Notification.permission === 'granted'); }
  function desktopStatus(message) {
    byId('desktop-alerts').checked = enabled();
    byId('desktop-alerts-status').textContent = message || (enabled() ? 'Avisos activados en esta computadora.' : 'Avisos desactivados en esta computadora.');
  }
  function observe(rows) {
    let latest = {};
    try { latest = JSON.parse(localStorage.getItem(preferenceKey)) || {}; } catch (error) {}
    const seen = new Set([...preferences.seen, ...(Array.isArray(latest.seen) ? latest.seen : [])]);
    const additions = preferences.initialized || latest.initialized ? rows.filter(row => !seen.has(row.id)) : [];
    rows.forEach(row => seen.add(row.id));
    preferences.seen = [...seen];
    preferences.initialized = true;
    persist();
    if (!additions.length) return;
    const row = additions[additions.length - 1];
    const text = additions.length > 1 ? `${additions.length} nuevas salidas.` : `Nueva salida: ${row.truck_type}, ${window.Logistics.dateTimeLabel(row.departure_at)}.`;
    byId('new-departure-text').textContent = text;
    byId('new-departure-alert').hidden = false;
    byId('view-new-departure').onclick = () => { byId('new-departure-alert').hidden = true; onOpen(row); };
    if (enabled()) {
      try {
        const notification = new Notification('Nueva salida de camiones', { body: text, tag: `salida-${row.id}` });
        notification.onclick = () => { window.focus(); onOpen(row); notification.close(); };
      } catch (error) { desktopStatus('El navegador no permite mostrar notificaciones en este dispositivo.'); }
    }
  }
  function emailStatus(message, error = false) {
    byId('email-status').textContent = message;
    byId('email-status').classList.toggle('error', error);
  }
  async function api(path, options = {}) {
    if (!window.AppAccess.isFull()) throw new Error('Este acceso solo permite consultar calendarios.');
    const accessToken = await window.AppAccess.token();
    const response = await fetch(`${config.SUPABASE_URL}/rest/v1/${path}`, {
      ...options, signal: AbortSignal.timeout(10000), headers: { apikey: config.SUPABASE_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...options.headers }
    });
    if (!response.ok) {
      throw new Error(response.status === 409 ? 'Ese correo ya está agregado.' : 'No se pudo guardar o consultar la configuración. Revisá el acceso y la instalación de avisos.');
    }
    return response.status === 204 ? null : response.json();
  }
  async function loadRecipients() {
    const rows = await api('departure_notification_recipients?select=id,email,enabled&order=email.asc');
    byId('email-recipients').replaceChildren(...rows.map(row => {
      const item = document.createElement('li');
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.checked = row.enabled;
      checkbox.setAttribute('aria-label', `Avisar a ${row.email}`);
      checkbox.addEventListener('change', async () => {
        checkbox.disabled = true;
        try { await api(`departure_notification_recipients?id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', body: JSON.stringify({ enabled: checkbox.checked }) }); row.enabled = checkbox.checked; emailStatus('Destinatario actualizado.'); }
        catch (error) { checkbox.checked = row.enabled; emailStatus(error.message, true); }
        finally { checkbox.disabled = false; }
      });
      label.append(checkbox, document.createTextNode(row.email)); item.append(label); return item;
    }));
    byId('email-settings').hidden = false;
  }
  function init(options) {
    onOpen = options.onOpen;
    desktopStatus();
    byId('dismiss-new-departure').onclick = () => { byId('new-departure-alert').hidden = true; };
    byId('desktop-alerts').addEventListener('change', async event => {
      if (!event.target.checked) { preferences.enabled = false; persist(); desktopStatus(); return; }
      if (!window.isSecureContext || !('Notification' in window)) { desktopStatus('Los avisos requieren un navegador compatible y una conexión HTTPS.'); return; }
      try {
        const permission = await Notification.requestPermission();
        preferences.enabled = permission === 'granted'; persist();
        desktopStatus(permission === 'granted' ? '' : 'El navegador no autorizó las notificaciones.');
      } catch (error) { preferences.enabled = false; persist(); desktopStatus('No se pudo habilitar el permiso de notificaciones.'); }
    });
    emailStatus('Cargando destinatarios...');
    byId('add-email-form').addEventListener('submit', async event => {
      event.preventDefault();
      const button = event.target.querySelector('button'); button.disabled = true;
      try {
        await api('departure_notification_recipients', { method: 'POST', body: JSON.stringify({ email: byId('new-notification-email').value.trim().toLowerCase(), enabled: true }) });
        event.target.reset(); await loadRecipients(); emailStatus('Correo agregado.');
      } catch (error) { emailStatus(error.message, true); }
      finally { button.disabled = false; }
    });
    loadRecipients().then(() => emailStatus('Destinatarios cargados.')).catch(error => emailStatus(error.message, true));
  }
  window.DepartureAlerts = { init, observe, enabled };
})();
