const logger = require('../../utils/logger');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseJsonObjectDetailed } = require('../../utils/json');
const { LlmConfigError, LlmTimeoutError, LlmHttpError, LlmResponseError } = require('./errors');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class MimoClient {
  constructor(config, options = {}) {
    this.config = config;
    this.fetch = options.fetch || globalThis.fetch;
    this.sleep = options.sleep || sleep;
    if (typeof this.fetch !== 'function') throw new LlmConfigError('Node.js 20+ fetch is required', { code: 'FETCH_UNAVAILABLE' });
  }

  async text({ messages, model, temperature = 0.4, maxTokens = 2000, signal, maxRetries, thinking, responseFormat }) {
    return this.request({ model: model || this.config.textModel, messages, temperature, max_completion_tokens: maxTokens,
      ...(thinking ? { thinking: { type: thinking } } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}) }, signal, { maxRetries });
  }

  async vision({ messages, model, temperature = 0.1, maxTokens = 1000, signal, maxRetries = 1, responseFormat, thinking }) {
    return this.request({ model: model || this.config.visionModel, messages, temperature, max_completion_tokens: maxTokens,
      ...(thinking ? { thinking: { type: thinking } } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}) }, signal, {
      timeoutMs: this.config.visionTimeoutMs ?? 45000,
      maxRetries,
    });
  }

  async structuredJson({ messages, schema, model, vision = false, temperature = 0.1, maxTokens = 3000, signal, responseFormat = { type: 'json_object' }, thinking = 'disabled' }) {
    const attempts = 2;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let response;
      try {
        response = vision
          ? await this.vision({ messages, model, temperature, maxTokens, signal, maxRetries: 0, responseFormat, thinking })
          : await this.text({ messages, model, temperature, maxTokens, signal, maxRetries: 0, responseFormat, thinking });
        const parsedResult = parseJsonObjectDetailed(response.content);
        const validation = schema.safeParse(parsedResult.value);
        if (!validation.success) throw new LlmResponseError('MiMo JSON failed schema validation', { code: 'SCHEMA_VALIDATION_FAILED', details: validation.error.flatten() });
        return { ...response, data: validation.data, jsonRepaired: parsedResult.repaired };
      } catch (error) {
        const normalized = error instanceof LlmResponseError ? error : this.normalizeStructuredError(error, response, vision);
        lastError = normalized;
        if (vision && normalized.code === 'INVALID_JSON') this.logVisionDiagnostic(response, normalized);
        const retryable = attempt === 1 && (normalized.code === 'EMPTY_CONTENT' || (vision && (
          ['INVALID_JSON', 'TIMEOUT', 'NETWORK_ERROR'].includes(normalized.code)
          || normalized.status === 408 || normalized.status === 429 || normalized.status >= 500
        )));
        if (!retryable) throw normalized;
      }
    }
    throw lastError;
  }

  normalizeStructuredError(error, response, vision) {
    if (error instanceof LlmResponseError || error instanceof LlmHttpError || error instanceof LlmConfigError) return error;
    const parseFailureType = error.parseFailureType || 'MALFORMED_JSON';
    return new LlmResponseError('MiMo returned invalid JSON', {
      code: 'INVALID_JSON', cause: error,
      details: { parse_failure_type: parseFailureType, preview: response?.content?.slice(0, 300) },
    });
  }

  logVisionDiagnostic(response, error) {
    const details = error.details || {};
    const meta = {
      model: response?.model || this.config.visionModel,
      http_status: response?.httpStatus || null,
      finish_reason: response?.finishReason || null,
      content_length: response?.content?.length || 0,
      usage: response?.usage || null,
      latency_ms: response?.latencyMs || null,
      request_id: response?.requestId || null,
      parse_failure_type: details.parse_failure_type || 'MALFORMED_JSON',
    };
    logger.warn('vision.structured_output_invalid', meta);
    if (!this.config.visionDiagnosticsEnabled || !response?.content) return;
    fs.mkdirSync(this.config.diagnosticsDir, { recursive: true });
    const filePath = path.join(this.config.diagnosticsDir, `vision-invalid-${Date.now()}-${crypto.randomUUID()}.txt`);
    fs.writeFileSync(filePath, response.content, { mode: 0o600 });
  }

  async request(payload, externalSignal, options = {}) {
    if (!this.config.apiKey) throw new LlmConfigError('MIMO_API_KEY is not configured', { code: 'MISSING_API_KEY' });
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;
    const attempts = Math.max(1, (options.maxRetries ?? this.config.maxRetries) + 1);
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
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
        const choice = body?.choices?.[0];
        const content = choice?.message?.content;
        const responseMeta = {
          model: body.model || payload.model,
          finish_reason: choice?.finish_reason || null,
          usage: body.usage || null,
          latency_ms: Date.now() - startedAt,
          request_id: response.headers.get('x-request-id') || null,
        };
        if (typeof content !== 'string' || !content.trim()) {
          throw new LlmResponseError('MiMo response has no assistant content', {
            code: 'EMPTY_CONTENT', details: responseMeta,
          });
        }
        logger.info('mimo.request.completed', { model: payload.model, attempt, latency_ms: Date.now() - startedAt, usage: body.usage || null });
        return { content, model: body.model || payload.model, usage: body.usage || null, requestId: response.headers.get('x-request-id') || null,
          finishReason: body?.choices?.[0]?.finish_reason || null, httpStatus: response.status, latencyMs: Date.now() - startedAt };
      } catch (error) {
        if (error.name === 'AbortError' || controller.signal.aborted) {
          lastError = new LlmTimeoutError('MiMo request timed out or was cancelled', { code: 'TIMEOUT', retryable: !externalSignal?.aborted, cause: error });
        } else if (error instanceof LlmHttpError || error instanceof LlmResponseError || error instanceof LlmConfigError) lastError = error;
        else lastError = new LlmHttpError('MiMo network request failed', { code: 'NETWORK_ERROR', retryable: true, cause: error });
        logger.warn('mimo.request.failed', {
          model: payload.model, attempt, latency_ms: Date.now() - startedAt, error_code: lastError.code, status: lastError.status,
          finish_reason: lastError.details?.finish_reason || null,
          usage: lastError.details?.usage || null,
          request_id: lastError.details?.request_id || null,
        });
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
