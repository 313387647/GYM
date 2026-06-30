#!/bin/bash
# 共享配置 — 所有脚本 source 此文件
# 路径集中管理，改一处生效全部
# ⚠️ 密钥已迁移到 .env，此文件只保留路径和非敏感配置

GYM_DIR="/Users/sherryyoung/Desktop/GYM"
BIN_DIR="/Users/sherryyoung/bin"
DATA_DIR="$GYM_DIR/data"
DAILY_DIR="$DATA_DIR/daily"
LOG_DIR="$BIN_DIR"  # launchd 受 TCC 限制，日志只能放 ~/bin

# WeChat 配置（launchd 需要，TCC 限制无法读 ~/Desktop/.env）
WECHAT_USER="o9cq803Bj9aLxZ03w1nYWcer5Y5U@im.wechat"
WECHAT_BOT="df6654171baa@im.bot"

# MiMo API — 从 .env 读取（analyze-food.sh / vision.sh 调用时自行加载）
# 不再在此硬编码 MIMO_API_KEY
MIMO_API_BASE="https://api.xiaomimimo.com/v1"
MIMO_MODEL="mimo-v2.5"

# launchd 环境缺少用户 PATH
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
