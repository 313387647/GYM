// src/utils/env.js — 统一读取 .env
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.resolve(__dirname, '../../.env');

function loadEnv() {
    const vars = {};
    try {
        const content = fs.readFileSync(ENV_PATH, 'utf-8');
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx === -1) continue;
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim();
            vars[key] = val;
        }
    } catch (e) {
        // .env 不存在，尝试从 process.env 获取
    }
    return {
        MIMO_API_KEY: vars.MIMO_API_KEY || process.env.MIMO_API_KEY || '',
        MIMO_API_BASE: vars.MIMO_API_BASE || process.env.MIMO_API_BASE || 'https://api.xiaomimimo.com/v1',
        MIMO_MODEL: vars.MIMO_MODEL || process.env.MIMO_MODEL || 'mimo-v2.5',
        WECHAT_BOT_ID: vars.WECHAT_BOT_ID || process.env.WECHAT_BOT_ID || '',
        WECHAT_USER_ID: vars.WECHAT_USER_ID || process.env.WECHAT_USER_ID || '',
    };
}

// 直接执行时只输出 key 名称，不输出 value
if (require.main === module) {
    const env = loadEnv();
    console.log(JSON.stringify({
        loaded_keys: Object.keys(env).filter(k => env[k]),
        MIMO_API_BASE: env.MIMO_API_BASE,
        MIMO_MODEL: env.MIMO_MODEL,
        has_api_key: !!env.MIMO_API_KEY,
        has_wechat: !!env.WECHAT_BOT_ID,
    }, null, 2));
}

module.exports = { loadEnv };
