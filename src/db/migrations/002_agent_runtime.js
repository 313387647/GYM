function columns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

function addColumn(db, table, definition) {
  const name = definition.trim().split(/\s+/)[0];
  if (!columns(db, table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

module.exports = {
  version: 2,
  name: 'agent_runtime_and_idempotency',
  up(db) {
    addColumn(db, 'meals', 'source_event_id TEXT');
    addColumn(db, 'meals', 'source_message_id TEXT');
    addColumn(db, 'meals', 'image_hash TEXT');
    addColumn(db, 'meals', 'metadata_json TEXT');
    addColumn(db, 'weight_logs', 'source_event_id TEXT');
    addColumn(db, 'weight_logs', 'notes TEXT');
    addColumn(db, 'workouts', 'source_event_id TEXT');
    addColumn(db, 'daily_state', 'state_json TEXT');

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_meals_source_event ON meals(source_event_id);
      CREATE INDEX IF NOT EXISTS idx_meals_image_hash ON meals(image_hash);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workouts_source_event
        ON workouts(source_event_id) WHERE source_event_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS action_receipts (
        action_key TEXT PRIMARY KEY,
        action_type TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        user_id_hash TEXT,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        decision_json TEXT,
        result_json TEXT,
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_status ON events(status, occurred_at);

      CREATE TABLE IF NOT EXISTS sleep_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        logical_date TEXT NOT NULL UNIQUE,
        hours REAL NOT NULL,
        quality TEXT,
        bedtime TEXT,
        wake_time TEXT,
        notes TEXT,
        source_event_id TEXT,
        recorded_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS checkins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        logical_date TEXT NOT NULL,
        energy INTEGER,
        mood TEXT,
        workload TEXT,
        soreness INTEGER,
        training_readiness TEXT,
        notes TEXT,
        source_event_id TEXT,
        recorded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_checkins_date ON checkins(logical_date, recorded_at);

      CREATE TABLE IF NOT EXISTS temporary_events (
        id TEXT PRIMARY KEY,
        logical_date TEXT NOT NULL,
        event_type TEXT NOT NULL,
        description TEXT NOT NULL,
        starts_at TEXT,
        ends_at TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        source_event_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_temporary_events_date ON temporary_events(logical_date, status);

      CREATE TABLE IF NOT EXISTS schedule_rules (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        local_time TEXT NOT NULL,
        weekdays_json TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        rule_id TEXT REFERENCES schedule_rules(id),
        event_type TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        payload_json TEXT NOT NULL DEFAULT '{}',
        reason TEXT,
        created_at TEXT NOT NULL,
        sent_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL,
        CHECK(status IN ('pending','processing','sent','skipped','snoozed','rescheduled','cancelled','completed','failed'))
      );
      CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, scheduled_at);

      CREATE TABLE IF NOT EXISTS memory_items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        key TEXT,
        content TEXT NOT NULL,
        importance INTEGER NOT NULL DEFAULT 1,
        active INTEGER NOT NULL DEFAULT 1,
        expires_at TEXT,
        source_event_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_key ON memory_items(type, key) WHERE key IS NOT NULL;

      CREATE TABLE IF NOT EXISTS conversation_summaries (
        id TEXT PRIMARY KEY,
        user_id_hash TEXT,
        summary TEXT NOT NULL,
        from_at TEXT,
        to_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS image_ingestions (
        image_hash TEXT PRIMARY KEY,
        source_message_id TEXT,
        source_event_id TEXT NOT NULL,
        meal_ids_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS outbound_messages (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE REFERENCES events(id),
        user_id_hash TEXT,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        delivered_at TEXT
      );
    `);
  },
};
