#!/bin/bash
# 向 wechat-acp 注入提醒消息
# 用法: inject-reminder.sh <morning|lunch|pre_workout|training|evening|weekly_report>
# 注意: launchd 调用时需从 ~/bin 执行（TCC 限制），source 路径用绝对路径
#
# v2.0: 集成 get_context.sh，所有日期判断统一由脚本计算，不再依赖 LLM 推理

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_config.sh"

TYPE="${1:-}"
LOG_FILE="$LOG_DIR/reminder.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# 检查 wechat-acp 是否存活
if ! ps aux | grep -v grep | grep -q "wechat-acp"; then
  log "ERROR: wechat-acp 未运行: $TYPE"
  exit 1
fi

# ============================================================
# 获取统一上下文（get_context.js 处理跨天逻辑 + 今日饮食）
# --with-meals 会在 JSON 中附加 today_meals 字段
# ============================================================
CTX_JSON=$(node "$GYM_DIR/scripts/get_context.js" --minify --with-meals 2>/dev/null || echo '{}')
LOGICAL_DATE=$(echo "$CTX_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('logical_date',''))" 2>/dev/null || date '+%Y-%m-%d')

log "逻辑日期: $LOGICAL_DATE"

# 获取今日数据（从 context JSON 的 today_meals 字段）
get_today_data() {
  CALORIES=0; PROTEIN=0; TRAINING="未完成"
  # 尝试从 context JSON 的 today_meals 提取
  CALORIES=$(echo "$CTX_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); m=d.get('today_meals',{}); print(m.get('total_calories',0))" 2>/dev/null || echo "0")
  PROTEIN=$(echo "$CTX_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); m=d.get('today_meals',{}); print(m.get('total_protein_g',0))" 2>/dev/null || echo "0")
  # 训练完成状态从 daily_summary 表或 context 判断
  DONE=$(echo "$CTX_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('training_completed', False))" 2>/dev/null || echo "False")
  TRAINING=$([ "$DONE" = "True" ] && echo "已完成" || echo "未完成")
}

# 从上下文提取关键字段
IS_TRAINING=$(echo "$CTX_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('is_training_day',False))" 2>/dev/null || echo "False")
TRAINING_NAME=$(echo "$CTX_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('training_name',''))" 2>/dev/null || echo "")
DAILY_CAL=$(echo "$CTX_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('daily_calories',2150))" 2>/dev/null || echo "2150")
DAILY_PRO=$(echo "$CTX_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('macros',{}).get('protein_g',170))" 2>/dev/null || echo "170")

case "$TYPE" in
  morning)
    # 注入 daily_state + 基础上下文
    DAILY_STATE=$(node "$GYM_DIR/src/tools/generateDailyState.js" --save 2>/dev/null || echo '{"error":"unavailable"}')
    TEXT="[SYSTEM_CONTEXT] $CTX_JSON

[DAILY_STATE] $DAILY_STATE

[REMINDER_TYPE] morning

[系统指令] 早安检查。基于 DAILY_STATE 判断今天最重要的行动：通常需要提醒用户报体重，但不要机械重复。如果连续几天有体重记录则认可，如果没有则直接要求。语气遵循 daily_state.tone_strategy。"
    ;;
  lunch)
    DAILY_STATE=$(node "$GYM_DIR/src/tools/generateDailyState.js" --save 2>/dev/null || echo '{"error":"unavailable"}')
    TEXT="[SYSTEM_CONTEXT] $CTX_JSON

[DAILY_STATE] $DAILY_STATE

[REMINDER_TYPE] lunch

[系统指令] 午餐提醒。基于 DAILY_STATE 判断：控热量、补蛋白、恢复记录还是保持节奏。根据 calorie_status 和 protein_status 给出具体方向。要求用户拍照记录。语气遵循 daily_state.tone_strategy。"
    ;;
  pre_workout)
    DAILY_STATE=$(node "$GYM_DIR/src/tools/generateDailyState.js" --save 2>/dev/null || echo '{"error":"unavailable"}')
    TEXT="[SYSTEM_CONTEXT] $CTX_JSON

[DAILY_STATE] $DAILY_STATE

[REMINDER_TYPE] pre_workout

[系统指令] 训前加餐提醒。确认用户是否吃了午餐、现在是否需要加餐。根据 today's meal status 推荐加餐内容。提醒训练时间和训练类型。语气遵循 daily_state.tone_strategy。"
    ;;
  training)
    DAILY_STATE=$(node "$GYM_DIR/src/tools/generateDailyState.js" --save 2>/dev/null || echo '{"error":"unavailable"}')
    TEXT="[SYSTEM_CONTEXT] $CTX_JSON

[DAILY_STATE] $DAILY_STATE

[REMINDER_TYPE] training

[系统指令] 训练提醒。从 context.json 确认训练类型，从 plan.json 获取对应 workout 动作，输出训练卡（动作名称、组数、次数、重量，@kg 格式）。如果今天还没记录饮食，提醒训练前需要吃点东西。语气遵循 daily_state.tone_strategy。不要输出确认消息，直接输出训练卡。"
    ;;
  evening)
    DAILY_STATE=$(node "$GYM_DIR/src/tools/generateDailyState.js" --save 2>/dev/null || echo '{"error":"unavailable"}')
    TEXT="[SYSTEM_CONTEXT] $CTX_JSON

[DAILY_STATE] $DAILY_STATE

[REMINDER_TYPE] evening

[系统指令] 晚间收尾。调 queryStatus.js --today 获取精确数据。生成今日总结和评分。如果训练日但未训练，指出但不责备。如果饮食记录不全，鼓励明天补上。给出一个具体的改进建议。语气遵循 daily_state.tone_strategy。"
    ;;
  weekly_report)
    DAILY_STATE=$(node "$GYM_DIR/src/tools/generateDailyState.js" --save 2>/dev/null || echo '{"error":"unavailable"}')
    TEXT="[SYSTEM_CONTEXT] $CTX_JSON

[DAILY_STATE] $DAILY_STATE

[REMINDER_TYPE] weekly_report

[系统指令] 周日周报。调 queryStatus.js --week 和 queryStatus.js --weight-trend 获取数据。生成本周报告：训练完成率、体重趋势、饮食均值、最大风险点。给出下周的 1-2 个具体建议。语气遵循 daily_state.tone_strategy。"
    ;;
  *)
    echo "用法: $0 <morning|lunch|pre_workout|training|evening|weekly_report>"
    exit 1
    ;;
esac

log "发送提醒: $TYPE"

INJECT_OUTPUT=$(npx -y wechat-acp@latest inject --text "$TEXT" --to "$WECHAT_USER" 2>&1)
INJECT_EXIT=$?

echo "$INJECT_OUTPUT" | while IFS= read -r line; do
  log "  $line"
done

if [ $INJECT_EXIT -ne 0 ]; then
  log "ERROR: inject 失败 (exit=$INJECT_EXIT): $TYPE"
  exit $INJECT_EXIT
fi

log "完成: $TYPE"
