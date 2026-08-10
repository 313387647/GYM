const { MealRepository } = require('../repositories/mealRepository');
const { idempotent } = require('./serviceHelpers');

class MealService {
  constructor({ db, planService }) { this.db = db; this.repository = new MealRepository(db); this.planService = planService; }

  logMeal(input) {
    return idempotent(this.db, input.actionKey, 'log_meal', () => {
      if (input.imageHash) {
        const existingImage = this.repository.getImageIngestion(input.imageHash);
        if (existingImage) return { success: true, duplicate: true, reason: 'image_already_logged', meal_ids: existingImage.meal_ids };
      }
      const recordedAt = input.recordedAt || new Date().toISOString();
      const mealIds = this.repository.insertMany({ ...input, recordedAt });
      if (input.imageHash) this.repository.saveImageIngestion({
        imageHash: input.imageHash, sourceMessageId: input.sourceMessageId,
        sourceEventId: input.sourceEventId, mealIds, createdAt: recordedAt,
      });
      return { success: true, meal_ids: mealIds, items: input.items, summary: this.summary(input.logicalDate) };
    });
  }

  summary(logicalDate) {
    const totals = this.repository.totals(logicalDate);
    const targets = this.planService.getTargets();
    return {
      ...totals,
      target_calories: targets.calories,
      target_protein_g: targets.protein_g,
      remaining_calories: Math.max(0, targets.calories - totals.calories),
      remaining_protein_g: Math.max(0, targets.protein_g - totals.protein_g),
    };
  }
}
module.exports = { MealService };
