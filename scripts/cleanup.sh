#!/bin/bash
# GYM Coach 清理脚本
# 用法: bash scripts/cleanup.sh
# 移除 LaunchAgent、~/bin 脚本、日志（保留项目数据和 wechat-acp）

set -e

echo "🧹 GYM Coach 清理中..."

# 1. 卸载所有 GYM LaunchAgent
echo "  卸载 LaunchAgents..."
for plist in ~/Library/LaunchAgents/com.gym.*.plist; do
  [ -f "$plist" ] || continue
  launchctl unload "$plist" 2>/dev/null || true
  rm -f "$plist"
  echo "    ❌ $(basename "$plist")"
done

# 2. 清理 ~/bin 脚本和日志
echo "  清理 ~/bin..."
rm -f ~/bin/inject-reminder.sh ~/bin/_config.sh ~/bin/get_context.sh ~/bin/get_context.js ~/bin/log_meal.js ~/bin/watchdog.sh
rm -f ~/bin/reminder.log ~/bin/watchdog.log ~/bin/launchd-*.log

# 3. 清理残留 cron
echo "  清理 cron..."
crontab -l 2>/dev/null | grep -v "# GYM-COACH" | grep -v "inject-reminder" | crontab - 2>/dev/null || true

echo ""
echo "✅ 清理完成。"
echo "   GYM 目录、数据、wechat-acp 均未删除。"
echo "   重新启动: bash scripts/start.sh"
