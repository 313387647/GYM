#!/usr/bin/env node
const { loadConfig } = require('../src/config');
const { MimoClient } = require('../src/integrations/llm/mimoClient');
const { FoodVision } = require('../src/integrations/vision/foodVision');

const mode = process.argv[2] || 'text';
const config = loadConfig();
const client = new MimoClient(config.mimo);
(async () => {
  if (mode === 'text') {
    const result = await client.text({ messages: [{ role: 'user', content: '只回复：MiMo Text OK' }], maxTokens: 300 });
    console.log(JSON.stringify({ ok: true, model: result.model, content: result.content, usage: result.usage }, null, 2));
    return;
  }
  const imagePath = process.argv[3];
  if (!imagePath) throw new Error('用法: npm run mimo:vision -- data/inbox/food.jpg');
  const result = await new FoodVision({ client, allowedRoots: config.wechat.allowedInboxRoots }).analyze(imagePath);
  console.log(JSON.stringify({ ok: true, model: config.mimo.visionModel, analysis: result }, null, 2));
})().catch((error) => { console.error(JSON.stringify({ ok: false, error: error.code || error.message })); process.exitCode = 1; });
