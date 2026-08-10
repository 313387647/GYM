const test = require('node:test');
const assert = require('node:assert/strict');
const { getLogicalTime, zonedDateTimeToUtc } = require('../../src/utils/timezone');

test('logical date uses user timezone and 06:00 cutoff', () => {
  const before = getLogicalTime('2026-08-10T21:30:00.000Z', { timezone: 'Asia/Shanghai', cutoffHour: 6 });
  assert.equal(before.local_time, '05:30');
  assert.equal(before.logical_date, '2026-08-10');
  const after = getLogicalTime('2026-08-10T22:00:00.000Z', { timezone: 'Asia/Shanghai', cutoffHour: 6 });
  assert.equal(after.logical_date, '2026-08-11');
});

test('local schedule converts to UTC independent of server timezone', () => {
  assert.equal(zonedDateTimeToUtc('2026-08-10T18:00:00', 'Asia/Shanghai').toISOString(), '2026-08-10T10:00:00.000Z');
  const shanghai = getLogicalTime('2026-08-10T16:30:00.000Z', { timezone: 'Asia/Shanghai' });
  const newYork = getLogicalTime('2026-08-10T16:30:00.000Z', { timezone: 'America/New_York' });
  assert.notEqual(shanghai.local_date, newYork.local_date);
});
