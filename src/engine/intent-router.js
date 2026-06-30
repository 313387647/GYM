function routeIntent(input) {
  if (input.type === 'reminder') {
    return { name: 'reminder_event', event: input.event };
  }
  if (input.type === 'image' || input.image_path) {
    return { name: 'meal_photo', imagePath: input.image_path };
  }

  const text = normalize(input.text);
  const weight = parseWeight(text);
  if (weight) return { name: 'weight_log', weightKg: weight };

  if (/今天.*练什么|练什么|训练计划|训练卡/.test(text)) {
    return { name: 'ask_plan' };
  }

  if (/今天.*(吃了多少|情况|总结|热量|蛋白)|还剩多少|剩多少/.test(text)) {
    return { name: 'ask_summary' };
  }

  if (/练完|训练完|rpe|RPE|卧推|深蹲|下拉|划船|肩推/.test(text)) {
    return parseWorkoutDone(text);
  }

  if (/午饭|晚饭|晚餐|午餐|加餐|吃了|拿铁|鸡|饭|面|蛋|牛肉|鱼|奶|沙拉/.test(text)) {
    return { name: 'meal_text', text, mealType: inferMealType(text) };
  }

  if (/不想练|懒|累死|躺平|不去了/.test(text)) {
    return { name: 'chat', scene: 'user_lazy' };
  }
  if (/焦虑|崩了|完蛋|胖了|烦/.test(text)) {
    return { name: 'chat', scene: 'user_anxious' };
  }

  return { name: 'chat', scene: 'casual_chat' };
}

function normalize(text) {
  return String(text || '').trim();
}

function parseWeight(text) {
  const cleaned = text.replace(/公斤|kg|KG/g, '');
  const match = cleaned.match(/(?:今天|早上|体重|^)\s*(\d{2,3}(?:\.\d)?)(?:\s*$|\s*[，,。 ]?)/);
  if (!match) return null;
  const value = Number(match[1]);
  if (value >= 40 && value <= 200) return value;
  return null;
}

function inferMealType(text) {
  if (/晚饭|晚餐/.test(text)) return 'dinner';
  if (/加餐|训前|练前/.test(text)) return 'pre_workout';
  if (/练后|训后/.test(text)) return 'post_workout';
  return 'lunch';
}

function parseWorkoutDone(text) {
  const rpeMatch = text.match(/RPE\s*(\d{1,2})|rpe\s*(\d{1,2})/i);
  const rpe = rpeMatch ? Number(rpeMatch[1] || rpeMatch[2]) : null;
  const exerciseNames = ['卧推', '哑铃卧推', '高位下拉', '下拉', '深蹲', '肩推', '划船', '腿举', '硬拉', '弯举', '三头下压'];
  const exercises = [];

  for (const name of exerciseNames) {
    const idx = text.indexOf(name);
    if (idx < 0) continue;
    const chunk = text.slice(idx, idx + 36);
    const nums = [...chunk.matchAll(/\d+(?:\.\d+)?/g)].map(m => Number(m[0]));
    if (nums.length === 0) continue;
    const weight = nums[0] > 15 ? nums[0] : null;
    const reps = nums.slice(weight ? 1 : 0).filter(n => n > 0 && n <= 50);
    exercises.push({
      name,
      weight,
      reps
    });
  }

  return { name: 'workout_done', text, rpe, exercises };
}

module.exports = { routeIntent, parseWeight };
