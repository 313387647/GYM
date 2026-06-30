#!/usr/bin/env node
// src/tools/analyzeFood.js — 食物图片分析 + 自动入库
const { getDB, closeDB } = require('../db');
const { getLogicalDate } = require('../utils/date');
const { loadEnv } = require('../utils/env');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const GYM_DIR = path.resolve(__dirname, '../..');

function parseArgs(argv) {
    const args = { image: null, meal: 'lunch', date: null };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--image' && argv[i + 1])  args.image = argv[++i];
        if (argv[i] === '--meal' && argv[i + 1])   args.meal = argv[++i];
        if (argv[i] === '--date' && argv[i + 1])   args.date = argv[++i];
    }
    return args;
}

function imageHash(filePath) {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

function callMiMo(imagePath) {
    const env = loadEnv();
    if (!env.MIMO_API_KEY) throw new Error('MIMO_API_KEY not set');

    const mime = execSync(`file --mime-type -b "${imagePath}"`, { encoding: 'utf-8' }).trim() || 'image/jpeg';
    const b64 = fs.readFileSync(imagePath).toString('base64');

    const systemPrompt = `你是一个专业的营养分析师。请根据食物图片，识别食物内容、估算份量，并以严格 JSON 格式输出分析结果，不要额外文字。
格式：{"items":[{"name":"食物名","amount":"份量","calories":数字,"protein_g":数字,"carbs_g":数字,"fat_g":数字,"confidence":"high/medium/low"}],"notes":"简短分析说明（1-2句中文）"}`;

    const payload = {
        model: env.MIMO_MODEL,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: [
                { type: 'text', text: '请分析这份食物的营养成分' },
                { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }
            ]}
        ],
        temperature: 0.3,
        max_tokens: 4000,
    };

    // 用 curl 调用
    const tmpFile = path.join(GYM_DIR, '.mimo_req_tmp.json');
    fs.writeFileSync(tmpFile, JSON.stringify(payload));

    let response;
    for (let retry = 0; retry <= 2; retry++) {
        try {
            response = execSync(
                `curl -s --max-time 60 "${env.MIMO_API_BASE}/chat/completions" -H "Content-Type: application/json" -H "Authorization: Bearer ${env.MIMO_API_KEY}" -d @${tmpFile}`,
                { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
            );
            if (!response.includes('"error"')) break;
        } catch (e) {
            if (retry === 2) throw e;
        }
        if (retry < 2) execSync('sleep 2');
    }

    try { fs.unlinkSync(tmpFile); } catch (e) {}

    const data = JSON.parse(response);
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('No content in MiMo response');

    // 提取 JSON
    let parsed;
    try { parsed = JSON.parse(content); } catch (e) {
        const match = content.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
        else throw new Error('No JSON found in response');
    }
    return parsed;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.image || !fs.existsSync(args.image)) {
        console.log(JSON.stringify({ success: false, error: '需要有效的图片路径: --image <path>' }));
        process.exit(args.image ? 1 : 0);
    }

    const hash = imageHash(args.image);
    const db = getDB();

    // 检查是否重复（通过 hash 前缀）
    const imageFile = path.basename(args.image, path.extname(args.image));
    const existing = db.prepare("SELECT id FROM meals WHERE item_name LIKE ? LIMIT 1").get(`%${imageFile}%`);

    try {
        const analysis = callMiMo(args.image);
        const { logical_date } = getLogicalDate();
        const dateStr = args.date || logical_date;

        const items = (analysis.items || []).map(it => ({
            name: it.name || '未知食物',
            amount: it.amount || null,
            calories: Number(it.calories) || 0,
            protein_g: Number(it.protein_g) || 0,
            carbs_g: it.carbs_g != null ? Number(it.carbs_g) : null,
            fat_g: it.fat_g != null ? Number(it.fat_g) : null,
            confidence: it.confidence || 'medium',
        }));

        if (items.length === 0) {
            console.log(JSON.stringify({ success: false, error: 'MiMo 未识别到食物' }));
            closeDB();
            process.exit(1);
        }

        // 原子写入
        const insert = db.prepare(`INSERT INTO meals (logical_date, meal_type, item_name, amount, calories, protein_g, carbs_g, fat_g, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`);
        const tx = db.transaction(() => {
            for (const it of items) {
                insert.run(dateStr, args.meal, `🖼️ ${it.name}`, it.amount, it.calories, it.protein_g, it.carbs_g, it.fat_g);
            }
        });
        tx();

        // 汇总
        const today = db.prepare('SELECT COALESCE(SUM(calories),0) as cal, COALESCE(SUM(protein_g),0) as pro FROM meals WHERE logical_date=?').get(dateStr);

        // 获取目标
        const planPath = path.join(GYM_DIR, 'plan.json');
        const plan = JSON.parse(fs.readFileSync(planPath, 'utf-8'));
        const wt = db.prepare('SELECT weight_kg FROM weight_logs ORDER BY logical_date DESC LIMIT 1').get();
        let phase = 'phase_1', phaseCfg = plan.phases.phase_1;
        if (wt) {
            if (wt.weight_kg <= plan.phases.phase_3.target_kg) { phase = 'phase_3'; phaseCfg = plan.phases.phase_3; }
            else if (wt.weight_kg <= plan.phases.phase_2.target_kg) { phase = 'phase_2'; phaseCfg = plan.phases.phase_2; }
        }
        const calLeft = Math.max(0, phaseCfg.daily_calories - today.cal);
        const proLeft = Math.max(0, phaseCfg.macros.protein_g - today.pro);

        const lowConf = items.filter(i => i.confidence === 'low');
        const warnings = lowConf.length > 0 ? [`${lowConf.length} 项识别置信度较低，热量可能不准确`] : [];

        const result = {
            success: true,
            date: dateStr,
            meal_type: args.meal,
            items: items.map(i => ({ name: i.name.replace('🖼️ ', ''), amount: i.amount, calories: i.calories, protein_g: i.protein_g, carbs_g: i.carbs_g, fat_g: i.fat_g, confidence: i.confidence })),
            today_summary: {
                calories_used: today.cal,
                calories_left: Math.round(calLeft),
                protein_used: today.pro,
                protein_left: Math.round(proLeft),
            },
            warnings,
            coach_hint: calLeft > 500
                ? `这餐记录好了，今天还有 ${Math.round(calLeft)}kcal 额度，蛋白还差 ${Math.round(proLeft)}g。`
                : `热量余额不多了，剩 ${Math.round(calLeft)}kcal，晚餐要以蛋白质为主。`,
        };

        closeDB();
        console.log(JSON.stringify(result, null, 2));
    } catch (e) {
        closeDB();
        console.log(JSON.stringify({ success: false, error: e.message, stage: 'mimo_call' }));
        process.exit(1);
    }
}

main();
