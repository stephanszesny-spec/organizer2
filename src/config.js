import 'dotenv/config';
import path from 'node:path';

const num = (v, def) => (v === undefined || v === '' ? def : Number(v));

export const config = {
  port: num(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  dataFile: path.resolve(process.env.DATA_FILE || './data/data.json'),

  llm: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.LLM_MODEL || 'claude-sonnet-4-6',
    draftModel: process.env.LLM_DRAFT_MODEL || process.env.LLM_MODEL || 'claude-sonnet-4-6',
    get enabled() {
      return Boolean(process.env.ANTHROPIC_API_KEY);
    },
  },

  m365: {
    tenantId: process.env.M365_TENANT_ID || '',
    clientId: process.env.M365_CLIENT_ID || '',
    clientSecret: process.env.M365_CLIENT_SECRET || '',
    user: process.env.M365_USER || '',
    get configured() {
      return Boolean(
        process.env.M365_TENANT_ID && process.env.M365_CLIENT_ID && process.env.M365_CLIENT_SECRET && process.env.M365_USER,
      );
    },
  },

  jira: {
    baseUrl: process.env.JIRA_BASE_URL || '',
    email: process.env.JIRA_EMAIL || '',
    apiToken: process.env.JIRA_API_TOKEN || '',
    jql: process.env.JIRA_JQL || 'assignee = currentUser() AND statusCategory != Done',
    get configured() {
      return Boolean(process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN);
    },
  },

  freshdesk: {
    domain: process.env.FRESHDESK_DOMAIN || '',
    apiKey: process.env.FRESHDESK_API_KEY || '',
    get configured() {
      return Boolean(process.env.FRESHDESK_DOMAIN && process.env.FRESHDESK_API_KEY);
    },
  },

  syncIntervalMinutes: num(process.env.SYNC_INTERVAL_MINUTES, 0),
};

export const CATEGORIES = ['strategic', 'operative', 'sales', 'reminder'];
export const DEFAULT_REMINDER_INTERVAL_DAYS = 7;

// Konfigurierbare Felder pro Lane: 'off' | 'optional' | 'required'
export const LANE_FIELDS = ['dueDate', 'customer', 'reminder'];

// Standard-Lanes (Erstinitialisierung). Danach frei bearbeit-/erweiterbar.
export const DEFAULT_LANES = [
  { id: 'strategic', label: 'Strategische Todos', order: 0, fields: { dueDate: 'optional', customer: 'optional', reminder: 'optional' } },
  { id: 'operative', label: 'Operative Todos', order: 1, fields: { dueDate: 'optional', customer: 'optional', reminder: 'optional' } },
  { id: 'sales', label: 'Salesprozesse', order: 2, fields: { dueDate: 'optional', customer: 'optional', reminder: 'optional' } },
  { id: 'reminder', label: 'Reminder', order: 3, fields: { dueDate: 'optional', customer: 'optional', reminder: 'required' } },
];
