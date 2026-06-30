const fs = require('fs');
const path = require('path');
const { rootPath, ensureDir } = require('./paths');
const { formatDateTime } = require('./date');

function logDir() {
  return process.env.GYM_LOG_DIR
    ? path.resolve(rootPath(), process.env.GYM_LOG_DIR)
    : rootPath('logs');
}

function writeLog(fileName, level, message, meta) {
  const dir = logDir();
  ensureDir(dir);
  const suffix = meta ? ` ${safeJson(meta)}` : '';
  const line = `[${formatDateTime()}] ${level} ${message}${suffix}\n`;
  fs.appendFileSync(path.join(dir, fileName), line, 'utf8');
}

function safeJson(value) {
  try {
    if (value instanceof Error) {
      return JSON.stringify({ message: value.message, stack: value.stack });
    }
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function logInfo(message, meta) {
  writeLog('app.log', 'INFO', message, meta);
}

function logReminder(message, meta) {
  writeLog('reminder.log', 'INFO', message, meta);
}

function logError(message, error) {
  writeLog('error.log', 'ERROR', message, error);
  writeLog('app.log', 'ERROR', message, error);
}

module.exports = { logInfo, logReminder, logError, logDir };
