import './src/proxy.js'; // muss vor den ersten Netzwerkaufrufen geladen werden
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, LANE_FIELDS } from './src/config.js';
import * as db from './src/db.js';
import { reminderStatus, dueReminders } from './src/reminders.js';
import { runSync, startAutoSync } from './src/sync.js';
import { integrations, integrationStatus, getIntegration } from './src/integrations/index.js';
import { draftMessage, searchTodos, testLlm, summarizeTodo } from './src/llm/anthropic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));

// Statisches Frontend
app.use(express.static(path.join(__dirname, 'public')));
// SortableJS aus node_modules ausliefern (offline-fähig, kein CDN nötig)
app.use('/vendor/sortable.js', express.static(path.join(__dirname, 'node_modules/sortablejs/Sortable.min.js')));

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// Todo um abgeleitete Felder anreichern (Reminder-Status, abhängige Todos)
function decorate(todo) {
  const dependents = db.getDependents(todo.id).map((t) => ({ id: t.id, title: t.title, category: t.category, done: t.done }));
  return { ...todo, reminder: reminderStatus(todo), dependents };
}

const FIELD_LABEL = { dueDate: 'Ziel-Datum', customer: 'Kunde', reminder: 'Reminder-Intervall' };

// Prüft Pflichtfelder gemäß Lane-Konfiguration. Gibt Fehlertext oder null zurück.
function validateAgainstLane(effective) {
  const lane = db.getLane(effective.category) || db.getLanes()[0];
  if (!lane) return null;
  const missing = [];
  for (const key of LANE_FIELDS) {
    if (lane.fields[key] !== 'required') continue;
    const val = key === 'reminder' ? effective.reminderIntervalDays : effective[key];
    if (val === undefined || val === null || val === '' || (key === 'reminder' && !(Number(val) > 0))) {
      missing.push(FIELD_LABEL[key]);
    }
  }
  return missing.length ? `Pflichtfelder fehlen für Lane „${lane.label}": ${missing.join(', ')}` : null;
}

// --- Status / Konfiguration ---
app.get('/api/status', wrap(async (_req, res) => {
  res.json({
    llm: { enabled: config.llm.enabled, model: config.llm.model },
    integrations: integrationStatus(),
    lastSync: db.getMeta().lastSync,
    dataFile: config.dataFile,
  });
}));

// --- Verbindungstest aller Schnittstellen (rein lesend) ---
app.get('/api/test', wrap(async (_req, res) => {
  const results = [];
  for (const integ of integrations) {
    let r;
    try {
      r = await integ.testConnection();
    } catch (err) {
      r = { ok: false, configured: integ.isConfigured(), message: err.message };
    }
    results.push({ id: integ.id, label: integ.label, ...r });
  }
  let llm;
  try {
    llm = await testLlm();
  } catch (err) {
    llm = { ok: false, configured: config.llm.enabled, message: err.message };
  }
  results.push({ id: 'llm', label: 'Claude (LLM)', ...llm });
  res.json({ results });
}));

// --- Lanes (Hauptbereiche) ---
app.get('/api/lanes', wrap(async (_req, res) => {
  res.json(db.getLanes());
}));

app.post('/api/lanes', wrap(async (req, res) => {
  if (!req.body?.label || !req.body.label.trim()) {
    return res.status(400).json({ error: 'label ist erforderlich' });
  }
  const lane = await db.createLane(req.body);
  res.status(201).json(lane);
}));

app.put('/api/lanes/:id', wrap(async (req, res) => {
  const lane = await db.updateLane(req.params.id, req.body);
  if (!lane) return res.status(404).json({ error: 'Lane nicht gefunden' });
  res.json(lane);
}));

app.delete('/api/lanes/:id', wrap(async (req, res) => {
  const result = await db.deleteLane(req.params.id);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result); // { movedCount, fallbackLaneId }
}));

app.post('/api/lanes/reorder', wrap(async (req, res) => {
  if (!Array.isArray(req.body?.orderedIds)) return res.status(400).json({ error: 'orderedIds erforderlich' });
  res.json(await db.reorderLanes(req.body.orderedIds));
}));

// --- Technologien (im Einstellungsmenü pflegbar) ---
app.get('/api/technologies', wrap(async (_req, res) => {
  res.json(db.getTechnologies());
}));
app.post('/api/technologies', wrap(async (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name ist erforderlich' });
  res.status(201).json(await db.addTechnology(name));
}));
app.delete('/api/technologies/:name', wrap(async (req, res) => {
  res.json(await db.removeTechnology(decodeURIComponent(req.params.name)));
}));

// --- Todos CRUD ---
app.get('/api/todos', wrap(async (_req, res) => {
  res.json(db.getAll().map(decorate));
}));

app.get('/api/todos/:id', wrap(async (req, res) => {
  const todo = db.getById(req.params.id);
  if (!todo) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(decorate(todo));
}));

app.post('/api/todos', wrap(async (req, res) => {
  if (!req.body.title || !req.body.title.trim()) {
    return res.status(400).json({ error: 'title ist erforderlich' });
  }
  const laneErr = validateAgainstLane(req.body);
  if (laneErr) return res.status(400).json({ error: laneErr });
  const todo = await db.create(req.body);
  res.status(201).json(decorate(todo));
}));

app.put('/api/todos/:id', wrap(async (req, res) => {
  const existing = db.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Nicht gefunden' });
  const effective = { ...existing, ...req.body };
  if (!effective.title || !String(effective.title).trim()) {
    return res.status(400).json({ error: 'title ist erforderlich' });
  }
  const laneErr = validateAgainstLane(effective);
  if (laneErr) return res.status(400).json({ error: laneErr });
  const todo = await db.update(req.params.id, req.body);
  res.json(decorate(todo));
}));

app.delete('/api/todos/:id', wrap(async (req, res) => {
  const ok = await db.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Nicht gefunden' });
  res.status(204).end();
}));

// --- Erledigt-Status ---
app.post('/api/todos/:id/done', wrap(async (req, res) => {
  const todo = await db.setDone(req.params.id, Boolean(req.body?.done));
  if (!todo) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(decorate(todo));
}));

// --- Kommentare (zeitgestempelt) ---
app.post('/api/todos/:id/comments', wrap(async (req, res) => {
  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text ist erforderlich' });
  const todo = await db.addComment(req.params.id, text);
  if (!todo) return res.status(404).json({ error: 'Nicht gefunden' });
  res.status(201).json(decorate(todo));
}));

// --- Drag&Drop: Reihenfolge/Kategorie aktualisieren ---
app.post('/api/reorder', wrap(async (req, res) => {
  const { category, orderedIds } = req.body;
  if (!db.getLane(category) || !Array.isArray(orderedIds)) {
    return res.status(400).json({ error: 'gültige Lane (category) und orderedIds erforderlich' });
  }
  const updated = await db.reorder(category, orderedIds);
  res.json(updated.map(decorate));
}));

// --- Reminder ---
app.get('/api/reminders/due', wrap(async (_req, res) => {
  res.json(dueReminders(db.getAll()).map((x) => ({ ...decorate(x.todo) })));
}));

// Reminder als "gesendet/erledigt für dieses Intervall" markieren
app.post('/api/todos/:id/reminder-sent', wrap(async (req, res) => {
  const todo = await db.update(req.params.id, { lastReminderSentAt: new Date().toISOString() });
  if (!todo) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(decorate(todo));
}));

// --- Suche (LLM-gestützt, mit Text-Fallback) ---
app.post('/api/search', wrap(async (req, res) => {
  const query = (req.body?.query || '').trim();
  if (!query) return res.json({ mode: 'empty', ids: [] });
  const all = db.getAll();

  if (config.llm.enabled) {
    try {
      const ids = await searchTodos(query, all);
      if (ids) return res.json({ mode: 'llm', ids });
    } catch (err) {
      console.error('[search] LLM-Fehler, nutze Text-Fallback:', err.message);
    }
  }

  // Text-Fallback: Treffer in Titel, Notizen oder verknüpften Vorgängen.
  const q = query.toLowerCase();
  const ids = all
    .filter((t) => {
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
      return hay.includes(q);
    })
    .map((t) => t.id);
  res.json({ mode: 'text', ids });
}));

// --- LLM-Zusammenfassung des aktuellen Stands ---
app.post('/api/todos/:id/summary', wrap(async (req, res) => {
  const todo = db.getById(req.params.id);
  if (!todo) return res.status(404).json({ error: 'Nicht gefunden' });
  const { text, generatedBy } = await summarizeTodo({ todo, links: todo.links });
  const updated = await db.setSummary(todo.id, text, generatedBy);
  res.json(decorate(updated));
}));

// --- Sync ---
app.post('/api/sync', wrap(async (req, res) => {
  const result = await runSync({ only: req.body?.only });
  res.json(result);
}));

// --- E-Mail/Teams-Entwurf generieren ---
app.post('/api/todos/:id/draft', wrap(async (req, res) => {
  const todo = db.getById(req.params.id);
  if (!todo) return res.status(404).json({ error: 'Nicht gefunden' });
  const draft = await draftMessage({
    todo,
    links: todo.links,
    channel: req.body?.channel || 'email',
    instructions: req.body?.instructions || '',
  });
  res.json(draft);
}));

// --- E-Mail/Teams versenden ---
app.post('/api/todos/:id/send', wrap(async (req, res) => {
  const todo = db.getById(req.params.id);
  if (!todo) return res.status(404).json({ error: 'Nicht gefunden' });
  const { channel = 'email', to, subject, body } = req.body || {};
  const integ = getIntegration(channel === 'teams' ? 'teams' : 'm365mail');
  if (!integ) return res.status(400).json({ error: 'Unbekannter Kanal' });
  const result = await integ.sendMessage({ to, subject, body });
  // Falls das Todo einen Reminder hat: Sendezeitpunkt festhalten.
  if (todo.reminderIntervalDays) {
    await db.update(todo.id, { lastReminderSentAt: new Date().toISOString() });
  }
  res.json(result);
}));

// SPA-Fallback
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

async function main() {
  await db.load();
  startAutoSync(config.syncIntervalMinutes);
  app.listen(config.port, config.host, () => {
    console.log(`\n  Organizer2 läuft auf http://${config.host}:${config.port}`);
    console.log(`  Datenbank: ${config.dataFile}`);
    console.log(`  LLM: ${config.llm.enabled ? config.llm.model : 'deaktiviert (Heuristik-Fallback)'}`);
    const cfg = integrationStatus().filter((i) => i.configured).map((i) => i.label);
    console.log(`  Integrationen aktiv: ${cfg.length ? cfg.join(', ') : 'keine (Mock-Modus)'}\n`);
  });
}

main().catch((err) => {
  console.error('Start fehlgeschlagen:', err);
  process.exit(1);
});
