const { WorkoutRepository } = require('../repositories/workoutRepository');
const { idempotent } = require('./serviceHelpers');

class WorkoutService {
  constructor({ db }) { this.db = db; this.repository = new WorkoutRepository(db); }
  logWorkout(input) {
    return idempotent(this.db, input.actionKey, 'log_workout', () => ({ success: true, workout: this.repository.insert(input) }));
  }
  updateRpe(input) {
    return idempotent(this.db, input.actionKey, 'update_workout_rpe', () => {
      const workout = input.workoutId ? this.repository.byId(input.workoutId) : this.repository.latestForDate(input.logicalDate);
      if (!workout) { const error = new Error('No workout available to update'); error.code = 'WORKOUT_NOT_FOUND'; throw error; }
      return { success: true, workout: this.repository.updateRpe(workout.id, input.rpeScore, input.notes) };
    });
  }
  fatigue() {
    const recent = this.repository.recent(6);
    const highRpeCount = recent.slice(0, 2).filter((row) => row.rpe_score >= 9).length;
    return { recent: recent.map((row) => ({ date: row.logical_date, type: row.workout_type, rpe: row.rpe_score })), deload_signal: highRpeCount === 2, high_rpe_streak: highRpeCount };
  }
}
module.exports = { WorkoutService };
