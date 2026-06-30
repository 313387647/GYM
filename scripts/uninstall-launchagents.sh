#!/usr/bin/env bash
set -euo pipefail

PLIST_DIR="$HOME/Library/LaunchAgents"
LABELS=(
  com.gym.catcoach.service
  com.gym.catcoach.morning
  com.gym.catcoach.lunch
  com.gym.catcoach.preworkout
  com.gym.catcoach.training
  com.gym.catcoach.evening
)

for label in "${LABELS[@]}"; do
  plist="$PLIST_DIR/$label.plist"
  if [ -f "$plist" ]; then
    launchctl unload "$plist" >/dev/null 2>&1 || true
    rm -f "$plist"
    echo "已卸载：$label"
  fi
done

echo "LaunchAgent 已卸载。"
