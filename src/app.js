const fs = require('fs');
const path = require('path');
const { initDb, getDbPath, withDb } = require('./db/db');
const { loadConfig } = require('./utils/config');
const { envStatus } = require('./utils/env');
const { rootPath, ensureDir } = require('./utils/paths');
const { logInfo } = require('./utils/logger');
const { runCoach } = require('./engine/coach-engine');
const { sendText } = require('./gateway/wechat');

function initializeDatabase() {
  const result = initDb();
  console.log(`数据库已初始化：${result.dbPath}`);
  return result;
}

function healthcheck() {
  const checks = [];
  try {
    loadConfig();
    checks.push(['config', true, '配置文件正常']);
  } catch (error) {
    checks.push(['config', false, error.message]);
  }

  try {
    const dbPath = getDbPath();
    const dbExists = fs.existsSync(dbPath);
    if (!dbExists) throw new Error(`数据库不存在：${dbPath}`);
    withDb(db => db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('version'));
    checks.push(['database', true, dbPath]);
  } catch (error) {
    checks.push(['database', false, error.message]);
  }

  const logsDir = rootPath(process.env.GYM_LOG_DIR || 'logs');
  ensureDir(logsDir);
  checks.push(['logs', true, logsDir]);

  const env = envStatus();
  checks.push(['wechat', env.wechatConfigured, env.wechatConfigured ? '微信发送已配置' : '微信未配置，将输出到 console/logs']);
  checks.push(['llm', env.llmConfigured, env.llmConfigured ? 'LLM 已配置' : 'LLM 未配置，使用规则逻辑']);
  checks.push(['vision', env.visionConfigured, env.visionConfigured ? '图片识别已配置' : '图片识别未配置，使用占位提示']);

  for (const [name, ok, message] of checks) {
    console.log(`${ok ? 'OK ' : 'WARN'} ${name}: ${message}`);
  }

  const failed = checks.filter(([, ok, message]) => !ok && !/未配置/.test(message));
  if (failed.length) process.exitCode = 1;
  return checks;
}

async function start() {
  logInfo('service started', { pid: process.pid });
  console.log('GYM 猫娘助理已启动。本地服务运行中，微信 adapter 未配置时只输出日志。');
  setInterval(() => {
    logInfo('service heartbeat', { pid: process.pid });
  }, 60 * 60 * 1000);
  await new Promise(() => {});
}

async function dev() {
  await start();
}

async function handleMessage(text) {
  const result = await runCoach({ source: 'cli', type: 'text', text });
  console.log(result.reply);
  return result;
}

async function handleImage(imagePath) {
  const result = await runCoach({ source: 'cli', type: 'image', image_path: imagePath });
  console.log(result.reply);
  return result;
}

async function handleReminder(eventType, options = {}) {
  const result = await runCoach({ source: 'cli', type: 'reminder', event: eventType, force: options.force });
  sendText(result.reply);
  return result;
}

module.exports = { initializeDatabase, healthcheck, start, dev, handleMessage, handleImage, handleReminder };
