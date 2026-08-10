function addColumn(db, table, definition) {
  const name = definition.trim().split(/\s+/)[0];
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((column) => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

module.exports = {
  version: 6,
  name: 'pending_interaction_expiry',
  up(db) {
    addColumn(db, 'pending_interactions', 'expires_at TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_pending_interactions_expiry ON pending_interactions(user_id_hash, status, expires_at)');
  },
};
