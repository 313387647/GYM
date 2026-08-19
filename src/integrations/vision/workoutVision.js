const { z } = require('zod');

const workoutScreenshotSchema = z.object({
  is_workout_screenshot: z.boolean(),
  confidence: z.enum(['high', 'medium', 'low']),
  workout_name: z.string().max(100).nullish(),
  workout_type: z.string().max(50).nullish(),
  total_duration_min: z.coerce.number().min(0).max(600).nullish(),
  cardio_done_min: z.coerce.number().min(0).max(300).nullish(),
  calories_burned_kcal: z.coerce.number().min(0).max(5000).nullish(),
  avg_heart_rate_bpm: z.coerce.number().int().min(20).max(260).nullish(),
  rpe_score: z.coerce.number().int().min(1).max(10).nullish(),
  notes: z.string().max(500).nullish(),
  needs_clarification: z.boolean().default(false),
  clarification_question: z.string().max(300).nullish(),
});

class WorkoutVision {
  constructor({ client, imageReader }) { this.client = client; this.imageReader = imageReader; }
  imageHash(imagePath) { return this.imageReader.imageHash(imagePath); }
  async analyze(imagePath, { signal } = {}) {
    const { resolved, buffer, mime, imageHash } = this.imageReader.readImage(imagePath);
    const response = await this.client.structuredJson({
      vision: true,
      schema: workoutScreenshotSchema,
      messages: [
        { role: 'system', content: '你是谨慎的训练截图数据提取器。只分析健身 App、手表、跑步机等训练数据截图；不能确认就 needs_clarification=true。禁止医疗诊断，只输出指定 JSON。' },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${mime};base64,${buffer.toString('base64')}` } },
          { type: 'text', text: '判断是否为训练数据截图。只输出 JSON：{"is_workout_screenshot":true,"confidence":"high|medium|low","workout_name":null,"workout_type":null,"total_duration_min":null,"cardio_done_min":null,"calories_burned_kcal":null,"avg_heart_rate_bpm":null,"rpe_score":null,"notes":null,"needs_clarification":false,"clarification_question":null}。只提取图片中可见且可信的数据；不确定字段填 null。' },
        ] },
      ], maxTokens: 900, thinking: 'disabled', responseFormat: { type: 'json_object' }, signal,
    });
    return { ...response.data, image_hash: imageHash, mime, path: resolved };
  }
}

module.exports = { WorkoutVision, workoutScreenshotSchema };
