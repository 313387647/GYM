#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_PATH="${GYM_DB_PATH:-$ROOT_DIR/data/gym.db}"
BACKUP_DIR="$ROOT_DIR/backups"
STAMP="$(date +%Y%m%d_%H%M%S)"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB_PATH" ]; then
  echo "数据库不存在：$DB_PATH"
  exit 1
fi

cp "$DB_PATH" "$BACKUP_DIR/gym_$STAMP.db"
echo "备份完成：$BACKUP_DIR/gym_$STAMP.db"
