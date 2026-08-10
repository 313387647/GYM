const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { migrate, migrations } = require('../../src/db/migrate');

test('v1 history migrates additively to current schema', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-migrate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, 'history.db');
  const db = new Database(databasePath);
  migrations[0].up(db);
  db.exec("CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT); INSERT INTO schema_version VALUES (1,'old')");
  db.prepare("INSERT INTO meals (logical_date,meal_type,item_name,calories,protein_g) VALUES ('2026-01-01','lunch','历史餐',500,30)").run();
  db.close();
  migrate({ databasePath, skipBackup: true });
  const migrated = new Database(databasePath);
  assert.equal(migrated.prepare('SELECT COUNT(*) count FROM meals').get().count, 1);
  assert.equal(migrated.prepare('SELECT MAX(version) version FROM schema_version').get().version, 6);
  assert.ok(migrated.prepare("SELECT name FROM sqlite_master WHERE name='reminders'").get());
  migrated.close();
});
