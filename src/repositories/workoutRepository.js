class WorkoutRepository {
  constructor(db) { this.db = db; }
  insert(workout) {
    const result = this.db.prepare(`INSERT INTO workouts
      (logical_date, workout_type, workout_name, total_duration_min, cardio_done_min,
       cardio_target_min, rpe_score, notes, recorded_at, source_event_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`    ).run(
      workout.logicalDate, workout.workoutType, workout.workoutName ?? null,
      workout.totalDurationMin ?? null, workout.cardioDoneMin ?? 0,
      workout.cardioTargetMin ?? 20, workout.rpeScore ?? null, workout.notes ?? null,
      workout.recordedAt, workout.sourceEventId ?? null,
    );
    return this.byId(Number(result.lastInsertRowid));
  }
  byId(id) { return this.db.prepare('SELECT * FROM workouts WHERE id=?').get(id) || null; }
  latestForDate(date) { return this.db.prepare('SELECT * FROM workouts WHERE logical_date=? ORDER BY id DESC LIMIT 1').get(date) || null; }
  recent(limit = 10) { return this.db.prepare('SELECT * FROM workouts ORDER BY logical_date DESC, id DESC LIMIT ?').all(limit); }
}
module.exports = { WorkoutRepository };
