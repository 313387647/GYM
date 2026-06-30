#!/usr/bin/env node
// src/tools/logMeal.js — 饮食记录（共享 DB 模块）
const { getDB, closeDB } = require('../db');
const { getLogicalDate, getTrainingInfo } = require('../utils/date');
const fs = require('fs');
const path = require('path');

const PLAN_PATH = path.resolve(__dirname, '../../plan.json');
const TRAINING_DAYS = { monday: ['upper_a','Upper A (Push Focus)'], wednesday: ['lower','Lower (Legs + Core)'], friday: ['upper_b','Upper B (Pull + Shoulder Focus)'] };

function fail(msg) { console.error(`❌ ${msg}`); process.exit(1); }

function getTargets(db) {
    const plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf-8'));
    let phase = 'phase_1', config = plan.phases.phase_1;
    const row = db.prepare('SELECT weight_kg FROM weight_logs ORDER BY logical_date DESC LIMIT 1').get();
    if (row) {
        const w = row.weight_kg;
        if (w <= plan.phases.phase_3.target_kg)      { phase = 'phase_3'; config = plan.phases.phase_3; }
        else if (w <= plan.phases.phase_2.target_kg)  { phase = 'phase_2'; config = plan.phases.phase_2; }
    }
    return { phase, phaseTargetKg: config.target_kg, dailyCalories: config.daily_calories, dailyProtein: config.macros.protein_g };
}

// ─── 参数 ──────────────────────────────────────────
const rawArgs = process.argv.slice(2);
const jsonFlagIdx = rawArgs.indexOf('--json');
const doJson = jsonFlagIdx !== -1;
const args = jsonFlagIdx !== -1 ? rawArgs.slice(0, jsonFlagIdx) : rawArgs;
const [dateStr, mealType, thirdArg, calStr, proteinStr, carbsStr, fatStr] = args;

if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) fail('日期格式错误: "' + (dateStr || '') + '"，应为 YYYY-MM-DD');

const isBatch = typeof thirdArg === 'string' && thirdArg.trim().startsWith('[');
if (isBatch && args.length < 3) fail('批量: node src/tools/logMeal.js <date> <meal> \'[{...}]\'');
if (!isBatch && args.length < 5) fail('用法: node src/tools/logMeal.js <date> <meal> "<name>" <cal> <pro> [carbs] [fat]');

// ─── 解析 ──────────────────────────────────────────
let items = [];
if (isBatch) {
    const parsed = JSON.parse(thirdArg);
    if (!Array.isArray(parsed)) fail('JSON 必须是数组');
    items = parsed.map((it, i) => {
        if (!it.name) fail('第 ' + (i+1) + ' 项缺少 name');
        const cal = Number(it.calories), pro = Number(it.protein_g);
        if (isNaN(cal) || isNaN(pro) || cal < 0 || pro < 0) fail('"' + it.name + '" 无效数值');
        return { name: it.name, calories: cal, protein_g: pro, ...(it.carbs_g != null ? { carbs_g: Number(it.carbs_g) } : {}), ...(it.fat_g != null ? { fat_g: Number(it.fat_g) } : {}), ...(it.amount != null ? { amount: it.amount } : {}) };
    });
} else {
    const cal = Number(calStr), pro = Number(proteinStr);
    if (isNaN(cal) || isNaN(pro) || cal < 0 || pro < 0) fail('无效数值');
    const item = { name: thirdArg, calories: cal, protein_g: pro };
    if (carbsStr && !isNaN(Number(carbsStr))) item.carbs_g = Number(carbsStr);
    if (fatStr && !isNaN(Number(fatStr))) item.fat_g = Number(fatStr);
    items.push(item);
}

// ─── 写入 ──────────────────────────────────────────
const db = getDB();
const nowStr = dateStr + ' ' + new Date().toTimeString().slice(0, 8);
const insertMeal = db.prepare('INSERT INTO meals (logical_date, meal_type, item_name, amount, calories, protein_g, carbs_g, fat_g, recorded_at) VALUES (?,?,?,?,?,?,?,?,?)');
const writeAll = db.transaction(() => { for (const it of items) insertMeal.run(dateStr, mealType, it.name, it.amount || null, it.calories, it.protein_g, it.carbs_g ?? null, it.fat_g ?? null, nowStr); });
writeAll();

// ─── 查询 ──────────────────────────────────────────
const daily = db.prepare('SELECT COALESCE(SUM(calories),0) as total_calories, COALESCE(SUM(protein_g),0) as total_protein_g, COALESCE(SUM(carbs_g),0) as total_carbs_g, COALESCE(SUM(fat_g),0) as total_fat_g, COUNT(*) as item_count FROM meals WHERE logical_date=?').get(dateStr);
const mealSum = db.prepare('SELECT COALESCE(SUM(calories),0) as calories, COALESCE(SUM(protein_g),0) as protein_g FROM meals WHERE logical_date=? AND meal_type=?').get(dateStr, mealType);
const targets = getTargets(db);

const { logical_date } = getLogicalDate();
const weekday = dateStr === logical_date ? (() => { const d = new Date(); return ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][d.getDay()]; })() : ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date(dateStr + 'T12:00:00').getDay()];
const isTraining = weekday in TRAINING_DAYS;
const trainingInfo = TRAINING_DAYS[weekday] || null;

const remainingCal = Math.max(0, targets.dailyCalories - daily.total_calories);
const remainingPro = Math.max(0, targets.dailyProtein - daily.total_protein_g);
const calPct = Math.min(100, Math.round((daily.total_calories / targets.dailyCalories) * 100));
const proPct = Math.min(100, Math.round((daily.total_protein_g / targets.dailyProtein) * 100));

// ─── 输出 ──────────────────────────────────────────
const macro = (it) => [`${it.calories}kcal`, `蛋白${it.protein_g}g`, it.carbs_g != null ? `碳水${it.carbs_g}g` : null, it.fat_g != null ? `脂肪${it.fat_g}g` : null].filter(Boolean).join(' | ');
const out = [];
if (items.length === 1) { out.push('✅ 已记录：' + items[0].name); out.push('   📋 ' + macro(items[0])); }
else { out.push('✅ 已记录 ' + items.length + ' 项食物到 ' + mealType + '：'); for (const it of items) out.push('   🍴 ' + it.name + ' — ' + macro(it)); }
out.push('   🍽️ 餐次：' + mealType + '（本餐累计 ' + mealSum.calories + 'kcal / 蛋白' + mealSum.protein_g + 'g）');
out.push('');
out.push('📊 今日累计：' + daily.total_calories + ' / ' + targets.dailyCalories + ' kcal（' + calPct + '%）');
out.push('   蛋白：' + daily.total_protein_g + ' / ' + targets.dailyProtein + 'g（' + proPct + '%）');
if (daily.total_carbs_g > 0) out.push('   碳水：' + daily.total_carbs_g + 'g');
if (daily.total_fat_g > 0) out.push('   脂肪：' + daily.total_fat_g + 'g');
out.push('');
out.push('🎯 剩余：' + remainingCal + 'kcal | 蛋白' + remainingPro + 'g');
out.push((isTraining ? '🏋️' : '😴') + ' 今日' + (isTraining ? '训练日' : '休息日') + (isTraining ? '：' + trainingInfo[1] : ''));
out.push('📦 阶段：' + targets.phase + '（→' + targets.phaseTargetKg + 'kg）');
out.push('💾 写入: gym_coach.db → meals (' + daily.item_count + ' 条记录)');
out.push('');
console.log(out.join('\n'));

if (doJson) {
    console.log(JSON.stringify({
        ok: true, logged: items,
        meal: { type: mealType, calories: mealSum.calories, protein_g: mealSum.protein_g },
        daily: { total_calories: daily.total_calories, total_protein_g: daily.total_protein_g, total_carbs_g: daily.total_carbs_g, total_fat_g: daily.total_fat_g },
        targets: { daily_calories: targets.dailyCalories, daily_protein: targets.dailyProtein },
        remaining: { calories: remainingCal, protein: remainingPro },
        percentage: { calories: calPct, protein: proPct },
        is_training_day: isTraining, training: trainingInfo, phase: targets.phase,
    }));
}

closeDB();
