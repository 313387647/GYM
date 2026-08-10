const { ActionReceiptRepository } = require('../repositories/actionReceiptRepository');

function idempotent(db, actionKey, actionType, operation) {
  const receipts = new ActionReceiptRepository(db);
  const existing = receipts.get(actionKey, actionType);
  if (existing) return { ...existing, duplicate: true };
  return db.transaction(() => {
    const raced = receipts.get(actionKey, actionType);
    if (raced) return { ...raced, duplicate: true };
    const result = operation();
    receipts.save(actionKey, actionType, result);
    return result;
  })();
}

module.exports = { idempotent };
