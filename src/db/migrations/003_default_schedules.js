const DEFAULTS = [
  ['morning-check', 'morning_check', '07:00', null],
  ['meal-window', 'meal_window', '12:00', null],
  ['pre-workout', 'pre_workout', '17:00', null],
  ['workout-window', 'workout_window', '18:00', null],
  ['evening-review', 'evening_review', '22:00', null],
  ['weekly-review', 'weekly_review', '10:00', ['sunday']],
];

module.exports = {
  version: 3,
  name: 'default_schedule_rules',
  up(db) {
    const now = new Date().toISOString();
    const insert = db.prepare(`INSERT OR IGNORE INTO schedule_rules
      (id, event_type, local_time, weekdays_json, enabled, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, '{}', ?, ?)`);
    for (const [id, type, time, weekdays] of DEFAULTS) {
      insert.run(id, type, time, weekdays ? JSON.stringify(weekdays) : null, now, now);
    }
  },
};
