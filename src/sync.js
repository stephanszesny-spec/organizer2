import * as db from './db.js';
import { integrations } from './integrations/index.js';
import { deriveTasks } from './llm/anthropic.js';

let running = false;

/**
 * Holt von allen Integrationen Source-Items, leitet via LLM Todos/Reminder ab
 * und legt neue (deduplizierte) Todos an. Bestehende, automatisch erzeugte
 * Todos werden nicht doppelt angelegt (dedupeKey = sourceItemId).
 */
export async function runSync({ only } = {}) {
  if (running) return { skipped: true, reason: 'Sync läuft bereits' };
  running = true;
  const result = { created: 0, skipped: 0, errors: [], bySource: {} };

  try {
    const active = only ? integrations.filter((i) => i.id === only) : integrations;

    for (const integ of active) {
      try {
        const items = await integ.fetchItems();
        result.bySource[integ.id] = { fetched: items.length, created: 0 };
        if (!items.length) continue;

        const derived = await deriveTasks(items);
        const itemById = new Map(items.map((it) => [it.id, it]));

        for (const task of derived) {
          const src = itemById.get(task.sourceItemId);
          if (!src) continue;

          const dedupeKey = src.id; // ein Todo pro Source-Item
          if (db.findByDedupeKey(dedupeKey)) {
            result.skipped++;
            continue;
          }

          await db.create({
            category: task.category,
            title: task.title || src.subject,
            priority: task.priority || 'medium',
            dueDate: task.dueDate || src.dueDate || null,
            notes: task.notes || src.snippet || '',
            source: src.source,
            dedupeKey,
            links: [
              {
                source: src.source,
                type: src.type,
                id: src.id,
                subject: src.subject,
                from: src.from || '',
                snippet: src.snippet || '',
                webUrl: src.webUrl || '',
                receivedAt: src.receivedAt || null,
                sentByUser: Boolean(src.sentByUser),
              },
            ],
          });
          result.created++;
          result.bySource[integ.id].created++;
        }
      } catch (err) {
        result.errors.push({ source: integ.id, message: err.message });
      }
    }

    await db.setMeta({ lastSync: new Date().toISOString() });
    return result;
  } finally {
    running = false;
  }
}

let timer = null;
export function startAutoSync(minutes) {
  if (timer) clearInterval(timer);
  if (!minutes || minutes <= 0) return;
  timer = setInterval(() => {
    runSync().catch((e) => console.error('[autosync]', e.message));
  }, minutes * 60_000);
}
