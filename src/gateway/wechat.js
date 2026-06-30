const { execFileSync } = require('child_process');
const { logInfo, logError } = require('../utils/logger');
const { runCoach } = require('../engine/coach-engine');

function sendText(text) {
  if (!process.env.WECHAT_SEND_COMMAND) {
    logInfo('wechat not configured; printed to console', { text });
    console.log(text);
    return { ok: true, mode: 'console' };
  }

  try {
    const [command, ...args] = process.env.WECHAT_SEND_COMMAND.split(' ');
    execFileSync(command, [...args, text], { stdio: 'pipe' });
    logInfo('wechat message sent', { text });
    return { ok: true, mode: 'wechat' };
  } catch (error) {
    logError('wechat send failed', error);
    console.log(text);
    return { ok: false, mode: 'console', error: error.message };
  }
}

async function handleIncomingMessage(payload) {
  const result = await runCoach({
    source: 'wechat',
    type: payload.type || (payload.image_path ? 'image' : 'text'),
    text: payload.text,
    image_path: payload.image_path,
    timestamp: payload.timestamp
  });
  sendText(result.reply);
  return result;
}

module.exports = { sendText, handleIncomingMessage };
