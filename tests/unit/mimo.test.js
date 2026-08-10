const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');
const { MimoClient } = require('../../src/integrations/llm/mimoClient');
const { LlmResponseError } = require('../../src/integrations/llm/errors');
const { parseJsonObject } = require('../../src/utils/json');

test('structured JSON parser handles fenced output and braces in strings', () => {
  assert.deepEqual(parseJsonObject('```json\n{"text":"a } brace","ok":true}\n```'), { text: 'a } brace', ok: true });
});

test('MiMo structured request validates parsed JSON without a real API call', async () => {
  const fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'prefix {"ok":true} suffix' } }], usage: { total_tokens: 5 } }), { status: 200 });
  const client = new MimoClient({ apiKey: 'test', apiBase: 'https://example.invalid', textModel: 'mimo-test', visionModel: 'mimo-test', timeoutMs: 1000, maxRetries: 0 }, { fetch });
  const result = await client.structuredJson({ messages: [], schema: z.object({ ok: z.boolean() }) });
  assert.equal(result.data.ok, true);
});

test('invalid MiMo output returns a normalized response error', async () => {
  const fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }), { status: 200 });
  const client = new MimoClient({ apiKey: 'test', apiBase: 'https://example.invalid', textModel: 'm', visionModel: 'm', timeoutMs: 1000, maxRetries: 0 }, { fetch });
  await assert.rejects(() => client.structuredJson({ messages: [], schema: z.object({ ok: z.boolean() }) }), (error) => error instanceof LlmResponseError && error.code === 'INVALID_JSON');
});
