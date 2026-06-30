#!/usr/bin/env node
// src/tools/generateDailyState.js — 每日状态判断（智能核心）
const { getDB, closeDB } = require('../db');
const { getLogicalDate, getTrainingInfo, isTrainingDay, isDawn } = require('../utils/date');
const fs = require('fs');
const path = require('path');

const PLAN_PATH = path.resolve(__dirname, '../../plan.json');
let _plan = null;
function getPlan() { if (!_plan) _plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf-8')); return _plan; }

function parseArgs(argv) {
    const args = { date: null, save: false };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--date' && argv[i + 1]) args.date = argv[++i];
        if (argv[i] === '--save') args.save = true;
    }
    return args;
}

function getPhase(plan, db) {
    const row = db.prepare('SELECT weight_kg FROM weight_logs ORDER BY logical_date DESC LIMIT 1').get();
    if (!row) return { phase: 'phase_1', target: plan.phases.phase_1.target_kg, dailyCal: plan.phases.phase_1.daily_calories, dailyPro: plan.phases.phase_1.macros.protein_g };
    const w = row.weight_kg;
    if (w <= plan.phases.phase_3.target_kg) return { phase: 'phase_3', target: plan.phases.phase_3.target_kg, dailyCal: plan.phases.phase_3.daily_calories, dailyPro: plan.phases.phase_3.macros.protein_g };
    if (w <= plan.phases.phase_2.target_kg) return { phase: 'phase_2', target: plan.phases.phase_2.target_kg, dailyCal: plan.phases.phase_2.daily_calories, dailyPro: plan.phases.phase_2.macros.protein_g };
    return { phase: 'phase_1', target: plan.phases.phase_1.target_kg, dailyCal: plan.phases.phase_1.daily_calories, dailyPro: plan.phases.phase_1.macros.protein_g };
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const { logical_date, weekday } = getLogicalDate();
    const dateStr = args.date || logical_date;
    const db = getDB();
    const plan = getPlan();
    const phase = getPhase(plan, db);

    // ─── 今日数据 ──────────────────────────────────
    const meals = db.prepare('SELECT COALESCE(SUM(calories),0) as cal, COALESCE(SUM(protein_g),0) as pro FROM meals WHERE logical_date=?').get(dateStr);
    const wt = db.prepare('SELECT weight_kg FROM weight_logs WHERE logical_date=?').get(dateStr);
    const wo = db.prepare("SELECT id, workout_type, rpe_score, total_duration_min FROM workouts WHERE logical_date=? ORDER BY id DESC LIMIT 1").get(dateStr);
    const training = getTrainingInfo(weekday);

    // ─── 7日连贯性 ────────────────────────────────
    const end7 = dateStr;
    const s7 = new Date(dateStr + 'T12:00:00'); s7.setDate(s7.getDate() - 6);
    const start7 = s7.toISOString().slice(0, 10);
    const mealDays7 = db.prepare('SELECT COUNT(DISTINCT logical_date) as c FROM meals WHERE logical_date BETWEEN ? AND ?').get(start7, end7).c;
    const trainingTarget = 3; // 每周 3 训
    const woDays7 = db.prepare('SELECT COUNT(*) as c FROM workouts WHERE logical_date BETWEEN ? AND ?').get(start7, end7).c;

    // ─── 14日体重趋势 ──────────────────────────────
    const weights = db.prepare('SELECT weight_kg FROM weight_logs ORDER BY logical_date DESC LIMIT 14').all().map(r => r.weight_kg);
    let weightStatus = 'unknown';
    if (weights.length >= 7) {
        const recentAvg = weights.slice(0, 7).reduce((s, w) => s + w, 0) / 7;
        const olderAvg = weights.slice(7).reduce((s, w) => s + w, 0) / weights.slice(7).length || recentAvg;
        const diff = olderAvg - recentAvg;
        if (diff >= 1.0) weightStatus = 'dropping';
        else if (diff <= -1.5) weightStatus = 'rebound';
        else if (Math.abs(diff) < 0.3) weightStatus = 'plateau';
        else weightStatus = 'normal_fluctuation';
    } else if (weights.length >= 2) {
        weightStatus = 'normal_fluctuation';
    }

    // ─── 判断 ──────────────────────────────────────
    let calorieStatus = 'unknown';
    if (meals.cal === 0) calorieStatus = 'under_eating';
    else if (meals.cal < phase.dailyCal * 0.7) calorieStatus = 'under_eating';
    else if (meals.cal <= phase.dailyCal * 1.05) calorieStatus = 'on_track';
    else if (meals.cal <= phase.dailyCal * 1.15) calorieStatus = 'near_limit';
    else calorieStatus = 'over_limit';

    let proteinStatus = 'unknown';
    if (meals.pro === 0) proteinStatus = 'low';
    else if (meals.pro < phase.dailyPro * 0.7) proteinStatus = 'low';
    else if (meals.pro < phase.dailyPro * 0.9) proteinStatus = 'acceptable';
    else proteinStatus = 'hit_target';

    let consistencyStatus = 'stable';
    if (mealDays7 >= 6) consistencyStatus = 'stable';
    else if (mealDays7 >= 4) consistencyStatus = 'slipping';
    else if (mealDays7 >= 2) consistencyStatus = 'broken';
    else consistencyStatus = 'recovering';
    if (mealDays7 <= 1 && woDays7 <= 0) consistencyStatus = 'broken';

    let trainingStatus = 'rest_day';
    if (training) {
        trainingStatus = wo ? 'training_completed' : 'training_day_pending';
        if (!wo) {
            // 检查是否连着跳过训练
            const missed = [];
            for (let i = 1; i <= 7; i++) {
                const d = new Date(dateStr + 'T12:00:00'); d.setDate(d.getDate() - i);
                const ds = d.toISOString().slice(0, 10);
                const wd = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                if (isTrainingDay(wd)) {
                    const w = db.prepare('SELECT id FROM workouts WHERE logical_date=?').get(ds);
                    if (!w) missed.push(ds);
                }
                if (missed.length >= 2) break;
            }
            if (missed.length >= 2) trainingStatus = 'missed_training';
        }
    }
    if (wo && wo.rpe_score && wo.rpe_score >= 9) trainingStatus = 'recovery_needed';

    // ─── 风险等级 ──────────────────────────────────
    let riskLevel = 'low';
    const riskCount = [
        calorieStatus === 'over_limit' || calorieStatus === 'under_eating',
        proteinStatus === 'low',
        consistencyStatus === 'broken' || consistencyStatus === 'slipping',
        weightStatus === 'plateau' || weightStatus === 'rebound',
        trainingStatus === 'missed_training',
    ].filter(Boolean).length;
    if (riskCount >= 3) riskLevel = 'high';
    else if (riskCount >= 1) riskLevel = 'medium';

    // ─── 语气策略 ──────────────────────────────────
    let tone = 'playful';
    if (consistencyStatus === 'stable' && proteinStatus === 'hit_target' && calorieStatus === 'on_track') tone = 'praise';
    else if (consistencyStatus === 'broken') tone = 'serious_review';
    else if (consistencyStatus === 'slipping') tone = 'playful_strict';
    else if (riskLevel === 'high') tone = 'strict';
    else if (weightStatus === 'plateau') tone = 'serious_review';
    else if (trainingStatus === 'recovery_needed') tone = 'gentle';

    // ─── 主要任务 ──────────────────────────────────
    let mainTask = '';
    const avoid = [];
    if (calorieStatus === 'under_eating') { mainTask = '优先保证今天正常进餐，不要靠空腹控制热量。'; avoid.push('不要夸少吃'); }
    else if (calorieStatus === 'over_limit') { mainTask = '今天热量已超标，晚餐以纯蛋白质为主，不要再吃碳水。'; avoid.push('不要说"没关系下次注意"'); }
    else if (proteinStatus === 'low') { mainTask = '今日蛋白缺口大，优先补足优质蛋白。'; avoid.push('不要只关注总热量忽略蛋白'); }
    else if (consistencyStatus === 'broken') { mainTask = '记录已经断了好几天，今天先把记录链接上——哪怕只是一餐。'; avoid.push('不要泛泛加油'); avoid.push('不要制造体重焦虑'); }
    else if (trainingStatus === 'training_day_pending') { mainTask = '今天是训练日，优先保证训前加餐并按时出发。'; avoid.push('不要说"没时间不要紧"'); }
    else if (trainingStatus === 'recovery_needed') { mainTask = '昨天 RPE 很高，今天以恢复为主，不要急着加强度。'; avoid.push('不要催训练'); avoid.push('不要问"今天练不练"'); }
    else { mainTask = '今天节奏正常，保持记录和规律就好。'; }

    if (riskLevel !== 'low') avoid.push('不要泛泛加油');
    if (consistencyStatus !== 'broken') avoid.push('不要过度卖萌');

    // ─── 上下文摘要 ──────────────────────────────────
    const ctxParts = [`${dateStr} ${['日','一','二','三','四','五','六'][new Date(dateStr + 'T12:00:00').getDay()]}周${training ? '训练日' : '休息日'}`];
    if (weights.length > 0) ctxParts.push(`最近体重 ${weights[0]}kg`);
    ctxParts.push(`近7天记录 ${mealDays7} 天饮食`);

    // ─── coach_action ──────────────────────────────
    let coachAction = '';
    if (trainingStatus === 'training_day_pending') coachAction = '提醒用户今天训练，确认是否准备了训前加餐';
    else if (consistencyStatus === 'broken') coachAction = '用严肃但关心的语气，让用户今天至少发一餐记录回来';
    else if (proteinStatus === 'low') coachAction = '提醒用户今天优先补蛋白，给具体建议';
    else coachAction = '保持正常提醒节奏';

    const result = {
        date: dateStr,
        calorie_status: calorieStatus,
        protein_status: proteinStatus,
        consistency_status: consistencyStatus,
        weight_status: weightStatus,
        training_status: trainingStatus,
        risk_level: riskLevel,
        main_task_today: mainTask,
        tone_strategy: tone,
        coach_action: coachAction,
        avoid,
        context_summary: ctxParts.join('，') + '。',
        data_snapshot: {
            meals_today: { calories: meals.cal, protein: meals.pro },
            weight_recorded: !!wt,
            weight_kg: wt?.weight_kg ?? null,
            training_done: !!wo,
            training_type: wo?.workout_type ?? (training ? training[0] : null),
            meal_days_7d: mealDays7,
            workout_days_7d: woDays7,
        },
    };

    // ─── --save ────────────────────────────────────
    if (args.save) {
        db.exec(`CREATE TABLE IF NOT EXISTS daily_state (
            logical_date TEXT PRIMARY KEY,
            calorie_status TEXT,
            protein_status TEXT,
            consistency_status TEXT,
            weight_status TEXT,
            training_status TEXT,
            risk_level TEXT,
            main_task_today TEXT,
            tone_strategy TEXT,
            coach_action TEXT,
            avoid TEXT,
            context_summary TEXT,
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )`);
        db.prepare(`INSERT OR REPLACE INTO daily_state (logical_date, calorie_status, protein_status, consistency_status, weight_status, training_status, risk_level, main_task_today, tone_strategy, coach_action, avoid, context_summary)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            dateStr, calorieStatus, proteinStatus, consistencyStatus, weightStatus, trainingStatus, riskLevel, mainTask, tone, coachAction, JSON.stringify(avoid), ctxParts.join('，') + '。'
        );
        result._saved = true;
    }

    closeDB();
    console.log(JSON.stringify(result, null, 2));
}

main();
