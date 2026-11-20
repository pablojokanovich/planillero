(function () {
  'use strict';
  const config = window.PDF_ARCHIVE_CONFIG;
  const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('es');
  const orderKey = value => normalize(value).replace(/^2026\s*-\s*/, '');
  const snapshot = value => {
    if (value && typeof value === 'object') return value;
    try { return JSON.parse(value) || {}; } catch (error) { return {}; }
  };
  const isRemito = record => snapshot(record.event_data).document_type === 'remito';

  async function request(path, options = {}) {
    const response = await fetch(`${config.SUPABASE_URL}${path}`, { signal: AbortSignal.timeout(15000), ...options, headers: {
      apikey: config.SUPABASE_KEY, Authorization: `Bearer ${config.SUPABASE_KEY}`, ...options.headers
    } });
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      const error = new Error('No se pudo guardar el documento.');
      error.status = response.status;
      error.code = details.code;
      error.storageStatus = Number(details.statusCode);
      throw error;
    }
    return response.status === 204 ? null : response;
  }

  async function documents() {
    const result = [];
    for (let offset = 0; ; offset += 500) {
      const response = await request(`/rest/v1/${config.SUPABASE_TABLE}?select=*&order=created_at.desc,id.desc&limit=500&offset=${offset}`);
      const rows = await response.json();
      result.push(...rows);
      if (rows.length < 500) return result;
    }
  }

  async function save({ blob, filename, metadata }, attempt = {}) {
    await window.AppAccess.ready;
    if (!window.AppAccess.isFull()) throw new Error('Este acceso solo permite consultar documentos.');
    if (!attempt.path) {
      const now = new Date();
      attempt.path = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.pdf`;
    }
    const retry = attempt.retry || (() => save({ blob, filename, metadata }, attempt));
    window.AppUI.status('pdf', 'saving', 'Guardando PDF en el registro compartido…');
    try {
      const records = await documents();
      const completed = records.find(record => record.storage_path === attempt.path);
      if (completed) {
        window.AppUI.status('pdf', 'saved', 'PDF guardado online.');
        return completed;
      }
      if (!attempt.choice) {
        const duplicates = records.filter(record => !isRemito(record) && !isRemito(metadata) && orderKey(metadata.os) &&
          orderKey(record.os) === orderKey(metadata.os) && normalize(record.area) === normalize(metadata.area) && normalize(record.sala) === normalize(metadata.sala));
        attempt.choice = duplicates.length ? await window.AppUI.chooseDuplicate(duplicates) : { action: 'keep' };
        if (attempt.choice.action === 'cancel') {
          attempt.choice = null;
          const error = new Error('La carga del PDF fue cancelada.');
          error.name = 'AbortError';
          throw error;
        }
      }
      if (!attempt.uploaded) {
        try {
          await request(`/storage/v1/object/${config.SUPABASE_BUCKET}/${attempt.path}`, {
            method: 'POST', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'false' }, body: blob
          });
        } catch (error) { if (error.status !== 409 && error.storageStatus !== 409) throw error; }
        attempt.uploaded = true;
      }
      const previous = attempt.choice.record;
      const eventData = snapshot(metadata.event_data);
      const version = previous ? Number(snapshot(previous.event_data).document_version || 1) + 1 : 1;
      const payload = { ...metadata, filename, storage_path: attempt.path, file_size: blob.size,
        public_url: `${config.SUPABASE_URL}/storage/v1/object/public/${config.SUPABASE_BUCKET}/${attempt.path}`,
        event_data: { ...eventData, document_version: version }, created_at: new Date().toISOString() };
      if (previous) payload.event_data.previous_versions = [...(snapshot(previous.event_data).previous_versions || []), {
        filename: previous.filename, storage_path: previous.storage_path, created_at: previous.created_at, version: version - 1
      }];
      let path = `/rest/v1/${config.SUPABASE_TABLE}?on_conflict=storage_path`;
      let method = 'POST';
      if (attempt.choice.action === 'replace') {
        method = 'PATCH';
        path = `/rest/v1/${config.SUPABASE_TABLE}?id=eq.${encodeURIComponent(previous.id)}&storage_path=eq.${encodeURIComponent(previous.storage_path)}`;
      }
      const response = await request(path, { method,
        headers: { 'Content-Type': 'application/json', Prefer: method === 'POST' ? 'resolution=ignore-duplicates,return=representation' : 'return=representation' },
        body: JSON.stringify(payload) });
      const rows = await response.json().catch(() => []);
      if (!rows.length) {
        attempt.choice = null;
        throw new Error('La planilla cambió mientras la guardabas. Reintentá para revisar la versión actual.');
      }
      window.AppUI.status('pdf', 'saved', attempt.choice.action === 'replace' ? 'Planilla reemplazada y guardada online.' : 'PDF guardado online.');
      return rows[0];
    } catch (error) {
      const cancelled = error.name === 'AbortError' && error.message === 'La carga del PDF fue cancelada.';
      window.AppUI.status('pdf', cancelled ? 'local' : 'pending', cancelled ? error.message : `PDF pendiente de guardar. ${window.AppUI.errorMessage(error)} Reintentá antes de cerrar esta página.`, cancelled ? null : retry);
      throw error;
    }
  }
  window.DocumentWorkflow = { save, documents, orderKey, isRemito };
})();
