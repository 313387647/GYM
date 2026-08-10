const logger = require('../../utils/logger');
const { parseJsonObject } = require('../../utils/json');
const { LlmConfigError, LlmTimeoutError, LlmHttpError, LlmResponseError } = require('./errors');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class MimoClient {
  constructor(config, options = {}) {
    this.config = config;
    this.fetch = options.fetch || globalThis.fetch;
    this.sleep = options.sleep || sleep;
    if (typeof this.fetch !== 'function') throw new LlmConfigError('Node.js 20+ fetch is required', { code: 'FETCH_UNAVAILABLE' });
  }

  async text({ messages, model, temperature = 0.4, maxTokens = 2000, signal }) {
    return this.request({ model: model || this.config.textModel, messages, temperature, max_tokens: maxTokens }, signal);
  }

  async vision({ messages, model, temperature = 0.2, maxTokens = 3000, signal }) {
    return this.request({ model: model || this.config.visionModel, messages, temperature, max_tokens: maxTokens }, signal);
  }

  async structuredJson({ messages, schema, model, vision = false, temperature = 0.1, maxTokens = 3000, signal }) {
    const response = vision
      ? await this.vision({ messages, model, temperature, maxTokens, signal })
      : await this.text({ messages, model, temperature, maxTokens, signal });
    let parsed;
    try { parsed = parseJsonObject(response.content); }
    catch (error) { throw new LlmResponseError('MiMo returned invalid JSON', { code: 'INVALID_JSON', cause: error, details: { preview: response.content.slice(0, 300) } }); }
    const validation = schema.safeParse(parsed);
    if (!validation.success) {
      throw new LlmResponseError('MiMo JSON failed schema validation', { code: 'SCHEMA_VALIDATION_FAILED', details: validation.error.flatten() });
    }
    return { ...response, data: validation.data };
  }

  async request(payload, externalSignal) {
    if (!this.config.apiKey) throw new LlmConfigError('MIMO_API_KEY is not configured', { code: 'MISSING_API_KEY' });
    const attempts = Math.max(1, this.config.maxRetries + 1);
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error('timeout')), this.config.timeoutMs);
      const onAbort = () => controller.abort(externalSignal.reason);
      externalSignal?.addEventListener('abort', onAbort, { once: true });
      const startedAt = Date.now();
      try {
        const response = await this.fetch(`${this.config.apiBase}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.apiKey}` },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        const raw = await response.text();
        let body;
        try { body = JSON.parse(raw); }
        catch (error) { throw new LlmResponseError('MiMo returned non-JSON HTTP response', { code: 'INVALID_HTTP_JSON', cause: error }); }
        if (!response.ok || body.error) {
          const status = response.status;
          throw new LlmHttpError(body.error?.message || `MiMo HTTP ${status}`, {
            code: body.error?.code || 'HTTP_ERROR', status,
            retryable: status === 408 || status === 429 || status >= 500,
          });
        }
        const content = body?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) throw new LlmResponseError('MiMo response has no assistant content', { code: 'EMPTY_CONTENT' });
        logger.info('mimo.request.completed', { model: payload.model, attempt, latency_ms: Date.now() - startedAt, usage: body.usage || null });
        return { content, model: body.model || payload.model, usage: body.usage || null, requestId: response.headers.get('x-request-id') || null };
      } catch (error) {
        if (error.name === 'AbortError' || controller.signal.aborted) {
          lastError = new LlmTimeoutError('MiMo request timed out or was cancelled', { code: 'TIMEOUT', retryable: !externalSignal?.aborted, cause: error });
        } else if (error instanceof LlmHttpError || error instanceof LlmResponseError || error instanceof LlmConfigError) lastError = error;
        else lastError = new LlmHttpError('MiMo network request failed', { code: 'NETWORK_ERROR', retryable: true, cause: error });
        logger.warn('mimo.request.failed', { model: payload.model, attempt, latency_ms: Date.now() - startedAt, error_code: lastError.code, status: lastError.status });
        if (!lastError.retryable || attempt === attempts) throw lastError;
        await this.sleep(Math.min(4000, 500 * (2 ** (attempt - 1))));
      } finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener('abort', onAbort);
      }
    }
    throw lastError;
  }
}

module.exports = { MimoClient };
