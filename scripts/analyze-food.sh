#!/bin/bash
# 食物照片分析 — 调用 MiMo 多模态模型
# 用法: bash scripts/analyze-food.sh <image_path>
# 输出: JSON 格式的营养分析结果

set -e

IMAGE_PATH="$1"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_config.sh"

# 从 .env 读取密钥（不再从 _config.sh 硬编码）
if [ -f "$GYM_DIR/.env" ]; then
  export $(grep -v '^#' "$GYM_DIR/.env" | xargs)
fi

API_KEY="${MIMO_API_KEY:-}"
API_BASE="$MIMO_API_BASE"
MODEL="$MIMO_MODEL"

if [ -z "$IMAGE_PATH" ]; then
  echo '{"error": "请提供图片路径: bash scripts/analyze-food.sh <image_path>"}'
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

# 构建请求 JSON 到临时文件（避免 base64 图片导致命令行参数溢出）
SYSTEM_PROMPT='你是一个专业的营养分析师。请根据食物图片，识别食物内容、估算份量，并以严格 JSON 格式输出分析结果，不要额外文字。格式：{"items":[{"name":"食物名","amount":"份量","calories":数字,"protein_g":数字,"carbs_g":数字,"fat_g":数字,"confidence":"high/medium/low"}],"total":{"calories":数字,"protein_g":数字,"carbs_g":数字,"fat_g":数字},"notes":"简短分析说明（1-2句中文）"}'
REQUEST_TMP=$(mktemp)
python3 -c "
import json, sys
data_uri = sys.argv[1]
system_prompt = sys.argv[2]
payload = {
    'model': '$MODEL',
    'messages': [
        {'role': 'system', 'content': system_prompt},
        {'role': 'user', 'content': [
            {'type': 'text', 'text': '请分析这份食物的营养成分'},
            {'type': 'image_url', 'image_url': {'url': data_uri}}
        ]}
    ],
    'temperature': 0.3,
    'max_tokens': 4000
}
with open(sys.argv[3], 'w') as f:
    json.dump(payload, f, ensure_ascii=False)
" "$DATA_URI" "$SYSTEM_PROMPT" "$REQUEST_TMP"

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
  echo "{\"error\": \"$ERROR_MSG\", \"raw\": $(echo "$RESPONSE" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()[:200]))' 2>/dev/null || echo '"truncated"')}"
  exit 1
fi

# 提取 content
CONTENT=$(echo "$RESPONSE" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    content = data['choices'][0]['message']['content']
    # 尝试直接解析 JSON
    try:
        parsed = json.loads(content)
        print(json.dumps(parsed, ensure_ascii=False))
    except:
        # 尝试提取 JSON 块
        import re
        match = re.search(r'\{[\s\S]*\}', content)
        if match:
            try:
                parsed = json.loads(match.group())
                print(json.dumps(parsed, ensure_ascii=False))
            except:
                print(json.dumps({'raw_analysis': content}, ensure_ascii=False))
        else:
            print(json.dumps({'raw_analysis': content}, ensure_ascii=False))
except Exception as e:
    print(json.dumps({'error': str(e), 'raw_response': sys.stdin.read()[:500]}, ensure_ascii=False))
" 2>/dev/null)

if [ -z "$CONTENT" ]; then
  echo "{\"error\": \"无法解析 API 响应\", \"raw\": $(echo "$RESPONSE" | head -c 300)}"
  exit 1
fi

echo "$CONTENT"
