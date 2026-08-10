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

const weightAndMeal = { intent: 'multi_action', actions: [
  { type: 'log_weight', weight_kg: 96.4 },
  { type: 'log_meal', meal_type: 'lunch', items: [{ name: '牛肉面', calories: 650, protein_g: 35 }] },
], needs_followup: false, response_goal: '记录', tone: 'neutral' };

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

test('recent conversation and food clarification pending interaction close without another vision call', async (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  let visionCalls = 0;
  const foodVision = { async analyze() { visionCalls += 1; return { is_food: true, confidence: 'low', needs_clarification: true, items: [{ name: '鸡肉', calories: 400, protein_g: 45 }], image_hash: 'pending-image' }; } };
  const container = createTestContainer(fixture, { foodVision });
  await container.orchestrator.handle({ id: 'food-image', type: 'image_received', user_id: 'u', timestamp: '2026-08-10T04:00:00.000Z', payload: { path: '/ignored', message_id: 'm1', meal_type: 'lunch' } });
  const reply = await container.orchestrator.handle({ id: 'food-grams', type: 'user_message', user_id: 'u', timestamp: '2026-08-10T04:01:00.000Z', payload: { text: '300g左右' } });
  assert.equal(visionCalls, 1); assert.equal(reply.actions[0].success, true);
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM meals').get().count, 1);
  assert.equal(container.contextBuilder.build({ id: 'context', type: 'user_message', user_id: 'u', timestamp: '2026-08-10T04:02:00.000Z', payload: {} }).recent_conversation.length >= 1, true);
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
