class EventRepository {
  constructor(db) { this.db = db; }
  create(event, userIdHash) {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT OR IGNORE INTO events
      (id, type, user_id_hash, occurred_at, payload_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`)
      .run(event.id, event.type, userIdHash, event.timestamp, JSON.stringify(event.payload), now, now);
    return this.get(event.id);
  }
  get(id) {
    const row = this.db.prepare('SELECT * FROM events WHERE id=?').get(id);
    if (!row) return null;
    return { ...row, payload: JSON.parse(row.payload_json), decision: row.decision_json ? JSON.parse(row.decision_json) : null, result: row.result_json ? JSON.parse(row.result_json) : null };
  }
  mark(id, status, fields = {}) {
    this.db.prepare(`UPDATE events SET status=?, decision_json=COALESCE(?, decision_json),
      result_json=COALESCE(?, result_json), error_code=COALESCE(?, error_code), updated_at=? WHERE id=?`)
      .run(status, fields.decision ? JSON.stringify(fields.decision) : null,
        fields.result ? JSON.stringify(fields.result) : null, fields.errorCode ?? null,
        new Date().toISOString(), id);
  }
  saveDecision(id, decision) {
    this.db.prepare(`UPDATE events SET decision_json=?, status='processing', error_code=NULL, updated_at=? WHERE id=?`)
      .run(JSON.stringify(decision), new Date().toISOString(), id);
    return this.get(id);
  }
  createOutbound({ id, eventId, userIdHash, content, now }) {
    this.db.prepare(`INSERT OR IGNORE INTO outbound_messages
      (id, event_id, user_id_hash, content, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)`)
      .run(id, eventId, userIdHash, content, now);
  }
  outbound(id) { return this.db.prepare('SELECT * FROM outbound_messages WHERE id=?').get(id) || null; }
  pendingOutbounds({ now = new Date(), limit = 20, maxRetries = 3, retryBaseMs = 30000 } = {}) {
    const rows = this.db.prepare("SELECT * FROM outbound_messages WHERE status='pending' AND retry_count<? ORDER BY created_at LIMIT ?").all(maxRetries, limit);
    return rows.filter((row) => !row.last_attempt_at || now.getTime() - new Date(row.last_attempt_at).getTime() >= retryBaseMs * (2 ** Math.max(0, row.retry_count - 1)));
  }
  recoverStaleOutbounds(cutoff, now = new Date().toISOString(), maxRetries = 3) {
    const failed = this.db.prepare(`UPDATE outbound_messages SET status='failed', error_code='stale_queue_max_retries', last_attempt_at=?
      WHERE status='queued' AND last_attempt_at<? AND retry_count>=?`).run(now, cutoff, maxRetries).changes;
    const recovered = this.db.prepare(`UPDATE outbound_messages SET status='pending', error_code='stale_queue_recovered'
      WHERE status='queued' AND last_attempt_at<? AND retry_count<?`).run(cutoff, maxRetries).changes;
    return { recovered, failed };
  }
  markOutboundQueued(id, now = new Date().toISOString()) {
    this.db.prepare("UPDATE outbound_messages SET status='queued', retry_count=retry_count+1, last_attempt_at=?, error_code=NULL WHERE id=? AND status='pending'").run(now, id);
  }
  markOutboundAttemptFailed(id, errorCode, now = new Date().toISOString(), maxRetries = 3) {
    this.db.prepare(`UPDATE outbound_messages SET retry_count=retry_count+1, last_attempt_at=?, error_code=?,
      status=CASE WHEN retry_count+1>=? THEN 'failed' ELSE 'pending' END WHERE id=? AND status='pending'`).run(now, errorCode, maxRetries, id);
  }
  markOutboundDelivered(id) {
    this.db.prepare("UPDATE outbound_messages SET status='delivered', delivered_at=? WHERE id=?")
      .run(new Date().toISOString(), id);
  }
}
module.exports = { EventRepository };
