const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function assertTimezone(timezone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    throw new RangeError(`Invalid IANA timezone: ${timezone}`);
  }
}

function zonedParts(input = new Date(), timezone = 'Asia/Shanghai') {
  assertTimezone(timezone);
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', weekday: 'long',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second),
    weekday: values.weekday.toLowerCase(),
  };
}

function dateString(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function shiftCalendarDate(value, days) {
  const [year, month, day] = value.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12));
  return shifted.toISOString().slice(0, 10);
}

function getLogicalTime(input = new Date(), options = {}) {
  const timezone = options.timezone || 'Asia/Shanghai';
  const cutoffHour = options.cutoffHour ?? 6;
  const parts = zonedParts(input, timezone);
  const calendarDate = dateString(parts);
  const logicalDate = parts.hour < cutoffHour ? shiftCalendarDate(calendarDate, -1) : calendarDate;
  const noon = zonedParts(zonedDateTimeToUtc(`${logicalDate}T12:00:00`, timezone), timezone);
  return {
    now: (input instanceof Date ? input : new Date(input)).toISOString(),
    timezone,
    local_date: calendarDate,
    local_time: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`,
    logical_date: logicalDate,
    weekday: noon.weekday,
    hour: parts.hour,
    minute: parts.minute,
    is_dawn: parts.hour < cutoffHour,
  };
}

function timezoneOffsetMs(date, timezone) {
  const parts = zonedParts(date, timezone);
  const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return representedAsUtc - date.getTime();
}

function zonedDateTimeToUtc(localDateTime, timezone = 'Asia/Shanghai') {
  assertTimezone(timezone);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(localDateTime);
  if (!match) throw new RangeError('Local datetime must be YYYY-MM-DDTHH:mm[:ss]');
  const [, y, m, d, hh, mm, ss = '00'] = match;
  const guess = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  let result = new Date(guess - timezoneOffsetMs(new Date(guess), timezone));
  result = new Date(guess - timezoneOffsetMs(result, timezone));
  return result;
}

function weekdayForDate(logicalDate) {
  const [year, month, day] = logicalDate.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay()];
}

module.exports = {
  WEEKDAYS, assertTimezone, zonedParts, getLogicalTime, zonedDateTimeToUtc,
  shiftCalendarDate, weekdayForDate,
};
