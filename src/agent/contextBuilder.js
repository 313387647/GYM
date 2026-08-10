const { getLogicalTime } = require('../utils/timezone');
const { hashUserId } = require('../utils/logger');
const { MemoryRepository } = require('../repositories/memoryRepository');
const { ReminderRepository } = require('../repositories/reminderRepository');

class ContextBuilder {
  constructor({ config, stateService, planService, mealRepository, weightRepository, memoryRepository, reminderRepository, conversationRepository, pendingInteractionRepository }) {
    Object.assign(this, { config, stateService, planService, mealRepository, weightRepository });
    this.memoryRepository = memoryRepository;
    this.reminderRepository = reminderRepository;
    this.conversationRepository = conversationRepository;
    this.pendingInteractionRepository = pendingInteractionRepository;
  }
  build(event) {
    const time = getLogicalTime(event.timestamp, { timezone: this.config.timezone, cutoffHour: this.config.logicalDayCutoffHour });
    const state = this.stateService.build({ logicalDate: time.logical_date, weekday: time.weekday, hour: time.hour });
    const userIdHash = hashUserId(event.user_id);
    const recentReminderSince = new Date(new Date(event.timestamp).getTime() - 36 * 60 * 60 * 1000).toISOString();
    return {
      event: { id: event.id, type: event.type, timestamp: event.timestamp, payload: event.payload },
      time,
      user: { ...this.config.user, id_hash: userIdHash },
      targets: this.planService.getTargets(),
      state,
      today: {
        weight: this.weightRepository.byDate(time.logical_date),
        meals: this.mealRepository.listByDate(time.logical_date),
      },
      memory: this.memoryRepository.active(20),
      conversation_summary: this.memoryRepository.latestSummary(userIdHash)?.summary || null,
      recent_conversation: this.conversationRepository.recent(userIdHash, 16),
      pending_interaction: this.pendingInteractionRepository.active(userIdHash),
      recent_reminders: this.reminderRepository.recentForType(event.type, recentReminderSince)
        .map(({ id, status, scheduled_at, sent_at, reason }) => ({ id, status, scheduled_at, sent_at, reason })),
    };
  }
}

module.exports = { ContextBuilder };
