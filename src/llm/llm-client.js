function isConfigured() {
  return Boolean(process.env.LLM_API_KEY && process.env.LLM_BASE_URL);
}

async function complete() {
  if (!isConfigured()) {
    return {
      ok: false,
      reason: 'LLM interface is not configured'
    };
  }
  return {
    ok: false,
    reason: 'LLM client adapter placeholder: configure provider implementation here'
  };
}

module.exports = { isConfigured, complete };
