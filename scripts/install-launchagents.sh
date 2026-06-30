#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_DIR="$HOME/Library/LaunchAgents"
NODE_BIN="$(command -v node)"
mkdir -p "$PLIST_DIR" "$ROOT_DIR/logs"

write_plist() {
  local label="$1"
  local command="$2"
  local hour="$3"
  local minute="$4"
  local plist="$PLIST_DIR/$label.plist"

  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>WorkingDirectory</key>
  <string>$ROOT_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$ROOT_DIR/src/index.js</string>
    <string>reminder</string>
    <string>$command</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>$hour</integer>
    <key>Minute</key>
    <integer>$minute</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$ROOT_DIR/logs/launchd-$command.log</string>
  <key>StandardErrorPath</key>
  <string>$ROOT_DIR/logs/launchd-$command.err.log</string>
</dict>
</plist>
EOF
  launchctl unload "$plist" >/dev/null 2>&1 || true
  launchctl load "$plist"
  echo "已安装：$label"
}

SERVICE_PLIST="$PLIST_DIR/com.gym.catcoach.service.plist"
cat > "$SERVICE_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.gym.catcoach.service</string>
  <key>WorkingDirectory</key>
  <string>$ROOT_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$ROOT_DIR/src/index.js</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$ROOT_DIR/logs/service.log</string>
  <key>StandardErrorPath</key>
  <string>$ROOT_DIR/logs/service.err.log</string>
</dict>
</plist>
EOF
launchctl unload "$SERVICE_PLIST" >/dev/null 2>&1 || true
launchctl load "$SERVICE_PLIST"
echo "已安装：com.gym.catcoach.service"

write_plist "com.gym.catcoach.morning" "morning_checkin" 7 30
write_plist "com.gym.catcoach.lunch" "lunch" 12 0
write_plist "com.gym.catcoach.preworkout" "pre_workout" 17 30
write_plist "com.gym.catcoach.training" "training_card" 18 20
write_plist "com.gym.catcoach.evening" "evening_summary" 21 50

echo "LaunchAgent 安装完成。Codex / Claude 不需要保持运行。"
