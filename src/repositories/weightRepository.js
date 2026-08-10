class WeightRepository {
  constructor(db) { this.db = db; }
  upsert({ logicalDate, weightKg, notes, sourceEventId, recordedAt }) {
    this.db.prepare(`INSERT INTO weight_logs
      (logical_date, weight_kg, recorded_at, notes, source_event_id) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(logical_date) DO UPDATE SET weight_kg=excluded.weight_kg,
        recorded_at=excluded.recorded_at, notes=COALESCE(excluded.notes, weight_logs.notes),
        source_event_id=COALESCE(excluded.source_event_id, weight_logs.source_event_id)`)
      .run(logicalDate, weightKg, recordedAt, notes ?? null, sourceEventId ?? null);
    return this.byDate(logicalDate);
  }
  byDate(logicalDate) { return this.db.prepare('SELECT * FROM weight_logs WHERE logical_date=?').get(logicalDate) || null; }
  recent(limit = 14) { return this.db.prepare('SELECT * FROM weight_logs ORDER BY logical_date DESC LIMIT ?').all(limit); }
  latest() { return this.db.prepare('SELECT * FROM weight_logs ORDER BY logical_date DESC LIMIT 1').get() || null; }
}
module.exports = { WeightRepository };
