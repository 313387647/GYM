const { withDb } = require('../db/db');
const { loadConfig } = require('../utils/config');

function getDailySummary(date) {
  const config = loadConfig();
  return withDb(db => {
    const weight = db.prepare('SELECT weight_kg FROM weight_logs WHERE date = ? ORDER BY id DESC LIMIT 1').get(date);
    const nutrition = db.prepare(`
      SELECT COALESCE(SUM(estimated_calories), 0) AS calories,
             COALESCE(SUM(estimated_protein_g), 0) AS protein,
             COUNT(*) AS meals
      FROM meals WHERE date = ?
    `).get(date);
    const workout = db.prepare('SELECT workout_type, status, rpe FROM workouts WHERE date = ? ORDER BY id DESC LIMIT 1').get(date);

    const score = gradeDay({ weight, nutrition, workout, config });
    const missing = [];
    if (!weight) missing.push('体重');
    if (!nutrition.meals) missing.push('饮食');
    const workoutText = workout ? `${workout.workout_type || '训练'}，RPE ${workout.rpe || '未填'}` : '未记录';

    const message = [
      `晚间收尾：${date}`,
      `体重：${weight ? `${weight.weight_kg}kg` : '未记录'}`,
      `热量：约 ${Math.round(nutrition.calories)} / ${config.user.targets.calories} kcal`,
      `蛋白：约 ${Math.round(nutrition.protein)} / ${config.user.targets.protein_g}g`,
      `训练：${workoutText}`,
      `评分：${score}`,
      missing.length ? `缺：${missing.join('、')}。补一下，猫猫再给你算准。` : '明天建议：继续先蛋白后主食，训练日别空腹硬顶。'
    ].join('\n');

    return { date, weight, nutrition, workout, score, message };
  });
}

function getWeeklySummary(weekStart) {
  return withDb(db => {
    const rows = db.prepare(`
      SELECT date, estimated_calories, estimated_protein_g FROM meals
      WHERE date >= ? AND date < date(?, '+7 days')
      ORDER BY date
    `).all(weekStart, weekStart);
    const calories = rows.reduce((sum, row) => sum + row.estimated_calories, 0);
    const protein = rows.reduce((sum, row) => sum + row.estimated_protein_g, 0);
    return { weekStart, daysWithMeals: new Set(rows.map(row => row.date)).size, calories, protein };
  });
}

function gradeDay({ weight, nutrition, workout, config }) {
  const calDiff = Math.abs((nutrition.calories || 0) - config.user.targets.calories);
  const proteinDiff = config.user.targets.protein_g - (nutrition.protein || 0);
  if (weight && workout && calDiff <= 100 && proteinDiff <= 15) return 'A';
  if (calDiff <= 200 && proteinDiff <= 25) return 'B';
  if (!nutrition.meals || !weight) return '待补';
  return 'C';
}

module.exports = { getDailySummary, getWeeklySummary };
