class StateService {
  constructor({ mealService, weightService, workoutService, lifeRepository, planService }) {
    Object.assign(this, { mealService, weightService, workoutService, lifeRepository, planService });
  }

  build({ logicalDate, weekday, hour }) {
    const nutrition = this.mealService.summary(logicalDate);
    const targets = this.planService.getTargets();
    const trainingPlan = this.planService.getTrainingForWeekday(weekday);
    const workout = this.workoutService.repository.latestForDate(logicalDate);
    const sleep = this.lifeRepository.sleepForDate(logicalDate);
    const checkin = this.lifeRepository.latestCheckin(logicalDate);
    const temporaryEvents = this.lifeRepository.activeTemporaryEvents(logicalDate);
    const trend = this.weightService.trend();
    const fatigue = this.workoutService.fatigue();

    let calorieStatus = 'in_progress';
    if (hour < 12 && nutrition.item_count === 0) calorieStatus = 'not_started_expected';
    else if (hour >= 20 && nutrition.calories < targets.calories * 0.7) calorieStatus = 'under_target_late';
    else if (nutrition.calories > targets.calories * 1.15) calorieStatus = 'over_target';
    else if (nutrition.calories >= targets.calories * 0.8) calorieStatus = 'near_target';

    let proteinStatus = 'in_progress';
    if (hour < 12 && nutrition.item_count === 0) proteinStatus = 'not_started_expected';
    else if (hour >= 20 && nutrition.protein_g < targets.protein_g * 0.7) proteinStatus = 'low_late';
    else if (nutrition.protein_g >= targets.protein_g * 0.9) proteinStatus = 'near_or_hit_target';

    let readiness = checkin?.training_readiness || 'unknown';
    if (sleep?.hours < 6 || checkin?.energy <= 3 || fatigue.deload_signal) readiness = 'low';
    else if (sleep?.hours >= 7 && checkin?.energy >= 6) readiness = 'high';

    return {
      logical_date: logicalDate,
      nutrition: { ...nutrition, calorie_status: calorieStatus, protein_status: proteinStatus },
      weight: trend,
      sleep: sleep ? { hours: sleep.hours, quality: sleep.quality } : null,
      checkin: checkin ? { energy: checkin.energy, mood: checkin.mood, workload: checkin.workload, soreness: checkin.soreness } : null,
      training: { ...trainingPlan, completed: Boolean(workout), latest_today: workout, readiness, fatigue },
      temporary_events: temporaryEvents,
    };
  }
}
module.exports = { StateService };
