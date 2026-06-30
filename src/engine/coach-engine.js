const { routeIntent } = require('./intent-router');
const { buildContext } = require('./context-builder');
const { buildResponse } = require('./response-builder');
const { withDb } = require('../db/db');
const { logInfo, logError } = require('../utils/logger');
const WeightService = require('../services/weight-service');
const NutritionService = require('../services/nutrition-service');
const TrainingService = require('../services/training-service');
const ReminderService = require('../services/reminder-service');
const SummaryService = require('../services/summary-service');

async function runCoach(input) {
  let intent;
  try {
    const context = buildContext(input);
    intent = routeIntent(input);
    recordChat({ direction: 'in', eventType: input.type, text: input.text, imagePath: input.image_path, intent });
    logInfo('intent routed', { intent, date: context.date });

    const result = await handleIntent(intent, input, context);
    recordChat({ direction: 'out', eventType: intent.name, text: result.reply, intent });
    return result;
  } catch (error) {
    logError('coach engine failed', error);
    const reply = '猫猫这边出错了，但不会装没事。你稍后再发一次，或先跑 npm run health 看状态。';
    try {
      recordChat({ direction: 'out', eventType: intent ? intent.name : 'error', text: reply, intent });
    } catch {}
    return { reply, actions: [{ type: 'error', message: error.message }] };
  }
}

async function handleIntent(intent, input, context) {
  switch (intent.name) {
    case 'reminder_event': {
      const reminder = ReminderService.sendReminder(intent.event, context.date, { force: input.force });
      return { reply: reminder.message, actions: [{ type: 'reminder', skipped: reminder.skipped }] };
    }
    case 'weight_log': {
      const facts = WeightService.logWeight({ date: context.date, weightKg: intent.weightKg, note: input.text });
      return { reply: buildResponse('weight_logged', facts), actions: [{ type: 'weight_logged', facts }] };
    }
    case 'meal_text': {
      const items = NutritionService.estimateMealText(intent.text);
      const logged = NutritionService.logMeal({
        date: context.date,
        mealType: intent.mealType,
        source: 'text',
        items,
        note: input.text
      });
      const facts = mealFacts(intent.mealType, logged);
      return { reply: buildResponse('meal_logged', facts), actions: [{ type: 'meal_logged', mealId: logged.mealId }] };
    }
    case 'meal_photo': {
      const analysis = NutritionService.analyzeFoodImage(intent.imagePath);
      if (!analysis.ok) {
        return { reply: buildResponse('food_vision_unconfigured', { imagePath: intent.imagePath }), actions: [{ type: 'vision_missing' }] };
      }
      const logged = NutritionService.logMeal({
        date: context.date,
        mealType: 'lunch',
        source: 'image',
        imagePath: intent.imagePath,
        items: analysis.items,
        note: 'image estimate'
      });
      return { reply: buildResponse('meal_logged', mealFacts('lunch', logged)), actions: [{ type: 'meal_logged', mealId: logged.mealId }] };
    }
    case 'workout_done': {
      const workoutType = context.workoutType || inferWorkoutType(input.text);
      const facts = TrainingService.logWorkout({
        date: context.date,
        workoutType,
        exercises: intent.exercises,
        rpe: intent.rpe,
        notes: input.text
      });
      return { reply: buildResponse('workout_logged', facts), actions: [{ type: 'workout_logged', facts }] };
    }
    case 'ask_plan': {
      const card = TrainingService.getWorkoutCard(context.date);
      return { reply: buildResponse('training_card', { card }), actions: [{ type: 'training_card' }] };
    }
    case 'ask_summary': {
      const summary = SummaryService.getDailySummary(context.date);
      return { reply: buildResponse('evening_summary', { summary: summary.message }), actions: [{ type: 'summary' }] };
    }
    case 'chat':
      return { reply: buildResponse(intent.scene || 'casual_chat'), actions: [{ type: 'chat' }] };
    default:
      return { reply: buildResponse('unknown'), actions: [{ type: 'unknown' }] };
  }
}

function recordChat({ direction, eventType, text, imagePath, intent }) {
  withDb(db => {
    db.prepare(`
      INSERT INTO chat_events(direction, event_type, text, image_path, parsed_intent)
      VALUES (?, ?, ?, ?, ?)
    `).run(direction, eventType || null, text || null, imagePath || null, intent ? JSON.stringify(intent) : null);
  });
}

function mealFacts(mealType, logged) {
  const budget = NutritionService.getNutritionBudget(logged.date);
  return {
    mealLabel: labelMeal(mealType),
    totalCalories: logged.totals.calories,
    totalProtein: logged.totals.protein,
    dailyCalories: logged.calories,
    dailyProtein: logged.protein,
    calorieTarget: budget.calorieTarget,
    proteinTarget: budget.proteinTarget,
    remainingCalories: budget.remainingCalories
  };
}

function labelMeal(mealType) {
  const map = {
    lunch: '午饭',
    dinner: '晚饭',
    pre_workout: '训前加餐',
    post_workout: '练后餐'
  };
  return map[mealType] || '这餐';
}

function inferWorkoutType(text) {
  if (/深蹲|腿举|硬拉/.test(text || '')) return 'Lower';
  if (/上斜|二头/.test(text || '')) return 'Upper B';
  return 'Upper A';
}

module.exports = { runCoach };
