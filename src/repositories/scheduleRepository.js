class ScheduleRepository {
  constructor(db) { this.db = db; }
  enabledRules() {
    return this.db.prepare('SELECT * FROM schedule_rules WHERE enabled=1 ORDER BY local_time').all()
      .map((row) => ({ ...row, weekdays: row.weekdays_json ? JSON.parse(row.weekdays_json) : null, payload: JSON.parse(row.payload_json) }));
  }
}
module.exports = { ScheduleRepository };
