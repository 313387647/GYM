const { eventSchema } = require('../schemas/events');
const logger = require('../utils/logger');
const { LlmError } = require('../integrations/llm/errors');

class Orchestrator {
  constructor({ contextBuilder, decisionEngine, actionExecutor, responseComposer, eventRepository, foodVision, mealService }) {
    Object.assign(this, { contextBuilder, decisionEngine, actionExecutor, responseComposer, eventRepository, foodVision, mealService });
  }

  async handle(rawEvent) {
    const event = eventSchema.parse(rawEvent);
    const userIdHash = logger.hashUserId(event.user_id);
    const stored = this.eventRepository.create(event, userIdHash);
    if (stored.status === 'completed' && stored.result) return { ...stored.result, duplicate: true };
    this.eventRepository.mark(event.id, 'processing');
    try {
      const initialContext = this.contextBuilder.build(event);
      let decision;
      let actionResults = [];

      if (event.type === 'image_received') {
        ({ decision, actionResults } = await this.handleImage(event, initialContext));
      } else {
        decision = await this.decisionEngine.decide(event, initialContext);
        this.eventRepository.mark(event.id, 'processing', { decision });
        actionResults = this.actionExecutor.execute(decision.actions, { event, context: initialContext });
      }

      const updatedContext = this.contextBuilder.build(event);
      const response = await this.responseComposer.compose({ event, decision, actionResults, updatedContext });
      const result = { event_id: event.id, decision, actions: actionResults, response, context: updatedContext };
      this.eventRepository.mark(event.id, 'completed', { decision, result });
      logger.info('agent.event.completed', { event_id: event.id, user_id: userIdHash, event_type: event.type, decision: decision.notification?.action || decision.intent, action_count: actionResults.length });
      return result;
    } catch (error) {
      const errorCode = error.code || 'AGENT_ERROR';
      this.eventRepository.mark(event.id, 'failed', { errorCode });
      logger.error('agent.event.failed', { event_id: event.id, user_id: userIdHash, event_type: event.type, error_code: errorCode, message: error.message });
      return { event_id: event.id, error: errorCode, response: error instanceof LlmError ? '猫猫的大脑刚刚走神了，数据还没有乱写。稍后再试一次就好。' : '这次处理没有完成，数据没有重复记录。请稍后再试。' };
    }
  }

  async handleImage(event, context) {
    const analysis = await this.foodVision.analyze(event.payload.path);
    if (!analysis.is_food) return {
      decision: { intent: 'chat', actions: [], needs_followup: false, response_goal: '自然说明这不是食物图片，不进行饮食记录', tone: 'neutral' },
      actionResults: [],
    };
    if (analysis.confidence === 'low' || analysis.needs_clarification) return {
      decision: { intent: 'record', actions: [], needs_followup: true, followup_question: analysis.clarification_question || '这张图的份量看不太准，你能告诉我大概份量吗？我确认后再记录。', response_goal: '说明未自动入库并询问份量', tone: 'neutral' },
      actionResults: [],
    };
    const result = this.mealService.logMeal({
      actionKey: `${event.id}:image`, logicalDate: context.time.logical_date,
      mealType: event.payload.meal_type || 'other', items: analysis.items,
      sourceEventId: event.id, sourceMessageId: event.payload.message_id,
      imageHash: analysis.image_hash, recordedAt: event.timestamp,
    });
    return {
      decision: { intent: 'record', actions: [], needs_followup: false, response_goal: `图片饮食已分析并记录。识别说明：${analysis.notes || '无'}`, tone: 'neutral' },
      actionResults: [result],
    };
  }
}
module.exports = { Orchestrator };
