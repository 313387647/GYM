#!/bin/bash
# wechat-acp 健康检查 + 自动恢复
# 通过 launchd 定时调用（每 30 分钟）
# 检查项：进程存活 + inject 无卡死 + 无 getUpdates 错误 + 无新失败

set -e

source "$(cd "$(dirname "$0")" && pwd)/_config.sh"

LOG_FILE="$LOG_DIR/watchdog.log"
STALE_MINUTES=10
FAILED_DIR="$HOME/.wechat-acp/inject/failed"
STDOUT_LOG="$HOME/.wechat-acp/launchd-stdout.log"
STATE_FILE="$LOG_DIR/watchdog.state"  # 记录上次检查的 failed 文件数

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# 刷新上下文（每 30 分钟更新 data/context.json）
node "$GYM_DIR/scripts/get_context.js" --save 2>/dev/null || true

restart_acp() {
  log "WARN: 重启 wechat-acp..."
  launchctl unload ~/Library/LaunchAgents/com.wechat.acp.plist 2>/dev/null || true
  sleep 2
  pkill -f "wechat-acp" 2>/dev/null || true
  sleep 1
  launchctl load ~/Library/LaunchAgents/com.wechat.acp.plist 2>/dev/null || true
  sleep 5
  # 自动补丁 wechat-acp（更新后重打）
  bash "$GYM_DIR/scripts/patch-wechat-acp.sh" 2>/dev/null || true
  bash "$GYM_DIR/scripts/patch-markdown.sh" 2>/dev/null || true
  if ps aux | grep -v grep | grep -q "wechat-acp"; then
    log "OK: wechat-acp 重启成功 + 补丁已应用"
  else
    log "ERROR: wechat-acp 重启失败"
  fi
}

# 1. 进程存活
if ! ps aux | grep -v grep | grep -q "wechat-acp"; then
  log "ERROR: wechat-acp 进程不存在"
  restart_acp
  exit 0
fi

# 2. inject 卡死检查
PROCESSING_DIR="$HOME/.wechat-acp/inject/processing"
if [ -d "$PROCESSING_DIR" ]; then
  for f in "$PROCESSING_DIR"/*.json; do
    [ -f "$f" ] || continue
    AGE=$(( ($(date +%s) - $(stat -f %m "$f")) / 60 ))
    if [ "$AGE" -ge "$STALE_MINUTES" ]; then
      log "WARN: inject 卡死 ${AGE}分钟: $(basename "$f")"
      restart_acp
      exit 0
    fi
  done
fi

# 3. 检查 getUpdates 连续错误（最后 20 行有 3+ 次 fetch failed）
if [ -f "$STDOUT_LOG" ]; then
  FETCH_ERRORS=$(tail -20 "$STDOUT_LOG" 2>/dev/null | grep -c "fetch failed" || true)
  if [ "$FETCH_ERRORS" -ge 3 ]; then
    log "WARN: getUpdates 连续失败 (${FETCH_ERRORS}次)"
    restart_acp
    exit 0
  fi
fi

# 4. 检查新增 failed injects
if [ -d "$FAILED_DIR" ]; then
  CURRENT_FAILED=$(ls -1 "$FAILED_DIR"/*.json 2>/dev/null | wc -l | tr -d ' ')
  LAST_FAILED=0
  if [ -f "$STATE_FILE" ]; then
    LAST_FAILED=$(cat "$STATE_FILE" 2>/dev/null || echo "0")
  fi
  echo "$CURRENT_FAILED" > "$STATE_FILE"
  if [ "$CURRENT_FAILED" -gt "$LAST_FAILED" ] && [ "$LAST_FAILED" -gt 0 ]; then
    NEW=$((CURRENT_FAILED - LAST_FAILED))
    log "WARN: 新增 ${NEW} 个失败 inject"
    restart_acp
    exit 0
  fi
fi

log "OK: 健康"
