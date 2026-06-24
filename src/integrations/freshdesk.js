import { Integration } from './base.js';
import { config } from '../config.js';
import { describeError } from '../util.js';

/**
 * Freshdesk via REST API v2 (Basic Auth: API-Key als Username, "X" als Passwort).
 * Holt die dem Agenten zugewiesenen, offenen Tickets.
 */
export class FreshdeskIntegration extends Integration {
  constructor() {
    super({ id: 'freshdesk', label: 'Freshdesk' });
  }

  isConfigured() {
    return config.freshdesk.configured;
  }

  _authHeader() {
    const token = Buffer.from(`${config.freshdesk.apiKey}:X`).toString('base64');
    return `Basic ${token}`;
  }

  async testConnection() {
    if (!this.isConfigured()) {
      return { ok: false, configured: false, message: 'Nicht konfiguriert (Mock-Modus).' };
    }
    // GET /api/v2/agents/me: rein lesender Auth-/Verbindungstest.
    try {
      const base = `https://${config.freshdesk.domain}.freshdesk.com`;
      const res = await fetch(`${base}/api/v2/agents/me`, {
        headers: { Authorization: this._authHeader(), 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        return { ok: false, configured: true, status: res.status, message: `Freshdesk-Fehler ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      const me = await res.json();
      return { ok: true, configured: true, message: `OK – Agent: ${me.contact?.name || me.contact?.email || me.id}` };
    } catch (err) {
      return { ok: false, configured: true, message: describeError(err) };
    }
  }

  async fetchItems() {
    if (!this.isConfigured()) return MOCK_FRESHDESK;
    const base = `https://${config.freshdesk.domain}.freshdesk.com`;
    // "me" = der zur API-Key gehörende Agent; Status < 4 = nicht resolved/closed.
    const url = `${base}/api/v2/tickets?filter=new_and_my_open&per_page=50`;
    const res = await fetch(url, {
      headers: { Authorization: this._authHeader(), 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`Freshdesk-Fehler ${res.status}: ${await res.text()}`);
    const tickets = await res.json();
    return (tickets || []).map((t) => ({
      id: `freshdesk:${t.id}`,
      source: 'freshdesk',
      type: 'freshdesk',
      subject: `#${t.id} ${t.subject}`,
      from: t.requester_id ? `Requester ${t.requester_id}` : '',
      snippet: (t.description_text || '').slice(0, 500),
      sentByUser: false,
      needsReply: t.status === 2 || t.status === 3, // open / pending
      receivedAt: t.updated_at,
      dueDate: t.due_by ? t.due_by.slice(0, 10) : null,
      webUrl: `${base}/a/tickets/${t.id}`,
    }));
  }
}

const MOCK_FRESHDESK = [
  {
    id: 'freshdesk:mock-1051',
    source: 'freshdesk',
    type: 'freshdesk',
    subject: '#1051 Login funktioniert nicht nach Update',
    from: 'Requester 88',
    snippet: 'Kunde meldet, dass der Login seit dem letzten Update fehlschlägt. Priorität hoch, SLA läuft.',
    sentByUser: false,
    needsReply: true,
    receivedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    dueDate: new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10),
    webUrl: 'https://your-domain.freshdesk.com/a/tickets/1051',
  },
];
