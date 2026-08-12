const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTestDb, createTestContainer } = require('../helpers/testDb');
const { ActionReceiptRepository } = require('../../src/repositories/actionReceiptRepository');
const { EventDispatcher } = require('../../src/scheduler/eventDispatcher');
const { ReminderService } = require('../../src/services/reminderService');
const { normalizePrompt } = require('../../src/integrations/wechat/normalizeMessage');
const { LlmTimeoutError } = require('../../src/integrations/llm/errors');
const { OutboundDeliveryWorker } = require('../../src/integrations/wechat/outboundWorker');
const { resolveUserId } = require('../../src/integrations/wechat/identity');
const { foodDraftRelationSchema } = require('../../src/agent/orchestrator');
const { DecisionEngine } = require('../../src/agent/decisionEngine');

const weightAndMeal = { intent: 'multi_action', actions: [
  { type: 'log_weight', weight_kg: 96.4 },
  { type: 'log_meal', meal_type: 'lunch', items: [{ name: '牛肉面', calories: 650, protein_g: 35 }] },
], needs_followup: false, response_goal: '记录', tone: 'neutral' };

test('ACP uses a stable configured user id when the transport does not provide one', () => {
  assert.equal(resolveUserId(undefined, { defaultUserId: 'primary-user' }), 'primary-user');
  assert.equal(resolveUserId({ wechatUserId: 'wechat-user' }, { defaultUserId: 'primary-user' }), 'wechat-user');
});

test('agent decision and repair disable thinking for deterministic JSON', async () => {
  const requests = [];
  const client = { async structuredJson(input) {
    requests.push(input);
    return { data: { intent: 'chat', actions: [], needs_followup: false, response_goal: '测试', tone: 'neutral' } };
  } };
  const engine = new DecisionEngine({ client });
  const event = { type: 'user_message', payload: { text: '测试一下' } };
  await engine.decide(event, {}, undefined);
  await engine.repair(event, {}, requests[0].data, undefined);
  assert.equal(requests.length, 2);
  assert.equal(requests.every((request) => request.thinking === 'disabled'), true);
});

test('event retry reuses persisted decision and continues after a later action failure', async (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  let decisions = 0; let failMeal = true;
  const client = { async structuredJson() { decisions += 1; return { data: structuredClone(weightAndMeal) }; }, async text() { return { content: '好。' }; } };
  const container = createTestContainer(fixture, { client });
  const realLogMeal = container.services.mealService.logMeal.bind(container.services.mealService);
  container.services.mealService.logMeal = (input) => { if (failMeal) { failMeal = false; throw new Error('temporary meal failure'); } return realLogMeal(input); };
  const event = { id: 'retry-decision', type: 'user_message', user_id: 'u', timestamp: '2026-08-10T04:00:00.000Z', payload: { text: '96.4，吃牛肉面' } };
  assert.equal((await container.orchestrator.handle(event)).error, 'AGENT_ERROR');
  const retry = await container.orchestrator.handle(event);
  assert.equal(decisions, 1);
  assert.equal(retry.actions[0].duplicate, true);
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM weight_logs').get().count, 1);
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM meals').get().count, 1);
});

test('action receipt cannot be reused across action types', (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  new ActionReceiptRepository(fixture.db).save('same-key', 'log_meal', { success: true });
  const container = createTestContainer(fixture);
  assert.throws(() => container.services.weightService.logWeight({ actionKey: 'same-key', logicalDate: '2026-08-10', weightKg: 90, recordedAt: '2026-08-10T00:00:00.000Z' }), { code: 'ACTION_RECEIPT_TYPE_MISMATCH' });
});

test('scheduled decisions cannot write health facts', async (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const client = { async structuredJson() { return { data: { intent: 'scheduled_decision', actions: [{ type: 'log_weight', weight_kg: 90 }], needs_followup: false, tone: 'neutral', notification: { action: 'send', reason: 'bad' } } }; }, async text() { return { content: 'must not send' }; } };
  const container = createTestContainer(fixture, { client });
  const result = await container.orchestrator.handle({ id: 'scheduled-write', type: 'morning_check', user_id: 'u', timestamp: '2026-08-10T00:00:00.000Z', payload: {} });
  assert.equal(result.error, 'SCHEDULED_ACTION_FORBIDDEN');
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM weight_logs').get().count, 0);
});

test('scheduled MiMo timeout schedules retry without outbound delivery', async (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const client = { async structuredJson() { throw new LlmTimeoutError('timeout', { code: 'TIMEOUT' }); }, async text() { throw new Error('not called'); } };
  const container = createTestContainer(fixture, { client });
  const reminder = container.repositories.reminderRepository.create({ id: 'timeout-reminder', eventType: 'morning_check', scheduledAt: '2026-08-10T00:00:00.000Z', payload: {}, now: '2026-08-09T23:00:00.000Z' });
  container.repositories.reminderRepository.claim(reminder.id, '2026-08-10T00:00:00.000Z');
  const dispatcher = new EventDispatcher({ config: container.config, orchestrator: container.orchestrator, reminderService: new ReminderService({ reminderRepository: container.repositories.reminderRepository }), eventRepository: container.repositories.eventRepository, injector: { async enqueue() { throw new Error('not called'); } } });
  const outcome = await dispatcher.dispatch(reminder, new Date('2026-08-10T00:00:00.000Z'));
  assert.equal(outcome.action, 'retry');
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM outbound_messages').get().count, 0);
  assert.equal(container.repositories.reminderRepository.get(reminder.id).status, 'pending');
});

test('inject-disabled core leaves outbound retry ownership to the delivery worker', async (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const container = createTestContainer(fixture);
  const event = { id: 'worker-owned-event', type: 'scheduled_check', user_id: 'u', timestamp: '2026-08-10T00:00:00.000Z', payload: {} };
  container.repositories.eventRepository.create(event, 'test-user');
  container.repositories.eventRepository.createOutbound({ id: 'worker-owned-outbound', eventId: event.id, userIdHash: 'test-user', content: 'test', now: event.timestamp });
  let injectCalls = 0;
  const dispatcher = new EventDispatcher({
    config: { ...container.config, wechat: { ...container.config.wechat, injectEnabled: false } },
    orchestrator: container.orchestrator,
    reminderService: new ReminderService({ reminderRepository: container.repositories.reminderRepository }),
    eventRepository: container.repositories.eventRepository,
    injector: { async enqueue() { injectCalls += 1; return { queued: false }; } },
  });
  assert.equal(await dispatcher.retryPendingOutbounds(), 0);
  const outbound = container.repositories.eventRepository.outbound('worker-owned-outbound');
  assert.equal(injectCalls, 0);
  assert.equal(outbound.status, 'pending');
  assert.equal(outbound.retry_count, 0);
});

test('recent conversation and food clarification pending interaction close without another vision call', async (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  let visionCalls = 0;
  const foodVision = { async analyze() { visionCalls += 1; return { is_food: true, confidence: 'low', needs_clarification: true, items: [{ name: '鸡肉', calories: 400, protein_g: 45 }], image_hash: 'pending-image' }; } };
  const client = { async structuredJson() { return { data: { items: [{ name: '鸡肉', amount: '300g', calories: 360, protein_g: 65, carbs_g: 0, fat_g: 8 }] } }; }, async text() { return { content: '收到。' }; } };
  const container = createTestContainer(fixture, { foodVision, client });
  await container.orchestrator.handle({ id: 'food-image', type: 'image_received', user_id: 'u', timestamp: '2026-08-10T04:00:00.000Z', payload: { path: '/ignored', message_id: 'm1', meal_type: 'lunch' } });
  const reply = await container.orchestrator.handle({ id: 'food-grams', type: 'user_message', user_id: 'u', timestamp: '2026-08-10T04:01:00.000Z', payload: { text: '300g左右' } });
  assert.equal(visionCalls, 1); assert.equal(reply.actions[0].success, true);
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM meals').get().count, 1);
  assert.equal(container.contextBuilder.build({ id: 'context', type: 'user_message', user_id: 'u', timestamp: '2026-08-10T04:02:00.000Z', payload: {} }).recent_conversation.length >= 1, true);
});

test('food quantity clarification recalibrates nutrition through text model without another vision request', async (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  let visionCalls = 0; let calibrationCalls = 0;
  const foodVision = { async analyze() { visionCalls += 1; return { is_food: true, confidence: 'low', needs_clarification: true, items: [{ name: '鸡肉', amount: '未知', calories: 400, protein_g: 45, carbs_g: 0, fat_g: 12 }], image_hash: 'recal-image' }; } };
  const client = { async structuredJson() { calibrationCalls += 1; return { data: { items: [{ name: '鸡肉', amount: '200g', calories: 260, protein_g: 50, carbs_g: 0, fat_g: 6 }] } }; }, async text() { return { content: '收到。' }; } };
  const container = createTestContainer(fixture, { foodVision, client });
  await container.orchestrator.handle({ id: 'recal-image', type: 'image_received', user_id: 'u', timestamp: '2026-08-10T04:00:00.000Z', payload: { path: '/ignored', message_id: 'm', meal_type: 'lunch' } });
  await container.orchestrator.handle({ id: 'recal-answer', type: 'user_message', user_id: 'u', timestamp: '2026-08-10T04:01:00.000Z', payload: { text: '鸡肉约200g' } });
  const meal = fixture.db.prepare('SELECT calories, protein_g, item_name FROM meals').get();
  assert.equal(visionCalls, 1); assert.equal(calibrationCalls, 2);
  assert.deepEqual(meal, { calories: 260, protein_g: 50, item_name: '鸡肉' });
});

test('ambiguous multi-item total weight remains pending instead of assigning it to every item', async (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const foodVision = { async analyze() { return { is_food: true, confidence: 'low', needs_clarification: true, items: [{ name: '鸡肉', calories: 200, protein_g: 30 }, { name: '米饭', calories: 300, protein_g: 5 }], image_hash: 'multi-image' }; } };
  const client = { async structuredJson({ schema }) { if (schema === foodDraftRelationSchema) return { data: { relation: 'attach', cancel_draft: false } }; throw new Error('must not calibrate ambiguous total'); }, async text() { return { content: '收到。' }; } };
  const container = createTestContainer(fixture, { foodVision, client });
  await container.orchestrator.handle({ id: 'multi-image', type: 'image_received', user_id: 'u', timestamp: '2026-08-10T04:00:00.000Z', payload: { path: '/ignored', message_id: 'm', meal_type: 'lunch' } });
  const result = await container.orchestrator.handle({ id: 'multi-answer', type: 'user_message', user_id: 'u', timestamp: '2026-08-10T04:01:00.000Z', payload: { text: '300g' } });
  assert.match(result.response, /整份/);
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM meals').get().count, 0);
  assert.equal(container.repositories.pendingInteractionRepository.active('0bfe935e70c3', 'food_image_draft', '2026-08-10T04:01:00.000Z').status, 'active');
});

test('food image is held as a draft and nearby user description replaces incorrect vision before one meal write', async (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  let visionCalls = 0; let fusionCalls = 0; let relationCalls = 0; const structuredOptions = [];
  const foodVision = { async analyze() { visionCalls += 1; return { is_food: true, confidence: 'high', needs_clarification: false, items: [{ name: '错误识别', amount: '1份', calories: 999, protein_g: 1 }], image_hash: 'wrong-vision-image' }; } };
  const client = {
    async structuredJson(input) {
      const { schema } = input;
      structuredOptions.push(input);
      if (schema === foodDraftRelationSchema) { relationCalls += 1; return { data: { relation: 'attach', cancel_draft: false } }; }
      fusionCalls += 1; return { data: { items: [{ name: '小锅米线', amount: '1碗', calories: 520, protein_g: 21, carbs_g: 75, fat_g: 16 }] } };
    },
    async text() { return { content: '收到。' }; },
  };
  const container = createTestContainer(fixture, { foodVision, client });
  await container.orchestrator.handle({ id: 'draft-only-image', type: 'image_received', user_id: 'u', timestamp: '2026-08-10T04:00:00.000Z', payload: { path: '/ignored', message_id: 'image-1', meal_type: 'lunch' } });
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM meals').get().count, 0);
  assert.equal(container.repositories.pendingInteractionRepository.active('0bfe935e70c3', 'food_image_draft', '2026-08-10T04:01:00.000Z').status, 'active');
  await container.orchestrator.handle({ id: 'draft-description', type: 'user_message', user_id: 'u', timestamp: '2026-08-10T04:01:00.000Z', payload: { text: '吃小锅米线' } });
  const meal = fixture.db.prepare('SELECT item_name, calories FROM meals').get();
  assert.equal(visionCalls, 1); assert.equal(relationCalls, 1); assert.equal(fusionCalls, 1);
  assert.deepEqual(meal, { item_name: '小锅米线', calories: 520 });
  assert.equal(structuredOptions.every((input) => input.thinking === 'disabled'), true);
  assert.equal(structuredOptions.every((input) => input.responseFormat?.type === 'json_object'), true);
});

test('duplicate image event does not create another draft, vision call, or meal', async (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  let visionCalls = 0;
  const foodVision = { imageHash() { return 'same-image'; }, async analyze() { visionCalls += 1; return { is_food: true, confidence: 'high', items: [{ name: '米线', calories: 500, protein_g: 20 }], image_hash: 'same-image' }; } };
  const container = createTestContainer(fixture, { foodVision });
  const image = { id: 'same-image-event', type: 'image_received', user_id: 'u', timestamp: '2026-08-10T04:00:00.000Z', payload: { path: '/ignored', message_id: 'image-same', meal_type: 'lunch' } };
  await container.orchestrator.handle(image);
  await container.orchestrator.handle({ ...image, id: 'same-image-retry', timestamp: '2026-08-10T04:01:00.000Z' });
  assert.equal(visionCalls, 1);
  assert.equal(fixture.db.prepare("SELECT COUNT(*) count FROM pending_interactions WHERE kind='food_image_draft'").get().count, 1);
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM meals').get().count, 0);
});

test('a seven-minute explicit food description attaches to the active image draft and preserves image hash', async (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const foodVision = { async analyze() { return { is_food: true, confidence: 'medium', items: [{ name: '凉皮', calories: 260, protein_g: 6 }], image_hash: 'seven-minute-image' }; } };
  const client = { async structuredJson({ schema }) {
    if (schema === foodDraftRelationSchema) return { data: { relation: 'attach', cancel_draft: false } };
    return { data: { items: [{ name: '小锅米线', amount: '1碗', calories: 520, protein_g: 20, carbs_g: 70, fat_g: 15 }] } };
  }, async text() { return { content: '收到。' }; } };
  const container = createTestContainer(fixture, { foodVision, client });
  await container.orchestrator.handle({ id: 'draft-seven-image', type: 'image_received', user_id: 'u', timestamp: '2026-08-10T04:00:00.000Z', payload: { path: '/ignored', message_id: 'photo', meal_type: 'lunch' } });
  await container.orchestrator.handle({ id: 'draft-seven-text', type: 'user_message', user_id: 'u', timestamp: '2026-08-10T04:07:00.000Z', payload: { text: '吃小锅米线' } });
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM meals').get().count, 1);
  assert.equal(fixture.db.prepare('SELECT image_hash FROM meals').get().image_hash, 'seven-minute-image');
  assert.equal(container.repositories.pendingInteractionRepository.active('0bfe935e70c3', 'food_image_draft', '2026-08-10T04:08:00.000Z'), null);
  assert.equal(fixture.db.prepare("SELECT status FROM pending_interactions WHERE source_event_id='draft-seven-image'").get().status, 'completed');
});

test('a thirty-minute explicit correction attaches, while an unrelated future meal leaves its draft active', async (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const foodVision = { async analyze() { return { is_food: true, confidence: 'medium', items: [{ name: '米皮', calories: 300, protein_g: 8 }], image_hash: 'relation-image' }; } };
  const client = { async structuredJson({ schema, messages }) {
    if (schema === foodDraftRelationSchema) {
      const text = JSON.parse(messages[1].content).user_text;
      return { data: { relation: text.includes('晚上想') ? 'unrelated' : 'attach', cancel_draft: false } };
    }
    if (String(messages[1]?.content).includes('vision_analysis')) {
      return { data: { items: [{ name: '麻酱凉皮', amount: '一小份', calories: 300, protein_g: 8, carbs_g: 35, fat_g: 15 }] } };
    }
    return { data: { intent: 'chat', actions: [], needs_followup: false, response_goal: '普通聊天', tone: 'neutral' } };
  }, async text() { return { content: '收到。' }; } };
  const container = createTestContainer(fixture, { foodVision, client });
  await container.orchestrator.handle({ id: 'relation-image', type: 'image_received', user_id: 'u', timestamp: '2026-08-10T04:00:00.000Z', payload: { path: '/ignored', message_id: 'photo', meal_type: 'lunch' } });
  await container.orchestrator.handle({ id: 'relation-unrelated', type: 'user_message', user_id: 'u', timestamp: '2026-08-10T04:15:00.000Z', payload: { text: '晚上想吃牛肉面' } });
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM meals').get().count, 0);
  assert.ok(container.repositories.pendingInteractionRepository.active('0bfe935e70c3', 'food_image_draft', '2026-08-10T04:15:00.000Z'));
  await container.orchestrator.handle({ id: 'relation-attach', type: 'user_message', user_id: 'u', timestamp: '2026-08-10T04:30:00.000Z', payload: { text: '这是麻酱凉皮，一小份' } });
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM meals').get().count, 1);
  assert.equal(fixture.db.prepare("SELECT status FROM pending_interactions WHERE source_event_id='relation-image'").get().status, 'completed');
});

test('ambiguous draft relation never writes a standalone meal and explicit cancellation cancels the draft', async (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  let relation = 'ambiguous';
  const foodVision = { async analyze() { return { is_food: true, confidence: 'medium', items: [{ name: '食物', calories: 100, protein_g: 5 }], image_hash: 'cancel-image' }; } };
  const client = { async structuredJson({ schema }) {
    if (schema === foodDraftRelationSchema) return { data: { relation: relation === 'cancel' ? 'unrelated' : relation, cancel_draft: relation === 'cancel' } };
    throw new Error('fusion must not run');
  }, async text() { return { content: '收到。' }; } };
  const container = createTestContainer(fixture, { foodVision, client });
  await container.orchestrator.handle({ id: 'cancel-image', type: 'image_received', user_id: 'u', timestamp: '2026-08-10T04:00:00.000Z', payload: { path: '/ignored', message_id: 'photo', meal_type: 'lunch' } });
  const ambiguous = await container.orchestrator.handle({ id: 'ambiguous-reply', type: 'user_message', user_id: 'u', timestamp: '2026-08-10T04:20:00.000Z', payload: { text: '差不多' } });
  assert.match(ambiguous.response, /刚才那张饭图/);
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM meals').get().count, 0);
  relation = 'cancel';
  await container.orchestrator.handle({ id: 'cancel-reply', type: 'user_message', user_id: 'u', timestamp: '2026-08-10T04:21:00.000Z', payload: { text: '刚才那张不用记了' } });
  assert.equal(fixture.db.prepare("SELECT status FROM pending_interactions WHERE source_event_id='cancel-image'").get().status, 'cancelled');
});

test('one decision repair turns an actionable empty plan change into a persisted schedule mutation', async (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  let calls = 0;
  const client = {
    async structuredJson() {
      calls += 1;
      return { data: calls === 1
        ? { intent: 'plan_change', actions: [], needs_followup: false, response_goal: '调整提醒', tone: 'neutral' }
        : { intent: 'plan_change', actions: [{ type: 'update_schedule_rule', rule_id: 'morning-check', local_time: '08:00' }], needs_followup: false, response_goal: '已调整', tone: 'neutral' } };
    },
    async text() { return { content: '已调整。' }; },
  };
  const container = createTestContainer(fixture, { client });
  await container.orchestrator.handle({ id: 'repair-schedule', type: 'user_message', user_id: 'u', timestamp: '2026-08-10T04:00:00.000Z', payload: { text: '以后早上八点提醒我' } });
  assert.equal(calls, 2);
  assert.equal(container.repositories.scheduleRepository.get('morning-check').local_time, '08:00');
});

test('decision repair runs at most once when the repaired result is still empty', async (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  let calls = 0;
  const client = {
    async structuredJson() { calls += 1; return { data: { intent: 'plan_change', actions: [], needs_followup: false, response_goal: '调整提醒', tone: 'neutral' } }; },
    async text() { return { content: '需要更多信息。' }; },
  };
  const container = createTestContainer(fixture, { client });
  await container.orchestrator.handle({ id: 'repair-once', type: 'user_message', user_id: 'u', timestamp: '2026-08-10T04:00:00.000Z', payload: { text: '以后早上八点提醒我' } });
  assert.equal(calls, 2);
});

test('training completion gets one repair, writes workout, and creates an RPE pending interaction', async (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  let calls = 0;
  const client = {
    async structuredJson() {
      calls += 1;
      return { data: calls === 1
        ? { intent: 'chat', actions: [], needs_followup: true, followup_question: '训练做了什么？', response_goal: '闲聊', tone: 'neutral' }
        : { intent: 'record', actions: [{ type: 'log_workout', workout_type: 'upper_a', total_duration_min: 60 }], needs_followup: false, response_goal: '记录训练', tone: 'neutral' } };
    },
    async text() { return { content: '训练已记。' }; },
  };
  const container = createTestContainer(fixture, { client });
  await container.orchestrator.handle({ id: 'repair-workout', type: 'user_message', user_id: 'u', timestamp: '2026-08-10T04:00:00.000Z', payload: { text: '今天训练做完了' } });
  assert.equal(calls, 2);
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM workouts').get().count, 1);
  assert.ok(container.repositories.pendingInteractionRepository.active('0bfe935e70c3', 'workout_rpe', '2026-08-10T04:01:00.000Z'));
});

test('pending interactions expire and numeric RPE prefers workout pending over food pending', async (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const container = createTestContainer(fixture);
  const hash = '0bfe935e70c3';
  for (const id of ['old-food', 'new-food', 'rpe-pending']) container.repositories.eventRepository.create({ id, type: 'user_message', user_id: 'u', timestamp: '2026-08-10T00:00:00.000Z', payload: {} }, hash);
  container.repositories.pendingInteractionRepository.create({ userIdHash: hash, kind: 'food_quantity', payload: { analysis: { items: [] } }, sourceEventId: 'old-food', now: '2026-08-09T00:00:00.000Z' });
  const expired = await container.orchestrator.handle({ id: 'today-food', type: 'user_message', user_id: 'u', timestamp: '2026-08-10T04:00:00.000Z', payload: { text: '300g' } });
  assert.equal(expired.actions.length, 0);
  assert.equal(fixture.db.prepare("SELECT status FROM pending_interactions WHERE source_event_id='old-food'").get().status, 'expired');
  const workout = container.services.workoutService.logWorkout({ actionKey: 'rpe-base', logicalDate: '2026-08-10', workoutType: 'upper_a', recordedAt: '2026-08-10T04:00:00.000Z' }).workout;
  container.repositories.pendingInteractionRepository.create({ userIdHash: hash, kind: 'food_quantity', payload: { analysis: { items: [] } }, sourceEventId: 'new-food', now: '2026-08-10T04:00:00.000Z' });
  container.repositories.pendingInteractionRepository.create({ userIdHash: hash, kind: 'workout_rpe', payload: { workout_id: workout.id }, sourceEventId: 'rpe-pending', now: '2026-08-10T04:00:00.000Z' });
  await container.orchestrator.handle({ id: 'rpe-answer', type: 'user_message', user_id: 'u', timestamp: '2026-08-10T04:01:00.000Z', payload: { text: '8' } });
  assert.equal(fixture.db.prepare('SELECT rpe_score FROM workouts WHERE id=?').get(workout.id).rpe_score, 8);
  assert.equal(container.repositories.pendingInteractionRepository.active(hash, 'food_quantity', '2026-08-10T04:01:00.000Z').status, 'active');
});

test('outbound worker backs off, stops after max retries, and expires exhausted queued records', async (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const container = createTestContainer(fixture); const repo = container.repositories.eventRepository;
  repo.create({ id: 'retry-event', type: 'morning_check', user_id: 'u', timestamp: '2026-08-10T00:00:00.000Z', payload: {} }, 'hash');
  repo.createOutbound({ id: 'retry-outbound', eventId: 'retry-event', userIdHash: 'hash', content: 'hello', now: '2026-08-10T00:00:00.000Z' });
  let attempts = 0; const worker = new OutboundDeliveryWorker({ config: { outbound: { maxRetries: 3, retryBaseMs: 30000 } }, repository: repo, injector: { async enqueue() { attempts += 1; throw new Error('inject down'); } } });
  await worker.tick(new Date('2026-08-10T00:00:00.000Z'));
  await worker.tick(new Date('2026-08-10T00:00:30.000Z'));
  await worker.tick(new Date('2026-08-10T00:01:30.000Z'));
  await worker.tick(new Date('2026-08-10T00:10:00.000Z'));
  assert.equal(attempts, 3); assert.equal(repo.outbound('retry-outbound').status, 'failed');
  repo.create({ id: 'queued-event', type: 'morning_check', user_id: 'u', timestamp: '2026-08-10T00:00:00.000Z', payload: {} }, 'hash');
  repo.createOutbound({ id: 'queued-outbound', eventId: 'queued-event', userIdHash: 'hash', content: 'hello', now: '2026-08-10T00:00:00.000Z' });
  fixture.db.prepare("UPDATE outbound_messages SET status='queued', retry_count=3, last_attempt_at='2026-08-10T00:00:00.000Z' WHERE id='queued-outbound'").run();
  await worker.tick(new Date('2026-08-10T00:20:00.000Z'));
  assert.equal(repo.outbound('queued-outbound').status, 'failed');
});

test('Docker gives migration ownership only to healthy gym-core', () => {
  const compose = fs.readFileSync(path.join(__dirname, '../../docker-compose.yml'), 'utf8');
  assert.match(compose, /gym-core:[\s\S]*GYM_MIGRATE_ON_START: "true"/);
  assert.equal((compose.match(/GYM_MIGRATE_ON_START: "false"/g) || []).length, 2);
  assert.equal((compose.match(/condition: service_healthy/g) || []).length, 2);
  assert.match(compose, /--agent", "node src\/acp\/server\.mjs"/);
  assert.doesNotMatch(compose, /--agent", "npm run acp"/);
  assert.doesNotMatch(compose, /session-resume/);
});

test('RPE follow-up updates the existing workout instead of inserting another', async (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const client = { async structuredJson() { return { data: { intent: 'record', actions: [{ type: 'log_workout', workout_type: 'upper_a', total_duration_min: 60 }], needs_followup: false, tone: 'neutral' } }; }, async text() { return { content: '训练已记。' }; } };
  const container = createTestContainer(fixture, { client });
  await container.orchestrator.handle({ id: 'workout-no-rpe', type: 'user_message', user_id: 'u', timestamp: '2026-08-10T10:00:00.000Z', payload: { text: '训练做完了' } });
  await container.orchestrator.handle({ id: 'workout-rpe', type: 'user_message', user_id: 'u', timestamp: '2026-08-10T10:01:00.000Z', payload: { text: '8' } });
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM workouts').get().count, 1);
  assert.equal(fixture.db.prepare('SELECT rpe_score FROM workouts').get().rpe_score, 8);
});

test('schedule changes are persisted and past reschedule falls back to a future time', (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const container = createTestContainer(fixture);
  const result = container.services.scheduleMutationService.updateRule({ actionKey: 'schedule-change', ruleId: 'morning-check', localTime: '08:00', now: '2026-08-10T00:00:00.000Z' });
  assert.equal(result.schedule_rule.local_time, '08:00');
  const repo = container.repositories.reminderRepository;
  const reminder = repo.create({ id: 'past-reschedule', eventType: 'morning_check', scheduledAt: '2026-08-10T00:00:00.000Z', payload: {}, now: '2026-08-09T00:00:00.000Z' }); repo.claim(reminder.id, '2026-08-10T00:00:00.000Z');
  const applied = new ReminderService({ reminderRepository: repo }).applyDecision(reminder, { action: 'snooze', reason: 'test', scheduled_at: '2026-08-09T00:00:00.000Z' }, new Date('2026-08-10T00:00:00.000Z'));
  assert.ok(new Date(applied.replacement.scheduled_at).getTime() > Date.parse('2026-08-10T00:00:00.000Z'));
});

test('cancellation signal reaches decision and prevents any action write', async (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const controller = new AbortController(); let receivedSignal;
  const client = { async structuredJson({ signal }) { receivedSignal = signal; controller.abort(); return { data: { intent: 'record', actions: [{ type: 'log_weight', weight_kg: 90 }], needs_followup: false, tone: 'neutral' } }; }, async text() { throw new Error('not called'); } };
  const container = createTestContainer(fixture, { client });
  const result = await container.orchestrator.handle({ id: 'cancelled', type: 'user_message', user_id: 'u', timestamp: '2026-08-10T00:00:00.000Z', payload: { text: '90' } }, { signal: controller.signal });
  assert.equal(receivedSignal, controller.signal);
  assert.equal(result.error, 'REQUEST_CANCELLED');
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM weight_logs').get().count, 0);
});

test('oversized base64 image is rejected before it is written and stale queued delivery is recoverable', (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const container = createTestContainer(fixture);
  assert.throws(() => normalizePrompt({ prompt: [{ type: 'image', data: Buffer.alloc(11).toString('base64'), mimeType: 'image/png' }], sessionId: 's' }, { ...container.config, wechat: { ...container.config.wechat, maxImageBytes: 10 } }), { code: 'IMAGE_TOO_LARGE' });
  assert.equal(fs.readdirSync(fixture.directory).some((name) => name.endsWith('.png')), false);
  container.repositories.eventRepository.create({ id: 'out-event', type: 'morning_check', user_id: 'u', timestamp: '2026-08-10T00:00:00.000Z', payload: {} }, 'hash');
  container.repositories.eventRepository.createOutbound({ id: 'out-1', eventId: 'out-event', userIdHash: 'hash', content: 'hi', now: '2026-08-10T00:00:00.000Z' });
  container.repositories.eventRepository.markOutboundQueued('out-1', '2026-08-10T00:00:00.000Z');
  container.repositories.eventRepository.recoverStaleOutbounds('2026-08-10T00:10:00.000Z', '2026-08-10T00:20:00.000Z');
  assert.equal(container.repositories.eventRepository.outbound('out-1').status, 'pending');
});
