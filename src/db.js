import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, DEFAULT_LANES, LANE_FIELDS, DEFAULT_TECHNOLOGIES, DEFAULT_REMINDER_INTERVAL_DAYS } from './config.js';

/**
 * Persistenz: eine einzelne JSON-Datei (z.B. im OneDrive-Ordner).
 * - In-Memory-State + atomares Schreiben (Temp-Datei -> rename).
 * - Schreibvorgänge werden serialisiert.
 */

const EMPTY = { version: 2, lanes: [], technologies: [], todos: [], meta: { lastSync: null } };

let state = structuredClone(EMPTY);
let writeChain = Promise.resolve();

function ensureDir() {
  const dir = path.dirname(config.dataFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export async function load() {
  ensureDir();
  try {
    const raw = await fsp.readFile(config.dataFile, 'utf8');
    const parsed = JSON.parse(raw);
    state = { ...structuredClone(EMPTY), ...parsed };
    if (!Array.isArray(state.todos)) state.todos = [];
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw new Error(`Datenbank-Datei konnte nicht gelesen werden (${config.dataFile}): ${err.message}`);
    }
  }
  // Lanes sicherstellen (Migration bestehender Daten ohne Lanes)
  if (!Array.isArray(state.lanes) || state.lanes.length === 0) {
    state.lanes = DEFAULT_LANES.map((l, i) => normalizeLane(l, i));
  } else {
    state.lanes = state.lanes.map((l, i) => normalizeLane(l, i));
  }
  if (!Array.isArray(state.technologies)) state.technologies = [...DEFAULT_TECHNOLOGIES];
  // Verwaiste Todos (Lane gelöscht) auf erste Lane umhängen
  const laneIds = new Set(state.lanes.map((l) => l.id));
  const fallback = getLanes()[0]?.id;
  for (const t of state.todos) {
    if (!laneIds.has(t.category)) t.category = fallback;
  }
  await persist();
  return state;
}

function persist() {
  writeChain = writeChain.then(async () => {
    ensureDir();
    const tmp = `${config.dataFile}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    await fsp.rename(tmp, config.dataFile);
  });
  return writeChain;
}

const now = () => new Date().toISOString();
const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

// ---------------- Lanes ----------------
function normalizeLane(l, index) {
  const f = l.fields || {};
  const fieldVal = (v) => (['off', 'optional', 'required'].includes(v) ? v : 'optional');
  const fields = {};
  for (const key of LANE_FIELDS) fields[key] = fieldVal(f[key]);
  return {
    id: l.id || slug(l.label) || crypto.randomUUID().slice(0, 8),
    label: (l.label || '').trim() || 'Neue Lane',
    order: typeof l.order === 'number' ? l.order : index,
    fields,
  };
}

export function getLanes() {
  return [...state.lanes].sort((a, b) => a.order - b.order);
}
export function getLane(id) {
  return state.lanes.find((l) => l.id === id) || null;
}
export async function createLane(data) {
  const base = slug(data.label) || 'lane';
  const ids = new Set(state.lanes.map((l) => l.id));
  let id = base;
  let n = 1;
  while (ids.has(id)) id = `${base}-${++n}`;
  const order = state.lanes.reduce((m, l) => Math.max(m, l.order), -1) + 1;
  const lane = normalizeLane({ ...data, id, order }, order);
  state.lanes.push(lane);
  await persist();
  return lane;
}
export async function updateLane(id, patch) {
  const lane = getLane(id);
  if (!lane) return null;
  const merged = normalizeLane({ ...lane, ...patch, id: lane.id, order: lane.order }, lane.order);
  Object.assign(lane, merged);
  await persist();
  return lane;
}
export async function deleteLane(id) {
  if (state.lanes.length <= 1) return { error: 'Mindestens eine Lane muss bestehen bleiben.' };
  const idx = state.lanes.findIndex((l) => l.id === id);
  if (idx === -1) return { error: 'Lane nicht gefunden.' };
  const fallback = getLanes().filter((l) => l.id !== id)[0].id;
  let movedCount = 0;
  for (const t of state.todos) {
    if (t.category === id) {
      t.category = fallback;
      t.updatedAt = now();
      movedCount++;
    }
  }
  state.lanes.splice(idx, 1);
  await persist();
  return { movedCount, fallbackLaneId: fallback };
}
export async function reorderLanes(orderedIds) {
  orderedIds.forEach((id, index) => {
    const lane = getLane(id);
    if (lane) lane.order = index;
  });
  await persist();
  return getLanes();
}

// ---------------- Technologien ----------------
export function getTechnologies() {
  return [...state.technologies].sort((a, b) => a.localeCompare(b, 'de'));
}
export async function addTechnology(name) {
  const n = (name || '').trim();
  if (n && !state.technologies.some((t) => t.toLowerCase() === n.toLowerCase())) {
    state.technologies.push(n);
    await persist();
  }
  return getTechnologies();
}
export async function removeTechnology(name) {
  state.technologies = state.technologies.filter((t) => t !== name);
  // Auch aus allen Todos entfernen, damit nichts Verwaistes zurückbleibt.
  for (const todo of state.todos) {
    if (todo.technologies?.includes(name)) todo.technologies = todo.technologies.filter((x) => x !== name);
  }
  await persist();
  return getTechnologies();
}

// ---------------- Todos ----------------
function normalizeComment(c) {
  return { id: c.id || crypto.randomUUID(), text: (c.text || '').trim(), createdAt: c.createdAt || now() };
}
function normalizeChecklistItem(c) {
  return { id: c.id || crypto.randomUUID(), text: (c.text || '').trim(), checked: Boolean(c.checked) };
}
function normalizeSummary(s) {
  if (s && typeof s === 'object') {
    return { text: s.text || '', generatedAt: s.generatedAt || null, generatedBy: s.generatedBy || null };
  }
  return { text: '', generatedAt: null, generatedBy: null };
}

function normalize(todo) {
  const id = todo.id || crypto.randomUUID();
  const laneIds = state.lanes.map((l) => l.id);
  const category = laneIds.includes(todo.category) ? todo.category : laneIds[0] || 'operative';
  const interval =
    todo.reminderIntervalDays !== null && todo.reminderIntervalDays !== undefined && todo.reminderIntervalDays !== ''
      ? Number(todo.reminderIntervalDays) || null
      : null;
  return {
    id,
    category,
    title: (todo.title || '').trim(),
    priority: ['high', 'medium', 'low'].includes(todo.priority) ? todo.priority : 'medium',
    dueDate: todo.dueDate || null,
    notes: todo.notes || '',
    customer: (todo.customer || '').trim(),
    summary: normalizeSummary(todo.summary),
    checklist: Array.isArray(todo.checklist) ? todo.checklist.map(normalizeChecklistItem) : [],
    dependsOn: Array.isArray(todo.dependsOn)
      ? [...new Set(todo.dependsOn.filter((x) => typeof x === 'string' && x !== id))]
      : [],
    technologies: Array.isArray(todo.technologies)
      ? [...new Set(todo.technologies.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()))]
      : [],
    comments: Array.isArray(todo.comments) ? todo.comments.map(normalizeComment) : [],
    order: typeof todo.order === 'number' ? todo.order : Date.now(),
    createdAt: todo.createdAt || now(),
    updatedAt: todo.updatedAt || now(),
    source: todo.source || 'manual',
    links: Array.isArray(todo.links) ? todo.links : [],
    dedupeKey: todo.dedupeKey || null,
    // Reminder ist in jeder Lane möglich: aktiv, wenn ein Intervall gesetzt ist.
    reminderIntervalDays: interval,
    lastReminderSentAt: todo.lastReminderSentAt || null,
    done: Boolean(todo.done),
    doneAt: todo.doneAt || null,
    sourceUpdatedAt: todo.sourceUpdatedAt || null,
    relevanceKey: todo.relevanceKey || null,
  };
}

export function getAll() {
  return state.todos;
}
export function getById(id) {
  return state.todos.find((t) => t.id === id) || null;
}
export function findByDedupeKey(key) {
  if (!key) return null;
  return state.todos.find((t) => t.dedupeKey === key) || null;
}
/** Todos, die vom angegebenen Todo abhängen (Reverse-Dependency). */
export function getDependents(id) {
  return state.todos.filter((t) => (t.dependsOn || []).includes(id));
}

export async function create(data) {
  const todo = normalize(data);
  const maxOrder = state.todos.filter((t) => t.category === todo.category).reduce((m, t) => Math.max(m, t.order), 0);
  todo.order = maxOrder + 1;
  state.todos.push(todo);
  await persist();
  return todo;
}

export async function update(id, patch) {
  const todo = getById(id);
  if (!todo) return null;
  const merged = normalize({ ...todo, ...patch, id: todo.id, createdAt: todo.createdAt });
  merged.updatedAt = now();
  Object.assign(todo, merged);
  await persist();
  return todo;
}

export async function addComment(id, text) {
  const todo = getById(id);
  if (!todo) return null;
  if (!text || !text.trim()) return todo;
  todo.comments.push(normalizeComment({ text }));
  todo.updatedAt = now();
  await persist();
  return todo;
}

export async function setSummary(id, text, generatedBy) {
  const todo = getById(id);
  if (!todo) return null;
  todo.summary = { text: text || '', generatedAt: now(), generatedBy: generatedBy || null };
  todo.updatedAt = now();
  await persist();
  return todo;
}

export async function setDone(id, done) {
  const todo = getById(id);
  if (!todo) return null;
  todo.done = Boolean(done);
  todo.doneAt = todo.done ? now() : null;
  todo.updatedAt = now();
  await persist();
  return todo;
}

export async function applySourceState(id, { sourceUpdatedAt, relevanceKey, link, resurface } = {}) {
  const todo = getById(id);
  if (!todo) return null;
  if (sourceUpdatedAt) todo.sourceUpdatedAt = sourceUpdatedAt;
  if (relevanceKey !== undefined) todo.relevanceKey = relevanceKey;
  if (link) todo.links = [link];
  if (resurface) {
    todo.done = false;
    todo.doneAt = null;
    todo.updatedAt = now();
  }
  await persist();
  return todo;
}

export async function remove(id) {
  const idx = state.todos.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  state.todos.splice(idx, 1);
  // Abhängigkeiten auf das gelöschte Todo entfernen
  for (const t of state.todos) {
    if (t.dependsOn?.includes(id)) t.dependsOn = t.dependsOn.filter((d) => d !== id);
  }
  await persist();
  return true;
}

/** Reihenfolge & Lane nach Drag&Drop neu setzen. */
export async function reorder(category, orderedIds) {
  orderedIds.forEach((id, index) => {
    const todo = getById(id);
    if (todo) {
      todo.category = category;
      todo.order = index;
      todo.updatedAt = now();
    }
  });
  await persist();
  return state.todos.filter((t) => t.category === category);
}

export function setMeta(patch) {
  state.meta = { ...state.meta, ...patch };
  return persist();
}
export function getMeta() {
  return state.meta;
}

export { DEFAULT_REMINDER_INTERVAL_DAYS };
