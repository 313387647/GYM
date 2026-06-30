#!/bin/bash
# 补丁 wechat-acp：图片保存到 inbox + 路径注入消息
# 必须每次 wechat-acp 更新后重新执行
set -euo pipefail

MARKER="INBOX_PATH_INJECT_V2"
INBOUND_FILES=$(find ~/.npm/_npx -name "inbound.js" -path "*/wechat-acp/*" 2>/dev/null)

for f in $INBOUND_FILES; do
  # 已打新补丁则跳过
  if grep -q "$MARKER" "$f" 2>/dev/null; then
    echo "✅ 已是最新补丁: $(basename $(dirname $(dirname $(dirname $f))))"
    continue
  fi

  python3 - "$f" "$MARKER" << 'PYEOF'
import sys

fp = sys.argv[1]
marker = sys.argv[2]
content = open(fp).read()

applied = 0

# ──────────────── Patch 1: 图片路径注入为文本块 ────────────────

# 变体 A: 新版 wechat-acp（模板字符串 + _meta）
OLD_A = '''        return {
            type: "image",
            data: base64,
            mimeType: "image/jpeg",
            _meta: savedPath ? { savedPath } : undefined,
        };'''

NEW_A = '''        // INBOX_PATH_INJECT_V2
        const imageBlocks = [];
        if (savedPath) {
            imageBlocks.push({
                type: "text",
                text: `[📷 图片已保存: ${savedPath}]`,
                _meta: { savedPath },
            });
        }
        imageBlocks.push({
            type: "image",
            data: base64,
            mimeType: "image/jpeg",
            _meta: savedPath ? { savedPath } : undefined,
        });
        return imageBlocks;'''

# 变体 B: 旧版 wechat-acp（字符串拼接，无 _meta）
OLD_B = '''        return {
            type: "image",
            data: base64,
            mimeType: "image/jpeg",
        };'''

NEW_B = '''        // INBOX_PATH_INJECT_V2
        const imageBlocks = [];
        if (savedPath) {
            imageBlocks.push({
                type: "text",
                text: "[📷 图片已保存: " + savedPath + "]",
                _meta: { savedPath },
            });
        }
        imageBlocks.push({
            type: "image",
            data: base64,
            mimeType: "image/jpeg",
        });
        return imageBlocks;'''

if OLD_A in content:
    content = content.replace(OLD_A, NEW_A)
    applied += 1
elif OLD_B in content:
    content = content.replace(OLD_B, NEW_B)
    applied += 1
else:
    # 检查是否已经有旧 patch 的"Also save to inbox"
    if "Also save to inbox" in content:
        print(f"⚠️  已有旧补丁但模式不匹配: {fp}")
        print("   请手动检查 return 代码块格式")
    else:
        print(f"⚠️  未找到图片处理代码（wechat-acp 版本可能已变更）: {fp}")
    sys.exit(0)

# ──────────────── Patch 2: convertMediaItem 返回数组 ──────────────

OLD_P2 = '''            if (attached)
                blocks.push(attached);'''

NEW_P2 = '''            if (attached) {
                // INBOX_PATH_INJECT_V2: convertMediaItem 可能返回数组
                if (Array.isArray(attached))
                    blocks.push(...attached);
                else
                    blocks.push(attached);
            }'''

if OLD_P2 in content:
    content = content.replace(OLD_P2, NEW_P2)
    applied += 1
else:
    print(f"⚠️  Patch 2 模式不匹配（可能已被修改）: {fp}")

# 写回
open(fp, 'w').write(content)
print(f"🔧 补丁完成 [{applied}/2]: {fp}")

PYEOF

done

echo ""
echo "🎉 补丁应用完毕。需要重启 wechat-acp 生效。"
echo "   效果：用户发图片 → AI 收到 [📷 图片已保存: ~/.wechat-acp/inbox/xxx.jpg]"
echo "   AI 可执行: bash scripts/analyze-food.sh <路径>"
