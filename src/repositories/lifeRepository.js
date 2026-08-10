class LifeRepository {
  constructor(db) { this.db = db; }

  upsertSleep(entry) {
    this.db.prepare(`INSERT INTO sleep_logs
      (logical_date, hours, quality, bedtime, wake_time, notes, source_event_id, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(logical_date) DO UPDATE SET hours=excluded.hours, quality=excluded.quality,
        bedtime=excluded.bedtime, wake_time=excluded.wake_time, notes=excluded.notes,
        source_event_id=excluded.source_event_id, recorded_at=excluded.recorded_at`)
      .run(entry.logicalDate, entry.hours, entry.quality ?? null, entry.bedtime ?? null,
        entry.wakeTime ?? null, entry.notes ?? null, entry.sourceEventId ?? null, entry.recordedAt);
    return this.db.prepare('SELECT * FROM sleep_logs WHERE logical_date=?').get(entry.logicalDate);
  }

  insertCheckin(entry) {
    const result = this.db.prepare(`INSERT INTO checkins
      (logical_date, energy, mood, workload, soreness, training_readiness, notes, source_event_id, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`    ).run(entry.logicalDate, entry.energy ?? null, entry.mood ?? null,
      entry.workload ?? null, entry.soreness ?? null, entry.trainingReadiness ?? null,
      entry.notes ?? null, entry.sourceEventId ?? null, entry.recordedAt);
    return this.db.prepare('SELECT * FROM checkins WHERE id=?').get(Number(result.lastInsertRowid));
  }

  latestCheckin(logicalDate) {
    return this.db.prepare('SELECT * FROM checkins WHERE logical_date=? ORDER BY recorded_at DESC, id DESC LIMIT 1').get(logicalDate) || null;
  }
  sleepForDate(logicalDate) { return this.db.prepare('SELECT * FROM sleep_logs WHERE logical_date=?').get(logicalDate) || null; }
  activeTemporaryEvents(logicalDate) {
    return this.db.prepare("SELECT * FROM temporary_events WHERE logical_date=? AND status='active' ORDER BY starts_at, created_at").all(logicalDate);
  }
  upsertTemporaryEvent(entry) {
    this.db.prepare(`INSERT INTO temporary_events
      (id, logical_date, event_type, description, starts_at, ends_at, status, source_event_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET description=excluded.description, starts_at=excluded.starts_at,
        ends_at=excluded.ends_at, status='active', updated_at=excluded.updated_at`)
      .run(entry.id, entry.logicalDate, entry.eventType, entry.description, entry.startsAt ?? null,
        entry.endsAt ?? null, entry.sourceEventId ?? null, entry.now, entry.now);
    return this.db.prepare('SELECT * FROM temporary_events WHERE id=?').get(entry.id);
  }
}
module.exports = { LifeRepository };
