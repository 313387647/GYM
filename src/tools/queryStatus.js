#!/usr/bin/env node
// src/tools/queryStatus.js — 统一状态查询
const { getDB, closeDB } = require('../db');
const { getLogicalDate, getTrainingInfo, isTrainingDay } = require('../utils/date');
const fs = require('fs');
const path = require('path');

const PLAN_PATH = path.resolve(__dirname, '../../plan.json');
let _plan = null;
function getPlan() {
    if (!_plan) _plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf-8'));
    return _plan;
}

function getPhase(db) {
    const row = db.prepare('SELECT weight_kg FROM weight_logs ORDER BY logical_date DESC LIMIT 1').get();
    const plan = getPlan();
    if (!row) return { phase: 'phase_1', target: plan.phases.phase_1.target_kg, dailyCal: plan.phases.phase_1.daily_calories, dailyPro: plan.phases.phase_1.macros.protein_g };
    const w = row.weight_kg;
    if (w <= plan.phases.phase_3.target_kg) return { phase: 'phase_3', target: plan.phases.phase_3.target_kg, dailyCal: plan.phases.phase_3.daily_calories, dailyPro: plan.phases.phase_3.macros.protein_g };
    if (w <= plan.phases.phase_2.target_kg) return { phase: 'phase_2', target: plan.phases.phase_2.target_kg, dailyCal: plan.phases.phase_2.daily_calories, dailyPro: plan.phases.phase_2.macros.protein_g };
    return { phase: 'phase_1', target: plan.phases.phase_1.target_kg, dailyCal: plan.phases.phase_1.daily_calories, dailyPro: plan.phases.phase_1.macros.protein_g };
}

function queryToday(db, dateStr, weekday) {
    const phase = getPhase(db);
    const meals = db.prepare('SELECT COALESCE(SUM(calories),0) as cal, COALESCE(SUM(protein_g),0) as pro, COALESCE(SUM(carbs_g),0) as carbs, COALESCE(SUM(fat_g),0) as fat FROM meals WHERE logical_date=?').get(dateStr);
    const wt = db.prepare('SELECT weight_kg FROM weight_logs WHERE logical_date=?').get(dateStr);
    const wo = db.prepare("SELECT workout_type, rpe_score, total_duration_min FROM workouts WHERE logical_date=? ORDER BY id DESC LIMIT 1").get(dateStr);
    const training = getTrainingInfo(weekday);

    const calLeft = Math.max(0, phase.dailyCal - meals.cal);
    const proLeft = Math.max(0, phase.dailyPro - meals.pro);

    let calStatus = 'unknown';
    if (meals.cal === 0) calStatus = 'under_eating';
    else if (meals.cal < phase.dailyCal * 0.7) calStatus = 'under_eating';
    else if (meals.cal <= phase.dailyCal * 1.05) calStatus = 'on_track';
    else if (meals.cal <= phase.dailyCal * 1.15) calStatus = 'near_limit';
    else calStatus = 'over_limit';

    let proStatus = 'unknown';
    if (meals.pro === 0) proStatus = 'low';
    else if (meals.pro < phase.dailyPro * 0.7) proStatus = 'low';
    else if (meals.pro < phase.dailyPro * 0.9) proStatus = 'acceptable';
    else proStatus = 'hit_target';

    let hint = '';
    if (calStatus === 'over_limit') hint = '热量已超标，今天不要再吃了。';
    else if (proStatus === 'low') hint = `热量还有空间，但蛋白差 ${Math.round(proLeft)}g，优先吃高蛋白食物。`;
    else if (calStatus === 'on_track' && proStatus === 'hit_target') hint = '热量和蛋白都在目标内，继续保持。';
    else hint = `还可以摄入约 ${Math.round(calLeft)}kcal，蛋白还需要 ${Math.round(proLeft)}g。`;

    return {
        date: dateStr,
        weekday_cn: ['日','一','二','三','四','五','六'][new Date(dateStr + 'T12:00:00').getDay()],
        is_training_day: !!training,
        training_type: training ? training[0] : null,
        meals: { total_calories: meals.cal, total_protein: meals.pro, total_carbs: meals.carbs, total_fat: meals.fat },
        targets: { daily_calories: phase.dailyCal, daily_protein: phase.dailyPro },
        remaining: { calories: Math.round(calLeft), protein: Math.round(proLeft) },
        calorie_status: calStatus,
        protein_status: proStatus,
        weight_recorded: !!wt,
        weight_kg: wt?.weight_kg ?? null,
        training_completed: !!wo,
        training_detail: wo || null,
        coach_hint: hint,
    };
}

function queryWeek(db, dateStr) {
    const phase = getPhase(db);
    const end = dateStr;
    const startDate = new Date(dateStr + 'T12:00:00');
    startDate.setDate(startDate.getDate() - 6);
    const start = startDate.toISOString().slice(0, 10);

    const meals = db.prepare(`SELECT logical_date, SUM(calories) as cal, SUM(protein_g) as pro FROM meals WHERE logical_date BETWEEN ? AND ? GROUP BY logical_date`).all(start, end);
    const wts = db.prepare('SELECT logical_date FROM weight_logs WHERE logical_date BETWEEN ? AND ?').all(start, end);
    const wos = db.prepare("SELECT logical_date, workout_type FROM workouts WHERE logical_date BETWEEN ? AND ?").all(start, end);

    const mealDays = meals.length;
    const avgCal = mealDays > 0 ? Math.round(meals.reduce((s, r) => s + r.cal, 0) / mealDays) : 0;
    const avgPro = mealDays > 0 ? Math.round(meals.reduce((s, r) => s + r.pro, 0) / mealDays) : 0;

    const missingMealDays = [];
    for (let d = new Date(start); d <= new Date(end + 'T12:00:00'); d.setDate(d.getDate() + 1)) {
        const ds = d.toISOString().slice(0, 10);
        if (!meals.find(m => m.logical_date === ds)) missingMealDays.push(ds);
    }

    let maxRisk = null;
    if (missingMealDays.length >= 3) maxRisk = `连续 ${missingMealDays.length} 天无饮食记录`;
    else if (wos.length < 2 && isTrainingDay(['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date().getDay()])) maxRisk = '本周训练不足';
    else if (wts.length < 3) maxRisk = '体重记录不足';
    else maxRisk = '暂无显著风险';

    return {
        period: { start, end },
        meal_days: mealDays,
        avg_calories: avgCal,
        avg_protein: avgPro,
        weight_days: wts.length,
        training_count: wos.length,
        missing_meal_days: missingMealDays.length,
        max_risk: maxRisk,
        coach_hint: missingMealDays.length >= 3
            ? '记录已经断了好几天了，先不追完美，今天拍一餐发回来就能把链条接上。'
            : avgPro < phase.dailyPro * 0.7
                ? '这周蛋白整体偏低，优先补蛋白质。'
                : '这周整体节奏不错，周末别完全放飞。',
    };
}

function queryWeightTrend(db) {
    const rows = db.prepare('SELECT * FROM weight_logs ORDER BY logical_date DESC LIMIT 14').all();
    if (rows.length < 2) return { status: 'insufficient_data', coach_hint: '体重数据不足，再记录 2-3 天。', data: rows };

    const latest = rows[0];
    const prev = rows[1];
    const avg7d = rows.slice(0, Math.min(7, rows.length)).reduce((s, r) => s + r.weight_kg, 0) / Math.min(7, rows.length);
    const changeFromPrev = Math.round((latest.weight_kg - prev.weight_kg) * 10) / 10;

    let status = 'normal_fluctuation';
    if (rows.length >= 7) {
        const older = rows.slice(4, 7);
        const olderAvg = older.reduce((s, r) => s + r.weight_kg, 0) / older.length;
        if (olderAvg - avg7d >= 1.0) status = 'dropping';
        else if (avg7d - olderAvg >= 1.5) status = 'rebound';
        else if (Math.abs(olderAvg - avg7d) < 0.3) status = 'plateau';
    }

    const hints = {
        dropping: '7日均值在下降，保持节奏。',
        normal_fluctuation: '体重正常波动中，继续观察。',
        plateau: '近一周体重没明显变化，可以考虑增加有氧或控制晚餐碳水。',
        rebound: '短期回升，可能是水分或钠摄入，2-3 天通常会回落。',
        insufficient_data: '数据还不够。',
    };

    return {
        latest_weight_kg: latest.weight_kg,
        seven_day_avg: Math.round(avg7d * 10) / 10,
        change_from_previous: changeFromPrev,
        status,
        data_days: rows.length,
        coach_hint: hints[status] || hints.normal_fluctuation,
    };
}

function queryWorkoutProgress(db) {
    const lastWo = db.prepare("SELECT * FROM workouts ORDER BY logical_date DESC LIMIT 1").get();
    const thisWeekWos = (() => {
        const now = new Date();
        now.setDate(now.getDate() - now.getDay());
        const mon = now.toISOString().slice(0, 10);
        return db.prepare("SELECT COUNT(*) as c FROM workouts WHERE logical_date >= ?").get(mon).c;
    })();

    let mainLifts = [];
    if (lastWo) {
        mainLifts = db.prepare(`SELECT exercise_name, MAX(weight_kg) as max_weight FROM exercise_sets WHERE workout_id=? AND weight_kg IS NOT NULL GROUP BY exercise_name LIMIT 5`).all(lastWo.id);
    }

    const missedDays = (() => {
        const today = new Date();
        let count = 0;
        for (let i = 0; i < 7; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const ds = d.toISOString().slice(0, 10);
            const wd = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
            if (wd in { monday: 1, wednesday: 1, friday: 1 }) {
                const wo = db.prepare("SELECT id FROM workouts WHERE logical_date=?").get(ds);
                if (!wo) count++;
            }
        }
        return count;
    })();

    let hint = '';
    if (!lastWo) hint = '最近没有训练记录，今天把包背上。';
    else if (missedDays >= 2) hint = `最近漏了 ${missedDays} 次训练，先不求强度，恢复节奏最重要。`;
    else hint = '训练节奏正常，注意记录 RPE 和重量变化。';

    return {
        last_training_date: lastWo?.logical_date ?? null,
        last_training_type: lastWo?.workout_type ?? null,
        this_week_count: thisWeekWos,
        missed_training_days: missedDays,
        recent_lifts: mainLifts,
        coach_hint: hint,
    };
}

function queryMealAdvice(db, dateStr, weekday) {
    const phase = getPhase(db);
    const meals = db.prepare('SELECT COALESCE(SUM(calories),0) as cal, COALESCE(SUM(protein_g),0) as pro, meal_type FROM meals WHERE logical_date=? GROUP BY meal_type',).all(dateStr);
    const total = meals.reduce((s, m) => s + m.cal, 0);
    const totalPro = meals.reduce((s, m) => s + m.pro, 0);
    const calLeft = Math.max(0, phase.dailyCal - total);
    const proLeft = Math.max(0, phase.dailyPro - totalPro);
    const training = getTrainingInfo(weekday);

    let targetCal, targetPro, avoid;
    if (total === 0) {
        targetCal = training ? 900 : 1050;
        targetPro = training ? 70 : 85;
        avoid = '不要跳过午餐，空腹太久容易晚上暴食。';
    } else if (calLeft < 300) {
        targetCal = calLeft;
        targetPro = proLeft;
        avoid = '热量余额很少，下一餐以纯蛋白质为主。';
    } else {
        targetCal = Math.round(calLeft * 0.6);
        targetPro = Math.round(proLeft * 0.7);
        avoid = '控制油脂，选瘦肉或鱼虾。';
    }

    const examples = proLeft > 30
        ? ['鸡胸肉 200g + 西兰花', '鱼片 200g + 青菜', '蛋白粉 1 勺 + 脱脂奶']
        : ['酸奶 + 水煮蛋', '豆腐 + 蔬菜汤'];

    return {
        calories_left: Math.round(calLeft),
        protein_left: Math.round(proLeft),
        next_meal: { target_calories: Math.round(targetCal), target_protein: Math.round(targetPro) },
        avoid,
        examples,
        coach_hint: `下一餐建议摄入约 ${Math.round(targetCal)}kcal，优先保证 ${Math.round(targetPro)}g 蛋白。`,
    };
}

// ─── Main ──────────────────────────────────────────
const mode = process.argv[2];
const { logical_date, weekday } = getLogicalDate();
const db = getDB();

let result;
switch (mode) {
    case '--today':
        result = queryToday(db, logical_date, weekday);
        break;
    case '--week':
        result = queryWeek(db, logical_date);
        break;
    case '--weight-trend':
        result = queryWeightTrend(db);
        break;
    case '--workout-progress':
        result = queryWorkoutProgress(db);
        break;
    case '--meal-advice':
        result = queryMealAdvice(db, logical_date, weekday);
        break;
    default:
        // 默认 = --today
        result = queryToday(db, logical_date, weekday);
        result._help = '可用: --today | --week | --weight-trend | --workout-progress | --meal-advice';
}

closeDB();
console.log(JSON.stringify(result, null, 2));
