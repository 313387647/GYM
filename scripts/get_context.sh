#!/bin/bash
# get_context.sh — 薄壳，委托给 get_context.js（SQLite 版）
# 保留此文件是为了兼容已有调用方（inject-reminder.sh / watchdog.sh / start.sh）
set -euo pipefail
exec node "$(cd "$(dirname "$0")" && pwd)/get_context.js" "$@"
