#!/bin/bash
# 通用 MiMo 视觉分析
# 用法: bash scripts/vision.sh <image_path> "<prompt>"
# 输出: 模型的文本回复

set -e

IMAGE_PATH="$1"
PROMPT="$2"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_config.sh"

# 从 .env 读取密钥
if [ -f "$GYM_DIR/.env" ]; then
  export $(grep -v '^#' "$GYM_DIR/.env" | xargs)
fi

API_KEY="${MIMO_API_KEY:-}"
API_BASE="$MIMO_API_BASE"
MODEL="$MIMO_MODEL"

if [ -z "$IMAGE_PATH" ] || [ -z "$PROMPT" ]; then
  echo '{"error": "用法: bash scripts/vision.sh <image_path> \"<prompt>\""}'
  exit 1
fi

if [ ! -f "$IMAGE_PATH" ]; then
  echo "{\"error\": \"文件不存在: $IMAGE_PATH\"}"
  exit 1
fi

if [ -z "$API_KEY" ]; then
  echo '{"error": "未设置 MIMO_API_KEY，请在 .env 中配置"}'
  exit 1
fi

# 获取文件 MIME 类型
MIME=$(file --mime-type -b "$IMAGE_PATH" 2>/dev/null || echo "image/jpeg")

# base64 编码
IMAGE_B64=$(base64 -i "$IMAGE_PATH" 2>/dev/null | tr -d '\n')
DATA_URI="data:${MIME};base64,${IMAGE_B64}"

# 构建请求 JSON
REQUEST_TMP=$(mktemp)
python3 -c "
import json, sys
data_uri = sys.argv[1]
prompt = sys.argv[2]
payload = {
    'model': '$MODEL',
    'messages': [
        {'role': 'user', 'content': [
            {'type': 'text', 'text': prompt},
            {'type': 'image_url', 'image_url': {'url': data_uri}}
        ]}
    ],
    'temperature': 0.3,
    'max_tokens': 4000
}
with open(sys.argv[3], 'w') as f:
    json.dump(payload, f, ensure_ascii=False)
" "$DATA_URI" "$PROMPT" "$REQUEST_TMP"

# 调用 MiMo API（带重试）
MAX_RETRIES=2
RETRY=0
RESPONSE=""

while [ $RETRY -le $MAX_RETRIES ]; do
  RESPONSE=$(curl -s --max-time 60 "$API_BASE/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d @"$REQUEST_TMP" 2>&1)

  if ! echo "$RESPONSE" | grep -q '"error"'; then
    break
  fi

  RETRY=$((RETRY + 1))
  if [ $RETRY -le $MAX_RETRIES ]; then
    sleep 2
  fi
done

rm -f "$REQUEST_TMP"

# 检查是否有错误
if echo "$RESPONSE" | grep -q '"error"'; then
  ERROR_MSG=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('error',{}).get('message','unknown error'))" 2>/dev/null || echo "API 调用失败")
  echo "❌ MiMo API 错误: $ERROR_MSG"
  exit 1
fi

# 提取 content
echo "$RESPONSE" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    content = data['choices'][0]['message']['content']
    print(content)
except Exception as e:
    print(f'解析失败: {e}', file=sys.stderr)
    sys.exit(1)
"
