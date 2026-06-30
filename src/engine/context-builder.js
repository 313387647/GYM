const { loadConfig } = require('../utils/config');
const { getLogicalDate, getWeekdayName } = require('../utils/date');

function buildContext(input = {}) {
  const config = loadConfig();
  const now = input.timestamp ? new Date(input.timestamp) : new Date();
  const date = input.date || getLogicalDate(now);
  const weekday = getWeekdayName(date);
  const workoutType = config.plan.weekly_plan[weekday] || null;

  return {
    date,
    weekday,
    isTrainingDay: Boolean(workoutType),
    workoutType,
    config,
    now
  };
}

module.exports = { buildContext };
