// V1 compatibility facade. New code should use src/config.js.
const { loadConfig } = require('../config');
function loadEnv() {
  const config = loadConfig();
  return {
    MIMO_API_KEY: config.mimo.apiKey,
    MIMO_API_BASE: config.mimo.apiBase,
    MIMO_MODEL: config.mimo.textModel,
    MIMO_TEXT_MODEL: config.mimo.textModel,
    MIMO_VISION_MODEL: config.mimo.visionModel,
    USER_TIMEZONE: config.timezone,
  };
}
module.exports = { loadEnv };
