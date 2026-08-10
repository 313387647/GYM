const { stableId } = require('../utils/id');

class PendingInteractionRepository {
  constructor(db) { this.db = db; }
  create({ userIdHash, kind, payload, sourceEventId, now = new Date().toISOString() }) {
    const id = stableId('pending', userIdHash, kind, sourceEventId);
    this.db.prepare(`INSERT INTO pending_interactions (id,user_id_hash,kind,payload_json,status,source_event_id,created_at,updated_at)
      VALUES (?,?,?,?, 'active',?,?,?)
      ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,status='active',updated_at=excluded.updated_at`)
      .run(id, userIdHash, kind, JSON.stringify(payload), sourceEventId, now, now);
    return this.get(id);
  }
  active(userIdHash, kind) {
    const row = this.db.prepare(`SELECT * FROM pending_interactions WHERE user_id_hash=? AND status='active'
      ${kind ? 'AND kind=?' : ''} ORDER BY updated_at DESC LIMIT 1`).get(...(kind ? [userIdHash, kind] : [userIdHash]));
    return row ? { ...row, payload: JSON.parse(row.payload_json) } : null;
  }
  get(id) { const row = this.db.prepare('SELECT * FROM pending_interactions WHERE id=?').get(id); return row ? { ...row, payload: JSON.parse(row.payload_json) } : null; }
  complete(id, now = new Date().toISOString()) { this.db.prepare("UPDATE pending_interactions SET status='completed', completed_at=?, updated_at=? WHERE id=? AND status='active'").run(now, now, id); }
}
module.exports = { PendingInteractionRepository };
