// src/utils/formatWechat.js — 微信纯文本格式化
function toWeChat(text) {
    let t = String(text);
    // bold
    t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
    // italic
    t = t.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1');
    // headings
    t = t.replace(/^#{1,6}\s+/gm, '');
    // horizontal rules → 短分隔
    t = t.replace(/^[-_*]{3,}$/gm, '──────────');
    // unordered lists
    t = t.replace(/^[\s]*[-+]\s+/gm, '• ');
    // inline code
    t = t.replace(/`([^`]+)`/g, '$1');
    // code blocks
    t = t.replace(/```[\s\S]*?```/g, (match) => {
        const inner = match.replace(/```\w*\n?/g, '').replace(/\n```$/, '');
        return '\n' + inner.trim() + '\n';
    });
    // links
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
    // <u> tags
    t = t.replace(/<u>(.*?)<\/u>/g, '$1');
    // bare HTML tags
    t = t.replace(/<\/?[a-z]+>/gi, '');
    // collapse blank lines
    t = t.replace(/\n{4,}/g, '\n\n\n');
    return t;
}

function limitWeChat(text, maxChars = 300) {
    const clean = toWeChat(text);
    if (clean.length <= maxChars) return clean;
    return clean.slice(0, maxChars - 3) + '...';
}

// 直接执行时测试
if (require.main === module) {
    const test = '**粗体** 和 ## 标题 和 `code` 和 [link](url)';
    console.log('input:', test);
    console.log('output:', toWeChat(test));
}

module.exports = { toWeChat, limitWeChat };
