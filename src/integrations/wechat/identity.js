function resolveUserId(meta, config) {
  const transportUserId = meta?.wechatUserId;
  return typeof transportUserId === 'string' && transportUserId.trim()
    ? transportUserId
    : config.defaultUserId;
}

module.exports = { resolveUserId };
