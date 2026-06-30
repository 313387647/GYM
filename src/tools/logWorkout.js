#!/usr/bin/env node
// src/tools/logWorkout.js — 训练记录（SQLite）
const { getDB, closeDB } = require('../db');
const { getLogicalDate } = require('../utils/date');

const VALID_TYPES = ['upper_a', 'lower', 'upper_b', 'cardio', 'rest', 'other'];

function parseArgs(argv) {
    const args = { type: null, rpe: null, duration: null, cardio: null, notes: null, date: null, json: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--type' && argv[i + 1])       args.type = argv[++i];
        else if (a === '--rpe' && argv[i + 1])   args.rpe = parseInt(argv[++i]);
        else if (a === '--duration' && argv[i + 1]) args.duration = parseFloat(argv[++i]);
        else if (a === '--cardio' && argv[i + 1])   args.cardio = parseInt(argv[++i]);
        else if (a === '--notes' && argv[i + 1])    args.notes = argv[++i];
        else if (a === '--date' && argv[i + 1])     args.date = argv[++i];
        else if (a === '--json')                     args.json = true;
    }
    return args;
}

function readStdin() {
    return new Promise((resolve) => {
        let data = '';
        if (process.stdin.isTTY) return resolve(null);
        process.stdin.setEncoding('utf-8');
        process.stdin.on('readable', () => {
            let chunk;
            while ((chunk = process.stdin.read()) !== null) data += chunk;
        });
        process.stdin.on('end', () => resolve(data || null));
    });
}

function coachHint(rpe, type) {
    if (rpe >= 9) return '今天 RPE 偏高，下次同动作重量先不急着加，优先保证动作质量和恢复。';
    if (rpe >= 7) return '强度到位了，明天注意休息和蛋白补充。';
    if (rpe <= 3) return '今天强度偏低，下次可以尝试加一点重量或减少组间休息。';
    return `${type} 完成！记得记录每个动作的重量变化。`;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const { logical_date } = getLogicalDate();
    const dateStr = args.date || logical_date;

    let input = null;
    if (args.json) {
        const stdinData = await readStdin();
        if (stdinData) {
            try { input = JSON.parse(stdinData); }
            catch (e) { console.log(JSON.stringify({ success: false, error: 'JSON 解析失败: ' + e.message })); process.exit(1); }
        }
    }

    const workoutType = input?.workout_type || args.type;
    const rpe = input?.rpe_score ?? args.rpe;
    const duration = input?.total_duration_min ?? args.duration;
    const cardio = input?.cardio_done_min ?? args.cardio;
    const notes = input?.notes || args.notes;
    const workoutName = input?.workout_name || null;
    const exercises = input?.exercises || [];

    if (!workoutType || !VALID_TYPES.includes(workoutType)) {
        console.log(JSON.stringify({ success: false, error: `workout_type 必须是: ${VALID_TYPES.join(', ')}` }));
        process.exit(1);
    }
    if (rpe !== null && rpe !== undefined && (rpe < 1 || rpe > 10 || !Number.isInteger(rpe))) {
        console.log(JSON.stringify({ success: false, error: 'RPE 必须是 1-10 的整数' }));
        process.exit(1);
    }

    const db = getDB();

    const result = db.prepare(`INSERT INTO workouts (logical_date, workout_type, workout_name, total_duration_min, cardio_done_min, cardio_target_min, rpe_score, notes, recorded_at)
        VALUES (?, ?, ?, ?, ?, 20, ?, ?, datetime('now','localtime'))`)
        .run(dateStr, workoutType, workoutName, duration ?? null, cardio ?? 0, rpe ?? null, notes ?? null);

    const workoutId = result.lastInsertRowid;
    let exerciseCount = 0;

    if (Array.isArray(exercises) && exercises.length > 0) {
        const insertSet = db.prepare(`INSERT INTO exercise_sets (workout_id, exercise_name, set_number, reps, weight_kg, is_warmup, notes)
            VALUES (?, ?, ?, ?, ?, 0, ?)`);
        const tx = db.transaction(() => {
            for (const ex of exercises) {
                const exName = ex.name || ex.exercise_name;
                const sets = ex.sets || ex.set_number || 1;
                const reps = ex.reps || null;
                const weight = ex.weight_kg ?? null;
                const exNotes = ex.notes || null;
                for (let i = 1; i <= sets; i++) {
                    insertSet.run(workoutId, exName, i, reps, weight, exNotes);
                    exerciseCount++;
                }
            }
        });
        tx();
    }

    const hint = coachHint(rpe, workoutType);

    const output = {
        success: true,
        date: dateStr,
        workout_id: workoutId,
        workout_type: workoutType,
        summary: {
            duration_min: duration,
            rpe_score: rpe,
            exercise_count: exerciseCount,
            cardio_done_min: cardio ?? 0,
        },
        coach_hint: hint,
    };

    closeDB();
    console.log(JSON.stringify(output, null, 2));
}

main();
