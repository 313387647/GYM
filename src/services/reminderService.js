const { stableId } = require('../utils/id');

class ReminderService {
  constructor({ reminderRepository }) { this.repository = reminderRepository; }
  recover(now = new Date()) {
    const cutoff = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    return this.repository.recoverStale(cutoff, now.toISOString());
  }
  claimDue(now = new Date(), limit = 20) {
    const claimed = [];
    for (const reminder of this.repository.due(now.toISOString(), limit)) {
      if (this.repository.claim(reminder.id, now.toISOString())) claimed.push(reminder);
    }
    return claimed;
  }
  applyDecision(reminder, notification, now = new Date()) {
    const current = now.toISOString();
    const action = notification?.action || 'skip';
    if (action === 'send') this.repository.transition(reminder.id, 'sent', { now: current, reason: notification.reason });
    else if (['skip', 'cancel', 'complete'].includes(action)) {
      const status = action === 'skip' ? 'skipped' : action === 'cancel' ? 'cancelled' : 'completed';
      this.repository.transition(reminder.id, status, { now: current, reason: notification.reason });
    } else {
      const requested = notification.scheduled_at ? new Date(notification.scheduled_at) : null;
      const maximum = now.getTime() + 7 * 24 * 60 * 60 * 1000;
      const scheduledAt = !requested || Number.isNaN(requested.getTime()) || requested.getTime() <= now.getTime() || requested.getTime() > maximum
        ? new Date(now.getTime() + 30 * 60 * 1000).toISOString() : requested.toISOString();
      this.repository.transition(reminder.id, action === 'snooze' ? 'snoozed' : 'rescheduled', { now: current, reason: notification.reason });
      const replacement = this.repository.create({
        id: stableId('rem', reminder.id, action, scheduledAt), ruleId: reminder.rule_id,
        eventType: reminder.event_type, scheduledAt, payload: reminder.payload,
        reason: `${action}:${reminder.id}`, now: current,
      });
      return { action, replacement };
    }
    return { action };
  }
  retry(reminder, errorCode, now = new Date()) {
    const retryCount = Number(reminder.retry_count || 0);
    if (retryCount >= 3) {
      this.repository.transition(reminder.id, 'failed', { now: now.toISOString(), reason: `max_retries:${errorCode}` });
      return { action: 'failed', exhausted: true };
    }
    const delayMs = Math.min(60 * 60 * 1000, 5 * 60 * 1000 * (2 ** retryCount));
    const scheduledAt = new Date(now.getTime() + delayMs).toISOString();
    const retried = this.repository.retry(reminder.id, { scheduledAt, reason: `retry:${errorCode}`, now: now.toISOString() });
    return { action: retried ? 'retry' : 'failed', scheduled_at: scheduledAt };
  }
}
module.exports = { ReminderService };
