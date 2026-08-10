const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDb, createTestContainer } = require('../helpers/testDb');

test('daily state does not call an empty morning under-eating', (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const { services } = createTestContainer(fixture);
  const state = services.stateService.build({ logicalDate: '2026-08-10', weekday: 'monday', hour: 8 });
  assert.equal(state.nutrition.calorie_status, 'not_started_expected');
  assert.equal(state.training.planned, true);
});

test('context builder combines DB facts, plan, timezone, memory and reminders', (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const container = createTestContainer(fixture);
  fixture.db.prepare(`INSERT INTO memory_items (id,type,key,content,importance,active,created_at,updated_at)
    VALUES ('m','preference','style','不喜欢机械鼓励',3,1,'2026-08-01T00:00:00Z','2026-08-01T00:00:00Z')`).run();
  const context = container.contextBuilder.build({ id: 'evt', type: 'user_message', user_id: 'u', timestamp: '2026-08-10T03:00:00.000Z', payload: { text: 'hi' } });
  assert.equal(context.time.timezone, 'Asia/Shanghai');
  assert.equal(context.state.training.type, 'upper_a');
  assert.equal(context.memory[0].key, 'style');
  assert.ok(Array.isArray(context.today.meals));
});
