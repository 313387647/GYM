class ReminderRepository {
  constructor(db) { this.db = db; }
  create(reminder) {
    this.db.prepare(`INSERT OR IGNORE INTO reminders
      (id, rule_id, event_type, scheduled_at, status, payload_json, reason, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`)
      .run(reminder.id, reminder.ruleId ?? null, reminder.eventType, reminder.scheduledAt,
        JSON.stringify(reminder.payload || {}), reminder.reason ?? null, reminder.now, reminder.now);
    return this.get(reminder.id);
  }
  get(id) {
    const row = this.db.prepare('SELECT * FROM reminders WHERE id=?').get(id);
    return row ? { ...row, payload: JSON.parse(row.payload_json) } : null;
  }
  due(now, limit = 20) {
    return this.db.prepare(`SELECT * FROM reminders WHERE status='pending' AND scheduled_at<=?
      ORDER BY scheduled_at LIMIT ?`).all(now, limit).map((row) => ({ ...row, payload: JSON.parse(row.payload_json) }));
  }
  claim(id, now) {
    const result = this.db.prepare(`UPDATE reminders SET status='processing', updated_at=?
      WHERE id=? AND status='pending'`).run(now, id);
    return result.changes === 1;
  }
  transition(id, status, options = {}) {
    const sentAt = status === 'sent' ? options.now : null;
    const completedAt = ['skipped', 'cancelled', 'completed'].includes(status) ? options.now : null;
    this.db.prepare(`UPDATE reminders SET status=?, scheduled_at=COALESCE(?, scheduled_at),
      reason=COALESCE(?, reason), sent_at=COALESCE(?, sent_at),
      completed_at=COALESCE(?, completed_at), updated_at=? WHERE id=?`)
      .run(status, options.scheduledAt ?? null, options.reason ?? null, sentAt, completedAt, options.now, id);
  }
  retry(id, { scheduledAt, reason, now }) {
    return this.db.prepare(`UPDATE reminders SET status='pending', scheduled_at=?, reason=?, retry_count=retry_count+1,
      last_attempt_at=?, updated_at=? WHERE id=? AND status='processing' AND retry_count<3`)
      .run(scheduledAt, reason, now, now, id).changes === 1;
  }
  recentForType(eventType, since) {
    return this.db.prepare(`SELECT * FROM reminders WHERE event_type=? AND scheduled_at>=?
      ORDER BY scheduled_at DESC LIMIT 10`).all(eventType, since);
  }
  recoverStale(cutoff, now) {
    return this.db.prepare(`UPDATE reminders SET status='pending', reason='recovered_after_restart', updated_at=?
      WHERE status='processing' AND updated_at<?`).run(now, cutoff).changes;
  }
}
module.exports = { ReminderRepository };
