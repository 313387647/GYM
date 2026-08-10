const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { z } = require('zod');
const { mealItemSchema } = require('../../schemas/actions');

const analysisSchema = z.object({
  is_food: z.boolean(),
  confidence: z.enum(['high', 'medium', 'low']),
  items: z.array(mealItemSchema).max(20),
  notes: z.string().max(500).optional(),
  needs_clarification: z.boolean().default(false),
  clarification_question: z.string().max(300).optional().nullable(),
});

function isInside(filePath, root) {
  const relative = path.relative(root, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function detectMime(buffer, filePath) {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.gif') return 'image/gif';
  throw new Error('Unsupported or unrecognized image format');
}

class FoodVision {
  constructor({ client, allowedRoots, maxBytes = 15 * 1024 * 1024 }) {
    this.client = client;
    this.allowedRoots = allowedRoots.map((root) => {
      const resolved = path.resolve(root);
      try { return fs.realpathSync(resolved); } catch { return resolved; }
    });
    this.maxBytes = maxBytes;
  }
  async analyze(imagePath) {
    const resolved = fs.realpathSync(path.resolve(imagePath));
    if (!this.allowedRoots.some((root) => isInside(resolved, root))) throw new Error('Image path is outside the configured inbox');
    const stats = fs.statSync(resolved);
    if (!stats.isFile() || stats.size <= 0 || stats.size > this.maxBytes) throw new Error('Invalid image file size');
    const buffer = fs.readFileSync(resolved);
    const mime = detectMime(buffer, resolved);
    const imageHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const prompt = `判断图片是否为食物。若是，识别每种食物和份量并估算营养；不确定时降低 confidence，不要假装精确。只输出 JSON：{"is_food":true,"confidence":"high|medium|low","items":[{"name":"","amount":"","calories":0,"protein_g":0,"carbs_g":0,"fat_g":0,"confidence":"high|medium|low"}],"notes":"","needs_clarification":false,"clarification_question":null}`;
    const response = await this.client.structuredJson({
      vision: true,
      schema: analysisSchema,
      messages: [
        { role: 'system', content: '你是谨慎的食物图片营养分析器。禁止医疗诊断，只输出指定 JSON。' },
        { role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${buffer.toString('base64')}` } },
        ] },
      ],
    });
    return { ...response.data, image_hash: imageHash, mime, path: resolved };
  }
}

module.exports = { FoodVision, analysisSchema, isInside, detectMime };
