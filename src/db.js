import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, CATEGORIES, DEFAULT_REMINDER_INTERVAL_DAYS } from './config.js';

/**
 * Persistenz: eine einzelne JSON-Datei (z.B. im OneDrive-Ordner).
 * - In-Memory-State + atomares Schreiben (Temp-Datei -> rename), damit ein
 *   parallel laufender OneDrive-Sync nie eine halb geschriebene Datei sieht.
 * - Schreibvorgänge werden serialisiert, damit sie sich nicht überholen.
 */

const EMPTY = { version: 1, todos: [], meta: { lastSync: null } };

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
    if (err.code === 'ENOENT') {
      await persist(); // erste Initialisierung
    } else {
      throw new Error(`Datenbank-Datei konnte nicht gelesen werden (${config.dataFile}): ${err.message}`);
    }
  }
  return state;
}

function persist() {
  // Schreibvorgänge serialisieren.
  writeChain = writeChain.then(async () => {
    ensureDir();
    const tmp = `${config.dataFile}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    await fsp.rename(tmp, config.dataFile);
  });
  return writeChain;
}

const now = () => new Date().toISOString();

function normalizeComment(c) {
  return {
    id: c.id || crypto.randomUUID(),
    text: (c.text || '').trim(),
    createdAt: c.createdAt || now(),
  };
}

function normalize(todo) {
  const t = {
    id: todo.id || crypto.randomUUID(),
    category: CATEGORIES.includes(todo.category) ? todo.category : 'operative',
    title: (todo.title || '').trim(),
    priority: ['high', 'medium', 'low'].includes(todo.priority) ? todo.priority : 'medium',
    dueDate: todo.dueDate || null,
    notes: todo.notes || '',
    customer: (todo.customer || '').trim(),
    comments: Array.isArray(todo.comments) ? todo.comments.map(normalizeComment) : [],
    order: typeof todo.order === 'number' ? todo.order : Date.now(),
    createdAt: todo.createdAt || now(),
    updatedAt: todo.updatedAt || now(),
    // Herkunft / Verknüpfungen
    source: todo.source || 'manual', // manual | m365mail | teams | jira | freshdesk
    links: Array.isArray(todo.links) ? todo.links : [],
    dedupeKey: todo.dedupeKey || null,
    // Reminder-spezifisch
    reminderIntervalDays:
      todo.category === 'reminder'
        ? Number(todo.reminderIntervalDays) || DEFAULT_REMINDER_INTERVAL_DAYS
        : (todo.reminderIntervalDays ?? null),
    lastReminderSentAt: todo.lastReminderSentAt || null,
  };
  return t;
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

export async function create(data) {
  const todo = normalize(data);
  // Am Ende der Zielspalte einsortieren.
  const maxOrder = state.todos
    .filter((t) => t.category === todo.category)
    .reduce((m, t) => Math.max(m, t.order), 0);
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
  const comment = normalizeComment({ text });
  todo.comments.push(comment);
  todo.updatedAt = now();
  await persist();
  return todo;
}

export async function remove(id) {
  const idx = state.todos.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  state.todos.splice(idx, 1);
  await persist();
  return true;
}

/**
 * Reihenfolge & Kategorie nach Drag&Drop neu setzen.
 * orderedIds = Reihenfolge der Karten in der Zielspalte (category).
 */
export async function reorder(category, orderedIds) {
  orderedIds.forEach((id, index) => {
    const todo = getById(id);
    if (todo) {
      if (todo.category !== category) {
        todo.category = category;
        // Reminder-Defaults setzen, wenn in/aus Reminder-Spalte verschoben
        if (category === 'reminder' && !todo.reminderIntervalDays) {
          todo.reminderIntervalDays = DEFAULT_REMINDER_INTERVAL_DAYS;
        }
      }
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
