#!/bin/bash
# 补丁 wechat-acp：将 markdown 回复转为微信友好纯文本
# 每次 wechat-acp 更新后需要重新执行
set -euo pipefail
exec python3 "$(cd "$(dirname "$0")" && pwd)/_patch_markdown.py"
