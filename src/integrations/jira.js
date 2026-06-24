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
    const url = new URL('/rest/api/3/search', config.jira.baseUrl);
    url.searchParams.set('jql', config.jira.jql);
    url.searchParams.set('maxResults', '50');
    url.searchParams.set('fields', 'summary,description,priority,duedate,updated,status');
    const res = await fetch(url, {
      headers: { Authorization: this._authHeader(), Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`JIRA-Fehler ${res.status}: ${await res.text()}`);
    const json = await res.json();
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
