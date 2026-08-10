const { loadPrompt } = require('../prompts/loadPrompts');

function fallbackResponse(decision, actionResults) {
  if (decision.needs_followup && decision.followup_question) return decision.followup_question;
  if (actionResults.length) {
    const successful = actionResults.filter((result) => result?.success).length;
    return successful === actionResults.length ? `已经记录好了，共完成 ${successful} 项。` : '部分记录没有完成，请稍后再试一次。';
  }
  return decision.response_goal || '我收到啦。现在暂时没法组织完整回复，稍后再试一次。';
}

class ResponseComposer {
  constructor({ client }) { this.client = client; }
  async compose({ event, decision, actionResults, updatedContext }) {
    if (decision.notification && decision.notification.action !== 'send') return null;
    try {
      const response = await this.client.text({
        messages: [
          { role: 'system', content: `${loadPrompt('personality')}\n\n${loadPrompt('safety')}\n\n根据已执行 action 的真实结果回复。不得声称未成功的数据已保存。微信纯文本，简洁自然。` },
          { role: 'user', content: JSON.stringify({ event, decision, action_results: actionResults, context: updatedContext }) },
        ],
        temperature: 0.55,
        maxTokens: 800,
      });
      return response.content.trim();
    } catch {
      return fallbackResponse(decision, actionResults);
    }
  }
}
module.exports = { ResponseComposer, fallbackResponse };
