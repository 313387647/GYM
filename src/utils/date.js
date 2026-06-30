function pad(n) {
  return String(n).padStart(2, '0');
}

function formatDate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDateTime(date = new Date()) {
  return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getLogicalDate(date = new Date()) {
  const logical = new Date(date);
  if (logical.getHours() < 6) logical.setDate(logical.getDate() - 1);
  return formatDate(logical);
}

function getWeekdayName(dateInput = new Date()) {
  const date = typeof dateInput === 'string' ? parseDate(dateInput) : dateInput;
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()];
}

function parseDate(value) {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Invalid date: ${value}`);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return formatDate(d);
}

module.exports = {
  formatDate,
  formatDateTime,
  getLogicalDate,
  getWeekdayName,
  parseDate,
  startOfWeek
};
