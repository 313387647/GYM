const { decisionSchema } = require('../schemas/actions');
const { loadRuntimePrompt } = require('../prompts/loadPrompts');

function decisionInstructions(eventType) {
  const scheduled = !['user_message', 'image_received'].includes(eventType);
  return `只输出一个 JSON 对象，不要 Markdown。字段：
{"intent":"chat|query|record|multi_action|status_update|plan_change|health_advice|scheduled_decision|unknown","actions":[],"needs_followup":false,"followup_question":null,"response_goal":"回复目标与应包含的事实","tone":"gentle|neutral|playful|strict|serious|celebratory"${scheduled ? ',"notification":{"action":"send|skip|snooze|reschedule|cancel|complete","reason":"基于状态的理由","scheduled_at":null}' : ''}}
actions 只能使用以下形状（未知字段不要生成）：
- {"type":"log_weight","weight_kg":96.4,"notes":null}
- {"type":"log_meal","meal_type":"lunch|dinner|pre_workout_snack|post_workout_dinner|snack|other","items":[{"name":"牛肉面","amount":"1碗","calories":650,"protein_g":35,"carbs_g":80,"fat_g":18,"confidence":"high|medium|low"}]}
- {"type":"log_workout","workout_type":"upper_a","workout_name":null,"total_duration_min":60,"cardio_done_min":20,"rpe_score":8,"notes":null}
- {"type":"update_workout_rpe","workout_id":null,"selector":"latest_today","rpe_score":8,"notes":null}
- {"type":"log_sleep","hours":7.5,"quality":"poor|fair|good|excellent","bedtime":null,"wake_time":null,"notes":null}
- {"type":"log_checkin","energy":1到10,"mood":"文字","workload":"low|normal|high","soreness":1到10,"training_readiness":"low|medium|high","notes":null}
- {"type":"upsert_temporary_event","event_type":"overtime","description":"加班到22点","starts_at":null,"ends_at":"ISO时间或null"}
- {"type":"remember","memory_type":"preference|habit|agreement|background","key":"稳定键","content":"长期有效内容","importance":1到5}
${scheduled ? '定时事件绝对不能产生 actions；只能使用 notification 决定提醒。' : '- {"type":"update_schedule_rule","rule_id":"morning-check","local_time":"08:00","enabled":true,"weekdays":["monday"]}'}
不要产生 SQL 或文件操作；不要把不确定信息编造成 action。scheduled_at 若提供必须是 ISO UTC。`;
}

class DecisionEngine {
  constructor({ client }) { this.client = client; this.systemPrompt = loadRuntimePrompt(); }
  async decide(event, context, signal) {
    const response = await this.client.structuredJson({
      schema: decisionSchema,
      messages: [
        { role: 'system', content: `${this.systemPrompt}\n\n${decisionInstructions(event.type)}` },
        { role: 'user', content: JSON.stringify({ event, context }) },
      ],
      temperature: 0.1,
      maxTokens: 2500,
      signal,
    });
    return response.data;
  }
}

module.exports = { DecisionEngine, decisionInstructions };
