#!/usr/bin/env node
const { migrate } = require('../db/migrate');
const { createContainer } = require('../container');
const { getLogicalDate } = require('../utils/date');
const { shiftCalendarDate } = require('../utils/timezone');
migrate();
const container = createContainer();
const time = getLogicalDate();
const mode = process.argv[2] || '--today';
let result;
if (mode === '--weight-trend') result = container.services.weightService.trend();
else if (mode === '--workout-progress') result = container.services.workoutService.fatigue();
else if (mode === '--week') {
  const start = shiftCalendarDate(time.logical_date, -6);
  result = {
    period: { start, end: time.logical_date },
    meals: container.db.prepare('SELECT logical_date,SUM(calories) calories,SUM(protein_g) protein_g FROM meals WHERE logical_date BETWEEN ? AND ? GROUP BY logical_date').all(start, time.logical_date),
    weights: container.db.prepare('SELECT logical_date,weight_kg FROM weight_logs WHERE logical_date BETWEEN ? AND ? ORDER BY logical_date').all(start, time.logical_date),
    workouts: container.db.prepare('SELECT logical_date,workout_type,rpe_score FROM workouts WHERE logical_date BETWEEN ? AND ? ORDER BY logical_date').all(start, time.logical_date),
  };
} else if (mode === '--meal-advice') result = container.services.mealService.summary(time.logical_date);
else result = container.contextBuilder.build({ id: 'cli-query', type: 'scheduled_check', user_id: container.config.defaultUserId, timestamp: new Date().toISOString(), payload: {} }).state;
console.log(JSON.stringify(result, null, 2));
