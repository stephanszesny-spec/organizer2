import { Integration } from './base.js';
import { config } from '../config.js';

/**
 * JIRA Cloud via REST API v3 (Basic Auth: E-Mail + API-Token).
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
    }));
  }

  /**
   * JIRA-Suche. Bevorzugt den aktuellen Cloud-Endpunkt /rest/api/3/search/jql;
   * fällt nur bei "Endpunkt nicht vorhanden" (404/410) auf den alten
   * /rest/api/3/search zurück (z.B. ältere Server/Data-Center-Instanzen).
   */
  async _search(jql, fields) {
    const paths = ['/rest/api/3/search/jql', '/rest/api/3/search'];
    let lastError;
    for (const path of paths) {
      const url = new URL(path, config.jira.baseUrl);
      url.searchParams.set('jql', jql);
      url.searchParams.set('maxResults', '50');
      url.searchParams.set('fields', fields);
      const res = await fetch(url, {
        headers: { Authorization: this._authHeader(), Accept: 'application/json' },
      });
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
  },
];
