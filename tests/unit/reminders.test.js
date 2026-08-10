const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDb, createTestContainer } = require('../helpers/testDb');
const { ScheduleService } = require('../../src/services/scheduleService');
const { ReminderService } = require('../../src/services/reminderService');
const { EventDispatcher } = require('../../src/scheduler/eventDispatcher');

test('schedule materialization deduplicates the same rule and day', (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const container = createTestContainer(fixture);
  const service = new ScheduleService({ config: container.config, scheduleRepository: container.repositories.scheduleRepository, reminderRepository: container.repositories.reminderRepository });
  service.materialize(new Date('2026-08-10T00:00:00.000Z'));
  service.materialize(new Date('2026-08-10T00:00:00.000Z'));
  const rows = fixture.db.prepare('SELECT rule_id, COUNT(*) count FROM reminders GROUP BY rule_id').all();
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => row.count === 1));
});

test('schedule rules use calendar weekday before logical-day cutoff', (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const container = createTestContainer(fixture);
  const service = new ScheduleService({ config: container.config, scheduleRepository: container.repositories.scheduleRepository, reminderRepository: container.repositories.reminderRepository });
  // 2026-08-09 17:00Z = Monday 01:00 in Shanghai; logical date is still Sunday.
  service.materialize(new Date('2026-08-09T17:00:00.000Z'));
  const weekly = fixture.db.prepare("SELECT * FROM reminders WHERE rule_id='weekly-review'").get();
  assert.equal(weekly, undefined);
});

test('scheduler restart recovers stale processing reminders', (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const container = createTestContainer(fixture);
  container.repositories.reminderRepository.create({ id: 'stale', eventType: 'morning_check', scheduledAt: '2026-08-10T00:00:00.000Z', payload: {}, now: '2026-08-10T00:00:00.000Z' });
  container.repositories.reminderRepository.claim('stale', '2026-08-10T00:01:00.000Z');
  const service = new ReminderService({ reminderRepository: container.repositories.reminderRepository });
  assert.equal(service.recover(new Date('2026-08-10T01:00:00.000Z')), 1);
  assert.equal(container.repositories.reminderRepository.get('stale').status, 'pending');
});

test('reminder decision supports snooze without losing original state', (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const container = createTestContainer(fixture);
  const repo = container.repositories.reminderRepository;
  const reminder = repo.create({ id: 'r1', eventType: 'workout_window', scheduledAt: '2026-08-10T10:00:00.000Z', payload: {}, now: '2026-08-10T09:00:00.000Z' });
  repo.claim('r1', '2026-08-10T10:00:00.000Z');
  const service = new ReminderService({ reminderRepository: repo });
  const result = service.applyDecision(reminder, { action: 'snooze', reason: '加班', scheduled_at: '2026-08-10T12:00:00.000Z' }, new Date('2026-08-10T10:00:00.000Z'));
  assert.equal(repo.get('r1').status, 'snoozed');
  assert.equal(result.replacement.status, 'pending');
});

test('scheduled event is decided by the agent and may skip sending', async (t) => {
  const fixture = createTestDb(); t.after(fixture.cleanup);
  const client = {
    async structuredJson() { return { data: { intent: 'scheduled_decision', actions: [], needs_followup: false, response_goal: '无需打扰', tone: 'neutral', notification: { action: 'skip', reason: '今日已经完成' } } }; },
    async text() { throw new Error('skip must not compose a message'); },
  };
  const container = createTestContainer(fixture, { client });
  const repo = container.repositories.reminderRepository;
  const reminder = repo.create({ id: 'agent-skip', eventType: 'workout_window', scheduledAt: '2026-08-10T10:00:00.000Z', payload: {}, now: '2026-08-10T09:00:00.000Z' });
  repo.claim(reminder.id, '2026-08-10T10:00:00.000Z');
  const reminderService = new ReminderService({ reminderRepository: repo });
  const dispatcher = new EventDispatcher({ config: container.config, orchestrator: container.orchestrator, reminderService, eventRepository: container.repositories.eventRepository, injector: { async enqueue() { throw new Error('must not inject'); } } });
  const result = await dispatcher.dispatch(reminder, new Date('2026-08-10T10:00:00.000Z'));
  assert.equal(result.action, 'skip');
  assert.equal(repo.get(reminder.id).status, 'skipped');
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM outbound_messages').get().count, 0);
});
