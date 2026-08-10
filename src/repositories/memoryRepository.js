class MemoryRepository {
  constructor(db) { this.db = db; }
  upsert(entry) {
    this.db.prepare(`INSERT INTO memory_items
      (id, type, key, content, importance, active, source_event_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(type, key) WHERE key IS NOT NULL DO UPDATE SET content=excluded.content,
        importance=excluded.importance, active=1, source_event_id=excluded.source_event_id,
        updated_at=excluded.updated_at`)
      .run(entry.id, entry.type, entry.key ?? null, entry.content, entry.importance ?? 1,
        entry.sourceEventId ?? null, entry.now, entry.now);
    return this.db.prepare('SELECT * FROM memory_items WHERE type=? AND key=?').get(entry.type, entry.key);
  }
  active(limit = 30, now = new Date().toISOString()) {
    return this.db.prepare(`SELECT * FROM memory_items WHERE active=1
      AND (expires_at IS NULL OR expires_at>?) ORDER BY importance DESC, updated_at DESC LIMIT ?`).all(now, limit);
  }
  latestSummary(userIdHash) {
    return this.db.prepare('SELECT * FROM conversation_summaries WHERE user_id_hash=? ORDER BY to_at DESC LIMIT 1').get(userIdHash) || null;
  }
}
module.exports = { MemoryRepository };
