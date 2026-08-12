const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FoodVision } = require('../../src/integrations/vision/foodVision');

test('food vision validates inbox path and structured analysis', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-image-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const imagePath = path.join(directory, 'food.png');
  fs.writeFileSync(imagePath, Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3]));
  let request;
  const client = { async structuredJson(input) { request = input; return { data: { is_food: true, confidence: 'medium', items: [{ name: '测试食物', calories: 100, protein_g: 10 }], needs_clarification: false } }; } };
  const result = await new FoodVision({ client, allowedRoots: [directory] }).analyze(imagePath);
  assert.equal(result.is_food, true);
  assert.equal(result.items[0].name, '测试食物');
  assert.equal(result.image_hash.length, 64);
  assert.equal(request.maxTokens, 1000);
  assert.equal(request.thinking, 'disabled');
  assert.deepEqual(request.responseFormat, { type: 'json_object' });
  assert.equal(request.messages[1].content[0].type, 'image_url');
  assert.equal(request.messages[1].content[1].type, 'text');
});

test('food vision rejects paths outside configured inbox', async () => {
  const client = { async structuredJson() { throw new Error('must not call'); } };
  const vision = new FoodVision({ client, allowedRoots: [path.join(os.tmpdir(), 'not-this-file')] });
  await assert.rejects(() => vision.analyze(__filename), /outside the configured inbox/);
});
