import { Integration } from './base.js';
import { config } from '../config.js';
import { describeError, parseJsonResponse } from '../util.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';

/**
 * M365 Outlook Mail via Microsoft Graph (App-Only / Client-Credentials).
 * Leitet ab:
 *  - Aufgaben aus erhaltenen Mails
 *  - Reminder aus GESENDETEN Mails ohne Antwort
 *
 * Ohne Credentials -> Mock-Daten (damit der Flow testbar ist).
 */
export class M365MailIntegration extends Integration {
  constructor() {
    super({ id: 'm365mail', label: 'M365 Outlook E-Mail' });
    this._token = null;
    this._tokenExp = 0;
  }

  isConfigured() {
    return config.m365.configured;
  }

  async _getToken() {
    if (this._token && Date.now() < this._tokenExp - 60_000) return this._token;
    const url = `https://login.microsoftonline.com/${config.m365.tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: config.m365.clientId,
      client_secret: config.m365.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`M365 Token-Fehler ${res.status}: ${await res.text()}`);
    const json = await parseJsonResponse(res);
    this._token = json.access_token;
    this._tokenExp = Date.now() + json.expires_in * 1000;
    return this._token;
  }

  async _graph(pathname) {
    const token = await this._getToken();
    const res = await fetch(`${GRAPH}${pathname}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Graph-Fehler ${res.status} (${pathname}): ${await res.text()}`);
    return parseJsonResponse(res);
  }

  async testConnection() {
    if (!this.isConfigured()) {
      return { ok: false, configured: false, message: 'Nicht konfiguriert (Mock-Modus).' };
    }
    try {
      const user = encodeURIComponent(config.m365.user);
      const me = await this._graph(`/users/${user}?$select=id,displayName,mail`);
      return { ok: true, configured: true, message: `OK – Postfach erreichbar: ${me.displayName || me.mail || me.id}` };
    } catch (err) {
      return { ok: false, configured: true, message: describeError(err) };
    }
  }

  async fetchItems() {
    if (!this.isConfigured()) return MOCK_MAIL;
    const user = encodeURIComponent(config.m365.user);
    const items = [];

    // Posteingang (neueste 25)
    const inbox = await this._graph(
      `/users/${user}/mailFolders/inbox/messages?$top=25&$select=id,subject,from,bodyPreview,receivedDateTime,webLink,conversationId&$orderby=receivedDateTime desc`,
    );
    for (const m of inbox.value || []) {
      items.push({
        id: `m365mail:${m.id}`,
        source: 'm365mail',
        type: 'email',
        subject: m.subject || '(kein Betreff)',
        from: m.from?.emailAddress?.address || '',
        snippet: m.bodyPreview || '',
        sentByUser: false,
        needsReply: false,
        receivedAt: m.receivedDateTime,
        webUrl: m.webLink,
      });
    }

    // Gesendet (neueste 25) -> auf fehlende Antwort prüfen
    const sent = await this._graph(
      `/users/${user}/mailFolders/sentitems/messages?$top=25&$select=id,subject,toRecipients,bodyPreview,sentDateTime,webLink,conversationId&$orderby=sentDateTime desc`,
    );
    for (const m of sent.value || []) {
      const needsReply = await this._noReplySince(user, m.conversationId, m.sentDateTime).catch(() => false);
      if (!needsReply) continue;
      items.push({
        id: `m365mail:sent:${m.id}`,
        source: 'm365mail',
        type: 'email',
        subject: m.subject || '(kein Betreff)',
        from: (m.toRecipients || []).map((r) => r.emailAddress?.address).join(', '),
        snippet: m.bodyPreview || '',
        sentByUser: true,
        needsReply: true,
        receivedAt: m.sentDateTime,
        webUrl: m.webLink,
      });
    }
    return items;
  }

  /** Gibt true zurück, wenn in der Konversation seit sentDateTime keine eingehende Mail kam. */
  async _noReplySince(user, conversationId, sentDateTime) {
    if (!conversationId) return false;
    const filter = encodeURIComponent(`conversationId eq '${conversationId}' and receivedDateTime gt ${sentDateTime}`);
    const res = await this._graph(
      `/users/${user}/messages?$filter=${filter}&$top=1&$select=id`,
    );
    return (res.value || []).length === 0;
  }

  async sendMessage({ to, subject, body }) {
    if (!this.isConfigured()) {
      return { ok: false, mock: true, message: 'M365 nicht konfiguriert – Versand simuliert.' };
    }
    const token = await this._getToken();
    const user = encodeURIComponent(config.m365.user);
    const res = await fetch(`${GRAPH}/users/${user}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'Text', content: body },
          toRecipients: (Array.isArray(to) ? to : [to]).filter(Boolean).map((addr) => ({
            emailAddress: { address: addr },
          })),
        },
        saveToSentItems: true,
      }),
    });
    if (!res.ok) throw new Error(`Mail-Versand fehlgeschlagen ${res.status}: ${await res.text()}`);
    return { ok: true };
  }
}

const MOCK_MAIL = [
  {
    id: 'm365mail:mock-1',
    source: 'm365mail',
    type: 'email',
    subject: 'Angebot Q3 – Rückfrage zu Konditionen',
    from: 'kunde@example.com',
    snippet: 'Könnten Sie uns bis Ende der Woche ein angepasstes Angebot mit den besprochenen Rabatten zukommen lassen?',
    sentByUser: false,
    needsReply: false,
    receivedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    webUrl: 'https://outlook.office.com/mail/inbox',
  },
  {
    id: 'm365mail:mock-sent-1',
    source: 'm365mail',
    type: 'email',
    subject: 'Re: Vertragsentwurf zur Prüfung',
    from: 'partner@example.com',
    snippet: 'Anbei der überarbeitete Vertragsentwurf. Bitte um kurze Rückmeldung, ob wir so verbleiben können.',
    sentByUser: true,
    needsReply: true,
    receivedAt: new Date(Date.now() - 9 * 86400000).toISOString(),
    webUrl: 'https://outlook.office.com/mail/sentitems',
  },
];
