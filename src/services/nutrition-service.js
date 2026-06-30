const { withDb } = require('../db/db');
const { loadConfig } = require('../utils/config');
const { analyzeFoodImage: visionAnalyze } = require('../llm/food-vision');

const FOOD_ESTIMATES = [
  { pattern: /鸡腿饭|鸡.*饭/, name: '鸡腿饭', calories: 650, protein: 35, carbs: 80, fat: 20, blocks: ['米饭', '鸡肉'] },
  { pattern: /无糖拿铁/, name: '无糖拿铁', calories: 90, protein: 6, carbs: 8, fat: 4, blocks: ['拿铁'] },
  { pattern: /鸡胸|鸡肉/, name: '鸡肉', calories: 260, protein: 40, carbs: 5, fat: 8 },
  { pattern: /拿铁/, name: '拿铁', calories: 120, protein: 7, carbs: 10, fat: 5 },
  { pattern: /米饭|饭/, name: '米饭', calories: 280, protein: 6, carbs: 62, fat: 1 },
  { pattern: /牛肉/, name: '牛肉', calories: 300, protein: 35, carbs: 3, fat: 16 },
  { pattern: /鸡蛋|蛋/, name: '鸡蛋', calories: 80, protein: 7, carbs: 1, fat: 5 },
  { pattern: /沙拉/, name: '沙拉', calories: 180, protein: 8, carbs: 12, fat: 10 }
];

function estimateMealText(text) {
  const items = [];
  const blocked = new Set();
  for (const food of FOOD_ESTIMATES) {
    if (blocked.has(food.name)) continue;
    if (food.pattern.test(text)) {
      items.push({
        name: food.name,
        estimated_amount: '约一份',
        estimated_calories: food.calories,
        estimated_protein_g: food.protein,
        estimated_carbs_g: food.carbs,
        estimated_fat_g: food.fat
      });
      for (const name of food.blocks || []) blocked.add(name);
    }
  }
  if (items.length === 0) {
    items.push({
      name: text.replace(/^午饭[:：]?|^晚饭[:：]?/, '').slice(0, 40) || '文字记录餐食',
      estimated_amount: '估算一份',
      estimated_calories: 500,
      estimated_protein_g: 25,
      estimated_carbs_g: 55,
      estimated_fat_g: 16
    });
  }
  return items;
}

function analyzeFoodImage(imagePath) {
  return visionAnalyze(imagePath);
}

function logMeal({ date, mealType, source, imagePath, items, note }) {
  const totals = sumItems(items);
  return withDb(db => {
    const tx = db.transaction(() => {
      const meal = db.prepare(`
        INSERT INTO meals(date, meal_type, source, image_path, estimated_calories, estimated_protein_g,
          estimated_carbs_g, estimated_fat_g, confidence, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        date,
        mealType,
        source,
        imagePath || null,
        totals.calories,
        totals.protein,
        totals.carbs,
        totals.fat,
        'estimated',
        note || null
      );
      const insertItem = db.prepare(`
        INSERT INTO meal_items(meal_id, name, estimated_amount, estimated_calories, estimated_protein_g,
          estimated_carbs_g, estimated_fat_g)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of items) {
        insertItem.run(
          meal.lastInsertRowid,
          item.name,
          item.estimated_amount || null,
          item.estimated_calories || 0,
          item.estimated_protein_g || 0,
          item.estimated_carbs_g ?? null,
          item.estimated_fat_g ?? null
        );
      }
      return meal.lastInsertRowid;
    });
    const mealId = tx();
    return { mealId, date, ...getDailyNutrition(date), totals };
  });
}

function getDailyNutrition(date) {
  return withDb(db => {
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(estimated_calories), 0) AS calories,
        COALESCE(SUM(estimated_protein_g), 0) AS protein,
        COALESCE(SUM(estimated_carbs_g), 0) AS carbs,
        COALESCE(SUM(estimated_fat_g), 0) AS fat,
        COUNT(*) AS meal_count
      FROM meals WHERE date = ?
    `).get(date);
    return row;
  });
}

function getNutritionBudget(date) {
  const config = loadConfig();
  const totals = getDailyNutrition(date);
  const calorieTarget = config.user.targets.calories;
  const proteinTarget = config.user.targets.protein_g;
  return {
    date,
    calorieTarget,
    proteinTarget,
    calories: totals.calories,
    protein: totals.protein,
    remainingCalories: calorieTarget - totals.calories,
    remainingProtein: proteinTarget - totals.protein
  };
}

function sumItems(items) {
  return items.reduce((acc, item) => {
    acc.calories += Number(item.estimated_calories || 0);
    acc.protein += Number(item.estimated_protein_g || 0);
    acc.carbs += Number(item.estimated_carbs_g || 0);
    acc.fat += Number(item.estimated_fat_g || 0);
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

module.exports = {
  analyzeFoodImage,
  estimateMealText,
  logMeal,
  getDailyNutrition,
  getNutritionBudget
};
