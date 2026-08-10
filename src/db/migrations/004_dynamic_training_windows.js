module.exports = {
  version: 4,
  name: 'dynamic_training_windows',
  up(db) {
    const now = new Date().toISOString();
    db.prepare(`UPDATE schedule_rules SET weekdays_json=NULL, updated_at=?
      WHERE id IN ('pre-workout','workout-window')`).run(now);
  },
};
