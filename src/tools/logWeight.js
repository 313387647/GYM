#!/usr/bin/env node
// src/tools/logWeight.js — 体重记录（SQLite）
const { getDB, closeDB } = require('../db');
const { getLogicalDate } = require('../utils/date');

function parseArgs(argv) {
    const args = { weight: null, date: null, note: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--weight' && argv[i + 1]) { args.weight = parseFloat(argv[++i]); }
        else if (a === '--date' && argv[i + 1]) { args.date = argv[++i]; }
        else if (a === '--note' && argv[i + 1]) { args.note = argv[++i]; }
        else if (!isNaN(parseFloat(a)) && args.weight === null) { args.weight = parseFloat(a); }
    }
    return args;
}

function statusLabel(changeFromPrev, changeFromAvg, dataCount) {
    if (dataCount < 2) return 'insufficient_data';
    if (changeFromAvg <= -1.0) return 'dropping';
    if (changeFromAvg >= 1.5) return 'rebound';
    if (changeFromAvg >= 0 && changeFromAvg < 0.3) return 'plateau';
    return 'normal_fluctuation';
}

function coachHint(status, trend, weight) {
    const h = {
        insufficient_data: `体重数据还不够，再报 2-3 天就能看出趋势了。`,
        dropping: `7日均值在下降，保持节奏。`,
        normal_fluctuation: `今天体重有点波动正常，先看 7 日均值，不要被单日影响。`,
        plateau: `7 日均值连续不降，可以考虑加点有氧或控制一下晚餐碳水。`,
        rebound: `短期回升明显，检查最近钠摄入和睡眠。通常 2-3 天会回落。`,
    };
    return h[status] || h.normal_fluctuation;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.weight || isNaN(args.weight) || args.weight <= 0) {
        console.log(JSON.stringify({ success: false, error: '需要有效体重值: --weight <kg>' }));
        process.exit(1);
    }

    const { logical_date } = getLogicalDate();
    const dateStr = args.date || logical_date;

    const db = getDB();

    // 写入/更新
    db.prepare(`
        INSERT INTO weight_logs (logical_date, weight_kg, recorded_at)
        VALUES (?, ?, datetime('now','localtime'))
        ON CONFLICT(logical_date) DO UPDATE SET weight_kg = excluded.weight_kg, recorded_at = excluded.recorded_at
    `).run(dateStr, args.weight);

    // 查询最新 + 趋势
    const latest = db.prepare('SELECT * FROM weight_logs ORDER BY logical_date DESC LIMIT 1').get();
    const recent = db.prepare('SELECT * FROM weight_logs ORDER BY logical_date DESC LIMIT 7').all();
    const prev = recent.length >= 2 ? recent[1] : null;

    const avg7d = recent.length > 0
        ? Math.round((recent.reduce((s, r) => s + r.weight_kg, 0) / recent.length) * 10) / 10
        : null;

    const changeFromPrev = prev ? Math.round((args.weight - prev.weight_kg) * 10) / 10 : null;
    const changeFromAvg = avg7d ? Math.round((args.weight - avg7d) * 10) / 10 : null;
    const status = statusLabel(changeFromPrev, changeFromAvg, recent.length);
    const hint = args.note ? `${coachHint(status, null, args.weight)}（备注：${args.note}）` : coachHint(status, null, args.weight);

    const result = {
        success: true,
        date: dateStr,
        weight_kg: args.weight,
        trend: {
            previous_weight_kg: prev ? prev.weight_kg : null,
            change_from_previous: changeFromPrev,
            seven_day_avg: avg7d,
            change_from_seven_day_avg: changeFromAvg,
            data_days: recent.length,
            status,
        },
        coach_hint: hint,
    };

    if (args.note) result.note = args.note;

    closeDB();
    console.log(JSON.stringify(result, null, 2));
}

main();
