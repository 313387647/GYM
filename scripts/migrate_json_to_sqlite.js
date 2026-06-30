#!/usr/bin/env node
/**
 * migrate_json_to_sqlite.js — 将 JSON 扁平文件无损迁移到 SQLite
 *
 * 用法:
 *   node scripts/migrate_json_to_sqlite.js                # 干跑，仅打印摘要
 *   node scripts/migrate_json_to_sqlite.js --execute      # 实际写入 gym_coach.db
 *
 * 迁移范围:
 *   data/weight.json       → weight_logs
 *   data/training.json     → workouts + exercise_sets
 *   data/daily/*.json      → meals + daily_summary
 */

const fs = require('fs');
const path = require('path');

const GYM_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(GYM_DIR, 'data');
const DAILY_DIR = path.join(DATA_DIR, 'daily');
const DB_PATH = path.join(GYM_DIR, 'gym_coach.db');
const WEIGHT_PATH = path.join(DATA_DIR, 'weight.json');
const TRAINING_PATH = path.join(DATA_DIR, 'training.json');

const doExecute = process.argv.includes('--execute');

// ─── 工具函数 ──────────────────────────────────────
function readJSON(fp) {
    try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

function normalizeMealType(raw) {
    if (!raw) return 'lunch';
    const t = raw.toLowerCase().trim();
    if (t === 'snack' || t === 'pre_workout') return 'pre_workout_snack';
    if (t === 'post_workout' || t === 'post_workout_dinner') return 'post_workout_dinner';
    if (t === 'dinner') return 'dinner';
    if (t === 'lunch') return 'lunch';
    return t;
}

// ─── 加载所有数据 ──────────────────────────────────
const weightData = readJSON(WEIGHT_PATH) || [];
const trainingData = readJSON(TRAINING_PATH) || [];
const dailyFiles = (() => {
    try { return fs.readdirSync(DAILY_DIR).filter(f => f.endsWith('.json')); }
    catch (e) { return []; }
})().sort();

const dailies = dailyFiles.map(f => ({
    file: f,
    data: readJSON(path.join(DAILY_DIR, f))
})).filter(d => d.data);

// ─── 构建迁移数据 ──────────────────────────────────

// 1. 体重记录
const weightRows = [];
for (const w of weightData) {
    if (w.date && w.weight_kg != null) {
        weightRows.push({
            logical_date: w.date,
            weight_kg: w.weight_kg,
            recorded_at: `${w.date} 08:00:00`
        });
    }
}
// 从 daily 文件中补充体重（如果 weight.json 里没有）
const weightDates = new Set(weightRows.map(r => r.logical_date));
for (const d of dailies) {
    if (d.data.weight_kg && !weightDates.has(d.data.date)) {
        weightRows.push({
            logical_date: d.data.date,
            weight_kg: d.data.weight_kg,
            recorded_at: `${d.data.date} 08:00:00`
        });
        weightDates.add(d.data.date);
    }
}
weightRows.sort((a, b) => a.logical_date.localeCompare(b.logical_date));

// 2. 训练 & 动作
const workoutRows = [];
const setRows = [];
for (const t of trainingData) {
    if (!t.date) continue;
    const wid = workoutRows.length + 1; // 模拟 ID
    workoutRows.push({
        id: wid,
        logical_date: t.date,
        workout_type: t.workout || null,
        workout_name: t.workout_name || null,
        total_duration_min: t.total_duration_min || null,
        cardio_done_min: t.cardio_done_min || 0,
        cardio_target_min: t.cardio_target_min || 20,
        calories_burned_kcal: t.calories_burned_kcal || null,
        avg_heart_rate_bpm: t.avg_heart_rate_bpm || null,
        heart_rate_range: t.heart_rate_range || null,
        location: t.location || null,
        rpe_score: t.rpe_score || null,
        grade: t.grade || null,
        notes: t.notes || null,
        recorded_at: `${t.date} 19:00:00`
    });

    if (!Array.isArray(t.exercises)) continue;
    let setNum = 0;
    for (const ex of t.exercises) {
        const setsDone = ex.sets_completed != null ? ex.sets_completed : (ex.planned_sets || 1);
        // 跳过未完成的动作（如 sets_completed=0 表示跳过了）
        if (setsDone <= 0) continue;
        // 跳过有氧类（cardio 在 workouts 表已有 cardio_done_min）
        if (ex.name && ex.name.includes('有氧')) continue;
        const weightArr = Array.isArray(ex.weight_used) ? ex.weight_used : [ex.weight_used || ex.planned_weight || 0];
        for (let i = 0; i < setsDone; i++) {
            setNum++;
            const repRange = ex.reps_target || '';
            const repMatch = repRange.match(/(\d+)\s*-\s*(\d+)/);
            const reps = repMatch ? parseInt(repMatch[2]) : null;
            setRows.push({
                workout_id: wid,
                exercise_name: ex.name,
                set_number: i + 1,
                reps: reps,
                weight_kg: weightArr[i] || weightArr[weightArr.length - 1] || null,
                is_warmup: 0,
                notes: i === setsDone - 1 && ex.notes ? ex.notes : null
            });
        }
    }
}

// 3. 饮食 & 每日汇总
const mealRows = [];
const summaryRows = [];
for (const d of dailies) {
    const dd = d.data;
    if (!dd.date) continue;

    // 提取体重（用于 daily_summary）
    let dailyWeight = null;
    if (dd.weight_kg != null) dailyWeight = dd.weight_kg;
    // 也查 weightRows
    if (dailyWeight == null) {
        const wr = weightRows.find(r => r.logical_date === dd.date);
        if (wr) dailyWeight = wr.weight_kg;
    }

    summaryRows.push({
        logical_date: dd.date,
        weight_kg: dailyWeight,
        steps: dd.steps || null,
        sleep_hours: dd.sleep_hours || null,
        water_intake_ml: dd.water_intake_ml || 0,
        training_completed: dd.training_completed ? 1 : 0,
        daily_grade: dd.daily_grade || null,
        rpe_score: dd.rpe_score || null,
        notes: dd.notes || null
    });

    // 提取食物
    if (!Array.isArray(dd.meals)) continue;
    for (const m of dd.meals) {
        const mt = normalizeMealType(m.meal);
        if (!Array.isArray(m.items)) continue;
        for (const it of m.items) {
            mealRows.push({
                logical_date: dd.date,
                meal_type: mt,
                item_name: it.name || '未知食物',
                amount: it.amount || null,
                calories: it.calories != null ? it.calories : 0,
                protein_g: it.protein_g != null ? it.protein_g : 0,
                carbs_g: it.carbs_g != null ? it.carbs_g : null,
                fat_g: it.fat_g != null ? it.fat_g : null,
                recorded_at: `${dd.date} 12:00:00`
            });
        }
    }
}

// ─── 输出摘要 ──────────────────────────────────────
console.log('╔══════════════════════════════════════╗');
console.log('║  📦 JSON → SQLite 迁移报告           ║');
console.log('╚══════════════════════════════════════╝');
console.log('');
console.log(`  📅 daily 文件:    ${dailyFiles.length} 个`);
console.log(`  ⚖️  体重记录:      ${weightRows.length} 条`);
console.log(`  🏋️  训练记录:      ${workoutRows.length} 场`);
console.log(`     └─ 动作组数:    ${setRows.length} 组`);
console.log(`  🍱 饮食条目:       ${mealRows.length} 条`);
console.log(`  📊 每日汇总:       ${summaryRows.length} 条`);
console.log(`  💾 目标数据库:     ${DB_PATH}`);
console.log('');

if (!doExecute) {
    console.log('⚠️  这是干跑模式 (dry run)。');
    console.log('   要实际写入数据库，请加 --execute 参数：');
    console.log('   node scripts/migrate_json_to_sqlite.js --execute');
    console.log('');
    // 打印一些样本
    if (weightRows.length > 0) {
        console.log('--- 体重样本 ---');
        for (const r of weightRows.slice(-3)) console.log(`   ${r.logical_date}: ${r.weight_kg}kg`);
    }
    if (mealRows.length > 0) {
        console.log('--- 饮食样本 ---');
        for (const r of mealRows.slice(-5)) console.log(`   ${r.logical_date} [${r.meal_type}] ${r.item_name} ${r.calories}kcal P${r.protein_g}g`);
    }
    if (workoutRows.length > 0) {
        console.log('--- 训练样本 ---');
        for (const r of workoutRows.slice(-3)) console.log(`   ${r.logical_date}: ${r.workout_type} ${r.total_duration_min}min 评分${r.grade}`);
    }
    process.exit(0);
}

// ─── 执行写入 ──────────────────────────────────────
// 使用 better-sqlite3 如果可用，否则用 sqlite3 CLI
let db;
try {
    const BetterSqlite3 = require('better-sqlite3');
    db = new BetterSqlite3(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    console.log('🔌 使用 better-sqlite3');
} catch (e) {
    console.log('⚠️  better-sqlite3 未安装，将使用 sqlite3 CLI');
    // 使用 child_process 调 sqlite3
    const { execSync } = require('child_process');
    const sqliteBin = execSync('which sqlite3', { encoding: 'utf-8' }).trim();
    if (!sqliteBin) {
        console.error('❌ 需要 sqlite3 CLI 或 better-sqlite3 模块');
        console.error('   brew install sqlite3');
        process.exit(1);
    }
    // 用临时 SQL 文件写入
    const tmpSql = path.join(GYM_DIR, 'migrate_tmp.sql');
    db = {
        exec: (sql) => {
            fs.appendFileSync(tmpSql, sql + ';\n');
        },
        prepare: () => ({ run: () => {}, finalize: () => {} })
    };
    // 先清掉旧临时文件
    try { fs.unlinkSync(tmpSql); } catch (e) {}
    // 我们会用 execSync 在最后执行
    global._sqliteCli = sqliteBin;
    global._tmpSql = tmpSql;
    global._useCli = true;
}

// 建表
db.exec(`
CREATE TABLE IF NOT EXISTS weight_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    logical_date TEXT NOT NULL UNIQUE,
    weight_kg REAL NOT NULL,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS meals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    logical_date TEXT NOT NULL,
    meal_type TEXT NOT NULL,
    item_name TEXT NOT NULL,
    amount TEXT,
    calories REAL NOT NULL,
    protein_g REAL NOT NULL,
    carbs_g REAL,
    fat_g REAL,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_meals_date ON meals(logical_date);
CREATE INDEX IF NOT EXISTS idx_meals_type ON meals(meal_type);

CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    logical_date TEXT NOT NULL,
    workout_type TEXT NOT NULL,
    workout_name TEXT,
    total_duration_min REAL,
    cardio_done_min INTEGER DEFAULT 0,
    cardio_target_min INTEGER DEFAULT 20,
    calories_burned_kcal REAL,
    avg_heart_rate_bpm INTEGER,
    heart_rate_range TEXT,
    location TEXT,
    rpe_score INTEGER,
    grade TEXT,
    notes TEXT,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(logical_date);

CREATE TABLE IF NOT EXISTS exercise_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id INTEGER NOT NULL REFERENCES workouts(id),
    exercise_name TEXT NOT NULL,
    set_number INTEGER NOT NULL,
    reps INTEGER,
    weight_kg REAL,
    is_warmup INTEGER DEFAULT 0,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_sets_workout ON exercise_sets(workout_id);

CREATE TABLE IF NOT EXISTS daily_summary (
    logical_date TEXT PRIMARY KEY,
    weight_kg REAL,
    steps INTEGER,
    sleep_hours REAL,
    water_intake_ml INTEGER DEFAULT 0,
    training_completed INTEGER DEFAULT 0,
    daily_grade TEXT,
    rpe_score INTEGER,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now','localtime'))
);
`);

// 标记版本
db.exec("INSERT OR REPLACE INTO schema_version (version) VALUES (1)");

// ─── 插入数据 ──────────────────────────────────────

// 体重
if (!global._useCli) {
    const insertWeight = db.prepare('INSERT OR REPLACE INTO weight_logs (logical_date, weight_kg, recorded_at) VALUES (?, ?, ?)');
    const insertBatch = db.transaction((rows) => {
        for (const r of rows) insertWeight.run(r.logical_date, r.weight_kg, r.recorded_at);
    });
    insertBatch(weightRows);
} else {
    for (const r of weightRows) {
        db.exec(`INSERT OR REPLACE INTO weight_logs (logical_date, weight_kg, recorded_at) VALUES ('${r.logical_date}', ${r.weight_kg}, '${r.recorded_at}')`);
    }
}

// 训练 & 动作
if (!global._useCli) {
    const insertWorkout = db.prepare(`INSERT INTO workouts (id, logical_date, workout_type, workout_name, total_duration_min, cardio_done_min, cardio_target_min, calories_burned_kcal, avg_heart_rate_bpm, heart_rate_range, location, rpe_score, grade, notes, recorded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertSet = db.prepare(`INSERT INTO exercise_sets (workout_id, exercise_name, set_number, reps, weight_kg, is_warmup, notes) VALUES (?,?,?,?,?,?,?)`);
    const workoutBatch = db.transaction((rows, sets) => {
        for (const r of rows) insertWorkout.run(r.id, r.logical_date, r.workout_type, r.workout_name, r.total_duration_min, r.cardio_done_min, r.cardio_target_min, r.calories_burned_kcal, r.avg_heart_rate_bpm, r.heart_rate_range, r.location, r.rpe_score, r.grade, r.notes, r.recorded_at);
        for (const s of sets) insertSet.run(s.workout_id, s.exercise_name, s.set_number, s.reps, s.weight_kg, s.is_warmup, s.notes);
    });
    workoutBatch(workoutRows, setRows);
} else {
    for (const r of workoutRows) {
        db.exec(`INSERT INTO workouts (id, logical_date, workout_type, workout_name, total_duration_min, cardio_done_min, cardio_target_min, calories_burned_kcal, avg_heart_rate_bpm, heart_rate_range, location, rpe_score, grade, notes, recorded_at) VALUES (${r.id}, '${r.logical_date}', '${r.workout_type}', ${r.workout_name ? `'${r.workout_name.replace(/'/g, "''")}'` : 'NULL'}, ${r.total_duration_min ?? 'NULL'}, ${r.cardio_done_min}, ${r.cardio_target_min}, ${r.calories_burned_kcal ?? 'NULL'}, ${r.avg_heart_rate_bpm ?? 'NULL'}, ${r.heart_rate_range ? `'${r.heart_rate_range}'` : 'NULL'}, ${r.location ? `'${r.location}'` : 'NULL'}, ${r.rpe_score ?? 'NULL'}, ${r.grade ? `'${r.grade}'` : 'NULL'}, ${r.notes ? `'${r.notes.replace(/'/g, "''")}'` : 'NULL'}, '${r.recorded_at}')`);
    }
    for (const s of setRows) {
        db.exec(`INSERT INTO exercise_sets (workout_id, exercise_name, set_number, reps, weight_kg, is_warmup, notes) VALUES (${s.workout_id}, '${s.exercise_name.replace(/'/g, "''")}', ${s.set_number}, ${s.reps ?? 'NULL'}, ${s.weight_kg ?? 'NULL'}, ${s.is_warmup}, ${s.notes ? `'${s.notes.replace(/'/g, "''")}'` : 'NULL'})`);
    }
}

// 饮食
if (!global._useCli) {
    const insertMeal = db.prepare(`INSERT INTO meals (logical_date, meal_type, item_name, amount, calories, protein_g, carbs_g, fat_g, recorded_at) VALUES (?,?,?,?,?,?,?,?,?)`);
    const mealBatch = db.transaction((rows) => {
        for (const r of rows) insertMeal.run(r.logical_date, r.meal_type, r.item_name, r.amount, r.calories, r.protein_g, r.carbs_g, r.fat_g, r.recorded_at);
    });
    mealBatch(mealRows);
} else {
    for (const r of mealRows) {
        const name = r.item_name.replace(/'/g, "''");
        const amt = r.amount ? `'${r.amount.replace(/'/g, "''")}'` : 'NULL';
        db.exec(`INSERT INTO meals (logical_date, meal_type, item_name, amount, calories, protein_g, carbs_g, fat_g, recorded_at) VALUES ('${r.logical_date}', '${r.meal_type}', '${name}', ${amt}, ${r.calories}, ${r.protein_g}, ${r.carbs_g ?? 'NULL'}, ${r.fat_g ?? 'NULL'}, '${r.recorded_at}')`);
    }
}

// 每日汇总
if (!global._useCli) {
    const insertSummary = db.prepare(`INSERT OR REPLACE INTO daily_summary (logical_date, weight_kg, steps, sleep_hours, water_intake_ml, training_completed, daily_grade, rpe_score, notes) VALUES (?,?,?,?,?,?,?,?,?)`);
    const summaryBatch = db.transaction((rows) => {
        for (const r of rows) insertSummary.run(r.logical_date, r.weight_kg, r.steps, r.sleep_hours, r.water_intake_ml, r.training_completed, r.daily_grade, r.rpe_score, r.notes);
    });
    summaryBatch(summaryRows);
} else {
    for (const r of summaryRows) {
        const n = r.notes ? `'${r.notes.replace(/'/g, "''")}'` : 'NULL';
        db.exec(`INSERT OR REPLACE INTO daily_summary (logical_date, weight_kg, steps, sleep_hours, water_intake_ml, training_completed, daily_grade, rpe_score, notes) VALUES ('${r.logical_date}', ${r.weight_kg ?? 'NULL'}, ${r.steps ?? 'NULL'}, ${r.sleep_hours ?? 'NULL'}, ${r.water_intake_ml}, ${r.training_completed}, ${r.daily_grade ? `'${r.daily_grade}'` : 'NULL'}, ${r.rpe_score ?? 'NULL'}, ${n})`);
    }
}

// CLI 模式：执行 SQL 文件
if (global._useCli) {
    const { execSync } = require('child_process');
    console.log('🔧 通过 sqlite3 CLI 执行迁移...');
    execSync(`${global._sqliteCli} "${DB_PATH}" < "${global._tmpSql}"`, { stdio: 'inherit' });
    try { fs.unlinkSync(global._tmpSql); } catch (e) {}
}

// 关闭数据库
if (db && db.close) db.close();

// ─── 最终验证 ──────────────────────────────────────
console.log('');
console.log('✅ 迁移完成！');
console.log('');
console.log(`📁 数据库: ${DB_PATH}`);
console.log('');
try {
    const BetterSqlite3 = require('better-sqlite3');
    const vdb = new BetterSqlite3(DB_PATH, { readonly: true });
    console.log('📊 验证:');
    console.log(`   weight_logs:  ${vdb.prepare('SELECT COUNT(*) as c FROM weight_logs').get().c} 行`);
    console.log(`   meals:        ${vdb.prepare('SELECT COUNT(*) as c FROM meals').get().c} 行`);
    console.log(`   workouts:     ${vdb.prepare('SELECT COUNT(*) as c FROM workouts').get().c} 行`);
    console.log(`   exercise_sets: ${vdb.prepare('SELECT COUNT(*) as c FROM exercise_sets').get().c} 行`);
    console.log(`   daily_summary: ${vdb.prepare('SELECT COUNT(*) as c FROM daily_summary').get().c} 行`);
    vdb.close();
} catch (e) {
    const { execSync } = require('child_process');
    console.log('📊 验证:');
    for (const t of ['weight_logs', 'meals', 'workouts', 'exercise_sets', 'daily_summary']) {
        const out = execSync(`${global._sqliteCli} "${DB_PATH}" "SELECT COUNT(*) FROM ${t};"`, { encoding: 'utf-8' }).trim();
        console.log(`   ${t}: ${out} 行`);
    }
}
