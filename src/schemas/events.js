const { z } = require('zod');

const eventSchema = z.object({
  id: z.string().min(3),
  type: z.enum(['user_message', 'image_received', 'scheduled_check', 'morning_check', 'meal_window', 'pre_workout', 'workout_window', 'evening_review', 'weekly_review']),
  user_id: z.string().min(1),
  timestamp: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

module.exports = { eventSchema };
