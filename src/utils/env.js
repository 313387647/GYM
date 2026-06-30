const fs = require('fs');
const path = require('path');
const { rootPath } = require('./paths');

function loadEnv() {
  const envPath = rootPath('.env');
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
  } else {
    require('dotenv').config();
  }
  if (!process.env.TZ) {
    process.env.TZ = 'Asia/Shanghai';
  }
}

function envStatus() {
  return {
    wechatConfigured: Boolean(process.env.WECHAT_SEND_COMMAND),
    llmConfigured: Boolean(process.env.LLM_API_KEY),
    visionConfigured: Boolean(process.env.FOOD_VISION_API_KEY),
    envPath: path.join(rootPath(), '.env')
  };
}

module.exports = { loadEnv, envStatus };
