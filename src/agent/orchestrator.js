const { eventSchema } = require('../schemas/events');
const { decisionSchema } = require('../schemas/actions');
const logger = require('../utils/logger');
const { LlmError } = require('../integrations/llm/errors');
const { z } = require('zod');
const { mealItemSchema } = require('../schemas/actions');

const SCHEDULED_TYPES = new Set(['morning_check', 'meal_window', 'pre_workout', 'workout_window', 'evening_review', 'weekly_review', 'scheduled_check']);
const STRUCTURED_RESPONSE_FAILURES = new Set(['SCHEMA_VALIDATION_FAILED', 'INVALID_JSON', 'EMPTY_CONTENT']);

function cancelled(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Request cancelled'); error.code = 'REQUEST_CANCELLED'; throw error;
}

const foodRecalibrationSchema = z.object({
  items: z.array(mealItemSchema).max(20).default([]),
  needs_clarification: z.boolean().default(false),
  clarification_question: z.string().max(300).nullish(),
}).refine((value) => value.needs_clarification || value.items.length > 0, 'items are required unless clarification is requested');

const foodDraftRelationSchema = z.object({
  relation: z.enum(['attach', 'unrelated', 'ambiguous']),
  cancel_draft: z.boolean().default(false),
  reason: z.string().max(240).nullish(),
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

function isRpeOnly(text) { return /^(?:rpe\s*)?(?:10|[1-9])(?:\s*分)?$/i.test(String(text).trim()); }
function workoutDraftCommand(text) { return /(?:记上|记录|保存|算训练|就是这次训练|不记|不用记|算了)/.test(String(text)); }
function needsRepair(decision, context, text) {
  const trainingCompletion = context.state.training.planned && !context.state.training.completed
    && /(?:训练|练).*(?:完|结束)|(?:完|结束).*(?:训练|练)/.test(String(text));
  if (trainingCompletion && !decision.actions.length) return true;
  if (decision.needs_followup || decision.actions.length) return false;
  if (['record', 'multi_action', 'status_update', 'plan_change'].includes(decision.intent)) return true;
  return false;
}
function looksLikeFoodDraftReply(text) { return Boolean(String(text).trim()) && !isRpeOnly(text); }

function structuredFailureFallback(event, errorCode) {
  const isImage = event.type === 'image_received';
  return {
    event_id: event.id,
    decision: {
      intent: 'unknown', actions: [], needs_followup: true,
      followup_question: isImage ? '这张图我这次没能可靠看清，请稍后重新发一次。' : '这条消息我这次没能可靠理解，请换一句更直接的描述再发一次。',
      response_goal: '结构化模型输出不合格时安全降级，不写入任何数据', tone: 'neutral',
    },
    actions: [],
    response: isImage
      ? '这张图我这次没能可靠看清，所以没有写入任何记录。请稍后重新发一次就好。'
      : '我刚才没能可靠解析这条消息，所以没有替你写入任何记录。麻烦换一句更直接的描述再发一次就好。',
    degraded: true,
    error_code: errorCode,
  };
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
      else if (event.type === 'image_received') ({ decision, actionResults, responseOverride } = await this.handleImage(event, initialContext, userIdHash, signal));
      else {
        const cached = stored.decision && decisionSchema.safeParse(stored.decision);
        decision = cached?.success ? cached.data : await this.decisionEngine.decide(event, initialContext, signal);
        if (!cached?.success && needsRepair(decision, initialContext, event.payload.text)) decision = await this.decisionEngine.repair(event, initialContext, decision, signal);
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
      if (!scheduled && STRUCTURED_RESPONSE_FAILURES.has(errorCode)) {
        const result = structuredFailureFallback(event, errorCode);
        this.eventRepository.mark(event.id, 'completed', { decision: result.decision, result });
        if (result.response) this.conversationRepository.add({ userIdHash, role: 'assistant', content: result.response, eventId: event.id, now: event.timestamp });
        logger.warn('agent.event.safe_degraded', { event_id: event.id, user_id: userIdHash, event_type: event.type, error_code: errorCode });
        return result;
      }
      if (errorCode === 'SCHEDULED_ACTION_FORBIDDEN') logger.warn('agent.scheduled_action_blocked', { event_id: event.id, event_type: event.type });
      else logger.error('agent.event.failed', { event_id: event.id, user_id: userIdHash, event_type: event.type, error_code: errorCode, message: error.message });
      return { event_id: event.id, error: errorCode, response: scheduled || signal?.aborted ? null : (error instanceof LlmError ? '猫猫的大脑刚刚走神了，数据还没有乱写。稍后再试一次就好。' : '这次处理没有完成，数据没有重复记录。请稍后再试。') };
    }
  }

  async completePending(event, context, userIdHash, signal) {
    const workoutDraft = this.pendingInteractionRepository.active(userIdHash, 'workout_image_draft', event.timestamp);
    if (workoutDraft && workoutDraftCommand(event.payload.text)) {
      if (/(?:不记|不用记|算了)/.test(event.payload.text)) {
        this.pendingInteractionRepository.cancel(workoutDraft.id, event.timestamp);
        return { decision: { intent: 'record', actions: [], needs_followup: false, response_goal: '用户取消训练截图草稿', tone: 'neutral' }, actionResults: [], responseOverride: '好，这张训练截图不记入训练记录。' };
      }
      return this.completeWorkoutImageDraft(workoutDraft, event, context, userIdHash);
    }
    const draft = this.pendingInteractionRepository.activeFoodDraft(userIdHash, event.timestamp);
    if (draft && looksLikeFoodDraftReply(event.payload.text)) {
      const relation = await this.resolveFoodDraftRelation(draft, event, userIdHash, signal);
      if (relation.cancel_draft) {
        this.pendingInteractionRepository.cancel(draft.id, event.timestamp);
        return { decision: { intent: 'record', actions: [], needs_followup: false, response_goal: '用户取消图片饮食草稿', tone: 'neutral' }, actionResults: [], responseOverride: '好的，刚才那张图片不记了。' };
      }
      if (relation.relation === 'attach') return this.fuseFoodDraft(draft, event, context, signal);
      if (relation.relation === 'ambiguous') {
        return { decision: { intent: 'record', actions: [], needs_followup: true, followup_question: '你是在补充刚才那张饭图吗？', response_goal: '澄清图片草稿与当前文字的关系', tone: 'neutral' }, actionResults: [], responseOverride: '你是在补充刚才那张饭图吗？' };
      }
    }
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
          { role: 'system', content: '你是谨慎的营养校准器。根据已有图片分析和用户补充的份量重新估算。只输出此 JSON 对象：{"items":[{"name":"","amount":"","calories":0,"protein_g":0,"carbs_g":0,"fat_g":0,"confidence":"high|medium|low"}],"needs_clarification":false,"clarification_question":null}。不要输出菜品介绍、category、ingredients 等其他字段；不要沿用旧营养数字；不清楚时设置 needs_clarification=true。' },
          { role: 'user', content: JSON.stringify({ original_analysis: analysis, quantity_description: event.payload.text }) },
        ], temperature: 0.1, maxTokens: 1400, thinking: 'disabled', responseFormat: { type: 'json_object' }, signal,
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

  completeWorkoutImageDraft(draft, event, context, userIdHash) {
    const analysis = draft.payload.analysis;
    if (analysis.needs_clarification || (!analysis.total_duration_min && !analysis.cardio_done_min && !analysis.workout_name)) {
      return { decision: { intent: 'record', actions: [], needs_followup: true, followup_question: analysis.clarification_question || '这次训练大概练了多久、是什么训练？', response_goal: '澄清训练截图数据', tone: 'neutral' }, actionResults: [], responseOverride: analysis.clarification_question || '这张截图的信息还不够确定：这次训练大概练了多久、是什么训练？' };
    }
    const result = this.workoutService.logWorkout({
      actionKey: `${event.id}:workout-image`, logicalDate: context.time.logical_date,
      workoutType: analysis.workout_type || context.state.training.type || 'other',
      workoutName: analysis.workout_name || context.state.training.name || '截图训练',
      totalDurationMin: analysis.total_duration_min, cardioDoneMin: analysis.cardio_done_min,
      rpeScore: analysis.rpe_score, notes: analysis.notes || null, sourceEventId: event.id, recordedAt: event.timestamp,
    });
    this.pendingInteractionRepository.complete(draft.id, event.timestamp);
    const decision = { intent: 'record', actions: [], needs_followup: false, response_goal: '已根据确认的训练截图记录训练', tone: 'neutral' };
    this.createRpeFollowup(event, userIdHash, [result], decision);
    return { decision, actionResults: [result], responseOverride: analysis.rpe_score ? '训练截图已确认并记入记录。' : '训练截图已确认并记入记录。顺便告诉猫猫这次 RPE 是多少？' };
  }

  async resolveFoodDraftRelation(draft, event, userIdHash, signal) {
    const payload = draft.payload;
    const ageMinutes = Math.max(0, Math.round((Date.parse(event.timestamp) - Date.parse(draft.created_at)) / 60000));
    const response = await this.client.structuredJson({
      schema: foodDraftRelationSchema,
      messages: [
        { role: 'system', content: '判断用户当前文字与一个未过期的图片饮食草稿的关系。relation 只能是 attach、unrelated、ambiguous。食物名称、份量、确认、修正通常 attach；未来计划、体重、工作、训练通常 unrelated；无法判断则 ambiguous。若用户明确说不记/不用管/算了，cancel_draft=true。只输出 JSON。' },
        { role: 'user', content: JSON.stringify({ user_text: event.payload.text, draft_age_minutes: ageMinutes, vision_summary: { items: payload.analysis.items, confidence: payload.analysis.confidence, notes: payload.analysis.notes || null }, image_caption: payload.caption || null, recent_conversation: this.conversationRepository.recent(userIdHash, 6) }) },
      ], temperature: 0, maxTokens: 400, thinking: 'disabled', responseFormat: { type: 'json_object' }, signal,
    });
    return { relation: response.data.relation || 'attach', cancel_draft: Boolean(response.data.cancel_draft), reason: response.data.reason || null };
  }

  async fuseFoodDraft(draft, event, context, signal) {
    const payload = draft.payload;
    if (ambiguousTotalWeight(event.payload.text, payload.analysis.items)) {
      return { decision: { intent: 'record', actions: [], needs_followup: true, followup_question: '300g 是整份，还是其中某一种食物？', response_goal: '澄清多食物图片的份量归属', tone: 'neutral' }, actionResults: [], responseOverride: '300g 是整份，还是其中某一种食物？' };
    }
    const fusion = await this.client.structuredJson({
      schema: foodRecalibrationSchema,
      messages: [
        { role: 'system', content: '你是谨慎的图片饮食融合器。用户后续文字是优先事实，Vision 只作视觉辅助。只输出此 JSON 对象：{"items":[{"name":"","amount":"","calories":0,"protein_g":0,"carbs_g":0,"fat_g":0,"confidence":"high|medium|low"}],"needs_clarification":false,"clarification_question":null}。不要输出菜品介绍、category、ingredients 等其他字段；不能机械保留视觉误识别。若文字仍不足以确认，needs_clarification=true。' },
        { role: 'user', content: JSON.stringify({ vision_analysis: payload.analysis, image: { image_hash: payload.image_hash, caption: payload.caption || null }, user_description: event.payload.text, meal_context: context.today }) },
      ], temperature: 0.1, maxTokens: 1400, thinking: 'disabled', responseFormat: { type: 'json_object' }, signal,
    });
    if (fusion.data.needs_clarification) {
      return { decision: { intent: 'record', actions: [], needs_followup: true, followup_question: fusion.data.clarification_question || '这顿具体是什么、份量大概多少？', response_goal: '继续澄清图片饮食', tone: 'neutral' }, actionResults: [], responseOverride: fusion.data.clarification_question || '这顿具体是什么、份量大概多少？' };
    }
    const result = this.mealService.logMeal({ actionKey: `${event.id}:food-fusion`, logicalDate: context.time.logical_date,
      mealType: payload.meal_type || 'other', items: fusion.data.items, sourceEventId: event.id,
      sourceMessageId: payload.source_message_id, imageHash: payload.image_hash, recordedAt: event.timestamp });
    this.pendingInteractionRepository.complete(draft.id, event.timestamp);
    return { decision: { intent: 'record', actions: [], needs_followup: false, response_goal: '已根据图片和用户描述确认并记录饮食', tone: 'neutral' }, actionResults: [result], responseOverride: '收到，已经按你补充的描述重新确认并记好了。' };
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
    const imageHash = this.foodVision.imageHash?.(event.payload.path);
    if (imageHash && this.mealService.repository.getImageIngestion(imageHash)) {
      return { decision: { intent: 'record', actions: [], needs_followup: false, response_goal: '此图片已记录，不重复入库', tone: 'neutral' }, actionResults: [], responseOverride: '这张图已经记过了，我不会重复记账。' };
    }
    const existingDraft = imageHash && this.pendingInteractionRepository.activeFoodDraftByImageHash(userIdHash, imageHash, event.timestamp);
    if (existingDraft) {
      return { decision: { intent: 'record', actions: [], needs_followup: true, followup_question: '这张图还在等你确认是什么或大概份量。', response_goal: '复用已有图片饮食草稿，不重复视觉分析', tone: 'neutral' }, actionResults: [], responseOverride: '这张图还在等你确认是什么或大概份量，我不会重复分析或记账。' };
    }
    const analysis = await this.foodVision.analyze(event.payload.path, { signal });
    if (!analysis.is_food) return this.handleNonFoodImage(event, context, userIdHash, signal);
    if (this.mealService.repository.getImageIngestion(analysis.image_hash)) return { decision: { intent: 'record', actions: [], needs_followup: false, response_goal: '此图片已记录，不重复入库', tone: 'neutral' }, actionResults: [], responseOverride: '这张图已经记过了，我不会重复记账。' };
    const draft = this.pendingInteractionRepository.activeFoodDraftByImageHash(userIdHash, analysis.image_hash, event.timestamp)
      || this.pendingInteractionRepository.create({ userIdHash, kind: 'food_image_draft', payload: { analysis, image_hash: analysis.image_hash, source_message_id: event.payload.message_id, caption: event.payload.caption || null, meal_type: event.payload.meal_type }, sourceEventId: event.id, now: event.timestamp });
    if (event.payload.caption?.trim()) return this.fuseFoodDraft(draft, { ...event, payload: { ...event.payload, text: event.payload.caption } }, context, signal);
    const names = analysis.items.slice(0, 3).map((item) => item.name).join('、') || '一顿食物';
    return { decision: { intent: 'record', actions: [], needs_followup: true, followup_question: '这顿具体是什么或者大概多少？', response_goal: '图片已保存为草稿，等待用户确认后再入库', tone: 'neutral' }, actionResults: [], responseOverride: `图我看到了，我先没直接记账。看起来像 ${names}；你补一句是什么或者大概份量，我再记准一点。` };
  }

  async handleNonFoodImage(event, context, userIdHash, signal) {
    const imageHash = this.workoutVision.imageHash?.(event.payload.path);
    const existing = imageHash && this.pendingInteractionRepository.workoutDraftByImageHash(userIdHash, imageHash, event.timestamp);
    if (existing?.status === 'completed') return { decision: { intent: 'record', actions: [], needs_followup: false, response_goal: '训练截图已记录，避免重复', tone: 'neutral' }, actionResults: [], responseOverride: '这张训练截图已经记过了，我不会重复记录。' };
    if (existing?.status === 'active') return { decision: { intent: 'record', actions: [], needs_followup: true, followup_question: '要把刚才这张训练截图记入今天训练吗？', response_goal: '等待训练截图确认', tone: 'neutral' }, actionResults: [], responseOverride: '这张训练截图还在等你确认；回复“记上吧”才会写入训练记录。' };
    const analysis = await this.workoutVision.analyze(event.payload.path, { signal });
    if (!analysis.is_workout_screenshot) return { decision: { intent: 'chat', actions: [], needs_followup: false, response_goal: '自然说明图片不是食物或训练数据截图，不自动记录', tone: 'neutral' }, actionResults: [], responseOverride: '这张图看起来不是食物或可识别的训练数据截图，所以我先不乱记。' };
    this.pendingInteractionRepository.create({ userIdHash, kind: 'workout_image_draft', payload: { analysis, image_hash: analysis.image_hash, source_message_id: event.payload.message_id }, sourceEventId: event.id, now: event.timestamp });
    const summary = [analysis.workout_name, analysis.total_duration_min != null ? `${analysis.total_duration_min} 分钟` : null, analysis.cardio_done_min != null ? `有氧 ${analysis.cardio_done_min} 分钟` : null].filter(Boolean).join('，') || '一条训练数据';
    return { decision: { intent: 'record', actions: [], needs_followup: true, followup_question: analysis.clarification_question || '要把这次训练记入今天记录吗？', response_goal: '训练截图已提取为待确认草稿', tone: 'neutral' }, actionResults: [], responseOverride: `猫猫看到了训练截图：${summary}。我先没直接写入；确认无误就回复“记上吧”。${analysis.needs_clarification ? ` ${analysis.clarification_question || '有些字段看不清，也可以补一句说明。'}` : ''}` };
  }
}
module.exports = { Orchestrator, SCHEDULED_TYPES, STRUCTURED_RESPONSE_FAILURES, foodRecalibrationSchema, foodDraftRelationSchema, inputKind, ambiguousTotalWeight, needsRepair, workoutDraftCommand, structuredFailureFallback };
