#!/bin/bash
# GYM Coach 启动脚本
# 用法: bash scripts/start.sh
# 功能: 同步脚本到 ~/bin、管理 LaunchAgent 提醒

set -e

GYM_DIR="/Users/sherryyoung/Desktop/GYM"
BIN_DIR="$HOME/bin"
LAUNCH_DIR="$HOME/Library/LaunchAgents"

echo "🏋️  GYM Coach 启动中..."

# 0. 确保 ~/bin 存在
mkdir -p "$BIN_DIR"

# 1. 同步脚本到 ~/bin（绕过 macOS TCC 限制）
echo "📁 同步脚本到 ~/bin..."
for f in inject-reminder.sh _config.sh get_context.sh get_context.js log_meal.js watchdog.sh; do
  if [ -f "$GYM_DIR/scripts/$f" ]; then
    cp "$GYM_DIR/scripts/$f" "$BIN_DIR/$f"
    chmod +x "$BIN_DIR/$f"
  fi
done
echo "  ✅ 脚本已同步"

# 2. 检查 wechat-acp
echo "🚀 检查 wechat-acp 服务..."
if ps aux | grep -v grep | grep -q "wechat-acp"; then
  echo "  ✅ wechat-acp 已在运行"
  # 自动打补丁
  bash "$GYM_DIR/scripts/patch-wechat-acp.sh" 2>/dev/null || true
  bash "$GYM_DIR/scripts/patch-markdown.sh" 2>/dev/null || true
else
  echo "  ⚠️  wechat-acp 未运行"
  echo "  请手动启动: npx wechat-acp@latest --agent claude --hide-thoughts"
fi

# 3. 确保数据目录存在
mkdir -p "$GYM_DIR/data/daily" "$GYM_DIR/data/reports"

# 4. 安装/更新 LaunchAgent 提醒
echo "⏰ 配置 LaunchAgent 提醒..."

create_plist() {
  local name=$1 type=$2 hour=$3 minute=$4 weekday=$5
  local plist="$LAUNCH_DIR/com.gym.${name}.plist"
  local logf="$BIN_DIR/launchd-${name}.log"

  # 先卸载旧版
  launchctl unload "$plist" 2>/dev/null || true

  # 构造 StartCalendarInterval
  if [ -n "$weekday" ]; then
    # 多 weekday 用数组
    local entries=""
    for wd in $weekday; do
      entries+="<dict><key>Weekday</key><integer>$wd</integer><key>Hour</key><integer>$hour</integer><key>Minute</key><integer>$minute</integer></dict>"
    done
    SCHEDULE="<key>StartCalendarInterval</key><array>$entries</array>"
  else
    SCHEDULE="<key>StartCalendarInterval</key><dict><key>Hour</key><integer>$hour</integer><key>Minute</key><integer>$minute</integer></dict>"
  fi

  cat > "$plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.gym.${name}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$BIN_DIR/inject-reminder.sh</string>
        <string>$type</string>
    </array>
    $SCHEDULE
    <key>StandardOutPath</key>
    <string>$logf</string>
    <key>StandardErrorPath</key>
    <string>$logf</string>
</dict>
</plist>
EOF

  launchctl load "$plist" 2>/dev/null
  echo "  ✅ ${name} → ${hour}:$(printf '%02d' $minute) ${weekday:+(周${weekday})}"
}

create_plist "morning"     "morning"      7  30 ""
create_plist "lunch"       "lunch"        11 30 ""
create_plist "pre_workout" "pre_workout"  16 45 "1 3 5"
create_plist "training"    "training"     18 20 "1 3 5"
create_plist "evening"     "evening"      21 30 ""
create_plist "weekly"      "weekly_report" 10 0  "0"

# 4b. 同步 watchdog 到 ~/bin 并安装（每 30 分钟健康检查）
cp "$GYM_DIR/scripts/watchdog.sh" "$BIN_DIR/watchdog.sh"
chmod +x "$BIN_DIR/watchdog.sh"

WATCHDOG_PLIST="$LAUNCH_DIR/com.gym.watchdog.plist"
launchctl unload "$WATCHDOG_PLIST" 2>/dev/null || true
cat > "$WATCHDOG_PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.gym.watchdog</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$BIN_DIR/watchdog.sh</string>
    </array>
    <key>StartInterval</key>
    <integer>1800</integer>
    <key>StandardOutPath</key>
    <string>$BIN_DIR/launchd-watchdog.log</string>
    <key>StandardErrorPath</key>
    <string>$BIN_DIR/launchd-watchdog.log</string>
</dict>
</plist>
EOF
launchctl load "$WATCHDOG_PLIST" 2>/dev/null
echo "  ✅ watchdog → 每 30 分钟"

# 4c. 每日 06:00 自动重启 wechat-acp（防止状态腐化）
RESTART_PLIST="$LAUNCH_DIR/com.gym.restart-acp.plist"
launchctl unload "$RESTART_PLIST" 2>/dev/null || true
cat > "$RESTART_PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.gym.restart-acp</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>launchctl unload ~/Library/LaunchAgents/com.wechat.acp.plist 2>/dev/null; sleep 2; pkill -f wechat-acp 2>/dev/null; sleep 1; launchctl load ~/Library/LaunchAgents/com.wechat.acp.plist 2>/dev/null</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>6</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
</dict>
</plist>
EOF
launchctl load "$RESTART_PLIST" 2>/dev/null
echo "  ✅ restart-acp → 每天 06:00"

# 5. 清理残留的旧 cron（如果有的话）
crontab -l 2>/dev/null | grep -v "# GYM-COACH" | grep -v "inject-reminder" | crontab - 2>/dev/null || true

# 6. 显示状态
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  GYM Coach 运行中 🏃"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  提醒时间:"
echo "    07:30  早安       (每天)"
echo "    11:30  午餐       (每天)"
echo "    16:45  训前加餐   (一三五)"
echo "    18:20  训练       (一三五)"
echo "    21:30  晚间       (每天)"
echo "    10:00  周报       (周日)"
echo ""
echo "  防护:"
echo "    watchdog  → 每30分钟检查 agent 健康"
echo "    restart   → 每天06:00自动重启 wechat-acp"
echo ""
echo "  日志: ~/bin/reminder.log | ~/bin/watchdog.log"
echo "  管理: launchctl list | grep gym"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
