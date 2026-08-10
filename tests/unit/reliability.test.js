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
  assert.equal(visionCalls, 1); assert.equal(calibrationCalls, 1);
  assert.deepEqual(meal, { calories: 260, protein_g: 50, item_name: '鸡肉' });
});

test('ambiguous multi-item total weight remains pending instead of assigning it to every item', async (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const foodVision = { async analyze() { return { is_food: true, confidence: 'low', needs_clarification: true, items: [{ name: '鸡肉', calories: 200, protein_g: 30 }, { name: '米饭', calories: 300, protein_g: 5 }], image_hash: 'multi-image' }; } };
  const client = { async structuredJson() { throw new Error('must not calibrate ambiguous total'); }, async text() { return { content: '收到。' }; } };
  const container = createTestContainer(fixture, { foodVision, client });
  await container.orchestrator.handle({ id: 'multi-image', type: 'image_received', user_id: 'u', timestamp: '2026-08-10T04:00:00.000Z', payload: { path: '/ignored', message_id: 'm', meal_type: 'lunch' } });
  const result = await container.orchestrator.handle({ id: 'multi-answer', type: 'user_message', user_id: 'u', timestamp: '2026-08-10T04:01:00.000Z', payload: { text: '300g' } });
  assert.match(result.response, /整份/);
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM meals').get().count, 0);
  assert.equal(container.repositories.pendingInteractionRepository.active('0bfe935e70c3', 'food_quantity', '2026-08-10T04:01:00.000Z').status, 'active');
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
