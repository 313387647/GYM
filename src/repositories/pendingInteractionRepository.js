const { stableId } = require('../utils/id');

class PendingInteractionRepository {
  constructor(db) { this.db = db; }
  create({ userIdHash, kind, payload, sourceEventId, now = new Date().toISOString() }) {
    const expiresAt = new Date(new Date(now).getTime() + (kind === 'food_quantity' || kind === 'food_image_draft' ? 2 : 12) * 60 * 60 * 1000).toISOString();
    const id = stableId('pending', userIdHash, kind, sourceEventId);
    this.db.prepare(`INSERT INTO pending_interactions (id,user_id_hash,kind,payload_json,status,source_event_id,created_at,updated_at,expires_at)
      VALUES (?,?,?,?, 'active',?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,status='active',updated_at=excluded.updated_at,expires_at=excluded.expires_at`)
      .run(id, userIdHash, kind, JSON.stringify(payload), sourceEventId, now, now, expiresAt);
    return this.get(id);
  }
  expire(now = new Date().toISOString()) {
    return this.db.prepare("UPDATE pending_interactions SET status='expired', updated_at=? WHERE status='active' AND expires_at IS NOT NULL AND expires_at<=?").run(now, now).changes;
  }
  active(userIdHash, kind, now = new Date().toISOString()) {
    this.expire(now);
    const row = this.db.prepare(`SELECT * FROM pending_interactions WHERE user_id_hash=? AND status='active'
      ${kind ? 'AND kind=?' : ''} AND (expires_at IS NULL OR expires_at>?) ORDER BY updated_at DESC LIMIT 1`).get(...(kind ? [userIdHash, kind, now] : [userIdHash, now]));
    return row ? { ...row, payload: JSON.parse(row.payload_json) } : null;
  }
  activeFoodDraft(userIdHash, now = new Date().toISOString()) {
    this.expire(now);
    const row = this.db.prepare(`SELECT * FROM pending_interactions WHERE user_id_hash=? AND kind='food_image_draft'
      AND status='active' AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at DESC LIMIT 1`).get(userIdHash, now);
    return row ? { ...row, payload: JSON.parse(row.payload_json) } : null;
  }
  activeFoodDraftByImageHash(userIdHash, imageHash, now = new Date().toISOString()) {
    this.expire(now);
    const rows = this.db.prepare(`SELECT * FROM pending_interactions WHERE user_id_hash=? AND kind='food_image_draft'
      AND status='active' AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at DESC LIMIT 10`).all(userIdHash, now);
    const row = rows.find((entry) => JSON.parse(entry.payload_json).image_hash === imageHash);
    return row ? { ...row, payload: JSON.parse(row.payload_json) } : null;
  }
  workoutDraftByImageHash(userIdHash, imageHash, now = new Date().toISOString()) {
    this.expire(now);
    const rows = this.db.prepare(`SELECT * FROM pending_interactions WHERE user_id_hash=? AND kind='workout_image_draft'
      ORDER BY created_at DESC LIMIT 20`).all(userIdHash);
    const row = rows.find((entry) => JSON.parse(entry.payload_json).image_hash === imageHash);
    return row ? { ...row, payload: JSON.parse(row.payload_json) } : null;
  }
  get(id) { const row = this.db.prepare('SELECT * FROM pending_interactions WHERE id=?').get(id); return row ? { ...row, payload: JSON.parse(row.payload_json) } : null; }
  complete(id, now = new Date().toISOString()) { this.db.prepare("UPDATE pending_interactions SET status='completed', completed_at=?, updated_at=? WHERE id=? AND status='active'").run(now, now, id); }
  cancel(id, now = new Date().toISOString()) { this.db.prepare("UPDATE pending_interactions SET status='cancelled', completed_at=?, updated_at=? WHERE id=? AND status='active'").run(now, now, id); }
}
module.exports = { PendingInteractionRepository };
