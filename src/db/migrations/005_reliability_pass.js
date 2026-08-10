function addColumn(db, table, definition) {
  const name = definition.trim().split(/\s+/)[0];
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((column) => column.name === name);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

module.exports = {
  version: 5,
  name: 'reliability_conversation_and_delivery',
  up(db) {
    addColumn(db, 'outbound_messages', 'retry_count INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'outbound_messages', 'last_attempt_at TEXT');
    addColumn(db, 'outbound_messages', 'error_code TEXT');
    addColumn(db, 'reminders', 'retry_count INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'reminders', 'last_attempt_at TEXT');
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_messages (
        id TEXT PRIMARY KEY,
        user_id_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user','assistant')),
        content TEXT NOT NULL,
        event_id TEXT REFERENCES events(id),
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_event_role
        ON conversation_messages(event_id, role) WHERE event_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_conversation_recent
        ON conversation_messages(user_id_hash, created_at DESC);

      CREATE TABLE IF NOT EXISTS pending_interactions (
        id TEXT PRIMARY KEY,
        user_id_hash TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','cancelled','expired')),
        source_event_id TEXT REFERENCES events(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pending_interactions_active
        ON pending_interactions(user_id_hash, status, updated_at DESC);
    `);
  },
};
