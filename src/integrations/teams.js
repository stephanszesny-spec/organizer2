import { Integration } from './base.js';
import { config } from '../config.js';

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
