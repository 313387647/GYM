const { clampText } = require('../utils/validators');
const { chooseTone } = require('./tone-policy');

function lineJoin(lines) {
  return clampText(lines.filter(Boolean).join('\n'), 520);
}

function renderPersona({ scene, facts = {}, tone }) {
  const selectedTone = tone || chooseTone(scene, facts);
  switch (scene) {
    case 'morning_checkin':
      return '早。上秤，报数。\n体重不是审判，是导航。喝 300ml 水，然后把数字发给我。';
    case 'lunch':
      return '进食窗口开了。午饭记得先拍照再开吃。\n猫猫今天重点盯两件事：热量别爆，蛋白别少。';
    case 'pre_workout':
      return '今天是训练日。下班别和沙发对视太久，它会把你吃掉。\n如果饿，可以先吃点轻的，别空腹硬顶。';
    case 'training_card':
      return facts.card || '今天不是计划训练日。想加练也行，先热身，别硬莽。';
    case 'weight_logged':
      return renderWeightLogged(facts);
    case 'meal_logged':
      return renderMealLogged(facts);
    case 'food_vision_unconfigured':
      return '图片收到啦，但图片识别接口还没配置。先用文字告诉我吃了什么，我照样帮你估算记录。';
    case 'workout_logged':
      return renderWorkoutLogged(facts);
    case 'evening_summary':
      return facts.summary || '今天数据还不够，猫猫不能瞎编。把体重、饭和训练补一下，我再给你收尾。';
    case 'missed_weight':
      return '主人你是不是把猫猫忘了…今天体重还没报。发个数字就行，不许消失。';
    case 'missed_meal':
      return '今天饮食记录空空的。猫猫不审判你，但没有记录我就没法帮你调方向。补一句吃了啥吧。';
    case 'user_lazy':
      return '可以不想练，但不能直接断线。今天降级版：去健身房，做完前三个动作就算赢。';
    case 'user_anxious':
      return '先别把一天的波动当判决。我们看趋势，不看情绪审判。把今天该记录的补上，猫猫陪你慢慢调。';
    case 'casual_chat':
      return selectedTone === 'strict'
        ? '猫猫听见了。但别光聊天，今天的体重、饭、训练哪个还没交？'
        : '我在。你说，我听着；顺便别忘了把今天的数据交给猫猫。';
    case 'unknown':
    default:
      return '这句我没完全看懂。你可以直接发体重、午饭内容、训练完成情况，或者问“今天练什么”。';
  }
}

function renderWeightLogged(facts) {
  const delta = typeof facts.delta === 'number' ? facts.delta : null;
  const deltaText = delta == null ? '这是第一条体重基准。' :
    delta < 0 ? `比上次轻了 ${Math.abs(delta).toFixed(1)}kg。` :
    delta > 0 ? `比上次重了 ${delta.toFixed(1)}kg，先别慌，看趋势。` :
    '和上次一样，稳住。';
  const avg = facts.avg7 ? `7日均值约 ${facts.avg7.toFixed(1)}kg。` : '';
  return `${facts.weightKg.toFixed(1)}kg 已记录。\n${deltaText}${avg}\n午饭继续拍照，我要盯你的蛋白质。`;
}

function renderMealLogged(facts) {
  return lineJoin([
    `${facts.mealLabel || '这餐'}已记录，大约 ${Math.round(facts.totalCalories)} kcal，蛋白 ${Math.round(facts.totalProtein)}g。`,
    `今日合计约 ${Math.round(facts.dailyCalories)} / ${facts.calorieTarget} kcal，蛋白 ${Math.round(facts.dailyProtein)} / ${facts.proteinTarget}g。`,
    facts.remainingCalories >= 0
      ? `还剩约 ${Math.round(facts.remainingCalories)} kcal，别把额度当抽奖券乱花。`
      : `热量已经超了约 ${Math.abs(Math.round(facts.remainingCalories))} kcal，晚点收住。`
  ]);
}

function renderWorkoutLogged(facts) {
  const rpe = facts.rpe ? `RPE ${facts.rpe}` : 'RPE 未记录';
  return `训练已记录：${facts.workoutType || '力量训练'}，${rpe}。\n完成就赢一半，另一半是回家吃够蛋白和早点睡。`;
}

module.exports = { renderPersona };
