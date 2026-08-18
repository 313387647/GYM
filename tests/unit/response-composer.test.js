const test = require('node:test');
const assert = require('node:assert/strict');
const { ResponseComposer, responseStrategy } = require('../../src/agent/responseComposer');

function sampleContext() {
  return {
    state: {
      nutrition: { calories: 1350, protein_g: 55, carbs_g: 130, fat_g: 55, calorie_status: 'in_progress', protein_status: 'in_progress' },
      training: { planned: true, type: 'upper_a', completed: false, readiness: 'low', fatigue: { recent_rpe_average: 7 } },
      sleep: { hours: 5, quality: 'poor' },
      weight: { current: 96.4, seven_day_change_kg: -0.3 },
    },
    targets: { calories: 2150, protein_g: 170 },
  };
}

test('response composer supplies rich coach policy and relevant updated context', async () => {
  let request;
  const composer = new ResponseComposer({
    client: { async text(input) { request = input; return { content: '## 🌶️ 毛血旺到账\n\n猫猫已记账。' }; } },
  });
  const event = { type: 'user_message', payload: { text: '中午吃了毛血旺' } };
  const decision = { intent: 'record', response_goal: '确认饮食记录', tone: 'playful' };
  await composer.compose({ event, decision, actionResults: [{ success: true, type: 'log_meal' }], updatedContext: sampleContext() });

  assert.equal(request.maxTokens, 1000);
  assert.equal(request.thinking, 'disabled');
  assert.match(request.messages[0].content, /高信息密度猫猫教练/);
  assert.match(request.messages[0].content, /饮食时，先看本顿/);
  const payload = JSON.parse(request.messages[1].content);
  assert.equal(payload.context.state.nutrition.calories, 1350);
  assert.equal(payload.context.targets.protein_g, 170);
  assert.equal(payload.context.state.training.type, 'upper_a');
});

test('response strategy is concise for simple drinks and expands explicit analysis', () => {
  const simple = responseStrategy(
    { payload: { text: '喝了瓶无糖可乐' } },
    { intent: 'record' },
    [{ success: true }],
  );
  const analysis = responseStrategy(
    { payload: { text: '我昨晚只睡了5个小时，还练吗？' } },
    { intent: 'query' },
    [],
  );
  assert.equal(simple.maxTokens, 450);
  assert.match(simple.instruction, /1–3 句/);
  assert.equal(analysis.maxTokens, 1600);
  assert.match(analysis.instruction, /完整展开/);
});
