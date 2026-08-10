const { z } = require('zod');

const mealItemSchema = z.object({
  name: z.string().min(1).max(100),
  amount: z.string().max(100).nullish(),
  calories: z.coerce.number().min(0).max(5000),
  protein_g: z.coerce.number().min(0).max(500),
  carbs_g: z.coerce.number().min(0).max(1000).nullish(),
  fat_g: z.coerce.number().min(0).max(500).nullish(),
  confidence: z.enum(['high', 'medium', 'low']).nullish(),
});

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('log_weight'), weight_kg: z.coerce.number().min(30).max(350), notes: z.string().max(500).nullish() }),
  z.object({ type: z.literal('log_meal'), meal_type: z.enum(['lunch', 'dinner', 'pre_workout_snack', 'post_workout_dinner', 'snack', 'other']), items: z.array(mealItemSchema).min(1).max(20) }),
  z.object({ type: z.literal('log_workout'), workout_type: z.string().min(1).max(50), workout_name: z.string().max(100).nullish(), total_duration_min: z.coerce.number().min(0).max(600).nullish(), cardio_done_min: z.coerce.number().min(0).max(300).nullish(), rpe_score: z.coerce.number().int().min(1).max(10).nullish(), notes: z.string().max(1000).nullish() }),
  z.object({ type: z.literal('log_sleep'), hours: z.coerce.number().min(0).max(24), quality: z.enum(['poor', 'fair', 'good', 'excellent']).nullish(), bedtime: z.string().max(20).nullish(), wake_time: z.string().max(20).nullish(), notes: z.string().max(500).nullish() }),
  z.object({ type: z.literal('log_checkin'), energy: z.coerce.number().int().min(1).max(10).nullish(), mood: z.string().max(50).nullish(), workload: z.enum(['low', 'normal', 'high']).nullish(), soreness: z.coerce.number().int().min(1).max(10).nullish(), training_readiness: z.enum(['low', 'medium', 'high']).nullish(), notes: z.string().max(500).nullish() }),
  z.object({ type: z.literal('upsert_temporary_event'), event_type: z.string().min(1).max(50), description: z.string().min(1).max(500), starts_at: z.string().nullish(), ends_at: z.string().nullish() }),
  z.object({ type: z.literal('remember'), memory_type: z.enum(['preference', 'habit', 'agreement', 'background']), key: z.string().min(1).max(100), content: z.string().min(1).max(1000), importance: z.coerce.number().int().min(1).max(5).nullish() }),
]);

const decisionSchema = z.object({
  intent: z.enum(['chat', 'query', 'record', 'multi_action', 'status_update', 'plan_change', 'health_advice', 'scheduled_decision', 'unknown']),
  actions: z.array(actionSchema).max(10).default([]),
  needs_followup: z.boolean().default(false),
  followup_question: z.string().max(300).nullish(),
  response_goal: z.string().max(500).nullish(),
  tone: z.enum(['gentle', 'neutral', 'playful', 'strict', 'serious', 'celebratory']).default('neutral'),
  notification: z.object({
    action: z.enum(['send', 'skip', 'snooze', 'reschedule', 'cancel', 'complete']),
    reason: z.string().max(500),
    scheduled_at: z.string().datetime().nullish(),
  }).nullish(),
});

module.exports = { mealItemSchema, actionSchema, decisionSchema };
