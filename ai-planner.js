(() => {
  const STORAGE_KEY = 'cr_ai_planner_state_v1';
  const config = window.PDF_ARCHIVE_CONFIG || {};
  let selectedFile = null;
  let busy = false;
  let suppressDirty = false;
  let syncTimer = null;
  let state = loadAiState();

  function emptyState() {
    return { jobId: '', sourceFilename: '', sourcePath: '', sourceUrl: '', analysis: null, answers: {}, plan: null, status: '', approvedAt: '', applied: false };
  }

  function loadAiState() {
    try { return { ...emptyState(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; }
    catch { return emptyState(); }
  }

  function saveAiState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderStatusBar();
  }

  function headers(prefer = '') {
    const value = { apikey: config.SUPABASE_KEY, Authorization: `Bearer ${config.SUPABASE_KEY}`, 'Content-Type': 'application/json' };
    if (prefer) value.Prefer = prefer;
    return value;
  }

  async function supabaseRequest(path, options = {}) {
    const response = await fetch(`${config.SUPABASE_URL}${path}`, options);
    if (!response.ok) throw new Error(await response.text());
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  function safeFilePart(value) {
    return String(value || 'orden.pdf').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
  }

  async function uploadOrder(file) {
    const date = new Date();
    const folder = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`;
    const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const path = `${folder}/${id}_${safeFilePart(file.name)}`;
    const response = await fetch(`${config.SUPABASE_URL}/storage/v1/object/${config.AI_ORDERS_BUCKET}/${path}`, {
      method: 'POST',
      headers: { apikey: config.SUPABASE_KEY, Authorization: `Bearer ${config.SUPABASE_KEY}`, 'Content-Type': 'application/pdf', 'x-upsert': 'false' },
      body: file
    });
    if (!response.ok) throw new Error(`No se pudo subir el PDF: ${await response.text()}`);
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return { path, url: `${config.SUPABASE_URL}/storage/v1/object/public/${config.AI_ORDERS_BUCKET}/${encoded}` };
  }

  async function createJob(upload, file) {
    const rows = await supabaseRequest(`/rest/v1/${config.AI_JOBS_TABLE}`, {
      method: 'POST', headers: headers('return=representation'),
      body: JSON.stringify({ source_filename: file.name, source_path: upload.path, source_url: upload.url, status: 'questions' })
    });
    const job = rows?.[0];
    if (!job?.id) throw new Error('Supabase no devolvió el identificador del análisis.');
    await addAudit(job.id, 'created', { filename: file.name });
    return job.id;
  }

  async function updateJob(patch) {
    if (!state.jobId) return;
    await supabaseRequest(`/rest/v1/${config.AI_JOBS_TABLE}?id=eq.${encodeURIComponent(state.jobId)}`, {
      method: 'PATCH', headers: headers('return=minimal'),
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
    });
  }

  async function addAudit(jobId, action, details = {}) {
    if (!jobId) return;
    await supabaseRequest(`/rest/v1/${config.AI_AUDIT_TABLE}`, {
      method: 'POST', headers: headers('return=minimal'), body: JSON.stringify({ job_id: jobId, action, details })
    });
  }

  async function callPlanner(action, extra = {}) {
    let customRules = [];
    try {
      const rows = await supabaseRequest(`/rest/v1/${config.AI_RULES_TABLE}?select=rule_text&active=eq.true&order=created_at.asc`, { headers: headers() });
      customRules = (rows || []).map(row => row.rule_text);
    } catch (error) {
      console.warn('No se pudieron cargar reglas adicionales', error);
    }
    const response = await fetch('/api/ai-plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, fileUrl: state.sourceUrl, customRules, ...extra })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo consultar al agente.');
    return data.result;
  }

  function ensureUi() {
    if (document.getElementById('ai-planner-overlay')) return;
    const status = document.createElement('div');
    status.id = 'ai-status-bar';
    status.className = 'ai-status-bar no-print';
    status.innerHTML = `
      <span class="ai-status-pill" id="ai-status-pill"></span>
      <span class="ai-status-meta" id="ai-status-meta"></span>
      <button class="btn btn-ghost" id="ai-status-open" type="button">VER IA</button>
      <button class="btn btn-ghost" id="ai-add-rule" type="button">+ REGLA</button>
      <button class="btn btn-primary" id="ai-approve" type="button">APROBAR</button>`;
    document.body.appendChild(status);

    const overlay = document.createElement('div');
    overlay.id = 'ai-planner-overlay';
    overlay.className = 'ai-overlay no-print';
    overlay.innerHTML = `
      <div class="ai-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-dialog-title">
        <div class="ai-dialog-header">
          <div><div class="ai-dialog-title" id="ai-dialog-title">GENERAR PLANILLA CON IA</div><div class="ai-dialog-subtitle">// ORDEN PDF → PREGUNTAS → BORRADOR EDITABLE</div></div>
          <button class="ai-close" id="ai-close" type="button" aria-label="Cerrar">×</button>
        </div>
        <div class="ai-dialog-body" id="ai-dialog-body"></div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById('ai-close').addEventListener('click', closeAiPlanner);
    document.getElementById('ai-status-open').addEventListener('click', openAiPlanner);
    document.getElementById('ai-add-rule').addEventListener('click', addConfirmedRule);
    document.getElementById('ai-approve').addEventListener('click', approveCurrentPlan);
    overlay.addEventListener('click', event => { if (event.target === overlay && !busy) closeAiPlanner(); });
    renderStatusBar();
  }

  function renderStart() {
    const body = document.getElementById('ai-dialog-body');
    body.innerHTML = `
      <label class="ai-dropzone" for="ai-pdf-input">
        <strong>SELECCIONAR ORDEN DE SERVICIO</strong>
        <span>Archivo PDF · máximo 50 MB</span>
        <input id="ai-pdf-input" type="file" accept="application/pdf,.pdf">
      </label>
      <div class="ai-file-name" id="ai-file-name">Ningún archivo seleccionado.</div>
      <div class="ai-progress" id="ai-progress"></div>
      <div class="ai-error" id="ai-error"></div>
      <div class="ai-dialog-actions"><span></span><button class="btn btn-ai" id="ai-analyze" type="button" disabled>ANALIZAR ORDEN</button></div>`;
    document.getElementById('ai-pdf-input').addEventListener('change', event => {
      selectedFile = event.target.files?.[0] || null;
      const valid = selectedFile && selectedFile.type === 'application/pdf' && selectedFile.size <= 50 * 1024 * 1024;
      document.getElementById('ai-file-name').textContent = selectedFile ? `${selectedFile.name} · ${(selectedFile.size / 1024 / 1024).toFixed(1)} MB` : 'Ningún archivo seleccionado.';
      document.getElementById('ai-analyze').disabled = !valid;
      if (selectedFile && !valid) showError('El archivo debe ser un PDF de hasta 50 MB.'); else showError('');
    });
    document.getElementById('ai-analyze').addEventListener('click', analyzeOrder);
  }

  function setProgress(message) {
    const el = document.getElementById('ai-progress');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('visible', Boolean(message));
  }

  function showError(message) {
    const el = document.getElementById('ai-error');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('visible', Boolean(message));
  }

  async function analyzeOrder() {
    if (!selectedFile || busy) return;
    busy = true;
    showError('');
    document.getElementById('ai-analyze').disabled = true;
    try {
      setProgress('1/3 · Subiendo la orden a Supabase…');
      const upload = await uploadOrder(selectedFile);
      state = { ...emptyState(), sourceFilename: selectedFile.name, sourcePath: upload.path, sourceUrl: upload.url };
      setProgress('2/3 · Creando el análisis…');
      state.jobId = await createJob(upload, selectedFile);
      setProgress('3/3 · Leyendo texto, tablas e imágenes del PDF…');
      state.analysis = await callPlanner('analyze');
      state.status = 'questions';
      saveAiState();
      await updateJob({ analysis: state.analysis, status: 'questions' });
      await addAudit(state.jobId, 'analyzed', { questions: state.analysis.questions.length, rooms: state.analysis.rooms });
      renderQuestions();
    } catch (error) {
      showError(humanizeError(error));
      setProgress('');
      document.getElementById('ai-analyze').disabled = false;
    } finally { busy = false; }
  }

  function appendList(container, items, warning = false) {
    const list = document.createElement('div');
    list.className = 'ai-list';
    (items || []).forEach(value => {
      const row = document.createElement('div');
      row.className = `ai-list-item${warning ? ' warning' : ''}`;
      row.textContent = value;
      list.appendChild(row);
    });
    container.appendChild(list);
  }

  function renderQuestions() {
    const analysis = state.analysis;
    if (!analysis) return renderStart();
    const body = document.getElementById('ai-dialog-body');
    body.replaceChildren();

    const summary = document.createElement('div');
    summary.innerHTML = `<div class="ai-summary-grid">
      <div class="ai-summary-card"><label>ORDEN</label><div></div></div>
      <div class="ai-summary-card"><label>EVENTO</label><div></div></div>
      <div class="ai-summary-card"><label>LUGAR</label><div></div></div>
      <div class="ai-summary-card"><label>SALAS DETECTADAS</label><div></div></div>
    </div>`;
    const values = [analysis.event.os || '—', analysis.event.name || '—', analysis.event.venue || '—', (analysis.rooms || []).join(', ') || '—'];
    summary.querySelectorAll('.ai-summary-card div').forEach((el, index) => { el.textContent = values[index]; });
    body.appendChild(summary);

    if (analysis.warnings?.length) {
      const section = document.createElement('section'); section.className = 'ai-section';
      section.innerHTML = '<h3>ADVERTENCIAS DE LA ORDEN</h3>'; appendList(section, analysis.warnings, true); body.appendChild(section);
    }

    const questionsSection = document.createElement('section'); questionsSection.className = 'ai-section';
    const title = document.createElement('h3'); title.textContent = analysis.questions?.length ? 'PREGUNTAS ANTES DE GENERAR' : 'NO HAY PREGUNTAS CRÍTICAS';
    questionsSection.appendChild(title);
    (analysis.questions || []).forEach((question, index) => {
      const wrap = document.createElement('div'); wrap.className = 'ai-question';
      const room = document.createElement('div'); room.className = 'ai-question-room'; room.textContent = question.room || 'GENERAL';
      const label = document.createElement('label'); label.setAttribute('for', `ai-answer-${index}`); label.textContent = question.question + (question.required ? ' *' : '');
      const reason = document.createElement('div'); reason.className = 'ai-question-reason'; reason.textContent = question.reason;
      const input = document.createElement('textarea'); input.id = `ai-answer-${index}`; input.dataset.questionId = question.id; input.dataset.required = String(question.required); input.value = state.answers?.[question.id] || '';
      wrap.append(room, label, reason, input); questionsSection.appendChild(wrap);
    });
    body.appendChild(questionsSection);
    const progress = document.createElement('div'); progress.id = 'ai-progress'; progress.className = 'ai-progress'; body.appendChild(progress);
    const error = document.createElement('div'); error.id = 'ai-error'; error.className = 'ai-error'; body.appendChild(error);
    const actions = document.createElement('div'); actions.className = 'ai-dialog-actions'; actions.innerHTML = '<button class="btn btn-ghost" id="ai-new-order" type="button">OTRO PDF</button><button class="btn btn-ai" id="ai-generate" type="button">GENERAR BORRADOR</button>';
    body.appendChild(actions);
    document.getElementById('ai-new-order').addEventListener('click', () => { selectedFile = null; renderStart(); });
    document.getElementById('ai-generate').addEventListener('click', generatePlan);
  }

  async function generatePlan() {
    if (busy) return;
    const answers = {};
    let missing = 0;
    document.querySelectorAll('[data-question-id]').forEach(input => {
      answers[input.dataset.questionId] = input.value.trim();
      input.style.borderColor = '';
      if (input.dataset.required === 'true' && !input.value.trim()) { input.style.borderColor = '#e7a72e'; missing++; }
    });
    if (missing) return showError(`Falta responder ${missing} pregunta${missing === 1 ? '' : 's'} obligatoria${missing === 1 ? '' : 's'}.`);
    busy = true;
    showError('');
    setProgress('Generando equipos, cantidades, personal y preventivos por sala…');
    document.getElementById('ai-generate').disabled = true;
    try {
      state.answers = answers;
      const inventory = AREAS.cctv.data.map(category => ({ category: category.cat, items: category.items }));
      state.plan = await callPlanner('generate', { analysis: state.analysis, answers, inventory });
      state.status = 'draft'; state.approvedAt = ''; state.applied = false;
      saveAiState();
      await updateJob({ answers, draft: state.plan, status: 'draft', approved_at: null });
      await addAudit(state.jobId, 'generated', { rooms: state.plan.rooms.map(room => room.name) });
      renderPlanPreview();
    } catch (error) {
      showError(humanizeError(error));
      setProgress('');
      document.getElementById('ai-generate').disabled = false;
    } finally { busy = false; }
  }

  function renderPlanPreview() {
    const body = document.getElementById('ai-dialog-body');
    body.replaceChildren();
    const title = document.createElement('div'); title.className = 'ai-section'; title.innerHTML = '<h3>BORRADOR GENERADO</h3>';
    const intro = document.createElement('div'); intro.className = 'ai-list-item'; intro.textContent = 'Revisá el resultado. Al aplicarlo se cargarán las salas y equipos de CCTV, y después podrás modificar cualquier cantidad u observación.';
    title.appendChild(intro); body.appendChild(title);
    const preview = document.createElement('div'); preview.className = 'ai-plan-preview ai-section';
    (state.plan?.rooms || []).forEach(room => {
      const block = document.createElement('div'); block.className = 'ai-plan-room';
      const heading = document.createElement('h4'); heading.textContent = room.name; block.appendChild(heading);
      room.items.forEach(item => {
        const row = document.createElement('div'); row.className = 'ai-plan-item';
        const name = document.createElement('span'); name.innerHTML = `<b></b> · ${escapeText(item.category)}`; name.querySelector('b').textContent = item.item;
        const qty = document.createElement('span'); qty.textContent = `× ${item.quantity}`;
        row.append(name, qty); block.appendChild(row);
      });
      preview.appendChild(block);
    });
    body.appendChild(preview);
    if (state.plan?.pending?.length) {
      const pending = document.createElement('section'); pending.className = 'ai-section'; pending.innerHTML = '<h3>PENDIENTES</h3>'; appendList(pending, state.plan.pending, true); body.appendChild(pending);
    }
    const error = document.createElement('div'); error.id = 'ai-error'; error.className = 'ai-error'; body.appendChild(error);
    const actions = document.createElement('div'); actions.className = 'ai-dialog-actions'; actions.innerHTML = '<button class="btn btn-ghost" id="ai-back-questions" type="button">VOLVER A RESPUESTAS</button><button class="btn btn-ai" id="ai-apply" type="button">APLICAR BORRADOR</button>';
    body.appendChild(actions);
    document.getElementById('ai-back-questions').addEventListener('click', renderQuestions);
    document.getElementById('ai-apply').addEventListener('click', applyPlan);
  }

  function escapeText(value) { return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }

  function findInventoryItem(categoryName, itemName) {
    const category = AREAS.cctv.data.find(value => value.cat === categoryName);
    if (!category || !category.items.includes(itemName)) return null;
    return { category: category.cat, item: itemName };
  }

  async function applyPlan() {
    if (!state.plan || busy) return;
    if (Object.keys(quantities).length && !confirm('La planilla actual tiene equipos cargados. ¿Querés reemplazarla por el borrador generado por IA?')) return;
    busy = true; suppressDirty = true;
    const skipped = [];
    try {
      quantities = {}; observations = {}; bultos = []; bultoCounter = 0; salas = []; salaCounter = 0; currentSalaId = null;
      document.getElementById('sala-contents').replaceChildren();
      for (const room of state.plan.rooms || []) addSala(String(room.name || 'SALA').toUpperCase(), false);
      if (!salas.length) addSala('SALA A', false);
      for (let index = 0; index < state.plan.rooms.length; index++) {
        const room = state.plan.rooms[index];
        const sala = salas[index];
        for (const proposed of room.items || []) {
          const match = findInventoryItem(proposed.category, proposed.item);
          if (!match) { skipped.push(`${room.name}: ${proposed.category} / ${proposed.item}`); continue; }
          const key = buildItemKey(sala.id, 'cctv', match.category, match.item);
          quantities[key] = Math.max(Number(quantities[key]) || 0, Number(proposed.quantity) || 1);
          const notes = [proposed.observation, proposed.basis === 'preventive' ? 'Preventivo IA' : ''].filter(Boolean).join(' · ');
          if (notes) observations[key] = notes;
        }
      }
      currentSalaId = salas[0].id; currentArea = 'cctv'; eventId = createEventId();
      document.getElementById('sala-contents').replaceChildren(); renderSalaTabs(); renderAllSalaContents(); restoreQuantities();
      const event = state.plan.event || {};
      const fields = { 'ev-os': event.os, 'ev-evento': event.name, 'ev-lugar': event.venue, 'ev-armado': event.setup_date, 'ev-desarme': event.strike_date };
      Object.entries(fields).forEach(([id, value]) => { if (value) document.getElementById(id).value = value; });
      const personnelNotes = (state.plan.rooms || [])
        .filter(room => room.personnel?.length)
        .map(room => `${room.name} · Personal: ${room.personnel.join(', ')}`);
      const notes = [...personnelNotes, ...(state.plan.notes || []), ...(state.plan.pending || []).map(value => `PENDIENTE IA: ${value}`)];
      if (notes.length) document.getElementById('ev-notas').value = notes.join(' | ');
      updateHeaderInfo(); saveState();
      state.status = 'draft'; state.approvedAt = ''; state.applied = true; saveAiState();
      await addAudit(state.jobId, 'edited', { applied: true, skipped });
      closeAiPlanner(); goToStep(2);
      showToast(skipped.length ? `Borrador aplicado. ${skipped.length} item(s) no coincidieron con inventario.` : 'Borrador IA aplicado. Revisá y modificá lo necesario.');
    } catch (error) {
      showError(humanizeError(error));
    } finally { suppressDirty = false; busy = false; }
  }

  async function approveCurrentPlan() {
    if (!state.plan || !state.applied || state.status === 'approved') return;
    state.status = 'approved'; state.approvedAt = new Date().toISOString(); saveAiState();
    try {
      await updateJob({ status: 'approved', approved_at: state.approvedAt, draft: getEventSnapshot() });
      await addAudit(state.jobId, 'approved');
      showToast('Planilla aprobada. Cualquier cambio la devolverá a borrador.');
    } catch (error) {
      state.status = 'draft'; state.approvedAt = ''; saveAiState();
      showToast('No se pudo registrar la aprobación online.');
    }
  }

  async function markDirty() {
    if (suppressDirty || !state.plan || !['draft', 'approved'].includes(state.status)) return;
    const wasApproved = state.status === 'approved';
    if (wasApproved) { state.status = 'draft'; state.approvedAt = ''; saveAiState(); }
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      try {
        await updateJob({ status: 'draft', approved_at: null, draft: getEventSnapshot() });
        await addAudit(state.jobId, wasApproved ? 'returned_to_draft' : 'edited');
      } catch (error) { console.warn('No se pudo sincronizar la edición del borrador', error); }
    }, 900);
  }

  async function addConfirmedRule() {
    const ruleText = prompt('Escribí la corrección que querés convertir en una regla para futuras planillas:');
    if (!ruleText?.trim()) return;
    try {
      await supabaseRequest(`/rest/v1/${config.AI_RULES_TABLE}`, {
        method: 'POST', headers: headers('return=minimal'), body: JSON.stringify({ rule_text: ruleText.trim(), active: true })
      });
      showToast('Regla guardada. Se aplicará en los próximos análisis.');
    } catch (error) {
      showToast('No se pudo guardar la regla. Revisá la migración de Supabase.');
    }
  }

  function renderStatusBar() {
    const bar = document.getElementById('ai-status-bar'); if (!bar) return;
    const visible = Boolean(state.plan && state.applied && ['draft', 'approved'].includes(state.status));
    bar.classList.toggle('visible', visible); if (!visible) return;
    const pill = document.getElementById('ai-status-pill');
    pill.textContent = state.status === 'approved' ? 'APROBADA' : 'BORRADOR IA';
    pill.classList.toggle('approved', state.status === 'approved');
    document.getElementById('ai-status-meta').textContent = state.sourceFilename || 'Planilla generada con IA';
    const approve = document.getElementById('ai-approve'); approve.hidden = state.status === 'approved'; approve.disabled = state.status === 'approved';
  }

  function humanizeError(error) {
    const message = String(error?.message || error || 'Error desconocido');
    if (message.includes('AI_') || message.includes('relation') || message.includes('bucket')) return 'Falta ejecutar la migración supabase-enable-ai-planner.sql en Supabase.';
    if (message.includes('OPENAI_API_KEY')) return 'Falta configurar OPENAI_API_KEY en Vercel.';
    return message;
  }

  window.openAiPlanner = function openAiPlanner() {
    ensureUi();
    document.getElementById('ai-planner-overlay').classList.add('open');
    if (state.analysis && state.status === 'questions') renderQuestions();
    else if (state.plan) renderPlanPreview();
    else renderStart();
  };
  window.closeAiPlanner = function closeAiPlanner() { if (!busy) document.getElementById('ai-planner-overlay')?.classList.remove('open'); };
  window.aiPlannerOnStateChange = markDirty;
  window.addEventListener('DOMContentLoaded', ensureUi);
})();
