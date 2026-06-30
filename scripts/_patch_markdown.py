#!/usr/bin/env python3
"""Fix wechat-acp send.js: restore original + apply markdown-to-plaintext patch."""
import os, re, glob

MARKER = 'MARKDOWN_TO_WECHAT_V1'

ORIGINAL = """/**
 * Send messages via WeChat iLink API.
 */
import crypto from "node:crypto";
import { sendMessage } from "./api.js";
import { MessageType, MessageState } from "./types.js";
export async function sendTextMessage(to, text, opts, clientId, sendFn = sendMessage) {
    if (!opts.contextToken) {
        throw new Error("contextToken is required to send a message");
    }
    const id = clientId ?? `wechat-acp-${crypto.randomUUID()}`;
    await sendFn({
        baseUrl: opts.baseUrl,
        token: opts.token,
        body: {
            msg: {
                from_user_id: "",
                to_user_id: to,
                client_id: id,
                message_type: MessageType.BOT,
                message_state: MessageState.FINISH,
                context_token: opts.contextToken,
                item_list: [{ type: 1, text_item: { text } }],
            },
        },
    });
    return id;
}
export function splitText(text, maxLen) {
    if (text.length <= maxLen)
        return [text];
    const segments = [];
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= maxLen) {
            segments.push(remaining);
            break;
        }
        let breakAt = remaining.lastIndexOf("\\n", maxLen);
        if (breakAt <= 0)
            breakAt = maxLen;
        segments.push(remaining.substring(0, breakAt));
        remaining = remaining.substring(breakAt).replace(/^\\n/, "");
    }
    return segments;
}
//# sourceMappingURL=send.js.map"""

CONVERTER = r"""

// MARKDOWN_TO_WECHAT_V1: markdown -> WeChat plain text
function markdownToWeChat(text) {
    let t = text;
    // bold
    t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
    // italic
    t = t.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1");
    // headings
    t = t.replace(/^#{1,6}\s+/gm, "");
    // horizontal rules
    t = t.replace(/^[-_*]{3,}$/gm, "----------");
    // unordered lists
    t = t.replace(/^[\s]*[-+]\s+/gm, "- ");
    // inline code
    t = t.replace(/`([^`]+)`/g, "$1");
    // code blocks
    t = t.replace(/```[\s\S]*?```/g, function(match) {
        var inner = match.replace(/```\w*\n?/g, "").replace(/\n```$/, "");
        return "\n" + inner.trim() + "\n";
    });
    // links
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
    // underline
    t = t.replace(/<u>(.*?)<\/u>/g, "$1");
    // bare HTML tags
    t = t.replace(/<\/?[a-z]+>/gi, "");
    // collapse excessive blank lines
    t = t.replace(/\n{4,}/g, "\n\n\n");
    return t;
}
"""

home = os.path.expanduser('~')
npx_root = os.path.join(home, '.npm', '_npx')
fixed = 0

for entry in os.listdir(npx_root):
    send_path = os.path.join(npx_root, entry, 'node_modules', 'wechat-acp', 'dist', 'src', 'weixin', 'send.js')
    if not os.path.isfile(send_path):
        continue

    print(f"  {entry}:", end=" ")
    content = open(send_path).read()

    # Already correctly patched?
    if MARKER in content and 'export async function sendTextMessage' in content:
        if '([^*' in content and '\n]+)' in content:
            print("corrupted, fixing...")
        else:
            print("already OK")
            fixed += 1
            continue

    # Apply patch
    new_content = ORIGINAL
    new_content = new_content.replace(
        'export async function sendTextMessage',
        CONVERTER.strip() + '\n\nexport async function sendTextMessage'
    )
    new_content = new_content.replace(
        'text_item: { text }',
        'text_item: { text: markdownToWeChat(text) }'
    )

    with open(send_path, 'w') as f:
        f.write(new_content)
    print("fixed")
    fixed += 1

print(f"Result: {fixed} OK")
