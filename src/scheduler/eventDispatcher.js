const { stableId } = require('../utils/id');

class EventDispatcher {
  constructor({ config, orchestrator, reminderService, eventRepository, injector }) {
    Object.assign(this, { config, orchestrator, reminderService, eventRepository, injector });
  }
  async dispatch(reminder, now = new Date()) {
    const event = {
      id: stableId('evt', 'reminder', reminder.id),
      type: reminder.event_type,
      user_id: this.config.defaultUserId,
      timestamp: now.toISOString(),
      payload: { ...reminder.payload, reminder_id: reminder.id, scheduled_at: reminder.scheduled_at },
    };
    const result = await this.orchestrator.handle(event);
    const notification = result.decision?.notification || { action: result.response ? 'send' : 'skip', reason: result.error || 'agent_decision' };
    const transition = this.reminderService.applyDecision(reminder, notification, now);
    if (transition.action === 'send' && result.response) {
      const outboundId = stableId('out', event.id);
      this.eventRepository.createOutbound({ id: outboundId, eventId: event.id, userIdHash: result.context?.user?.id_hash, content: result.response, now: now.toISOString() });
      try {
        const delivery = await this.injector.enqueue(outboundId);
        if (delivery.queued) this.eventRepository.markOutboundQueued(outboundId);
      }
      catch { /* outbound remains pending for retry/inspection */ }
      return { ...transition, outbound_id: outboundId };
    }
    return transition;
  }
  async retryPendingOutbounds() {
    let queued = 0;
    for (const outbound of this.eventRepository.pendingOutbounds()) {
      try {
        const result = await this.injector.enqueue(outbound.id);
        if (result.queued) { this.eventRepository.markOutboundQueued(outbound.id); queued += 1; }
      } catch { /* keep pending */ }
    }
    return queued;
  }
}
module.exports = { EventDispatcher };
