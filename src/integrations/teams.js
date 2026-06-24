import { Integration } from './base.js';
import { config } from '../config.js';
import { describeError } from '../util.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';

/**
 * M365 Teams Nachrichten via Microsoft Graph.
 * Hinweis: Das Auslesen aller Chat-Nachrichten erfordert delegierte
 * Berechtigungen oder die kostenpflichtige "ChannelMessage/Chat" Graph-API
 * (Protected APIs). Hier als Gerüst implementiert + Mock-Daten.
 */
export class TeamsIntegration extends Integration {
  constructor() {
    super({ id: 'teams', label: 'M365 Teams' });
  }

  isConfigured() {
    return config.m365.configured;
  }

  async testConnection() {
    if (!this.isConfigured()) {
      return { ok: false, configured: false, message: 'Nicht konfiguriert (Mock-Modus).' };
    }
    // Teams nutzt dieselbe M365-App-Registrierung. Wir prüfen die Token-Beschaffung.
    try {
      const res = await fetch(`https://login.microsoftonline.com/${config.m365.tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.m365.clientId,
          client_secret: config.m365.clientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }),
      });
      if (!res.ok) {
        return { ok: false, configured: true, message: `M365 Token-Fehler ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      return {
        ok: true,
        configured: true,
        message: 'OK – M365-Token erhalten. Hinweis: Auslesen von Teams-Nachrichten ist noch ein Gerüst (zusätzliche Graph-Berechtigungen nötig).',
      };
    } catch (err) {
      return { ok: false, configured: true, message: describeError(err) };
    }
  }

  async fetchItems() {
    if (!this.isConfigured()) return MOCK_TEAMS;
    // TODO: echte Graph-Abfrage von /chats/{id}/messages bzw. /me/chats.
    // Erfordert zusätzliche Graph-Lizenzierung/Berechtigungen.
    return MOCK_TEAMS;
  }

  async sendMessage({ to, body }) {
    if (!this.isConfigured()) {
      return { ok: false, mock: true, message: 'Teams nicht konfiguriert – Versand simuliert.' };
    }
    // TODO: POST /chats/{chatId}/messages
    throw new Error('Teams-Versand: Gerüst – bitte chatId-Auflösung ergänzen.');
  }
}

const MOCK_TEAMS = [
  {
    id: 'teams:mock-1',
    source: 'teams',
    type: 'teams',
    subject: 'Projekt Phoenix: Status bis Freitag?',
    from: 'Anna Müller',
    snippet: 'Hey, kannst du mir bis Freitag den aktuellen Stand zu Projekt Phoenix geben? Lead-Termin steht an.',
    sentByUser: false,
    needsReply: false,
    receivedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    webUrl: 'https://teams.microsoft.com/',
  },
];
