const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');
const { MimoClient } = require('../../src/integrations/llm/mimoClient');
const { LlmResponseError } = require('../../src/integrations/llm/errors');
const { parseJsonObject, parseJsonObjectDetailed } = require('../../src/utils/json');

test('structured JSON parser handles fenced output and braces in strings', () => {
  assert.deepEqual(parseJsonObject('```json\n{"text":"a } brace","ok":true}\n```'), { text: 'a } brace', ok: true });
  assert.deepEqual(parseJsonObject('前言 {"ok":true} 后言'), { ok: true });
});

test('JSON parser classifies incomplete output and repairs only trailing commas', () => {
  assert.throws(() => parseJsonObjectDetailed('{"items":[{"name":"鸡肉"}]'), (error) => error.parseFailureType === 'INCOMPLETE_JSON');
  const repaired = parseJsonObjectDetailed('{"ok":true,}');
  assert.deepEqual(repaired.value, { ok: true });
  assert.equal(repaired.repaired, true);
});

test('MiMo structured request validates parsed JSON without a real API call', async () => {
  let payload;
  const fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'prefix {"ok":true} suffix' } }], usage: { total_tokens: 5 } }), { status: 200 });
  };
  const client = new MimoClient({ apiKey: 'test', apiBase: 'https://example.invalid', textModel: 'mimo-test', visionModel: 'mimo-test', timeoutMs: 1000, maxRetries: 0 }, { fetch });
  const result = await client.structuredJson({ messages: [], schema: z.object({ ok: z.boolean() }) });
  assert.equal(result.data.ok, true);
  assert.deepEqual(payload.thinking, { type: 'disabled' });
  assert.deepEqual(payload.response_format, { type: 'json_object' });
  assert.equal(payload.max_completion_tokens, 3000);
  assert.equal('max_tokens' in payload, false);
});

test('ordinary text does not force JSON mode', async () => {
  let payload;
  const client = new MimoClient({ apiKey: 'test', apiBase: 'https://example.invalid', textModel: 'text', visionModel: 'vision', timeoutMs: 1000, maxRetries: 0 }, {
    fetch: async (_url, options) => { payload = JSON.parse(options.body); return new Response(JSON.stringify({ choices: [{ message: { content: '自然回复' } }] }), { status: 200 }); },
  });
  await client.text({ messages: [], maxTokens: 800 });
  assert.equal(payload.response_format, undefined);
  assert.equal(payload.max_completion_tokens, 800);
});

test('invalid MiMo output returns a normalized response error', async () => {
  const fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }), { status: 200 });
  const client = new MimoClient({ apiKey: 'test', apiBase: 'https://example.invalid', textModel: 'm', visionModel: 'm', timeoutMs: 1000, maxRetries: 0 }, { fetch });
  await assert.rejects(() => client.structuredJson({ messages: [], schema: z.object({ ok: z.boolean() }) }), (error) => error instanceof LlmResponseError && error.code === 'INVALID_JSON');
});

test('vision uses its own 45-second timeout and at most one retry', async () => {
  let requestOptions; let calls = 0;
  const client = new MimoClient({ apiKey: 'test', apiBase: 'https://example.invalid', textModel: 'text', visionModel: 'vision', timeoutMs: 60000, visionTimeoutMs: 45000, maxRetries: 9 }, {
    fetch: async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ error: { code: 'server_error' } }), { status: 500 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 });
    }, sleep: async () => {},
  });
  const originalRequest = client.request.bind(client);
  client.request = async (payload, signal, options) => { requestOptions = options; return originalRequest(payload, signal, options); };
  const response = await client.vision({ messages: [] });
  assert.equal(response.model, 'vision');
  assert.equal(calls, 2);
  assert.deepEqual(requestOptions, { timeoutMs: 45000, maxRetries: 1 });
});

test('Vision forwards response_format only when requested', async () => {
  let payload;
  const client = new MimoClient({ apiKey: 'test', apiBase: 'https://example.invalid', textModel: 'text', visionModel: 'vision', timeoutMs: 60000, visionTimeoutMs: 45000, maxRetries: 0 }, {
    fetch: async (_url, options) => { payload = JSON.parse(options.body); return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 }); },
  });
  await client.structuredJson({ vision: true, messages: [], schema: z.object({}), responseFormat: { type: 'json_object' } });
  assert.deepEqual(payload.response_format, { type: 'json_object' });
});

test('vision retries one invalid JSON response and rejects a schema-invalid repair', async () => {
  let calls = 0;
  const client = new MimoClient({ apiKey: 'test', apiBase: 'https://example.invalid', textModel: 'text', visionModel: 'vision', timeoutMs: 60000, visionTimeoutMs: 45000, maxRetries: 0 }, {
    fetch: async () => {
      calls += 1;
      const content = calls === 1 ? '{"ok":' : '{"ok":true,}';
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200 });
    }, sleep: async () => {},
  });
  const result = await client.structuredJson({ vision: true, messages: [], schema: z.object({ ok: z.boolean() }) });
  assert.equal(calls, 2);
  assert.equal(result.data.ok, true);
  assert.equal(result.jsonRepaired, true);

  const invalidSchema = new MimoClient({ apiKey: 'test', apiBase: 'https://example.invalid', textModel: 'text', visionModel: 'vision', timeoutMs: 60000, visionTimeoutMs: 45000, maxRetries: 0 }, {
    fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":"not-a-boolean",}' }, finish_reason: 'stop' }] }), { status: 200 }), sleep: async () => {},
  });
  await assert.rejects(() => invalidSchema.structuredJson({ vision: true, messages: [], schema: z.object({ ok: z.boolean() }) }), (error) => error.code === 'SCHEMA_VALIDATION_FAILED');
});

test('two invalid Vision generations fail after exactly two attempts', async () => {
  let calls = 0;
  const client = new MimoClient({ apiKey: 'test', apiBase: 'https://example.invalid', textModel: 'text', visionModel: 'vision', timeoutMs: 60000, visionTimeoutMs: 45000, maxRetries: 0 }, {
    fetch: async () => { calls += 1; return new Response(JSON.stringify({ choices: [{ message: { content: 'not-json' }, finish_reason: 'stop' }] }), { status: 200 }); }, sleep: async () => {},
  });
  await assert.rejects(() => client.structuredJson({ vision: true, messages: [], schema: z.object({ ok: z.boolean() }) }), (error) => error.code === 'INVALID_JSON');
  assert.equal(calls, 2);
});

test('structured JSON retries one empty response and then succeeds', async () => {
  let calls = 0;
  const client = new MimoClient({ apiKey: 'test', apiBase: 'https://example.invalid', textModel: 'text', visionModel: 'vision', timeoutMs: 1000, maxRetries: 9 }, {
    fetch: async () => {
      calls += 1;
      const content = calls === 1 ? '' : '{"ok":true}';
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { completion_tokens: 10, completion_tokens_details: { reasoning_tokens: 0 } } }), { status: 200, headers: { 'x-request-id': 'safe-id' } });
    }, sleep: async () => {},
  });
  const result = await client.structuredJson({ messages: [], schema: z.object({ ok: z.boolean() }) });
  assert.equal(calls, 2);
  assert.equal(result.data.ok, true);
});

test('two structured empty responses fail after exactly two attempts', async () => {
  let calls = 0;
  const client = new MimoClient({ apiKey: 'test', apiBase: 'https://example.invalid', textModel: 'text', visionModel: 'vision', timeoutMs: 1000, maxRetries: 9 }, {
    fetch: async () => { calls += 1; return new Response(JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] }), { status: 200 }); }, sleep: async () => {},
  });
  await assert.rejects(() => client.structuredJson({ messages: [], schema: z.object({ ok: z.boolean() }) }), (error) => error.code === 'EMPTY_CONTENT');
  assert.equal(calls, 2);
});
