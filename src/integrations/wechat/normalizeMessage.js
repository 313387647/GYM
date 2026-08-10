const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { stableId } = require('../../utils/id');

function extensionForMime(mime = '') {
  return ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' })[mime] || '.bin';
}

function normalizePrompt(params, config, now = new Date()) {
  const blocks = Array.isArray(params.prompt) ? params.prompt : [];
  const texts = [];
  let imagePath = null;
  fs.mkdirSync(config.wechat.inboxDir, { recursive: true });
  for (const block of blocks) {
    if (block.type === 'text') texts.push(block.text);
    if (block.type === 'image' && block.data && !imagePath) {
      const buffer = Buffer.from(block.data, 'base64');
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      imagePath = path.join(config.wechat.inboxDir, `${hash}${extensionForMime(block.mimeType)}`);
      if (!fs.existsSync(imagePath)) fs.writeFileSync(imagePath, buffer, { flag: 'wx' });
    }
  }
  const text = texts.join('\n').trim();
  const savedPath = text.match(/saved to:\s*([^\]\n]+)/i)?.[1]?.trim();
  if (!imagePath && savedPath && /\.(jpe?g|png|webp|gif)$/i.test(savedPath)) imagePath = savedPath;
  const messageId = params._meta?.messageId || params._meta?.wechatMessageId || stableId('msg', params.sessionId, text, imagePath || '', String(Math.floor(now.getTime() / 300000)));
  if (imagePath) return { type: 'image_received', payload: { path: imagePath, caption: text, message_id: messageId, meal_type: 'other' }, messageId };
  return { type: 'user_message', payload: { text, message_id: messageId }, messageId };
}
module.exports = { normalizePrompt, extensionForMime };
