const { eventSchema } = require('../schemas/events');
const { decisionSchema } = require('../schemas/actions');
const logger = require('../utils/logger');
const { LlmError } = require('../integrations/llm/errors');
const { z } = require('zod');
const { mealItemSchema } = require('../schemas/actions');

const SCHEDULED_TYPES = new Set(['morning_check', 'meal_window', 'pre_workout', 'workout_window', 'evening_review', 'weekly_review', 'scheduled_check']);

function cancelled(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Request cancelled'); error.code = 'REQUEST_CANCELLED'; throw error;
}

const foodRecalibrationSchema = z.object({
  items: z.array(mealItemSchema).min(1).max(20),
  needs_clarification: z.boolean().default(false),
  clarification_question: z.string().max(300).nullish(),
});

function inputKind(text) {
  const value = String(text).trim();
  if (/^(?:rpe\s*)?(?:10|[1-9])(?:\s*分)?$/i.test(value)) return 'workout_rpe';
  if (/(?:\d+(?:\.\d+)?\s*(?:g|克)|整份|一碗|半碗|两个?蛋)/i.test(value)) return 'food_quantity';
  return null;
}

function ambiguousTotalWeight(text, items) {
  return items.length > 1 && /^\s*\d+(?:\.\d+)?\s*(?:g|克)\s*(?:左右)?\s*$/i.test(String(text));
}

class Orchestrator {
  constructor(dependencies) { Object.assign(this, dependencies); }

  async handle(rawEvent, { signal } = {}) {
    const event = eventSchema.parse(rawEvent);
    const userIdHash = logger.hashUserId(event.user_id);
    const stored = this.eventRepository.create(event, userIdHash);
    if (stored.status === 'completed' && stored.result) return { ...stored.result, duplicate: true };
    this.eventRepository.mark(event.id, 'processing');
    if (event.type === 'user_message' && event.payload.text) this.conversationRepository.add({ userIdHash, role: 'user', content: event.payload.text, eventId: event.id, now: event.timestamp });
    try {
      cancelled(signal);
      const initialContext = this.contextBuilder.build(event);
      const pendingResult = event.type === 'user_message' ? await this.completePending(event, initialContext, userIdHash, signal) : null;
      let decision;
      let actionResults = [];
      let responseOverride = null;

      if (pendingResult) ({ decision, actionResults, responseOverride } = pendingResult);
      else if (event.type === 'image_received') ({ decision, actionResults } = await this.handleImage(event, initialContext, userIdHash, signal));
      else {
        const cached = stored.decision && decisionSchema.safeParse(stored.decision);
        decision = cached?.success ? cached.data : await this.decisionEngine.decide(event, initialContext, signal);
        if (!cached?.success) this.eventRepository.saveDecision(event.id, decision);
        cancelled(signal);
        actionResults = this.actionExecutor.execute(decision.actions, { event, context: initialContext, signal });
        this.createRpeFollowup(event, userIdHash, actionResults, decision);
      }

      const updatedContext = this.contextBuilder.build(event);
      const response = responseOverride ?? await this.responseComposer.compose({ event, decision, actionResults, updatedContext, signal });
      const result = { event_id: event.id, decision, actions: actionResults, response, context: updatedContext };
      this.eventRepository.mark(event.id, 'completed', { decision, result });
      if (response) this.conversationRepository.add({ userIdHash, role: 'assistant', content: response, eventId: event.id, now: event.timestamp });
      logger.info('agent.event.completed', { event_id: event.id, user_id: userIdHash, event_type: event.type, decision: decision.notification?.action || decision.intent, action_count: actionResults.length });
      return result;
    } catch (error) {
      const errorCode = error.code || 'AGENT_ERROR';
      this.eventRepository.mark(event.id, 'failed', { errorCode });
      const scheduled = SCHEDULED_TYPES.has(event.type);
      if (errorCode === 'SCHEDULED_ACTION_FORBIDDEN') logger.warn('agent.scheduled_action_blocked', { event_id: event.id, event_type: event.type });
      else logger.error('agent.event.failed', { event_id: event.id, user_id: userIdHash, event_type: event.type, error_code: errorCode, message: error.message });
      return { event_id: event.id, error: errorCode, response: scheduled || signal?.aborted ? null : (error instanceof LlmError ? '猫猫的大脑刚刚走神了，数据还没有乱写。稍后再试一次就好。' : '这次处理没有完成，数据没有重复记录。请稍后再试。') };
    }
  }

  async completePending(event, context, userIdHash, signal) {
    const kind = inputKind(event.payload.text);
    if (!kind) return null;
    const pending = this.pendingInteractionRepository.active(userIdHash, kind, event.timestamp);
    if (!pending) return null;
    cancelled(signal);
    if (pending.kind === 'food_quantity') {
      const payload = pending.payload;
      const analysis = payload.analysis;
      if (ambiguousTotalWeight(event.payload.text, analysis.items)) {
        return { decision: { intent: 'record', actions: [], needs_followup: true, followup_question: '300g 是整份，还是其中某一种食物？', response_goal: '澄清多食物图片的份量归属', tone: 'neutral' }, actionResults: [], responseOverride: '300g 是整份，还是其中某一种食物？' };
      }
      const recalibration = await this.client.structuredJson({
        schema: foodRecalibrationSchema,
        messages: [
          { role: 'system', content: '你是谨慎的营养校准器。根据已有图片分析和用户补充的份量重新估算每个食物的 amount、calories、protein_g、carbs_g、fat_g。不要沿用旧营养数字；不清楚时要求澄清。只输出 JSON。' },
          { role: 'user', content: JSON.stringify({ original_analysis: analysis, quantity_description: event.payload.text }) },
        ], temperature: 0.1, maxTokens: 1400, signal,
      });
      if (recalibration.data.needs_clarification) {
        return { decision: { intent: 'record', actions: [], needs_followup: true, followup_question: recalibration.data.clarification_question || '这个份量是指整份还是其中某一种食物？', response_goal: '继续澄清图片饮食份量', tone: 'neutral' }, actionResults: [], responseOverride: recalibration.data.clarification_question || '这个份量是指整份还是其中某一种食物？' };
      }
      const result = this.mealService.logMeal({ actionKey: `${event.id}:pending-food`, logicalDate: context.time.logical_date,
        mealType: payload.meal_type || 'other', items: recalibration.data.items, sourceEventId: event.id,
        sourceMessageId: payload.message_id, imageHash: payload.image_hash, recordedAt: event.timestamp });
      this.pendingInteractionRepository.complete(pending.id, event.timestamp);
      return { decision: { intent: 'record', actions: [], needs_followup: false, response_goal: '已根据用户补充的份量校准并记录图片饮食', tone: 'neutral' }, actionResults: [result], responseOverride: '份量补充收到，营养已经重新校准并记录好了。' };
    }
    if (pending.kind === 'workout_rpe') {
      const rpe = Number(String(event.payload.text).match(/(?:rpe\s*)?(10|[1-9])(?:\s*分)?/i)?.[1]);
      if (!rpe) return null;
      const result = this.workoutService.updateRpe({ actionKey: `${event.id}:pending-rpe`, workoutId: pending.payload.workout_id, logicalDate: context.time.logical_date, rpeScore: rpe, notes: null });
      this.pendingInteractionRepository.complete(pending.id, event.timestamp);
      return { decision: { intent: 'record', actions: [], needs_followup: false, response_goal: '已补充训练 RPE', tone: 'neutral' }, actionResults: [result], responseOverride: `RPE ${rpe} 已补到刚才那次训练里了。` };
    }
    return null;
  }

  createRpeFollowup(event, userIdHash, results, decision) {
    const workout = results.find((result) => result?.workout)?.workout;
    if (workout && !workout.rpe_score) {
      this.pendingInteractionRepository.create({ userIdHash, kind: 'workout_rpe', payload: { workout_id: workout.id }, sourceEventId: event.id, now: event.timestamp });
      decision.needs_followup = true;
      decision.followup_question = '训练已经记好了，刚才主观强度 RPE 是多少？1 到 10 分就行。';
    }
  }

  async handleImage(event, context, userIdHash, signal) {
    const analysis = await this.foodVision.analyze(event.payload.path, { signal });
    if (!analysis.is_food) return { decision: { intent: 'chat', actions: [], needs_followup: false, response_goal: '自然说明这不是食物图片，不进行饮食记录', tone: 'neutral' }, actionResults: [] };
    if (analysis.confidence === 'low' || analysis.needs_clarification) {
      this.pendingInteractionRepository.create({ userIdHash, kind: 'food_quantity', payload: { analysis, image_hash: analysis.image_hash, message_id: event.payload.message_id, meal_type: event.payload.meal_type }, sourceEventId: event.id, now: event.timestamp });
      return { decision: { intent: 'record', actions: [], needs_followup: true, followup_question: analysis.clarification_question || '这张图的份量看不太准，你能告诉我大概多少克吗？我确认后再记录。', response_goal: '说明未自动入库并询问份量', tone: 'neutral' }, actionResults: [] };
    }
    const result = this.mealService.logMeal({ actionKey: `${event.id}:image`, logicalDate: context.time.logical_date, mealType: event.payload.meal_type || 'other', items: analysis.items, sourceEventId: event.id, sourceMessageId: event.payload.message_id, imageHash: analysis.image_hash, recordedAt: event.timestamp });
    return { decision: { intent: 'record', actions: [], needs_followup: false, response_goal: `图片饮食已分析并记录。识别说明：${analysis.notes || '无'}`, tone: 'neutral' }, actionResults: [result] };
  }
}
module.exports = { Orchestrator, SCHEDULED_TYPES, foodRecalibrationSchema, inputKind, ambiguousTotalWeight };
