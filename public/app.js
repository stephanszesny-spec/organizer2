'use strict';

const CATEGORIES = [
  { id: 'strategic', label: 'Strategische Todos' },
  { id: 'operative', label: 'Operative Todos' },
  { id: 'sales', label: 'Salesprozesse' },
  { id: 'reminder', label: 'Reminder' },
];

const SOURCE_ICON = { manual: '📝', m365mail: '✉️', teams: '💬', jira: '🟦', freshdesk: '🎫', email: '✉️' };

const SORT_OPTIONS = [
  { id: 'manual', label: 'Manuell (Drag&Drop)' },
  { id: 'updated', label: 'Letzte Änderung' },
  { id: 'priority', label: 'Priorität' },
  { id: 'dueDate', label: 'Ziel-Datum' },
];
const PRIO_WEIGHT = { high: 0, medium: 1, low: 2 };

let todos = [];
let editingId = null;
// Sortierpräferenz pro Spalte (in localStorage gespeichert)
let sortPref = loadSortPref();
// Suchzustand: query = aktueller Text; matchIds = Treffer-IDs (Set) oder null
let search = { query: '', matchIds: null, mode: null, llmEnabled: false };

function loadSortPref() {
  try { return JSON.parse(localStorage.getItem('organizer2.sort') || '{}'); }
  catch { return {}; }
}
function saveSortPref() {
  localStorage.setItem('organizer2.sort', JSON.stringify(sortPref));
}

const $ = (sel, root = document) => root.querySelector(sel);
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
  setTimeout(() => el.classList.add('hidden'), 3500);
}

// ---------------- Rendering ----------------
function buildBoard() {
  const board = $('#board');
  board.innerHTML = '';
  for (const cat of CATEGORIES) {
    const col = document.createElement('section');
    col.className = 'column';
    col.dataset.cat = cat.id;
    const current = sortPref[cat.id] || 'manual';
    const opts = SORT_OPTIONS.map(
      (o) => `<option value="${o.id}" ${o.id === current ? 'selected' : ''}>↕ ${o.label}</option>`,
    ).join('');
    col.innerHTML = `
      <div class="column-head">
        <h2>${cat.label}</h2>
        <div class="head-right">
          <select class="col-sort ${current !== 'manual' ? 'active' : ''}" data-sort="${cat.id}" title="Sortierung">${opts}</select>
          <span class="count" data-count="${cat.id}">0</span>
        </div>
      </div>
      <div class="cards" data-cards="${cat.id}"></div>`;
    board.appendChild(col);
  }
  // Sortier-Auswahl pro Spalte
  document.querySelectorAll('[data-sort]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const cat = sel.dataset.sort;
      sortPref[cat] = sel.value;
      saveSortPref();
      sel.classList.toggle('active', sel.value !== 'manual');
      render();
    });
  });
  // Drag&Drop pro Spalte (funktioniert auch auf Touch dank SortableJS)
  document.querySelectorAll('[data-cards]').forEach((zone) => {
    Sortable.create(zone, {
      group: 'todos',
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      delay: 120, // Touch: kurzes Halten -> Drag, sonst Scroll
      delayOnTouchOnly: true,
      onEnd: onDragEnd,
    });
  });
}

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function dueTag(todo) {
  if (!todo.dueDate) return '';
  const due = new Date(todo.dueDate);
  const days = Math.ceil((due - new Date()) / 86400000);
  let cls = '';
  if (days < 0) cls = 'overdue';
  else if (days <= 2) cls = 'due-soon';
  return `<span class="tag ${cls}">📅 ${fmtDate(todo.dueDate)}</span>`;
}

function cardHtml(todo) {
  const prioLabel = { high: 'Hoch', medium: 'Mittel', low: 'Niedrig' }[todo.priority];
  const tags = [`<span class="tag prio-${todo.priority}">${prioLabel}</span>`, dueTag(todo)];

  if (todo.customer) tags.push(`<span class="tag">👤 ${escapeHtml(todo.customer)}</span>`);
  if (todo.comments && todo.comments.length) tags.push(`<span class="tag">💬 ${todo.comments.length}</span>`);

  if (todo.category === 'reminder' && todo.reminder) {
    const r = todo.reminder;
    if (r.due) tags.push(`<span class="tag reminder">🔔 fällig</span>`);
    else tags.push(`<span class="tag reminder">🔔 in ${r.daysUntil} T</span>`);
  }
  if (todo.links && todo.links.length) {
    const ico = SOURCE_ICON[todo.links[0].source] || '🔗';
    tags.push(`<span class="tag src">${ico} ${todo.links.length}</span>`);
  } else if (todo.source && todo.source !== 'manual') {
    tags.push(`<span class="tag src">${SOURCE_ICON[todo.source] || '🔗'}</span>`);
  }

  const dueCls = todo.category === 'reminder' && todo.reminder?.due ? 'reminder-due' : '';
  return `
    <div class="card prio-${todo.priority} ${dueCls}" data-id="${todo.id}">
      <div class="card-title">${escapeHtml(todo.title)}</div>
      <div class="card-meta">${tags.filter(Boolean).join('')}</div>
    </div>`;
}

function sortComparator(mode) {
  switch (mode) {
    case 'updated':
      return (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt);
    case 'priority':
      return (a, b) => (PRIO_WEIGHT[a.priority] - PRIO_WEIGHT[b.priority]) || (a.order - b.order);
    case 'dueDate':
      // frühestes Datum zuerst, Todos ohne Datum ans Ende
      return (a, b) => {
        if (!a.dueDate && !b.dueDate) return a.order - b.order;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate) - new Date(b.dueDate);
      };
    default:
      return (a, b) => a.order - b.order;
  }
}

function render() {
  for (const cat of CATEGORIES) {
    const zone = $(`[data-cards="${cat.id}"]`);
    const mode = sortPref[cat.id] || 'manual';
    let items = todos
      .filter((t) => t.category === cat.id)
      .filter((t) => (search.matchIds ? search.matchIds.has(t.id) : true));
    if (search.matchIds && search.mode === 'llm') {
      // LLM liefert nach Relevanz sortierte IDs -> diese Reihenfolge übernehmen
      const rank = new Map([...search.matchIds].map((id, i) => [id, i]));
      items.sort((a, b) => rank.get(a.id) - rank.get(b.id));
    } else {
      items.sort(sortComparator(mode));
    }
    zone.innerHTML = items.map(cardHtml).join('');
    $(`[data-count="${cat.id}"]`).textContent = items.length;
  }
  // Klick öffnet Detail
  document.querySelectorAll('.card').forEach((c) =>
    c.addEventListener('click', () => openEdit(c.dataset.id)),
  );
  updateReminderBadge();
}

function updateReminderBadge() {
  const due = todos.filter((t) => t.category === 'reminder' && t.reminder?.due).length;
  const badge = $('#reminderCount');
  badge.textContent = due;
  badge.classList.toggle('hidden', due === 0);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------- Drag&Drop ----------------
async function onDragEnd(evt) {
  // Während einer aktiven Suche ist die Ansicht gefiltert -> Reihenfolge nicht
  // verlässlich speicherbar. Erst Suche zurücksetzen.
  if (search.matchIds) {
    toast('Suche zum Verschieben zurücksetzen', 'err');
    await reload();
    return;
  }
  const targetCat = evt.to.dataset.cards;
  const fromCat = evt.from.dataset.cards;
  const collect = (zone) => Array.from(zone.querySelectorAll('.card')).map((c) => c.dataset.id);
  try {
    await api('/api/reorder', { method: 'POST', body: { category: targetCat, orderedIds: collect(evt.to) } });
    if (fromCat !== targetCat) {
      await api('/api/reorder', { method: 'POST', body: { category: fromCat, orderedIds: collect(evt.from) } });
    }
    await reload();
  } catch (e) {
    toast('Verschieben fehlgeschlagen: ' + e.message, 'err');
    await reload();
  }
}

// ---------------- Modal: Edit/Create ----------------
function openCreate() {
  editingId = null;
  $('#modalTitle').textContent = 'Neues Todo';
  $('#f-title').value = '';
  $('#f-customer').value = '';
  $('#f-category').value = 'operative';
  $('#f-priority').value = 'medium';
  $('#f-dueDate').value = '';
  $('#f-interval').value = '7';
  $('#f-notes').value = '';
  $('#f-updatedAt').textContent = '–';
  $('#deleteBtn').classList.add('hidden');
  $('#draftBtn').classList.add('hidden');
  $('#linksSection').classList.add('hidden');
  $('#commentsSection').classList.add('hidden'); // erst nach Erstellung
  $('#reminderInfo').classList.add('hidden');
  fillCustomerList();
  toggleIntervalField();
  showModal('#modal');
  $('#f-title').focus();
}

function openEdit(id) {
  const t = todos.find((x) => x.id === id);
  if (!t) return;
  editingId = id;
  $('#modalTitle').textContent = 'Todo bearbeiten';
  $('#f-title').value = t.title;
  $('#f-customer').value = t.customer || '';
  $('#f-category').value = t.category;
  $('#f-priority').value = t.priority;
  $('#f-dueDate').value = t.dueDate ? t.dueDate.slice(0, 10) : '';
  $('#f-interval').value = t.reminderIntervalDays || 7;
  $('#f-notes').value = t.notes || '';
  $('#f-updatedAt').textContent = t.updatedAt ? new Date(t.updatedAt).toLocaleString('de-DE') : '–';
  $('#deleteBtn').classList.remove('hidden');
  $('#draftBtn').classList.remove('hidden');
  fillCustomerList();
  toggleIntervalField();
  renderReminderInfo(t);
  renderComments(t);
  renderLinks(t);
  showModal('#modal');
}

function toggleIntervalField() {
  const isReminder = $('#f-category').value === 'reminder';
  $('#f-interval-wrap').classList.toggle('hidden', !isReminder);
}

function renderReminderInfo(t) {
  const box = $('#reminderInfo');
  if (t.category !== 'reminder' || !t.reminder) {
    box.classList.add('hidden');
    return;
  }
  const r = t.reminder;
  box.classList.remove('hidden');
  box.classList.toggle('due', r.due);
  const last = r.lastSentAt ? new Date(r.lastSentAt).toLocaleDateString('de-DE') : 'noch nie';
  box.innerHTML = r.due
    ? `🔔 <strong>Reminder fällig!</strong> Zuletzt gesendet: ${last}. Intervall: ${r.intervalDays} Tage.
       <button class="btn btn-ghost" id="markSentBtn" style="margin-top:8px">Als gesendet markieren</button>`
    : `🔔 Nächster Reminder in <strong>${r.daysUntil} Tag(en)</strong> (${fmtDate(r.nextDue)}). Zuletzt: ${last}.`;
  const btn = $('#markSentBtn');
  if (btn) btn.addEventListener('click', async () => {
    await api(`/api/todos/${t.id}/reminder-sent`, { method: 'POST' });
    toast('Reminder als gesendet markiert', 'ok');
    closeModal('#modal');
    await reload();
  });
}

function renderComments(t) {
  const section = $('#commentsSection');
  const list = $('#commentsList');
  section.classList.remove('hidden'); // nach Erstellung immer verfügbar
  const comments = t.comments || [];
  if (!comments.length) {
    list.innerHTML = '<li class="comments-empty">Noch keine Kommentare.</li>';
  } else {
    list.innerHTML = comments
      .slice()
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map(
        (c) => `<li class="comment-item">
          <div class="c-text">${escapeHtml(c.text)}</div>
          <div class="c-time">🕒 ${new Date(c.createdAt).toLocaleString('de-DE')}</div>
        </li>`,
      )
      .join('');
  }
  $('#commentInput').value = '';
}

async function addComment() {
  if (!editingId) return;
  const input = $('#commentInput');
  const text = input.value.trim();
  if (!text) return;
  try {
    const updated = await api(`/api/todos/${editingId}/comments`, { method: 'POST', body: { text } });
    // lokalen Stand aktualisieren, ohne Modal zu schließen
    const idx = todos.findIndex((x) => x.id === editingId);
    if (idx !== -1) todos[idx] = updated;
    renderComments(updated);
    render();
    toast('Kommentar hinzugefügt', 'ok');
  } catch (e) {
    toast('Kommentar fehlgeschlagen: ' + e.message, 'err');
  }
}

function fillCustomerList() {
  const dl = $('#customerList');
  const names = [...new Set(todos.map((t) => t.customer).filter(Boolean))].sort();
  dl.innerHTML = names.map((n) => `<option value="${escapeHtml(n)}"></option>`).join('');
}

function renderLinks(t) {
  const section = $('#linksSection');
  const list = $('#linksList');
  if (!t.links || !t.links.length) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  list.innerHTML = t.links
    .map((l) => {
      const ico = SOURCE_ICON[l.source] || '🔗';
      const sub = escapeHtml(l.subject || '(ohne Betreff)');
      const from = escapeHtml(l.from || '');
      const dir = l.sentByUser ? 'an: ' : 'von: ';
      const href = l.webUrl || '#';
      return `<li><a class="link-item" href="${href}" target="_blank" rel="noopener">
        <span class="li-ico">${ico}</span>
        <span><span class="li-sub">${sub}</span><br><span class="li-from">${from ? dir + from : ''}</span></span>
      </a></li>`;
    })
    .join('');
}

async function saveTodo() {
  const body = {
    title: $('#f-title').value.trim(),
    customer: $('#f-customer').value.trim(),
    category: $('#f-category').value,
    priority: $('#f-priority').value,
    dueDate: $('#f-dueDate').value || null,
    notes: $('#f-notes').value,
  };
  if (body.category === 'reminder') body.reminderIntervalDays = Number($('#f-interval').value) || 7;
  if (!body.title) return toast('Bitte eine Beschreibung eingeben', 'err');

  try {
    if (editingId) await api(`/api/todos/${editingId}`, { method: 'PUT', body });
    else await api('/api/todos', { method: 'POST', body });
    closeModal('#modal');
    await reload();
    toast('Gespeichert', 'ok');
  } catch (e) {
    toast('Speichern fehlgeschlagen: ' + e.message, 'err');
  }
}

async function deleteTodo() {
  if (!editingId || !confirm('Dieses Todo wirklich löschen?')) return;
  try {
    await api(`/api/todos/${editingId}`, { method: 'DELETE' });
    closeModal('#modal');
    await reload();
    toast('Gelöscht', 'ok');
  } catch (e) {
    toast('Löschen fehlgeschlagen: ' + e.message, 'err');
  }
}

// ---------------- Draft / Send ----------------
function openDraft() {
  const t = todos.find((x) => x.id === editingId);
  if (!t) return;
  $('#d-channel').value = t.category === 'reminder' && t.links?.[0]?.source === 'teams' ? 'teams' : 'email';
  const firstLink = t.links?.[0];
  $('#d-to').value = firstLink && firstLink.sentByUser ? firstLink.from : (firstLink?.from || '');
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
    const draft = await api(`/api/todos/${t.id}/draft`, {
      method: 'POST',
      body: { channel: $('#d-channel').value, instructions: $('#d-instructions').value },
    });
    $('#d-subject').value = draft.subject || '';
    $('#d-body').value = draft.body || '';
    if (draft.generatedBy === 'fallback') toast('LLM nicht konfiguriert – einfacher Entwurf erstellt', 'err');
  } catch (e) {
    toast('Entwurf fehlgeschlagen: ' + e.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = '✨ Entwurf generieren';
  }
}

async function sendMessage() {
  const t = todos.find((x) => x.id === editingId);
  if (!t) return;
  try {
    const result = await api(`/api/todos/${t.id}/send`, {
      method: 'POST',
      body: {
        channel: $('#d-channel').value,
        to: $('#d-to').value,
        subject: $('#d-subject').value,
        body: $('#d-body').value,
      },
    });
    closeModal('#draftModal');
    closeModal('#modal');
    await reload();
    toast(result.mock ? 'Versand simuliert (Integration nicht konfiguriert)' : 'Gesendet ✓', result.mock ? 'err' : 'ok');
  } catch (e) {
    toast('Senden fehlgeschlagen: ' + e.message, 'err');
  }
}

// ---------------- Suche ----------------
function localMatchIds(query) {
  const q = query.toLowerCase();
  const ids = new Set();
  for (const t of todos) {
    const hay = [
      t.title,
      t.notes,
      t.customer,
      ...(t.comments || []).map((c) => c.text),
      ...(t.links || []).flatMap((l) => [l.subject, l.from]),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
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
    search.matchIds = new Set(r.ids); // bei 'llm' nach Relevanz sortiert
    search.mode = r.mode;
    $('#searchClear').classList.remove('hidden');
    render();
    showSearchBanner();
  } catch (e) {
    toast('KI-Suche fehlgeschlagen: ' + e.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = '✨ KI';
  }
}

function showSearchBanner() {
  const banner = $('#searchBanner');
  if (!search.matchIds) { banner.classList.add('hidden'); return; }
  const n = search.matchIds.size;
  const ai = search.mode === 'llm';
  banner.className = `search-banner ${ai ? 'ai' : ''}`;
  banner.innerHTML =
    `${ai ? '✨ KI-Suche' : '🔎 Suche'}: <strong>${n}</strong> Treffer für „${escapeHtml(search.query)}"` +
    `${ai ? ' (nach Relevanz)' : ''} <button id="bannerClear">Zurücksetzen ✕</button>`;
  $('#bannerClear').addEventListener('click', clearSearch);
}

function clearSearch() {
  search = { query: '', matchIds: null, mode: null, llmEnabled: search.llmEnabled };
  $('#searchInput').value = '';
  $('#searchClear').classList.add('hidden');
  $('#searchBanner').classList.add('hidden');
  render();
}

// ---------------- Sync & Status ----------------
async function doSync() {
  const btn = $('#syncBtn');
  btn.classList.add('syncing'); btn.disabled = true;
  try {
    const r = await api('/api/sync', { method: 'POST' });
    await reload();
    const errs = r.errors?.length ? ` (${r.errors.length} Fehler)` : '';
    toast(`Sync: ${r.created} neu, ${r.skipped} bekannt${errs}`, r.errors?.length ? 'err' : 'ok');
  } catch (e) {
    toast('Sync fehlgeschlagen: ' + e.message, 'err');
  } finally {
    btn.classList.remove('syncing'); btn.disabled = false;
  }
}

async function loadStatus() {
  try {
    const s = await api('/api/status');
    const bar = $('#statusBar');
    const llm = `<span class="chip"><span class="dot ${s.llm.enabled ? 'on' : 'off'}"></span>LLM ${s.llm.enabled ? s.llm.model : 'aus'}</span>`;
    const integs = s.integrations
      .map((i) => `<span class="chip"><span class="dot ${i.configured ? 'on' : 'off'}"></span>${i.label}</span>`)
      .join('');
    const sync = s.lastSync ? `Letzter Sync: ${new Date(s.lastSync).toLocaleString('de-DE')}` : 'Noch kein Sync';
    bar.innerHTML = `${llm}${integs}<span class="chip" style="margin-left:auto">${sync}</span>`;
    // KI-Suchbutton nur zeigen, wenn LLM angebunden ist
    search.llmEnabled = s.llm.enabled;
    $('#aiSearchBtn').classList.toggle('hidden', !s.llm.enabled);
    $('#searchInput').placeholder = s.llm.enabled ? 'Suchen… (Enter = KI-Suche)' : 'Suchen…';
  } catch (e) { /* still */ }
}

// ---------------- Modal helpers ----------------
function showModal(sel) { $(sel).classList.remove('hidden'); }
function closeModal(sel) { $(sel).classList.add('hidden'); }

async function reload() {
  todos = await api('/api/todos');
  render();
  loadStatus();
}

// ---------------- Init ----------------
function init() {
  buildBoard();
  $('#addBtn').addEventListener('click', openCreate);
  $('#syncBtn').addEventListener('click', doSync);
  $('#saveBtn').addEventListener('click', saveTodo);
  $('#deleteBtn').addEventListener('click', deleteTodo);
  $('#draftBtn').addEventListener('click', openDraft);
  $('#addCommentBtn').addEventListener('click', addComment);
  $('#commentInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addComment(); }
  });
  $('#generateBtn').addEventListener('click', generateDraft);
  $('#sendBtn').addEventListener('click', sendMessage);
  $('#f-category').addEventListener('change', toggleIntervalField);
  // Suche: Live-Textfilter beim Tippen, KI-Suche per Button oder Enter
  const searchInput = $('#searchInput');
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    if (!q) clearSearch();
    else runTextSearch(q);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && search.llmEnabled && searchInput.value.trim()) {
      e.preventDefault();
      runAiSearch();
    } else if (e.key === 'Escape') {
      clearSearch();
    }
  });
  $('#aiSearchBtn').addEventListener('click', runAiSearch);
  $('#searchClear').addEventListener('click', clearSearch);
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal('#modal')));
  document.querySelectorAll('[data-close-draft]').forEach((b) => b.addEventListener('click', () => closeModal('#draftModal')));
  $('#reminderBell').addEventListener('click', () => {
    const due = todos.find((t) => t.category === 'reminder' && t.reminder?.due);
    if (due) openEdit(due.id);
    else toast('Keine fälligen Reminder 🎉', 'ok');
  });
  // Klick auf Overlay schließt Modal
  document.querySelectorAll('.modal').forEach((m) =>
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); }),
  );
  reload();
  // Service Worker (PWA, offline-fähige Shell)
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

document.addEventListener('DOMContentLoaded', init);
