class ScheduleRepository {
  constructor(db) { this.db = db; }
  enabledRules() {
    return this.db.prepare('SELECT * FROM schedule_rules WHERE enabled=1 ORDER BY local_time').all()
      .map((row) => ({ ...row, weekdays: row.weekdays_json ? JSON.parse(row.weekdays_json) : null, payload: JSON.parse(row.payload_json) }));
  }
  rules() {
    return this.db.prepare('SELECT * FROM schedule_rules ORDER BY local_time, id').all()
      .map((row) => ({ id: row.id, event_type: row.event_type, local_time: row.local_time, weekdays: row.weekdays_json ? JSON.parse(row.weekdays_json) : null, enabled: Boolean(row.enabled) }));
  }
  get(id) {
    const row = this.db.prepare('SELECT * FROM schedule_rules WHERE id=?').get(id);
    return row ? { ...row, weekdays: row.weekdays_json ? JSON.parse(row.weekdays_json) : null, payload: JSON.parse(row.payload_json) } : null;
  }
  update(id, input, now = new Date().toISOString()) {
    const current = this.get(id);
    if (!current) return null;
    this.db.prepare(`UPDATE schedule_rules SET local_time=?, enabled=?, weekdays_json=?, updated_at=? WHERE id=?`).run(
      input.localTime ?? current.local_time,
      input.enabled === undefined ? current.enabled : Number(input.enabled),
      input.weekdays === undefined ? current.weekdays_json : (input.weekdays ? JSON.stringify(input.weekdays) : null), now, id,
    );
    return this.get(id);
  }
}
module.exports = { ScheduleRepository };
