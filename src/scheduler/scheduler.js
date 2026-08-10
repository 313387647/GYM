#!/usr/bin/env node
const logger = require('../utils/logger');
const { migrate } = require('../db/migrate');
const { createContainer } = require('../container');
const { ScheduleService } = require('../services/scheduleService');
const { ReminderService } = require('../services/reminderService');
const { WeChatInjector } = require('../integrations/wechat/injector');
const { EventDispatcher } = require('./eventDispatcher');

class Scheduler {
  constructor({ config, scheduleService, reminderService, dispatcher }) {
    Object.assign(this, { config, scheduleService, reminderService, dispatcher });
    this.timer = null;
    this.running = false;
  }
  async tick(now = new Date()) {
    if (this.running) return { skipped: 'tick_in_progress' };
    this.running = true;
    try {
      await this.dispatcher.retryPendingOutbounds();
      this.scheduleService.materialize(now);
      const due = this.reminderService.claimDue(now);
      const results = [];
      for (const reminder of due) results.push(await this.dispatcher.dispatch(reminder, now));
      if (due.length) logger.info('scheduler.tick.completed', { due_count: due.length });
      return { due: due.length, results };
    } finally { this.running = false; }
  }
  start() {
    const recovered = this.reminderService.recover(new Date());
    logger.info('scheduler.started', { interval_ms: this.config.scheduler.pollIntervalMs, recovered });
    this.tick().catch((error) => logger.error('scheduler.tick.failed', { message: error.message }));
    this.timer = setInterval(() => this.tick().catch((error) => logger.error('scheduler.tick.failed', { message: error.message })), this.config.scheduler.pollIntervalMs);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

function createScheduler(container) {
  const reminderService = new ReminderService({ reminderRepository: container.repositories.reminderRepository });
  const scheduleService = new ScheduleService({ config: container.config, scheduleRepository: container.repositories.scheduleRepository, reminderRepository: container.repositories.reminderRepository });
  const injector = new WeChatInjector(container.config.wechat);
  const dispatcher = new EventDispatcher({ config: container.config, orchestrator: container.orchestrator, reminderService, eventRepository: container.repositories.eventRepository, injector });
  return new Scheduler({ config: container.config, scheduleService, reminderService, dispatcher });
}

if (require.main === module) {
  migrate();
  createScheduler(createContainer()).start();
}
module.exports = { Scheduler, createScheduler };
