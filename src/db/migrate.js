#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { getDB, closeDB, resolveDatabasePath } = require('./index');

const migrations = [
  require('./migrations/001_initial'),
  require('./migrations/002_agent_runtime'),
  require('./migrations/003_default_schedules'),
  require('./migrations/004_dynamic_training_windows'),
  require('./migrations/005_reliability_pass'),
  require('./migrations/006_pending_interaction_expiry'),
];

function backupDatabase(databasePath) {
  if (!fs.existsSync(databasePath) || fs.statSync(databasePath).size === 0) return null;
  const backupDir = path.join(path.dirname(databasePath), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `gym_coach.pre-migration-${Date.now()}.db`);
  fs.copyFileSync(databasePath, backupPath);
  return backupPath;
}

function migrate(options = {}) {
  const databasePath = resolveDatabasePath(options.databasePath);
  const db = getDB({ databasePath, forceNew: true });
  let backupPath = null;
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`);
    const applied = new Set(db.prepare('SELECT version FROM schema_version').all().map((row) => row.version));
    const pending = migrations.filter((migration) => !applied.has(migration.version));
    if (pending.length && !options.skipBackup) {
      db.pragma('wal_checkpoint(TRUNCATE)');
      backupPath = backupDatabase(databasePath);
    }
    for (const migration of pending) {
      db.transaction(() => {
        migration.up(db);
        db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)")
          .run(migration.version, new Date().toISOString());
      })();
    }
    return { databasePath, backupPath, applied: pending.map(({ version, name }) => ({ version, name })) };
  } finally {
    db.close();
  }
}

if (require.main === module) {
  const result = migrate();
  console.log(JSON.stringify(result, null, 2));
  closeDB();
}

module.exports = { migrate, migrations, backupDatabase };
