/**
 * Einheitliches Source-Item-Format, das alle Integrationen liefern.
 * Daraus leitet der Sync (via LLM) Todos/Reminder ab.
 *
 * @typedef {Object} SourceItem
 * @property {string} id        - Stabile, eindeutige ID (für Deduplizierung)
 * @property {string} source    - 'm365mail' | 'teams' | 'jira' | 'freshdesk'
 * @property {string} type      - 'email' | 'teams' | 'jira' | 'freshdesk'
 * @property {string} subject   - Betreff / Titel
 * @property {string} [from]    - Absender / Ersteller
 * @property {string} [snippet] - Kurzer Inhaltsauszug für das LLM
 * @property {boolean} [sentByUser] - true, wenn vom Nutzer gesendet
 * @property {boolean} [needsReply] - true, wenn (noch) keine Antwort vorliegt
 * @property {string} [receivedAt]  - ISO-Zeitstempel
 * @property {string} [webUrl]  - Link zum Öffnen des Originals
 */

/**
 * Basisklasse für Integrationen. Jede konkrete Integration implementiert
 * fetchItems() und (optional) sendMessage().
 */
export class Integration {
  constructor(meta) {
    this.id = meta.id;
    this.label = meta.label;
  }

  /** @returns {boolean} ob echte Credentials hinterlegt sind */
  isConfigured() {
    return false;
  }

  /** @returns {Promise<SourceItem[]>} */
  async fetchItems() {
    return [];
  }

  /** Optional: Nachricht/Mail versenden. */
  async sendMessage(/* { to, subject, body } */) {
    throw new Error(`${this.label}: Versand nicht unterstützt`);
  }
}
