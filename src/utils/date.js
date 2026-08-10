const fs = require('node:fs');
const { loadConfig } = require('../config');
const { getLogicalTime } = require('./timezone');

const WEEKDAY_CN = {
  monday: '周一', tuesday: '周二', wednesday: '周三', thursday: '周四',
  friday: '周五', saturday: '周六', sunday: '周日',
};

function loadPlan() {
  return JSON.parse(fs.readFileSync(loadConfig().planPath, 'utf8'));
}

function getLogicalDate(now = new Date(), options = {}) {
  const config = loadConfig();
  return getLogicalTime(now, {
    timezone: options.timezone || config.timezone,
    cutoffHour: options.cutoffHour ?? config.logicalDayCutoffHour,
  });
}

function getTrainingInfo(weekday, plan = loadPlan()) {
  const phaseName = plan.phase || 'phase_1';
  const schedule = plan.phases?.[phaseName]?.training?.schedule || {};
  const workoutType = schedule[weekday];
  const workout = workoutType ? plan.workouts?.[workoutType] : null;
  return workoutType ? [workoutType, workout?.name || workoutType] : null;
}

function isTrainingDay(weekday, plan) { return Boolean(getTrainingInfo(weekday, plan)); }
function getWeekdayCN(weekday) { return WEEKDAY_CN[weekday] || weekday; }
function isDawn(hour, cutoffHour = loadConfig().logicalDayCutoffHour) { return hour >= 0 && hour < cutoffHour; }

module.exports = { getLogicalDate, getWeekdayCN, getTrainingInfo, isTrainingDay, isDawn, loadPlan };
