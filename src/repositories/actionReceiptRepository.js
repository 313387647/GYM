class ActionReceiptRepository {
  constructor(db) { this.db = db; }
  get(actionKey, actionType) {
    const row = this.db.prepare('SELECT action_type, result_json FROM action_receipts WHERE action_key=?').get(actionKey);
    if (!row) return null;
    if (actionType && row.action_type !== actionType) {
      const error = new Error(`Action receipt type mismatch for ${actionKey}`);
      error.code = 'ACTION_RECEIPT_TYPE_MISMATCH';
      throw error;
    }
    return JSON.parse(row.result_json);
  }
  save(actionKey, actionType, result, now = new Date().toISOString()) {
    this.db.prepare(`INSERT INTO action_receipts (action_key, action_type, result_json, created_at)
      VALUES (?, ?, ?, ?)`    ).run(actionKey, actionType, JSON.stringify(result), now);
    return result;
  }
}

module.exports = { ActionReceiptRepository };
