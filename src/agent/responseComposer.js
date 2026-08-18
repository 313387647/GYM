const { loadPrompt } = require('../prompts/loadPrompts');

function fallbackResponse(decision, actionResults) {
  if (decision.needs_followup && decision.followup_question) return decision.followup_question;
  if (actionResults.length) {
    const successful = actionResults.filter((result) => result?.success).length;
    return successful === actionResults.length ? `已经记录好了，共完成 ${successful} 项。` : '部分记录没有完成，请稍后再试一次。';
  }
  return decision.response_goal || '我收到啦。现在暂时没法组织完整回复，稍后再试一次。';
}

function responseStrategy(event, decision, actionResults) {
  const text = String(event?.payload?.text || '').trim();
  const hasActions = actionResults.some((result) => result?.success);
  const isAnalysis = decision.intent === 'query' || /(?:多少|怎么样|分析|为什么|TDEE|BMR|练啥|还练|状态)/i.test(text);
  const isSimple = hasActions && actionResults.length === 1 && /(?:无糖可乐|黑咖啡|喝水|水)/.test(text);
  const maxTokens = isAnalysis ? 1600 : (isSimple ? 450 : 1000);
  const length = isAnalysis
    ? '这是明确分析/计划问题：可完整展开，按「数据 / 分析 / 猫猫判断 / 下一步」组织，但不要编造。'
    : (isSimple ? '这是极简单记录：只需 1–3 句，确认与最相关的一句判断即可，不要展开日报表。' : '这是一般互动：通常约 100–300 字；按重要性使用标题、重点数据和下一步，不必机械展示所有 Context。');
  return { maxTokens, instruction: `回复策略：${length} 优先使用 action 执行后的 updated Context；只选择与当前事件相关的事实。` };
}

class ResponseComposer {
  constructor({ client }) { this.client = client; }
  async compose({ event, decision, actionResults, updatedContext, signal }) {
    if (decision.notification && decision.notification.action !== 'send') return null;
    const strategy = responseStrategy(event, decision, actionResults);
    try {
      const response = await this.client.text({
        messages: [
          { role: 'system', content: `${loadPrompt('personality')}\n\n${loadPrompt('coach_policy')}\n\n${loadPrompt('safety')}\n\n根据已执行 action 的真实结果回复。不得声称未成功的数据已保存。${strategy.instruction}` },
          { role: 'user', content: JSON.stringify({ event, decision, action_results: actionResults, context: updatedContext }) },
        ],
        temperature: 0.55,
        maxTokens: strategy.maxTokens,
        thinking: 'disabled',
        signal,
      });
      return response.content.trim();
    } catch {
      return fallbackResponse(decision, actionResults);
    }
  }
}
module.exports = { ResponseComposer, fallbackResponse, responseStrategy };
