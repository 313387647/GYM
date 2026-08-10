const crypto = require('node:crypto');

const SECRET_PATTERN = /^(authorization|api[_-]?key|token|access[_-]?token|refresh[_-]?token|wechat[_-]?token|secret|password)$/i;

function sanitize(value, depth = 0) {
  if (depth > 5) return '[truncated]';
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SECRET_PATTERN.test(key) ? '[redacted]' : sanitize(item, depth + 1),
  ]));
}

function hashUserId(userId) {
  return crypto.createHash('sha256').update(String(userId || 'unknown')).digest('hex').slice(0, 12);
}

function write(level, message, meta = {}) {
  const entry = sanitize({ timestamp: new Date().toISOString(), level, message, ...meta });
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}

module.exports = {
  info: (message, meta) => write('INFO', message, meta),
  warn: (message, meta) => write('WARN', message, meta),
  error: (message, meta) => write('ERROR', message, meta),
  hashUserId,
  sanitize,
};
