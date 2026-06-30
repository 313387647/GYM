const { withDb } = require('../db/db');
const { loadConfig } = require('../utils/config');
const { getWeekdayName } = require('../utils/date');

function getTodayWorkout(date) {
  const config = loadConfig();
  const weekday = getWeekdayName(date);
  const workoutType = config.plan.weekly_plan[weekday] || null;
  return {
    workoutType,
    exercises: workoutType ? config.plan.workouts[workoutType] || [] : []
  };
}

function getWorkoutCard(date, options = {}) {
  const workout = getTodayWorkout(date);
  if (!workout.workoutType) {
    if (options.fallbackNext) {
      const next = getNextWorkout(date);
      if (next) return formatWorkoutCard(next.workoutType, next.exercises, `下一次 ${next.workoutType}：`);
    }
    return '今天不是固定力量训练日。\n可以散步 30 分钟，或者做拉伸恢复。猫猫批准你恢复，但不批准失踪。';
  }
  return formatWorkoutCard(workout.workoutType, workout.exercises, `今天 ${workout.workoutType}：`);
}

function formatWorkoutCard(workoutType, exercises, title) {
  const lines = [`今天 ${workoutType}：`];
  if (title) lines[0] = title;
  exercises.forEach((exercise, index) => {
    lines.push(`${index + 1}. ${exercise.name} ${exercise.target}`);
  });
  lines.push('');
  lines.push('练完回来报：动作 + 重量 + RPE。');
  return lines.join('\n');
}

function getNextWorkout(date) {
  const config = loadConfig();
  const base = new Date(`${date}T12:00:00`);
  for (let offset = 1; offset <= 7; offset++) {
    const next = new Date(base);
    next.setDate(base.getDate() + offset);
    const weekday = getWeekdayName(next);
    const workoutType = config.plan.weekly_plan[weekday];
    if (workoutType) {
      return { workoutType, exercises: config.plan.workouts[workoutType] || [] };
    }
  }
  return null;
}

function logWorkout({ date, workoutType, exercises = [], rpe, notes }) {
  return withDb(db => {
    const tx = db.transaction(() => {
      const workout = db.prepare(`
        INSERT INTO workouts(date, workout_type, status, rpe, notes)
        VALUES (?, ?, ?, ?, ?)
      `).run(date, workoutType || 'strength', 'done', rpe || null, notes || null);
      const insertSet = db.prepare(`
        INSERT INTO exercise_sets(workout_id, exercise_name, weight, reps, set_index, note)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const exercise of exercises) {
        const reps = Array.isArray(exercise.reps) && exercise.reps.length ? exercise.reps : [null];
        reps.forEach((rep, index) => {
          insertSet.run(workout.lastInsertRowid, exercise.name, exercise.weight || null, rep, index + 1, null);
        });
      }
      return workout.lastInsertRowid;
    });
    const workoutId = tx();
    return { workoutId, workoutType: workoutType || 'strength', rpe, exerciseCount: exercises.length };
  });
}

function getRecentWorkoutProgress({ days = 30 }) {
  return withDb(db => db.prepare(`
    SELECT * FROM workouts
    WHERE date >= date('now', ?)
    ORDER BY date DESC, id DESC
  `).all(`-${days} days`));
}

function getWorkoutSummary(date) {
  return withDb(db => db.prepare('SELECT * FROM workouts WHERE date = ? ORDER BY id DESC LIMIT 1').get(date) || null);
}

module.exports = { getTodayWorkout, getWorkoutCard, logWorkout, getRecentWorkoutProgress, getWorkoutSummary };
