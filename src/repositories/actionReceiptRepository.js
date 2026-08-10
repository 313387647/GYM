class ActionReceiptRepository {
  constructor(db) { this.db = db; }
  get(actionKey) {
    const row = this.db.prepare('SELECT result_json FROM action_receipts WHERE action_key=?').get(actionKey);
    return row ? JSON.parse(row.result_json) : null;
  }
  save(actionKey, actionType, result, now = new Date().toISOString()) {
    this.db.prepare(`INSERT INTO action_receipts (action_key, action_type, result_json, created_at)
      VALUES (?, ?, ?, ?)`    ).run(actionKey, actionType, JSON.stringify(result), now);
    return result;
  }
}

module.exports = { ActionReceiptRepository };
