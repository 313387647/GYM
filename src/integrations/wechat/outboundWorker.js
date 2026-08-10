#!/usr/bin/env node
// Runs in the wechat delivery container. It is deliberately separate from the
// scheduler so only the container holding wechat-acp's persistent state injects.
const { migrate } = require('../../db/migrate');
const { createContainer } = require('../../container');
const { WeChatInjector } = require('./injector');
const logger = require('../../utils/logger');

migrate();
const container = createContainer();
const injector = new WeChatInjector(container.config.wechat);
const repository = container.repositories.eventRepository;

async function tick() {
  repository.recoverStaleOutbounds(new Date(Date.now() - 10 * 60 * 1000).toISOString(), new Date().toISOString());
  for (const outbound of repository.pendingOutbounds()) {
    try {
      const result = await injector.enqueue(outbound.id);
      if (result.queued) repository.markOutboundQueued(outbound.id);
      else repository.markOutboundAttemptFailed(outbound.id, result.reason || 'not_queued');
    } catch (error) {
      repository.markOutboundAttemptFailed(outbound.id, 'INJECT_FAILED');
      logger.warn('wechat.outbound_worker.failed', { outbound_id: outbound.id, message: error.message });
    }
  }
}

tick().catch((error) => logger.error('wechat.outbound_worker.tick_failed', { message: error.message }));
setInterval(() => tick().catch((error) => logger.error('wechat.outbound_worker.tick_failed', { message: error.message })), 10_000);
