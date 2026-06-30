#!/usr/bin/env node
/**
 * get_context.js v2 — 统一上下文获取（SQLite 版）
 *
 * 严格按照「每天 06:00 为新一天起点」计算逻辑日期，
 * 从 gym_coach.db 读取最新体重、从 plan.json 读取训练计划。
 *
 * 用法:
 *   node scripts/get_context.js                → 格式化 JSON
 *   node scripts/get_context.js --save         → 同时写入 data/context.json
 *   node scripts/get_context.js --minify       → 单行 JSON（注入提示词用）
 *   node scripts/get_context.js --with-meals   → 附加今日饮食汇总
 */

const fs = require('fs');
const path = require('path');

// ─── 路径常量 ──────────────────────────────────────
const GYM_DIR = path.resolve(__dirname, '..');
const PLAN_PATH    = path.join(GYM_DIR, 'plan.json');
const DB_PATH      = path.join(GYM_DIR, 'gym_coach.db');
const CONTEXT_PATH = path.join(GYM_DIR, 'data', 'context.json');

// ─── 依赖 ──────────────────────────────────────────
let Database;
try { Database = require('better-sqlite3'); }
catch (e) { /* 降级：无 DB 时仍可输出基础上下文 */ }

// ─── 参数 ──────────────────────────────────────────
const args = process.argv.slice(2);
const doSave   = args.includes('--save');
const doMinify = args.includes('--minify');
const doMeals  = args.includes('--with-meals');

// ─── 读取 plan.json ────────────────────────────────
let plan;
try { plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf-8')); }
catch (e) { console.error('❌ 无法读取 plan.json'); process.exit(1); }

// ─── 当前真实时间 ──────────────────────────────────
const now = new Date();

// ─── 逻辑日期：每天 06:00 为新一天起点 ──────────────
let logical = new Date(now);
let dayNote = '正常时段(06:00-23:59)';
if (now.getHours() < 6) {
    logical.setDate(logical.getDate() - 1);
    dayNote = '凌晨(00:00-05:59)，逻辑日期为前一天';
}

const pad = (n) => String(n).padStart(2, '0');
const logicalDate = `${logical.getFullYear()}-${pad(logical.getMonth() + 1)}-${pad(logical.getDate())}`;
const weekdaysEn = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const weekdayEn  = weekdaysEn[logical.getDay()];

const weekdayCnMap = {
    monday: '周一', tuesday: '周二', wednesday: '周三',
    thursday: '周四', friday: '周五', saturday: '周六', sunday: '周日'
};

// ─── 训练日判断 ────────────────────────────────────
const trainingSchedule = {
    monday:    ['upper_a', 'Upper A (Push Focus)'],
    wednesday: ['lower',   'Lower (Legs + Core)'],
    friday:    ['upper_b', 'Upper B (Pull + Shoulder Focus)'],
};
const isTrainingDay = weekdayEn in trainingSchedule;
const [trainingKey, trainingName] = trainingSchedule[weekdayEn] || [null, null];

// ─── Phase & 最新体重（从 SQLite）──────────────────
let currentPhase = 'phase_1';
let phaseTargetKg = plan.phases.phase_1.target_kg;
let phaseConfig = plan.phases.phase_1;
let latestWeight = null;
let todayMeals = null;

if (Database) {
    try {
        const db = new Database(DB_PATH, { readonly: true });

        // 最新体重
        const wtRow = db.prepare('SELECT weight_kg FROM weight_logs ORDER BY logical_date DESC LIMIT 1').get();
        if (wtRow) {
            latestWeight = wtRow.weight_kg;
            if (latestWeight <= plan.phases.phase_3.target_kg) {
                currentPhase = 'phase_3';
                phaseTargetKg = plan.phases.phase_3.target_kg;
                phaseConfig = plan.phases.phase_3;
            } else if (latestWeight <= plan.phases.phase_2.target_kg) {
                currentPhase = 'phase_2';
                phaseTargetKg = plan.phases.phase_2.target_kg;
                phaseConfig = plan.phases.phase_2;
            }
        }

        // 今日饮食汇总
        if (doMeals) {
            todayMeals = db.prepare(`
                SELECT
                    COALESCE(SUM(calories), 0)  as total_calories,
                    COALESCE(SUM(protein_g), 0) as total_protein_g,
                    COALESCE(SUM(carbs_g), 0)   as total_carbs_g,
                    COALESCE(SUM(fat_g), 0)     as total_fat_g,
                    COUNT(*)                    as item_count
                FROM meals WHERE logical_date = ?
            `).get(logicalDate);
        }

        db.close();
    } catch (e) {
        // DB 不存在或表未创建，忽略
    }
}

// ─── 每日目标 ──────────────────────────────────────
const dailyCalories = phaseConfig.daily_calories;
const macros = phaseConfig.macros;

// ─── 构建上下文 ────────────────────────────────────
const context = {
    real_time: `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    real_weekday: weekdaysEn[now.getDay()],
    logical_date: logicalDate,
    weekday: weekdayEn,
    weekday_cn: weekdayCnMap[weekdayEn] || weekdayEn,
    hour: now.getHours(),
    minute: now.getMinutes(),
    day_note: dayNote,

    is_training_day: isTrainingDay,
    training_type: trainingKey,
    training_name: trainingName,
    is_rest_day: !isTrainingDay,

    current_phase: currentPhase,
    phase_target_kg: phaseTargetKg,
    latest_weight_kg: latestWeight,
    daily_calories: dailyCalories,
    macros: {
        protein_g: macros.protein_g || 170,
        fat_g_min: macros.fat_g_min || 50,
        fat_g_max: macros.fat_g_max || 65,
        carbs_g: macros.carbs_g || 'fill_remaining',
    },

    meal_window: {
        start: '12:00',
        end: '20:00',
        mode: '16:8 间歇断食，不吃早餐',
    },

    hydration_l: isTrainingDay ? 3.0 : 2.5,

    db_path: 'gym_coach.db',
    plan_path: 'plan.json',
    context_path: 'data/context.json',
};

// 附加今日饮食
if (todayMeals) {
    context.today_meals = todayMeals;
}

// ─── 输出 ──────────────────────────────────────────
const indent = doMinify ? undefined : 2;
const output = JSON.stringify(context, null, indent);
console.log(output);

// ─── 保存 ──────────────────────────────────────────
if (doSave) {
    fs.mkdirSync(path.dirname(CONTEXT_PATH), { recursive: true });
    fs.writeFileSync(CONTEXT_PATH, JSON.stringify(context, null, 2) + '\n', 'utf-8');
}
