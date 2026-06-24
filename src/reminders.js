import { DEFAULT_REMINDER_INTERVAL_DAYS } from './config.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Liefert den Reminder-Status eines Todos.
 * "due" = es ist Zeit, erneut einen Reminder zu versenden.
 */
export function reminderStatus(todo, ref = new Date()) {
  if (todo.category !== 'reminder') return null;

  const intervalDays = Number(todo.reminderIntervalDays) || DEFAULT_REMINDER_INTERVAL_DAYS;
  // Basis: letzter gesendeter Reminder, sonst Erstellzeit.
  const base = new Date(todo.lastReminderSentAt || todo.createdAt);
  const nextDue = new Date(base.getTime() + intervalDays * DAY_MS);
  const daysUntil = Math.round((nextDue - ref) / DAY_MS);

  return {
    intervalDays,
    lastSentAt: todo.lastReminderSentAt || null,
    nextDue: nextDue.toISOString(),
    daysUntil, // <0 = überfällig
    due: nextDue <= ref,
  };
}

export function dueReminders(todos, ref = new Date()) {
  return todos
    .filter((t) => t.category === 'reminder' && !t.done)
    .map((t) => ({ todo: t, status: reminderStatus(t, ref) }))
    .filter((x) => x.status?.due);
}
