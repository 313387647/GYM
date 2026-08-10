class LlmError extends Error {
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = this.constructor.name;
    this.code = options.code || 'LLM_ERROR';
    this.status = options.status;
    this.retryable = Boolean(options.retryable);
    this.details = options.details;
  }
}
class LlmConfigError extends LlmError {}
class LlmTimeoutError extends LlmError {}
class LlmHttpError extends LlmError {}
class LlmResponseError extends LlmError {}
module.exports = { LlmError, LlmConfigError, LlmTimeoutError, LlmHttpError, LlmResponseError };
