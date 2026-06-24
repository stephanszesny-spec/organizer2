import { Integration } from './base.js';
import { config } from '../config.js';
import { describeError } from '../util.js';

/**
 * JIRA Cloud via REST API v3 (Basic Auth: E-Mail + API-Token).
 *
 * NUR-LESEND. Diese Integration verwendet ausschliesslich lesende GET-Endpunkte;
 * Anlegen, Bearbeiten oder Loeschen ist bewusst NICHT implementiert.
 *
 * Genutzte Endpunkte (alle GET, read-only):
 *   - GET /rest/api/3/search/jql   Issues per JQL suchen (aktueller Cloud-Endpunkt)
 *       Query: jql, fields, maxResults, nextPageToken
 *       Benoetigte OAuth-Scopes (granular): read:jira-work (lesend)
 *   - GET /rest/api/3/search       veralteter Vorgaenger, nur als Fallback (404/410)
 *
 * Schreibende Endpunkte wie POST /rest/api/3/issue (anlegen),
 * PUT /rest/api/3/issue/{key} (bearbeiten) oder DELETE /rest/api/3/issue/{key}
 * (loeschen) werden hier absichtlich nie aufgerufen. Der zentrale Zugriff laeuft
 * ueber _get(), das ausschliesslich GET sendet und keinen Body zulaesst.
 */
export class JiraIntegration extends Integration {
  constructor() {
    super({ id: 'jira', label: 'JIRA' });
  }

  isConfigured() {
    return config.jira.configured;
  }

  _authHeader() {
    const token = Buffer.from(`${config.jira.email}:${config.jira.apiToken}`).toString('base64');
    return `Basic ${token}`;
  }

  async testConnection() {
    if (!this.isConfigured()) {
      return { ok: false, configured: false, message: 'Nicht konfiguriert (Mock-Modus).' };
    }
    // GET /rest/api/3/myself: leichter, rein lesender Auth-/Verbindungstest.
    try {
      const res = await this._get('/rest/api/3/myself', {});
      if (!res.ok) {
        return { ok: false, configured: true, status: res.status, message: `JIRA-Fehler ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      const me = await res.json();
      return { ok: true, configured: true, message: `OK – angemeldet als ${me.displayName || me.emailAddress || 'unbekannt'}` };
    } catch (err) {
      return { ok: false, configured: true, message: describeError(err) };
    }
  }

  async fetchItems() {
    if (!this.isConfigured()) return MOCK_JIRA;
    const json = await this._search(
      config.jira.jql,
      'summary,description,priority,duedate,updated,status',
    );
    return (json.issues || []).map((issue) => ({
      id: `jira:${issue.key}`,
      source: 'jira',
      type: 'jira',
      subject: `[${issue.key}] ${issue.fields.summary}`,
      from: issue.fields.status?.name || '',
      snippet: extractText(issue.fields.description) || '',
      sentByUser: false,
      needsReply: false,
      receivedAt: issue.fields.updated,
      dueDate: issue.fields.duedate || null,
      webUrl: new URL(`/browse/${issue.key}`, config.jira.baseUrl).toString(),
      // "Betrifft mich"-Signatur: Status/Priorität/Ziel-Datum. Ändert sich z.B.
      // der Status (wieder geöffnet, neue Phase), gilt das als relevante Änderung.
      relevanceKey: [
        `status:${issue.fields.status?.name || ''}`,
        `prio:${issue.fields.priority?.name || ''}`,
        `due:${issue.fields.duedate || ''}`,
      ].join('|'),
    }));
  }

  /**
   * Zentraler, AUSSCHLIESSLICH LESENDER Zugriff. Erzwingt method GET und sendet
   * niemals einen Body – damit sind schreibende Aufrufe strukturell unmoeglich.
   */
  async _get(path, params) {
    const url = new URL(path, config.jira.baseUrl);
    for (const [key, value] of Object.entries(params || {})) {
      url.searchParams.set(key, String(value));
    }
    return fetch(url, {
      method: 'GET', // read-only – bewusst hart kodiert
      headers: { Authorization: this._authHeader(), Accept: 'application/json' },
    });
  }

  /**
   * JIRA-Suche per JQL (lesend). Bevorzugt den aktuellen Cloud-Endpunkt
   * /rest/api/3/search/jql; fällt nur bei "Endpunkt nicht vorhanden" (404/410)
   * auf den alten /rest/api/3/search zurück (z.B. ältere Server/Data-Center).
   */
  async _search(jql, fields) {
    const paths = ['/rest/api/3/search/jql', '/rest/api/3/search'];
    let lastError;
    for (const path of paths) {
      const res = await this._get(path, { jql, fields, maxResults: 50 });
      if (res.ok) return res.json();
      const body = (await res.text()).slice(0, 300);
      lastError = new Error(`JIRA-Fehler ${res.status} (${path}): ${body}`);
      // Nur bei "gibt es nicht" den Alt-Endpunkt versuchen; bei 401/403/400 sofort abbrechen.
      if (res.status !== 404 && res.status !== 410) break;
    }
    throw lastError;
  }
}

/** JIRA-Beschreibungen sind ADF (Atlassian Document Format) – Text extrahieren. */
function extractText(adf) {
  if (!adf) return '';
  if (typeof adf === 'string') return adf;
  let out = '';
  const walk = (node) => {
    if (!node) return;
    if (node.text) out += node.text + ' ';
    (node.content || []).forEach(walk);
  };
  walk(adf);
  return out.trim().slice(0, 500);
}

const MOCK_JIRA = [
  {
    id: 'jira:mock-ORG-42',
    source: 'jira',
    type: 'jira',
    subject: '[ORG-42] API-Anbindung Reporting finalisieren',
    from: 'In Arbeit',
    snippet: 'Letzte offene Punkte: Auth-Flow testen und Doku ergänzen. Review steht aus.',
    sentByUser: false,
    needsReply: false,
    receivedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    dueDate: new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10),
    webUrl: 'https://your-domain.atlassian.net/browse/ORG-42',
    relevanceKey: 'status:In Arbeit|prio:|due:',
  },
];
