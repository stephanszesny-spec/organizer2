'use strict';

const SOURCE_ICON = { manual: '📝', m365mail: '✉️', teams: '💬', jira: '🟦', freshdesk: '🎫', email: '✉️' };
const SORT_OPTIONS = [
  { id: 'manual', label: 'Manuell (Drag&Drop)' },
  { id: 'updated', label: 'Letzte Änderung' },
  { id: 'priority', label: 'Priorität' },
  { id: 'dueDate', label: 'Ziel-Datum' },
];
const PRIO_WEIGHT = { high: 0, medium: 1, low: 2 };

let lanes = [];
let todos = [];
let technologies = [];
let editingId = null;
let editChecklist = []; // Arbeitskopie der Checkliste im offenen Dialog
let editingLaneId = null;
let sortPref = loadSortPref();
let search = { query: '', matchIds: null, mode: null, llmEnabled: false };
let showDone = localStorage.getItem('organizer2.showDone') === '1';

function loadSortPref() {
  try { return JSON.parse(localStorage.getItem('organizer2.sort') || '{}'); } catch { return {}; }
}
function saveSortPref() { localStorage.setItem('organizer2.sort', JSON.stringify(sortPref)); }
const laneById = (id) => lanes.find((l) => l.id === id) || null;

const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'tmp-' + Math.random().toString(36).slice(2));
const api = async (url, opts = {}) => {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
};

function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${kind}`;
  setTimeout(() => el.classList.add('hidden'), 4000);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ---------------- Board ----------------
function buildBoard() {
  const board = $('#board');
  board.innerHTML = '';
  board.style.setProperty('--cols', lanes.length + 1);
  for (const lane of lanes) {
    const col = document.createElement('section');
    col.className = 'column';
    col.dataset.cat = lane.id;
    const current = sortPref[lane.id] || 'manual';
    const opts = SORT_OPTIONS.map((o) => `<option value="${o.id}" ${o.id === current ? 'selected' : ''}>↕ ${o.label}</option>`).join('');
    col.innerHTML = `
      <div class="column-head">
        <h2 title="${escapeHtml(lane.label)}">${escapeHtml(lane.label)}</h2>
        <div class="head-right">
          <span class="count" data-count="${lane.id}">0</span>
          <button class="icon-btn lane-add" data-add="${lane.id}" title="Todo in dieser Lane erstellen">＋</button>
          <button class="icon-btn lane-edit" data-edit-lane="${lane.id}" title="Lane bearbeiten/löschen">✏️</button>
        </div>
      </div>
      <div class="column-sub">
        <select class="col-sort ${current !== 'manual' ? 'active' : ''}" data-sort="${lane.id}" title="Sortierung">${opts}</select>
      </div>
      <div class="cards" data-cards="${lane.id}"></div>`;
    board.appendChild(col);
  }
  // "Lane hinzufügen"-Kachel
  const addCol = document.createElement('section');
  addCol.className = 'column column-addlane';
  addCol.innerHTML = `<button class="addlane-btn" id="addLaneBtn">＋ Lane hinzufügen</button>`;
  board.appendChild(addCol);

  document.querySelectorAll('[data-sort]').forEach((sel) =>
    sel.addEventListener('change', () => {
      sortPref[sel.dataset.sort] = sel.value;
      saveSortPref();
      sel.classList.toggle('active', sel.value !== 'manual');
      render();
    }),
  );
  document.querySelectorAll('[data-add]').forEach((b) =>
    b.addEventListener('click', () => openCreate(b.dataset.add)),
  );
  document.querySelectorAll('[data-edit-lane]').forEach((b) =>
    b.addEventListener('click', () => openLaneEdit(b.dataset.editLane)),
  );
  $('#addLaneBtn').addEventListener('click', openLaneCreate);

  document.querySelectorAll('[data-cards]').forEach((zone) =>
    Sortable.create(zone, {
      group: 'todos',
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      delay: 120,
      delayOnTouchOnly: true,
      filter: '.card-check',
      onEnd: onDragEnd,
    }),
  );
}

function dueTag(todo) {
  if (!todo.dueDate) return '';
  const days = Math.ceil((new Date(todo.dueDate) - new Date()) / 86400000);
  const cls = days < 0 ? 'overdue' : days <= 2 ? 'due-soon' : '';
  return `<span class="tag ${cls}">📅 ${fmtDate(todo.dueDate)}</span>`;
}

function cardHtml(todo) {
  const prioLabel = { high: 'Hoch', medium: 'Mittel', low: 'Niedrig' }[todo.priority];
  const tags = [`<span class="tag prio-${todo.priority}">${prioLabel}</span>`, dueTag(todo)];
  if (todo.customer) tags.push(`<span class="tag">👤 ${escapeHtml(todo.customer)}</span>`);
  if (todo.comments?.length) tags.push(`<span class="tag">💬 ${todo.comments.length}</span>`);
  if (todo.checklist?.length) {
    const done = todo.checklist.filter((c) => c.checked).length;
    tags.push(`<span class="tag">☑ ${done}/${todo.checklist.length}</span>`);
  }
  if (todo.dependsOn?.length) tags.push(`<span class="tag">⛓ ${todo.dependsOn.length}</span>`);
  (todo.technologies || []).forEach((t) => tags.push(`<span class="tag tech">🔧 ${escapeHtml(t)}</span>`));
  if (todo.reminder) {
    tags.push(todo.reminder.due ? `<span class="tag reminder">🔔 fällig</span>` : `<span class="tag reminder">🔔 in ${todo.reminder.daysUntil} T</span>`);
  }
  if (todo.links?.length) tags.push(`<span class="tag src">${SOURCE_ICON[todo.links[0].source] || '🔗'} ${todo.links.length}</span>`);
  else if (todo.source && todo.source !== 'manual') tags.push(`<span class="tag src">${SOURCE_ICON[todo.source] || '🔗'}</span>`);

  const dueCls = todo.reminder?.due ? 'reminder-due' : '';
  return `
    <div class="card prio-${todo.priority} ${dueCls} ${todo.done ? 'done' : ''}" data-id="${todo.id}">
      <div class="card-head">
        <input type="checkbox" class="card-check" data-id="${todo.id}" ${todo.done ? 'checked' : ''} title="Als erledigt markieren" />
        <div class="card-title">${escapeHtml(todo.title)}</div>
      </div>
      <div class="card-meta">${tags.filter(Boolean).join('')}</div>
    </div>`;
}

function sortComparator(mode) {
  switch (mode) {
    case 'updated': return (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt);
    case 'priority': return (a, b) => (PRIO_WEIGHT[a.priority] - PRIO_WEIGHT[b.priority]) || (a.order - b.order);
    case 'dueDate': return (a, b) => {
      if (!a.dueDate && !b.dueDate) return a.order - b.order;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate) - new Date(b.dueDate);
    };
    default: return (a, b) => a.order - b.order;
  }
}

function render() {
  for (const lane of lanes) {
    const zone = $(`[data-cards="${lane.id}"]`);
    if (!zone) continue;
    const mode = sortPref[lane.id] || 'manual';
    let items = todos.filter((t) => t.category === lane.id).filter((t) => (search.matchIds ? search.matchIds.has(t.id) : true));
    if (search.matchIds && search.mode === 'llm') {
      const rank = new Map([...search.matchIds].map((id, i) => [id, i]));
      items.sort((a, b) => rank.get(a.id) - rank.get(b.id));
    } else items.sort(sortComparator(mode));
    const active = items.filter((t) => !t.done);
    const doneItems = items.filter((t) => t.done);
    const list = showDone ? active.concat(doneItems) : active;
    zone.innerHTML = list.map(cardHtml).join('');
    const cnt = $(`[data-count="${lane.id}"]`);
    if (cnt) cnt.textContent = list.length;
  }
  document.querySelectorAll('.card').forEach((c) => c.addEventListener('click', () => openEdit(c.dataset.id)));
  document.querySelectorAll('.card-check').forEach((cb) => {
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', (e) => { e.stopPropagation(); setTodoDone(cb.dataset.id, cb.checked); });
  });
  updateReminderBadge();
}

async function setTodoDone(id, done) {
  try {
    await api(`/api/todos/${id}/done`, { method: 'POST', body: { done } });
    await reload();
    toast(done ? 'Als erledigt markiert' : 'Wieder geöffnet', 'ok');
  } catch (e) { toast('Fehler: ' + e.message, 'err'); await reload(); }
}
function toggleShowDone() {
  showDone = !showDone;
  localStorage.setItem('organizer2.showDone', showDone ? '1' : '');
  $('#toggleDone').classList.toggle('active', showDone);
  render();
}
function updateReminderBadge() {
  const due = todos.filter((t) => !t.done && t.reminder?.due).length;
  const badge = $('#reminderCount');
  badge.textContent = due;
  badge.classList.toggle('hidden', due === 0);
}

// ---------------- Drag&Drop ----------------
async function onDragEnd(evt) {
  if (search.matchIds) { toast('Suche zum Verschieben zurücksetzen', 'err'); await reload(); return; }
  const targetCat = evt.to.dataset.cards;
  const fromCat = evt.from.dataset.cards;
  const collect = (zone) => Array.from(zone.querySelectorAll('.card')).map((c) => c.dataset.id);
  try {
    await api('/api/reorder', { method: 'POST', body: { category: targetCat, orderedIds: collect(evt.to) } });
    if (fromCat !== targetCat) await api('/api/reorder', { method: 'POST', body: { category: fromCat, orderedIds: collect(evt.from) } });
    await reload();
  } catch (e) {
    toast('Verschieben fehlgeschlagen: ' + e.message, 'err');
    await reload();
  }
}

// ---------------- Todo-Dialog ----------------
function populateCategorySelect(selected) {
  $('#f-category').innerHTML = lanes.map((l) => `<option value="${l.id}">${escapeHtml(l.label)}</option>`).join('');
  if (selected) $('#f-category').value = selected;
}

function applyLaneFields() {
  const lane = laneById($('#f-category').value);
  const f = lane?.fields || { dueDate: 'optional', customer: 'optional', reminder: 'optional' };
  const setField = (wrapSel, mode) => {
    const wrap = $(wrapSel);
    wrap.classList.toggle('hidden', mode === 'off');
    const req = wrap.querySelector('.req');
    if (req) req.classList.toggle('hidden', mode !== 'required');
  };
  setField('#f-customer-wrap', f.customer);
  setField('#f-dueDate-wrap', f.dueDate);
  setField('#f-interval-wrap', f.reminder);
  // Reminder verpflichtend & leer -> sinnvollen Default vorschlagen
  if (f.reminder === 'required' && !$('#f-interval').value) $('#f-interval').value = '7';
}

function openCreate(presetCategory) {
  editingId = null;
  editChecklist = [];
  $('#modalTitle').textContent = 'Neues Todo';
  $('#f-title').value = '';
  $('#f-customer').value = '';
  populateCategorySelect(presetCategory || (lanes[0] && lanes[0].id));
  $('#f-priority').value = 'medium';
  $('#f-dueDate').value = '';
  $('#f-interval').value = '';
  $('#f-notes').value = '';
  $('#f-updatedAt').textContent = '–';
  $('#deleteBtn').classList.add('hidden');
  $('#doneBtn').classList.add('hidden');
  $('#draftBtn').classList.add('hidden');
  $('#linksSection').classList.add('hidden');
  $('#commentsSection').classList.add('hidden');
  $('#summarySection').classList.add('hidden');
  $('#reminderInfo').classList.add('hidden');
  fillCustomerList();
  applyLaneFields();
  renderChecklist();
  renderDeps(null);
  renderTechPicker([]);
  showModal('#modal');
  $('#f-title').focus();
}

function openEdit(id) {
  const t = todos.find((x) => x.id === id);
  if (!t) return;
  editingId = id;
  editChecklist = (t.checklist || []).map((c) => ({ ...c }));
  $('#modalTitle').textContent = 'Todo bearbeiten';
  $('#f-title').value = t.title;
  $('#f-customer').value = t.customer || '';
  populateCategorySelect(t.category);
  $('#f-priority').value = t.priority;
  $('#f-dueDate').value = t.dueDate ? t.dueDate.slice(0, 10) : '';
  $('#f-interval').value = t.reminderIntervalDays || '';
  $('#f-notes').value = t.notes || '';
  $('#f-updatedAt').textContent = t.updatedAt ? new Date(t.updatedAt).toLocaleString('de-DE') : '–';
  $('#deleteBtn').classList.remove('hidden');
  $('#draftBtn').classList.remove('hidden');
  const doneBtn = $('#doneBtn');
  doneBtn.classList.remove('hidden');
  doneBtn.textContent = t.done ? '↺ Wieder öffnen' : '✓ Erledigt';
  fillCustomerList();
  applyLaneFields();
  renderReminderInfo(t);
  renderComments(t);
  renderSummary(t);
  renderChecklist();
  renderDeps(t);
  renderTechPicker(t.technologies || []);
  renderLinks(t);
  showModal('#modal');
}

function renderReminderInfo(t) {
  const box = $('#reminderInfo');
  if (!t.reminder) { box.classList.add('hidden'); return; }
  const r = t.reminder;
  box.classList.remove('hidden');
  box.classList.toggle('due', r.due);
  const last = r.lastSentAt ? new Date(r.lastSentAt).toLocaleDateString('de-DE') : 'noch nie';
  box.innerHTML = r.due
    ? `🔔 <strong>Reminder fällig!</strong> Zuletzt: ${last}. Intervall: ${r.intervalDays} Tage.
       <button class="btn btn-ghost" id="markSentBtn" type="button" style="margin-top:8px">Als gesendet markieren</button>`
    : `🔔 Nächster Reminder in <strong>${r.daysUntil} Tag(en)</strong> (${fmtDate(r.nextDue)}). Zuletzt: ${last}.`;
  const btn = $('#markSentBtn');
  if (btn) btn.addEventListener('click', async () => {
    await api(`/api/todos/${t.id}/reminder-sent`, { method: 'POST' });
    toast('Reminder als gesendet markiert', 'ok');
    closeModal('#modal');
    await reload();
  });
}

// ---- Zusammenfassung ----
function renderSummary(t) {
  $('#summarySection').classList.remove('hidden');
  const box = $('#summaryText');
  box.textContent = t.summary?.text || 'Noch keine Zusammenfassung. „✨ Aktualisieren" erzeugt eine auf Basis der verknüpften Vorgänge & Notizen.';
  box.classList.toggle('empty', !t.summary?.text);
}
async function generateSummary() {
  if (!editingId) return;
  const btn = $('#genSummaryBtn');
  btn.disabled = true; btn.textContent = '… erstelle';
  try {
    const updated = await api(`/api/todos/${editingId}/summary`, { method: 'POST' });
    const idx = todos.findIndex((x) => x.id === editingId);
    if (idx !== -1) todos[idx] = updated;
    renderSummary(updated);
    render();
    toast('Zusammenfassung aktualisiert', 'ok');
  } catch (e) { toast('Zusammenfassung fehlgeschlagen: ' + e.message, 'err'); }
  finally { btn.disabled = false; btn.textContent = '✨ Aktualisieren'; }
}

// ---- Checkliste ----
function renderChecklist() {
  const list = $('#checklistItems');
  if (!editChecklist.length) { list.innerHTML = '<li class="comments-empty">Noch keine Punkte.</li>'; return; }
  list.innerHTML = editChecklist
    .map((c, i) => `<li class="checklist-item">
        <input type="checkbox" data-ci="${i}" ${c.checked ? 'checked' : ''} />
        <span class="${c.checked ? 'cl-done' : ''}">${escapeHtml(c.text)}</span>
        <button class="icon-btn cl-del" data-cidel="${i}" title="Entfernen" type="button">✕</button>
      </li>`)
    .join('');
  list.querySelectorAll('[data-ci]').forEach((cb) => cb.addEventListener('change', () => { editChecklist[Number(cb.dataset.ci)].checked = cb.checked; renderChecklist(); }));
  list.querySelectorAll('[data-cidel]').forEach((b) => b.addEventListener('click', () => { editChecklist.splice(Number(b.dataset.cidel), 1); renderChecklist(); }));
}
function addChecklistItem() {
  const inp = $('#checklistInput');
  const text = inp.value.trim();
  if (!text) return;
  editChecklist.push({ id: uid(), text, checked: false });
  inp.value = '';
  renderChecklist();
}

// ---- Abhängigkeiten ----
function renderDeps(t) {
  const sel = $('#f-dependsOn');
  const dependsOn = t?.dependsOn || [];
  const options = todos
    .filter((x) => x.id !== editingId)
    .map((x) => {
      const lane = laneById(x.category);
      const label = `${x.title}${lane ? ' · ' + lane.label : ''}${x.done ? ' (erledigt)' : ''}`;
      return `<option value="${x.id}" ${dependsOn.includes(x.id) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    })
    .join('');
  sel.innerHTML = options || '<option disabled>Keine anderen Todos vorhanden</option>';

  const box = $('#dependentsBox');
  const dependents = t?.dependents || [];
  if (!dependents.length) { box.innerHTML = '<span class="deps-hint">Kein anderes Todo hängt von diesem ab.</span>'; return; }
  box.innerHTML = '<div class="deps-hint">Wird vorausgesetzt von:</div>' + dependents
    .map((d) => `<a class="dep-chip" data-dep="${d.id}">${escapeHtml(d.title)}${d.done ? ' ✓' : ''}</a>`)
    .join('');
  box.querySelectorAll('[data-dep]').forEach((a) => a.addEventListener('click', () => openEdit(a.dataset.dep)));
}

// ---- Technologien ----
function renderTechPicker(selected) {
  const sel = selected || [];
  const all = [...new Set([...technologies, ...sel])].sort((a, b) => a.localeCompare(b, 'de'));
  const box = $('#techPicker');
  if (!all.length) {
    box.innerHTML = '<span class="deps-hint">Noch keine Technologien gepflegt – im ⚙-Menü hinzufügen.</span>';
    return;
  }
  box.innerHTML = all
    .map((t) => `<label class="tech-chip ${sel.includes(t) ? 'on' : ''}"><input type="checkbox" value="${escapeHtml(t)}" ${sel.includes(t) ? 'checked' : ''} /> ${escapeHtml(t)}</label>`)
    .join('');
  box.querySelectorAll('input').forEach((cb) =>
    cb.addEventListener('change', () => cb.closest('.tech-chip').classList.toggle('on', cb.checked)),
  );
}
function selectedTechnologies() {
  return Array.from($('#techPicker').querySelectorAll('input:checked')).map((c) => c.value);
}

function renderTechManager() {
  const list = $('#techList');
  list.innerHTML = technologies.length
    ? technologies.map((t) => `<li class="tech-row"><span>${escapeHtml(t)}</span><button class="icon-btn" data-techdel="${escapeHtml(t)}" title="Entfernen" type="button">✕</button></li>`).join('')
    : '<li class="comments-empty">Noch keine Technologien.</li>';
  list.querySelectorAll('[data-techdel]').forEach((b) => b.addEventListener('click', () => removeTechnology(b.dataset.techdel)));
}
async function addTechnology() {
  const inp = $('#techInput');
  const name = inp.value.trim();
  if (!name) return;
  try {
    technologies = await api('/api/technologies', { method: 'POST', body: { name } });
    inp.value = '';
    renderTechManager();
    toast('Technologie hinzugefügt', 'ok');
  } catch (e) { toast('Fehler: ' + e.message, 'err'); }
}
async function removeTechnology(name) {
  try {
    technologies = await api(`/api/technologies/${encodeURIComponent(name)}`, { method: 'DELETE' });
    renderTechManager();
    await reload(); // aus Todos entfernt -> Karten aktualisieren
    toast('Technologie entfernt', 'ok');
  } catch (e) { toast('Fehler: ' + e.message, 'err'); }
}

function fillCustomerList() {
  $('#customerList').innerHTML = [...new Set(todos.map((t) => t.customer).filter(Boolean))].sort()
    .map((n) => `<option value="${escapeHtml(n)}"></option>`).join('');
}
function renderComments(t) {
  const list = $('#commentsList');
  $('#commentsSection').classList.remove('hidden');
  const comments = t.comments || [];
  list.innerHTML = comments.length
    ? comments.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .map((c) => `<li class="comment-item"><div class="c-text">${escapeHtml(c.text)}</div><div class="c-time">🕒 ${new Date(c.createdAt).toLocaleString('de-DE')}</div></li>`).join('')
    : '<li class="comments-empty">Noch keine Kommentare.</li>';
  $('#commentInput').value = '';
}
async function addComment() {
  if (!editingId) return;
  const text = $('#commentInput').value.trim();
  if (!text) return;
  try {
    const updated = await api(`/api/todos/${editingId}/comments`, { method: 'POST', body: { text } });
    const idx = todos.findIndex((x) => x.id === editingId);
    if (idx !== -1) todos[idx] = updated;
    renderComments(updated);
    render();
    toast('Kommentar hinzugefügt', 'ok');
  } catch (e) { toast('Kommentar fehlgeschlagen: ' + e.message, 'err'); }
}
function renderLinks(t) {
  const section = $('#linksSection');
  if (!t.links?.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  $('#linksList').innerHTML = t.links.map((l) => {
    const ico = SOURCE_ICON[l.source] || '🔗';
    const dir = l.sentByUser ? 'an: ' : 'von: ';
    return `<li><a class="link-item" href="${l.webUrl || '#'}" target="_blank" rel="noopener">
      <span class="li-ico">${ico}</span>
      <span><span class="li-sub">${escapeHtml(l.subject || '(ohne Betreff)')}</span><br>
      <span class="li-from">${l.from ? dir + escapeHtml(l.from) : ''}</span></span></a></li>`;
  }).join('');
}

async function saveTodo() {
  const cat = $('#f-category').value;
  const f = laneById(cat)?.fields || {};
  const body = {
    title: $('#f-title').value.trim(),
    category: cat,
    priority: $('#f-priority').value,
    notes: $('#f-notes').value,
    customer: f.customer === 'off' ? '' : $('#f-customer').value.trim(),
    dueDate: f.dueDate === 'off' ? null : $('#f-dueDate').value || null,
    checklist: editChecklist,
    dependsOn: Array.from($('#f-dependsOn').selectedOptions).map((o) => o.value).filter(Boolean),
    technologies: selectedTechnologies(),
  };
  if (f.reminder === 'off') body.reminderIntervalDays = null;
  else { const v = Number($('#f-interval').value); body.reminderIntervalDays = v > 0 ? v : null; }
  if (!body.title) return toast('Bitte eine Beschreibung eingeben', 'err');

  try {
    if (editingId) await api(`/api/todos/${editingId}`, { method: 'PUT', body });
    else await api('/api/todos', { method: 'POST', body });
    closeModal('#modal');
    await reload();
    toast('Gespeichert', 'ok');
  } catch (e) { toast('Speichern fehlgeschlagen: ' + e.message, 'err'); }
}
async function deleteTodo() {
  if (!editingId || !confirm('Dieses Todo wirklich löschen?')) return;
  try {
    await api(`/api/todos/${editingId}`, { method: 'DELETE' });
    closeModal('#modal');
    await reload();
    toast('Gelöscht', 'ok');
  } catch (e) { toast('Löschen fehlgeschlagen: ' + e.message, 'err'); }
}

// ---------------- Lane-Dialog ----------------
function openLaneCreate() {
  editingLaneId = null;
  $('#laneModalTitle').textContent = 'Neue Lane';
  $('#lane-label').value = '';
  $('#lane-dueDate').value = 'optional';
  $('#lane-customer').value = 'optional';
  $('#lane-reminder').value = 'optional';
  $('#laneDeleteBtn').classList.add('hidden');
  showModal('#laneModal');
  $('#lane-label').focus();
}
function openLaneEdit(id) {
  const lane = laneById(id);
  if (!lane) return;
  editingLaneId = id;
  $('#laneModalTitle').textContent = 'Lane bearbeiten';
  $('#lane-label').value = lane.label;
  $('#lane-dueDate').value = lane.fields.dueDate;
  $('#lane-customer').value = lane.fields.customer;
  $('#lane-reminder').value = lane.fields.reminder;
  $('#laneDeleteBtn').classList.toggle('hidden', lanes.length <= 1);
  showModal('#laneModal');
}
async function saveLane() {
  const body = {
    label: $('#lane-label').value.trim(),
    fields: { dueDate: $('#lane-dueDate').value, customer: $('#lane-customer').value, reminder: $('#lane-reminder').value },
  };
  if (!body.label) return toast('Bitte eine Bezeichnung eingeben', 'err');
  try {
    if (editingLaneId) await api(`/api/lanes/${editingLaneId}`, { method: 'PUT', body });
    else await api('/api/lanes', { method: 'POST', body });
    closeModal('#laneModal');
    await reload();
    toast('Lane gespeichert', 'ok');
  } catch (e) { toast('Speichern fehlgeschlagen: ' + e.message, 'err'); }
}
async function deleteLane() {
  if (!editingLaneId) return;
  const lane = laneById(editingLaneId);
  const count = todos.filter((t) => t.category === editingLaneId).length;
  const msg = count
    ? `Lane „${lane.label}" löschen? ${count} Todo(s) werden in eine andere Lane verschoben.`
    : `Lane „${lane.label}" löschen?`;
  if (!confirm(msg)) return;
  try {
    const r = await api(`/api/lanes/${editingLaneId}`, { method: 'DELETE' });
    closeModal('#laneModal');
    await reload();
    toast(r.movedCount ? `Lane gelöscht, ${r.movedCount} Todo(s) verschoben` : 'Lane gelöscht', 'ok');
  } catch (e) { toast('Löschen fehlgeschlagen: ' + e.message, 'err'); }
}

// ---------------- Draft / Send ----------------
function openDraft() {
  const t = todos.find((x) => x.id === editingId);
  if (!t) return;
  $('#d-channel').value = t.links?.[0]?.source === 'teams' ? 'teams' : 'email';
  const firstLink = t.links?.[0];
  $('#d-to').value = firstLink?.from || '';
  $('#d-instructions').value = '';
  $('#d-subject').value = '';
  $('#d-body').value = '';
  showModal('#draftModal');
}
async function generateDraft() {
  const t = todos.find((x) => x.id === editingId);
  if (!t) return;
  const btn = $('#generateBtn');
  btn.disabled = true; btn.textContent = '… generiere';
  try {
    const draft = await api(`/api/todos/${t.id}/draft`, { method: 'POST', body: { channel: $('#d-channel').value, instructions: $('#d-instructions').value } });
    $('#d-subject').value = draft.subject || '';
    $('#d-body').value = draft.body || '';
    if (draft.generatedBy === 'fallback') toast('LLM nicht konfiguriert – einfacher Entwurf erstellt', 'err');
  } catch (e) { toast('Entwurf fehlgeschlagen: ' + e.message, 'err'); }
  finally { btn.disabled = false; btn.textContent = '✨ Entwurf generieren'; }
}
async function sendMessage() {
  const t = todos.find((x) => x.id === editingId);
  if (!t) return;
  try {
    const result = await api(`/api/todos/${t.id}/send`, { method: 'POST', body: { channel: $('#d-channel').value, to: $('#d-to').value, subject: $('#d-subject').value, body: $('#d-body').value } });
    closeModal('#draftModal');
    closeModal('#modal');
    await reload();
    toast(result.mock ? 'Versand simuliert (Integration nicht konfiguriert)' : 'Gesendet ✓', result.mock ? 'err' : 'ok');
  } catch (e) { toast('Senden fehlgeschlagen: ' + e.message, 'err'); }
}

// ---------------- Suche ----------------
function localMatchIds(query) {
  const q = query.toLowerCase();
  const ids = new Set();
  for (const t of todos) {
    const hay = [t.title, t.notes, t.customer, ...(t.comments || []).map((c) => c.text), ...(t.checklist || []).map((c) => c.text), ...(t.links || []).flatMap((l) => [l.subject, l.from])]
      .filter(Boolean).join(' ').toLowerCase();
    if (hay.includes(q)) ids.add(t.id);
  }
  return ids;
}
function runTextSearch(query) {
  search.query = query;
  search.matchIds = localMatchIds(query);
  search.mode = 'text';
  $('#searchClear').classList.remove('hidden');
  render();
  showSearchBanner();
}
async function runAiSearch() {
  const query = $('#searchInput').value.trim();
  if (!query) return;
  const btn = $('#aiSearchBtn');
  btn.disabled = true; btn.textContent = '… KI';
  try {
    const r = await api('/api/search', { method: 'POST', body: { query } });
    search.query = query;
    search.matchIds = new Set(r.ids);
    search.mode = r.mode;
    $('#searchClear').classList.remove('hidden');
    render();
    showSearchBanner();
  } catch (e) { toast('KI-Suche fehlgeschlagen: ' + e.message, 'err'); }
  finally { btn.disabled = false; btn.textContent = '✨ KI'; }
}
function showSearchBanner() {
  const banner = $('#searchBanner');
  if (!search.matchIds) { banner.classList.add('hidden'); return; }
  const ai = search.mode === 'llm';
  banner.className = `search-banner ${ai ? 'ai' : ''}`;
  banner.innerHTML = `${ai ? '✨ KI-Suche' : '🔎 Suche'}: <strong>${search.matchIds.size}</strong> Treffer für „${escapeHtml(search.query)}"${ai ? ' (nach Relevanz)' : ''} <button id="bannerClear">Zurücksetzen ✕</button>`;
  $('#bannerClear').addEventListener('click', clearSearch);
}
function clearSearch() {
  search = { query: '', matchIds: null, mode: null, llmEnabled: search.llmEnabled };
  $('#searchInput').value = '';
  $('#searchClear').classList.add('hidden');
  $('#searchBanner').classList.add('hidden');
  render();
}

// ---------------- Sync / Status / Test ----------------
async function doSync() {
  const btn = $('#syncBtn');
  btn.classList.add('syncing'); btn.disabled = true;
  try {
    const r = await api('/api/sync', { method: 'POST' });
    await reload();
    const summary = `${r.created} neu, ${r.updated || 0} aktualisiert, ${r.skipped} bekannt`;
    if (r.errors?.length) toast(`Sync: ${summary} – Fehler (${r.errors[0].source}): ${r.errors[0].message}`, 'err');
    else toast(`Sync: ${summary}`, 'ok');
  } catch (e) { toast('Sync fehlgeschlagen: ' + e.message, 'err'); }
  finally { btn.classList.remove('syncing'); btn.disabled = false; }
}
function openTest() {
  renderTechManager();
  $('#testList').innerHTML = '<li class="test-empty">Noch nicht getestet – auf „Alle testen" klicken.</li>';
  showModal('#testModal');
}
function testRowHtml(x) {
  const state = !x.configured ? 'na' : x.ok ? 'ok' : 'err';
  const icon = state === 'ok' ? '✓' : state === 'err' ? '✗' : '–';
  return `<li class="test-row ${state}"><span class="t-ico">${icon}</span><span class="t-body"><span class="t-label">${escapeHtml(x.label)}</span><span class="t-msg">${escapeHtml(x.message || '')}</span></span></li>`;
}
async function runTests() {
  const btn = $('#runTestBtn');
  btn.disabled = true; btn.textContent = '… teste';
  $('#testList').innerHTML = '<li class="test-row pending"><span class="t-ico">⟳</span><span class="t-body"><span class="t-label">Teste Verbindungen…</span></span></li>';
  try {
    const r = await api('/api/test');
    $('#testList').innerHTML = r.results.map(testRowHtml).join('');
  } catch (e) {
    $('#testList').innerHTML = `<li class="test-row err"><span class="t-ico">✗</span><span class="t-body"><span class="t-label">Test fehlgeschlagen</span><span class="t-msg">${escapeHtml(e.message)}</span></span></li>`;
  } finally { btn.disabled = false; btn.textContent = 'Alle testen'; }
}
async function loadStatus() {
  try {
    const s = await api('/api/status');
    const llm = `<span class="chip"><span class="dot ${s.llm.enabled ? 'on' : 'off'}"></span>LLM ${s.llm.enabled ? s.llm.model : 'aus'}</span>`;
    const integs = s.integrations.map((i) => `<span class="chip"><span class="dot ${i.configured ? 'on' : 'off'}"></span>${i.label}</span>`).join('');
    const sync = s.lastSync ? `Letzter Sync: ${new Date(s.lastSync).toLocaleString('de-DE')}` : 'Noch kein Sync';
    $('#statusBar').innerHTML = `${llm}${integs}<span class="chip" style="margin-left:auto">${sync}</span>`;
    search.llmEnabled = s.llm.enabled;
    $('#aiSearchBtn').classList.toggle('hidden', !s.llm.enabled);
    $('#searchInput').placeholder = s.llm.enabled ? 'Suchen… (Enter = KI-Suche)' : 'Suchen…';
  } catch { /* still */ }
}

// ---------------- helpers / init ----------------
function showModal(sel) { $(sel).classList.remove('hidden'); }
function closeModal(sel) { $(sel).classList.add('hidden'); }

async function reload() {
  const [laneData, todoData, techData] = await Promise.all([api('/api/lanes'), api('/api/todos'), api('/api/technologies')]);
  lanes = laneData;
  todos = todoData;
  technologies = techData;
  buildBoard();
  render();
  loadStatus();
}

function init() {
  $('#addBtn').addEventListener('click', () => openCreate());
  $('#syncBtn').addEventListener('click', doSync);
  $('#saveBtn').addEventListener('click', saveTodo);
  $('#deleteBtn').addEventListener('click', deleteTodo);
  $('#doneBtn').addEventListener('click', async () => {
    if (!editingId) return;
    const t = todos.find((x) => x.id === editingId);
    closeModal('#modal');
    await setTodoDone(editingId, !t?.done);
  });
  $('#toggleDone').addEventListener('click', toggleShowDone);
  $('#toggleDone').classList.toggle('active', showDone);
  $('#draftBtn').addEventListener('click', openDraft);
  $('#genSummaryBtn').addEventListener('click', generateSummary);
  $('#addChecklistBtn').addEventListener('click', addChecklistItem);
  $('#checklistInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(); } });
  $('#addCommentBtn').addEventListener('click', addComment);
  $('#commentInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addComment(); } });
  $('#generateBtn').addEventListener('click', generateDraft);
  $('#sendBtn').addEventListener('click', sendMessage);
  $('#menuBtn').addEventListener('click', openTest);
  $('#runTestBtn').addEventListener('click', runTests);
  $('#addTechBtn').addEventListener('click', addTechnology);
  $('#techInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTechnology(); } });
  $('#laneSaveBtn').addEventListener('click', saveLane);
  $('#laneDeleteBtn').addEventListener('click', deleteLane);
  $('#f-category').addEventListener('change', applyLaneFields);
  document.querySelectorAll('[data-close-test]').forEach((b) => b.addEventListener('click', () => closeModal('#testModal')));
  document.querySelectorAll('[data-close-lane]').forEach((b) => b.addEventListener('click', () => closeModal('#laneModal')));
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal('#modal')));
  document.querySelectorAll('[data-close-draft]').forEach((b) => b.addEventListener('click', () => closeModal('#draftModal')));

  const searchInput = $('#searchInput');
  searchInput.addEventListener('input', () => { const q = searchInput.value.trim(); if (!q) clearSearch(); else runTextSearch(q); });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && search.llmEnabled && searchInput.value.trim()) { e.preventDefault(); runAiSearch(); }
    else if (e.key === 'Escape') clearSearch();
  });
  $('#aiSearchBtn').addEventListener('click', runAiSearch);
  $('#searchClear').addEventListener('click', clearSearch);
  $('#reminderBell').addEventListener('click', () => {
    const due = todos.find((t) => !t.done && t.reminder?.due);
    if (due) openEdit(due.id);
    else toast('Keine fälligen Reminder 🎉', 'ok');
  });
  document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); }));

  reload();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

document.addEventListener('DOMContentLoaded', init);
