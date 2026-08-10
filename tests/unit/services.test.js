const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDb, createTestContainer } = require('../helpers/testDb');

test('meal logging is authoritative and idempotent', (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const { services } = createTestContainer(fixture);
  const input = { actionKey: 'evt:0', logicalDate: '2026-08-10', mealType: 'lunch', items: [{ name: '牛肉面', calories: 650, protein_g: 35 }], sourceEventId: 'evt', recordedAt: '2026-08-10T04:00:00.000Z' };
  const first = services.mealService.logMeal(input);
  const second = services.mealService.logMeal(input);
  assert.equal(first.summary.calories, 650);
  assert.equal(second.duplicate, true);
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM meals').get().count, 1);
});

test('weight logging upserts a logical day and calculates trend', (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const { services } = createTestContainer(fixture);
  services.weightService.logWeight({ actionKey: 'w1', logicalDate: '2026-08-10', weightKg: 96.4, sourceEventId: 'w', recordedAt: '2026-08-10T00:00:00.000Z' });
  services.weightService.logWeight({ actionKey: 'w2', logicalDate: '2026-08-10', weightKg: 96.2, sourceEventId: 'w2', recordedAt: '2026-08-10T01:00:00.000Z' });
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM weight_logs').get().count, 1);
  assert.equal(services.weightService.trend().latest, 96.2);
});

test('workout logging preserves RPE and is idempotent', (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const { services } = createTestContainer(fixture);
  const input = { actionKey: 'wo:0', logicalDate: '2026-08-10', workoutType: 'upper_a', rpeScore: 8, totalDurationMin: 60, sourceEventId: 'wo', recordedAt: '2026-08-10T10:00:00.000Z' };
  services.workoutService.logWorkout(input);
  services.workoutService.logWorkout(input);
  const row = fixture.db.prepare('SELECT * FROM workouts').get();
  assert.equal(row.rpe_score, 8);
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM workouts').get().count, 1);
});

test('same image hash cannot create a second meal', (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const { services } = createTestContainer(fixture);
  const base = { logicalDate: '2026-08-10', mealType: 'lunch', items: [{ name: '鸡饭', calories: 500, protein_g: 40 }], imageHash: 'abc123', sourceMessageId: 'm1', sourceEventId: 'e1', recordedAt: '2026-08-10T04:00:00.000Z' };
  services.mealService.logMeal({ ...base, actionKey: 'e1:image' });
  const duplicate = services.mealService.logMeal({ ...base, actionKey: 'e2:image', sourceEventId: 'e2', sourceMessageId: 'm2' });
  assert.equal(duplicate.reason, 'image_already_logged');
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM meals').get().count, 1);
});
