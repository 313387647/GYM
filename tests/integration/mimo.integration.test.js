const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../../src/config');
const { MimoClient } = require('../../src/integrations/llm/mimoClient');
const { FoodVision } = require('../../src/integrations/vision/foodVision');
const { createTestDb, createTestContainer } = require('../helpers/testDb');

const enabled = process.env.MIMO_INTEGRATION === '1';
test('real MiMo Text API', { skip: !enabled }, async () => {
  const config = loadConfig();
  const result = await new MimoClient(config.mimo).text({ messages: [{ role: 'user', content: '只回复 OK' }], maxTokens: 300 });
  assert.ok(result.content);
});

test('real MiMo Vision API', { skip: !enabled || !process.env.MIMO_TEST_IMAGE }, async () => {
  const config = loadConfig();
  const client = new MimoClient(config.mimo);
  const result = await new FoodVision({ client, allowedRoots: config.wechat.allowedInboxRoots }).analyze(process.env.MIMO_TEST_IMAGE);
  assert.equal(typeof result.is_food, 'boolean');
});

test('real MiMo decision produces and executes validated multi-actions', { skip: !enabled }, async (t) => {
  const fixture = createTestDb();
  t.after(fixture.cleanup);
  const config = loadConfig({ GYM_DB_PATH: fixture.databasePath, WECHAT_INBOX_DIR: fixture.directory, WECHAT_ALLOWED_INBOX_ROOTS: fixture.directory });
  const container = createTestContainer(fixture, { client: new MimoClient(config.mimo) });
  const result = await container.orchestrator.handle({
    id: 'real-mimo-multi-action', type: 'user_message', user_id: 'integration-user',
    timestamp: '2026-08-10T04:30:00.000Z',
    payload: { message_id: 'real-mimo-message', text: '今天96.4kg，中午吃了一碗牛肉面和一个鸡蛋，请帮我记录。' },
  });
  assert.equal(result.error, undefined);
  assert.ok(result.decision.actions.some((action) => action.type === 'log_weight'));
  assert.ok(result.decision.actions.some((action) => action.type === 'log_meal'));
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM weight_logs').get().count, 1);
  assert.ok(fixture.db.prepare('SELECT COUNT(*) count FROM meals').get().count >= 1);
});
