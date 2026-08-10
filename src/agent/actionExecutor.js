class ActionExecutor {
  constructor({ mealService, weightService, workoutService, lifeService, memoryService }) {
    Object.assign(this, { mealService, weightService, workoutService, lifeService, memoryService });
  }
  execute(actions, { event, context }) {
    return actions.map((action, index) => {
      const common = {
        actionKey: `${event.id}:${index}`,
        logicalDate: context.time.logical_date,
        sourceEventId: event.id,
        recordedAt: event.timestamp,
      };
      switch (action.type) {
        case 'log_weight': return this.weightService.logWeight({ ...common, weightKg: action.weight_kg, notes: action.notes });
        case 'log_meal': return this.mealService.logMeal({ ...common, mealType: action.meal_type, items: action.items, sourceMessageId: event.payload.message_id });
        case 'log_workout': return this.workoutService.logWorkout({ ...common, workoutType: action.workout_type, workoutName: action.workout_name, totalDurationMin: action.total_duration_min, cardioDoneMin: action.cardio_done_min, rpeScore: action.rpe_score, notes: action.notes });
        case 'log_sleep': return this.lifeService.logSleep({ ...common, hours: action.hours, quality: action.quality, bedtime: action.bedtime, wakeTime: action.wake_time, notes: action.notes });
        case 'log_checkin': return this.lifeService.logCheckin({ ...common, energy: action.energy, mood: action.mood, workload: action.workload, soreness: action.soreness, trainingReadiness: action.training_readiness, notes: action.notes });
        case 'upsert_temporary_event': return this.lifeService.upsertTemporaryEvent({ ...common, eventType: action.event_type, description: action.description, startsAt: action.starts_at, endsAt: action.ends_at, now: event.timestamp });
        case 'remember': return this.memoryService.remember({ ...common, type: action.memory_type, key: action.key, content: action.content, importance: action.importance, now: event.timestamp });
        default: throw new Error(`Unsupported action type: ${action.type}`);
      }
    });
  }
}

module.exports = { ActionExecutor };
