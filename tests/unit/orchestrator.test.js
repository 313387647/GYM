const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDb, createTestContainer } = require('../helpers/testDb');

test('orchestrator validates, executes structured actions through services, then rebuilds context', async (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const client = {
    async structuredJson() { return { data: { intent: 'record', actions: [{ type: 'log_weight', weight_kg: 96.4 }], needs_followup: false, response_goal: '确认体重记录', tone: 'neutral' } }; },
    async text() { return { content: '96.4kg 已经记下。' }; },
  };
  const container = createTestContainer(fixture, { client });
  const event = { id: 'evt-natural', type: 'user_message', user_id: 'user', timestamp: '2026-08-10T00:00:00.000Z', payload: { text: '今天96.4' } };
  const first = await container.orchestrator.handle(event);
  const second = await container.orchestrator.handle(event);
  assert.equal(first.actions[0].success, true);
  assert.equal(first.context.today.weight.weight_kg, 96.4);
  assert.equal(second.duplicate, true);
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM weight_logs').get().count, 1);
});
