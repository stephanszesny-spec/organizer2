import { M365MailIntegration } from './m365mail.js';
import { TeamsIntegration } from './teams.js';
import { JiraIntegration } from './jira.js';
import { FreshdeskIntegration } from './freshdesk.js';

// Reihenfolge = Priorität der Quellen (Mail -> Teams -> JIRA -> Freshdesk).
export const integrations = [
  new M365MailIntegration(),
  new TeamsIntegration(),
  new JiraIntegration(),
  new FreshdeskIntegration(),
];

export function getIntegration(id) {
  return integrations.find((i) => i.id === id) || null;
}

export function integrationStatus() {
  return integrations.map((i) => ({
    id: i.id,
    label: i.label,
    configured: i.isConfigured(),
  }));
}
