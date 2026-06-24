import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

let client = null;
function getClient() {
  if (!config.llm.enabled) return null;
  if (!client) client = new Anthropic({ apiKey: config.llm.apiKey });
  return client;
}

/** Robustes Extrahieren des ersten JSON-Blocks aus einer Modellantwort. */
function parseJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Keine JSON-Struktur in LLM-Antwort gefunden');
  return JSON.parse(candidate.slice(start, end + 1));
}

const EXTRACT_SYSTEM = `Du bist ein Assistent, der Arbeits-Items (E-Mails, Teams-Nachrichten, JIRA-Tickets, Freshdesk-Tickets) analysiert und daraus konkrete Aufgaben (Todos) und Reminder für den Nutzer ableitet.

Regeln:
- Leite nur dann eine Aufgabe ab, wenn für den Nutzer wirklich eine Handlung nötig ist.
- Kategorien: "strategic" (strategisch), "operative" (operativ), "sales" (Salesprozesse), "reminder".
- WICHTIG – "reminder" gilt für Vorgänge, bei denen der Nutzer auf INPUT von
  EXTERNEN/anderen Personen WARTET und ggf. nachfassen (einen Reminder senden)
  muss. Das umfasst u.a.:
    * an andere DELEGIERTE Aufgaben, deren Erledigung noch aussteht,
    * vom Nutzer GESTELLTE Fragen/Anfragen, auf die noch keine Antwort vorliegt,
    * jede vom Nutzer GESENDETE Nachricht ohne Antwort
      ("sentByUser": true UND "needsReply": true).
  Kurz: Der Ball liegt bei jemand anderem, der Nutzer wartet.
- KEIN "reminder" für Aufgaben, die der Nutzer SELBST erledigen muss (der Ball
  liegt beim Nutzer) – diese gehören in "strategic", "operative" oder "sales".
- Priorität: "high", "medium" oder "low".
- "dueDate" nur als ISO-Datum (YYYY-MM-DD), wenn ein Termin erkennbar ist, sonst null.
- "title" ist eine kurze, handlungsorientierte Beschreibung (max. ~80 Zeichen).
- "notes" enthält knappen Kontext (1-3 Sätze).
- "customer": Name des Kunden/der Firma, falls erkennbar, sonst "".
- Antworte AUSSCHLIESSLICH mit JSON, keine Erklärungen.`;

/**
 * Leitet aus einer Liste von Source-Items Todos ab.
 * items: [{ id, source, type, subject, from, snippet, sentByUser, needsReply, receivedAt, webUrl }]
 * Rückgabe: [{ sourceItemId, category, title, priority, dueDate, notes, isReminder }]
 */
export async function deriveTasks(items) {
  if (!items.length) return [];
  const c = getClient();
  if (!c) return heuristicDerive(items);

  const userContent = `Analysiere die folgenden Items und gib pro relevantes Item höchstens eine Aufgabe zurück.

Items (JSON):
${JSON.stringify(items, null, 2)}

Antworte mit JSON in genau dieser Form:
{
  "tasks": [
    {
      "sourceItemId": "<id des items>",
      "category": "strategic|operative|sales|reminder",
      "title": "...",
      "priority": "high|medium|low",
      "dueDate": "YYYY-MM-DD oder null",
      "notes": "...",
      "customer": "Kundenname oder leerer String"
    }
  ]
}`;

  const msg = await c.messages.create({
    model: config.llm.model,
    max_tokens: 2000,
    system: EXTRACT_SYSTEM,
    messages: [{ role: 'user', content: userContent }],
  });
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const parsed = parseJson(text);
  return Array.isArray(parsed.tasks) ? parsed.tasks : [];
}

/**
 * Generiert einen E-Mail-/Nachrichten-Entwurf auf Basis eines Todos und
 * (optional) der verknüpften Quell-Items.
 */
export async function draftMessage({ todo, links, channel = 'email', instructions = '' }) {
  const c = getClient();
  if (!c) {
    return {
      subject: `Re: ${todo.title}`,
      body:
        `Hallo,\n\n[Entwurf – LLM nicht konfiguriert]\n\nKurz zum Thema "${todo.title}": ` +
        `${todo.notes || ''}\n\nViele Grüße`,
      generatedBy: 'fallback',
    };
  }

  const system = `Du formulierst professionelle, freundliche und prägnante ${
    channel === 'teams' ? 'Teams-Nachrichten' : 'E-Mails'
  } auf Deutsch im Namen des Nutzers. Antworte als JSON: { "subject": "...", "body": "..." }. Bei Teams kann "subject" leer sein.`;

  const content = `Erstelle einen Entwurf zu folgender Aufgabe.
Aufgabe: ${todo.title}
Notizen: ${todo.notes || '-'}
Kanal: ${channel}
Zusätzliche Anweisung des Nutzers: ${instructions || '-'}
Verknüpfte Vorgänge: ${JSON.stringify((links || []).map((l) => ({ subject: l.subject, from: l.from, snippet: l.snippet })), null, 2)}`;

  const msg = await c.messages.create({
    model: config.llm.draftModel,
    max_tokens: 1200,
    system,
    messages: [{ role: 'user', content }],
  });
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const parsed = parseJson(text);
  return { subject: parsed.subject || '', body: parsed.body || '', generatedBy: config.llm.draftModel };
}

const SEARCH_SYSTEM = `Du bist eine semantische Suchfunktion für eine Todo-App.
Du erhältst eine Suchanfrage und eine Liste von Todos.
Gib die IDs der relevanten Todos zurück, nach Relevanz sortiert (relevanteste zuerst).
Berücksichtige Bedeutung, Synonyme, verwandte Begriffe und Kontext – nicht nur exakte Wortübereinstimmungen.
Gib nur wirklich passende Todos zurück. Antworte AUSSCHLIESSLICH mit JSON: { "ids": ["..."] }.`;

/**
 * LLM-gestützte semantische Suche. Liefert relevante Todo-IDs nach Relevanz.
 * Ohne API-Key: null (Aufrufer nutzt dann die Text-Suche).
 */
export async function searchTodos(query, todos) {
  const c = getClient();
  if (!c) return null;

  const compact = todos.map((t) => ({
    id: t.id,
    title: t.title,
    notes: (t.notes || '').slice(0, 300),
    customer: t.customer || '',
    category: t.category,
    comments: (t.comments || []).map((c) => c.text),
    links: (t.links || []).map((l) => l.subject).filter(Boolean),
  }));

  const msg = await c.messages.create({
    model: config.llm.model,
    max_tokens: 1000,
    system: SEARCH_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Suchanfrage: "${query}"\n\nTodos (JSON):\n${JSON.stringify(compact)}\n\nAntworte mit { "ids": [...] }.`,
      },
    ],
  });
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const parsed = parseJson(text);
  return Array.isArray(parsed.ids) ? parsed.ids : [];
}

/**
 * Heuristischer Fallback ohne API-Key, damit der Sync-Flow auch ohne
 * Anthropic-Key sinnvolle (wenn auch simple) Ergebnisse liefert.
 */
function heuristicDerive(items) {
  return items.map((it) => {
    // Reminder, wenn der Nutzer auf externen Input wartet: selbst gesendet
    // (delegiert oder Frage gestellt) und noch keine Antwort erhalten.
    const isReminder = Boolean(it.sentByUser && it.needsReply);
    return {
      sourceItemId: it.id,
      category: isReminder ? 'reminder' : 'operative',
      title: isReminder ? `Nachfassen: ${it.subject}` : it.subject,
      priority: /dringend|asap|urgent|wichtig/i.test(`${it.subject} ${it.snippet || ''}`) ? 'high' : 'medium',
      dueDate: null,
      notes: it.snippet || '',
      customer: '',
    };
  });
}
