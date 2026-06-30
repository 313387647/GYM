function assertDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    throw new Error(`Invalid date: ${value}`);
  }
}

function assertNumber(value, label) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`${label} must be a number`);
  }
}

function clampText(text, max = 300) {
  if (!text) return '';
  const trimmed = String(text).trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

module.exports = { assertDate, assertNumber, clampText };
