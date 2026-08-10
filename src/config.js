const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function parseEnvFile(filePath = path.join(ROOT_DIR, '.env')) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith('#')) continue;
    const index = value.indexOf('=');
    if (index < 1) continue;
    const key = value.slice(0, index).trim();
    let parsed = value.slice(index + 1).trim();
    if ((parsed.startsWith('"') && parsed.endsWith('"')) || (parsed.startsWith("'") && parsed.endsWith("'"))) {
      parsed = parsed.slice(1, -1);
    }
    values[key] = parsed;
  }
  return values;
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function loadConfig(overrides = {}) {
  const fileEnv = parseEnvFile();
  const env = { ...fileEnv, ...process.env, ...overrides };
  const userConfig = readJson(path.join(ROOT_DIR, 'config.json'), readJson(path.join(ROOT_DIR, 'config.example.json')));
  const dataDir = path.resolve(env.GYM_DATA_DIR || path.join(ROOT_DIR, 'data'));
  const databasePath = path.resolve(env.GYM_DB_PATH || path.join(dataDir, 'gym_coach.db'));
  const legacyDatabasePath = path.join(ROOT_DIR, 'gym_coach.db');
  const inboxDir = path.resolve(env.WECHAT_INBOX_DIR || path.join(dataDir, 'inbox'));

  return {
    rootDir: ROOT_DIR,
    dataDir,
    databasePath,
    legacyDatabasePath,
    planPath: path.resolve(env.GYM_PLAN_PATH || path.join(ROOT_DIR, 'plan.json')),
    timezone: env.USER_TIMEZONE || userConfig.user?.timezone || 'Asia/Shanghai',
    logicalDayCutoffHour: Number(env.LOGICAL_DAY_CUTOFF_HOUR || 6),
    defaultUserId: env.GYM_USER_ID || 'primary-user',
    mimo: {
      apiKey: env.MIMO_API_KEY || '',
      apiBase: (env.MIMO_API_BASE || 'https://api.xiaomimimo.com/v1').replace(/\/$/, ''),
      textModel: env.MIMO_TEXT_MODEL || env.MIMO_MODEL || 'mimo-v2.5',
      visionModel: env.MIMO_VISION_MODEL || env.MIMO_MODEL || 'mimo-v2.5',
      timeoutMs: Number(env.MIMO_TIMEOUT_MS || 60000),
      maxRetries: Number(env.MIMO_MAX_RETRIES || 2),
    },
    scheduler: {
      enabled: !/^(0|false|no)$/i.test(env.SCHEDULER_ENABLED || 'true'),
      pollIntervalMs: Number(env.SCHEDULER_POLL_INTERVAL_MS || 60000),
      dispatchMode: env.SCHEDULER_DISPATCH_MODE || 'direct',
    },
    wechat: {
      instance: env.WECHAT_ACP_INSTANCE || 'gym',
      inboxDir,
      allowedInboxRoots: (env.WECHAT_ALLOWED_INBOX_ROOTS || inboxDir)
        .split(path.delimiter).filter(Boolean).map((entry) => path.resolve(entry)),
      maxImageBytes: Number(env.WECHAT_MAX_IMAGE_BYTES || 15 * 1024 * 1024),
      injectEnabled: /^(1|true|yes)$/i.test(env.WECHAT_INJECT_ENABLED || ''),
      executable: env.WECHAT_ACP_EXECUTABLE || 'wechat-acp',
      executableArgs: (() => {
        try { return JSON.parse(env.WECHAT_ACP_EXECUTABLE_ARGS || '[]'); }
        catch { return []; }
      })(),
    },
    user: userConfig.user || {},
  };
}

module.exports = { ROOT_DIR, loadConfig, parseEnvFile, readJson };
