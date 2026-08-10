const crypto = require('node:crypto');

function createId(prefix = 'id') { return `${prefix}_${crypto.randomUUID()}`; }
function stableId(prefix, ...parts) {
  const digest = crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24);
  return `${prefix}_${digest}`;
}

module.exports = { createId, stableId };
