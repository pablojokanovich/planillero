(function () {
  'use strict';
  const states = new Map();
  let sequence = 0;
  let panel;

  function showStatus(channel, state, message, retry) {
    states.set(channel, { state, message, retry, sequence: ++sequence });
    if (document.readyState === 'loading') return;
    if (!panel) {
      panel = document.createElement('section');
      panel.className = 'app-save-status';
      panel.setAttribute('role', 'status');
      panel.setAttribute('aria-live', 'polite');
      const content = document.querySelector('main, .main-wrapper');
      if (!content) return;
      content.prepend(panel);
    }
    const priority = { error: 5, pending: 4, saving: 3, offline: 2, local: 1, saved: 1 };
    const active = [...states.values()].sort((a, b) => (priority[b.state] || 0) - (priority[a.state] || 0) || b.sequence - a.sequence)[0];
    panel.dataset.state = active.state;
    const text = document.createElement('span');
    text.textContent = active.message;
    panel.replaceChildren(text);
    if (active.retry && ['error', 'pending', 'offline'].includes(active.state)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Reintentar';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await active.retry(); } catch (error) { console.error('No se pudo reintentar:', error); } finally { button.disabled = false; }
      });
      panel.append(button);
    }
  }

  function errorMessage(error) {
    if (error?.code === 'PGRST205') return 'Falta habilitar este registro en la base compartida.';
    if (error?.status === 401) return 'La sesión venció. Volvé a entrar a la app.';
    if (error?.status === 403) return 'Tu acceso no tiene permiso para guardar este cambio.';
    if (error?.status) return `El servidor rechazó la operación (HTTP ${error.status}).`;
    if (['TypeError', 'TimeoutError'].includes(error?.name)) return 'No se pudo conectar. Revisá la conexión y reintentá.';
    return error?.message || 'No se pudo conectar con el registro compartido.';
  }

  async function chooseDuplicate(records) {
    return new Promise(resolve => {
      const dialog = document.createElement('dialog');
      dialog.className = 'app-duplicate-dialog';
      const title = document.createElement('h2');
      title.textContent = 'Ya hay una planilla para esta orden, área y sala';
      const label = document.createElement('label');
      label.textContent = 'Planilla a reemplazar';
      const select = document.createElement('select');
      for (const record of records) {
        select.add(new Option(`${record.filename} · ${new Date(record.created_at).toLocaleString('es-AR')}`, record.id));
      }
      label.append(select);
      const actions = document.createElement('div');
      actions.className = 'dialog-footer';
      const finish = result => { dialog.close(); resolve(result); };
      for (const [text, value] of [['Cancelar', 'cancel'], ['Conservar ambas versiones', 'keep'], ['Reemplazar', 'replace']]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        if (value === 'replace') button.className = 'primary';
        button.addEventListener('click', () => finish({ action: value, record: records.find(record => record.id === select.value) }));
        actions.append(button);
      }
      dialog.append(title, label, actions);
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish({ action: 'cancel' }); });
      dialog.addEventListener('close', () => dialog.remove(), { once: true });
      document.body.append(dialog);
      dialog.showModal();
    });
  }

  window.AppUI = { status: showStatus, errorMessage, chooseDuplicate };
  document.addEventListener('DOMContentLoaded', () => {
    let activeModal = null;
    let previousFocus = null;
    const controls = modal => [...modal.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')]
      .filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length);
    const updateModal = () => {
      const modal = [...document.querySelectorAll('.modal-overlay.open, .modal-backdrop.open')].filter(element => element.getClientRects().length).at(-1);
      if (modal === activeModal) return;
      if (modal) {
        previousFocus = document.activeElement;
        activeModal = modal;
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        const title = modal.querySelector('.modal-title, h2');
        if (title && !modal.hasAttribute('aria-labelledby')) {
          if (!title.id) title.id = `${modal.id}-title`;
          modal.setAttribute('aria-labelledby', title.id);
        }
        controls(modal)[0]?.focus();
      } else {
        activeModal = null;
        if (previousFocus?.isConnected) previousFocus.focus();
        previousFocus = null;
      }
    };
    new MutationObserver(updateModal).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    document.addEventListener('keydown', event => {
      if (!activeModal || document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') {
        const close = activeModal.querySelector('.modal-close, #edit-cancel, #delete-cancel');
        if (close && !close.disabled) { event.preventDefault(); close.click(); }
      }
      if (event.key === 'Tab') {
        const items = controls(activeModal), first = items[0], last = items.at(-1);
        if (!items.length) return;
        if (event.shiftKey && (document.activeElement === first || !activeModal.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !activeModal.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    });
    updateModal();
    if (states.size) {
      const [channel, value] = [...states.entries()].at(-1);
      showStatus(channel, value.state, value.message, value.retry);
    }
  });
})();
