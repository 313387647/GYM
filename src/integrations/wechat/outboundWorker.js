#!/usr/bin/env node
const { migrate } = require('../../db/migrate');
const { createContainer } = require('../../container');
const { WeChatInjector } = require('./injector');
const logger = require('../../utils/logger');

class OutboundDeliveryWorker {
  constructor({ config, repository, injector }) { Object.assign(this, { config, repository, injector }); }
  async tick(now = new Date()) {
    const options = { maxRetries: this.config.outbound.maxRetries, retryBaseMs: this.config.outbound.retryBaseMs };
    this.repository.recoverStaleOutbounds(new Date(now.getTime() - 10 * 60 * 1000).toISOString(), now.toISOString(), options.maxRetries);
    let attempts = 0;
    for (const outbound of this.repository.pendingOutbounds({ ...options, now })) {
      attempts += 1;
      try {
        const result = await this.injector.enqueue(outbound.id);
        if (result.queued) this.repository.markOutboundQueued(outbound.id, now.toISOString());
        else this.repository.markOutboundAttemptFailed(outbound.id, result.reason || 'not_queued', now.toISOString(), options.maxRetries);
      } catch (error) {
        this.repository.markOutboundAttemptFailed(outbound.id, 'INJECT_FAILED', now.toISOString(), options.maxRetries);
        logger.warn('wechat.outbound_worker.failed', { outbound_id: outbound.id, message: error.message });
      }
    }
    return attempts;
  }
}

if (require.main === module) {
  const config = require('../../config').loadConfig();
  if (config.migrateOnStart) migrate();
  const container = createContainer({ config });
  const worker = new OutboundDeliveryWorker({ config, repository: container.repositories.eventRepository, injector: new WeChatInjector(config.wechat) });
  worker.tick().catch((error) => logger.error('wechat.outbound_worker.tick_failed', { message: error.message }));
  setInterval(() => worker.tick().catch((error) => logger.error('wechat.outbound_worker.tick_failed', { message: error.message })), 10_000);
}
module.exports = { OutboundDeliveryWorker };
