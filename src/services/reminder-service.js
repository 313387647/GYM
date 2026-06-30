const { withDb } = require('../db/db');
const { loadConfig } = require('../utils/config');
const { logReminder } = require('../utils/logger');
const { renderPersona } = require('../persona/persona-renderer');
const { getTodayWorkout, getWorkoutCard } = require('./training-service');
const { getDailySummary } = require('./summary-service');

function hasReminderSent(eventType, date) {
  return withDb(db => Boolean(db.prepare(
    'SELECT id FROM reminder_logs WHERE event_type = ? AND logical_date = ? AND status = ?'
  ).get(eventType, date, 'sent')));
}

function markReminderSent(eventType, date, message, status = 'sent') {
  const config = loadConfig();
  const scheduledAt = config.schedule[eventType] || (config.schedule.weekly_summary || {}).time || null;
  return withDb(db => db.prepare(`
    INSERT INTO reminder_logs(event_type, logical_date, scheduled_at, sent_at, status, message)
    VALUES (?, ?, ?, datetime('now', 'localtime'), ?, ?)
    ON CONFLICT(event_type, logical_date) DO UPDATE SET
      sent_at = excluded.sent_at,
      status = excluded.status,
      message = excluded.message
  `).run(eventType, date, scheduledAt, status, message));
}

function buildReminderMessage(eventType, date, options = {}) {
  if ((eventType === 'pre_workout' || eventType === 'training_card') && !getTodayWorkout(date).workoutType && !options.force) {
    return null;
  }
  if (eventType === 'training_card') {
    return renderPersona({ scene: 'training_card', facts: { card: getWorkoutCard(date, { fallbackNext: options.force }) } });
  }
  if (eventType === 'evening_summary') {
    return renderPersona({ scene: 'evening_summary', facts: { summary: getDailySummary(date).message } });
  }
  return renderPersona({ scene: eventType });
}

function sendReminder(eventType, date, options = {}) {
  if (!options.force && hasReminderSent(eventType, date)) {
    const message = `今天的 ${eventType} 已经发过啦，不重复轰炸你。`;
    logReminder('duplicate reminder skipped', { eventType, date });
    return { skipped: true, message };
  }
  const message = buildReminderMessage(eventType, date, options);
  if (!message) {
    logReminder('training reminder skipped on rest day', { eventType, date });
    return { skipped: true, message: '今天不是训练日，训练提醒已跳过。' };
  }
  markReminderSent(eventType, date, message);
  logReminder('reminder generated', { eventType, date, message });
  return { skipped: false, message };
}

module.exports = { sendReminder, hasReminderSent, markReminderSent, buildReminderMessage };
