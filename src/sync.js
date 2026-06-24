import * as db from './db.js';
import { integrations } from './integrations/index.js';
import { deriveTasks, isChangeRelevant } from './llm/anthropic.js';

let running = false;

/**
 * Holt von allen Integrationen Source-Items, leitet via LLM Todos/Reminder ab
 * und legt neue (deduplizierte) Todos an. Bestehende, automatisch erzeugte
 * Todos werden nicht doppelt angelegt (dedupeKey = sourceItemId).
 */
export async function runSync({ only } = {}) {
  if (running) return { skipped: true, reason: 'Sync läuft bereits' };
  running = true;
  const result = { created: 0, updated: 0, skipped: 0, errors: [], bySource: {} };

  try {
    const active = only ? integrations.filter((i) => i.id === only) : integrations;

    for (const integ of active) {
      try {
        const items = await integ.fetchItems();
        result.bySource[integ.id] = { fetched: items.length, created: 0 };
        if (!items.length) continue;

        const derived = await deriveTasks(items);
        const itemById = new Map(items.map((it) => [it.id, it]));
        result.bySource[integ.id].updated = 0;

        for (const task of derived) {
          const src = itemById.get(task.sourceItemId);
          if (!src) continue;

          const dedupeKey = src.id; // ein Todo pro Source-Item
          const incoming = src.receivedAt || null; // Zeitstempel (nur zur Info)
          // "Betrifft mich"-Signatur. Fehlt sie (z.B. Mail/Teams), nehmen wir die
          // stabile Item-ID -> dann gibt es kein Wiederauftauchen.
          const incomingKey = src.relevanceKey || src.id;
          const link = {
            source: src.source,
            type: src.type,
            id: src.id,
            subject: src.subject,
            from: src.from || '',
            snippet: src.snippet || '',
            webUrl: src.webUrl || '',
            receivedAt: src.receivedAt || null,
            sentByUser: Boolean(src.sentByUser),
          };

          const existing = db.findByDedupeKey(dedupeKey);
          if (existing) {
            const prevKey = existing.relevanceKey;
            const changed = prevKey != null && incomingKey !== prevKey;
            if (changed) {
              // Relevante Felder haben sich geändert. Bei aktivem LLM zusätzlich
              // prüfen, ob die Änderung den Nutzer wirklich betrifft.
              const relevant = await isChangeRelevant({
                todo: existing,
                item: src,
                previousKey: prevKey,
                newKey: incomingKey,
              });
              // Key immer mitziehen, damit dieselbe Änderung nicht erneut auslöst.
              await db.applySourceState(existing.id, {
                sourceUpdatedAt: incoming,
                relevanceKey: incomingKey,
                link,
                resurface: relevant,
              });
              if (relevant) {
                result.updated++;
                result.bySource[integ.id].updated++;
              } else {
                result.skipped++;
              }
            } else {
              // Keine relevante Änderung: nur Basiswert merken (kein Wiederauftauchen).
              if (prevKey == null) {
                await db.applySourceState(existing.id, { sourceUpdatedAt: incoming, relevanceKey: incomingKey });
              }
              result.skipped++;
            }
            continue;
          }

          await db.create({
            category: task.category,
            title: task.title || src.subject,
            priority: task.priority || 'medium',
            dueDate: task.dueDate || src.dueDate || null,
            notes: task.notes || src.snippet || '',
            customer: task.customer || '',
            source: src.source,
            dedupeKey,
            sourceUpdatedAt: incoming,
            relevanceKey: incomingKey,
            links: [link],
          });
          result.created++;
          result.bySource[integ.id].created++;
        }
      } catch (err) {
        // Bei Netzwerkfehlern (z.B. "fetch failed") steht der eigentliche Grund in err.cause
        const cause = err.cause ? ` (Ursache: ${err.cause.code || ''} ${err.cause.message || err.cause})`.trimEnd() : '';
        const message = `${err.message}${cause}`;
        console.error(`[sync] ${integ.id}: ${message}`);
        result.errors.push({ source: integ.id, message });
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
