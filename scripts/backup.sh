#!/bin/bash
# GYM Coach 数据备份（SQLite 版）
# 用法: bash scripts/backup.sh [备份目录]
# 默认备份到 ~/Desktop/GYM-backups/

set -e

GYM_DIR="/Users/sherryyoung/Desktop/GYM"
BACKUP_DIR="${1:-$HOME/Desktop/GYM-backups}"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
BACKUP_FILE="$BACKUP_DIR/gym_backup_$TIMESTAMP.tar.gz"

mkdir -p "$BACKUP_DIR"

# 创建备份（排除缓存和临时文件）
tar -czf "$BACKUP_FILE" \
  -C "$GYM_DIR" \
  --exclude='.claude/sessions' \
  --exclude='.claude/cache' \
  --exclude='.claude/backups' \
  --exclude='node_modules' \
  --exclude='.DS_Store' \
  . 2>/dev/null

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "✅ 备份完成: $BACKUP_FILE ($SIZE)"

# 保留最近 10 个备份，删除旧的
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/gym_backup_*.tar.gz 2>/dev/null | wc -l | tr -d ' ')
if [ "$BACKUP_COUNT" -gt 10 ]; then
  ls -1t "$BACKUP_DIR"/gym_backup_*.tar.gz | tail -n +11 | xargs rm -f
  echo "🗑️  已清理旧备份，保留最近 10 个"
fi

echo "📁 备份目录: $BACKUP_DIR"
echo "📊 备份数量: $(ls -1 "$BACKUP_DIR"/gym_backup_*.tar.gz 2>/dev/null | wc -l | tr -d ' ')"
echo "💾 包含: gym_coach.db + data/* + scripts/* + plan.json + CLAUDE.md + .env"
