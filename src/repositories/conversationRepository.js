const { stableId } = require('../utils/id');

class ConversationRepository {
  constructor(db) { this.db = db; }
  add({ userIdHash, role, content, eventId, now = new Date().toISOString() }) {
    if (!content) return null;
    const id = stableId('msg', eventId || '', role, content);
    this.db.prepare(`INSERT OR IGNORE INTO conversation_messages (id,user_id_hash,role,content,event_id,created_at)
      VALUES (?,?,?,?,?,?)`).run(id, userIdHash, role, content.slice(0, 4000), eventId || null, now);
    return this.db.prepare('SELECT * FROM conversation_messages WHERE id=?').get(id) || null;
  }
  recent(userIdHash, limit = 16) {
    return this.db.prepare(`SELECT role, content, created_at FROM conversation_messages
      WHERE user_id_hash=? ORDER BY created_at DESC LIMIT ?`).all(userIdHash, limit).reverse();
  }
}
module.exports = { ConversationRepository };
