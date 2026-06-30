function chooseTone(scene, facts = {}) {
  if (facts.anxious) return 'comfort';
  if (scene === 'user_lazy') return 'strict';
  if (scene === 'training_card') return 'serious';
  if (scene === 'meal_logged' || scene === 'weight_logged') return 'playful';
  if (scene === 'evening_summary') return 'comfort';
  return 'soft';
}

module.exports = { chooseTone };
