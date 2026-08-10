const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { loadConfig } = require('../config');

const connections = new Map();

function resolveDatabasePath(explicitPath) {
  if (explicitPath) return path.resolve(explicitPath);
  const config = loadConfig();
  if (process.env.GYM_DB_PATH) return config.databasePath;
  if (fs.existsSync(config.legacyDatabasePath) && !fs.existsSync(config.databasePath)) {
    return config.legacyDatabasePath;
  }
  return config.databasePath;
}

function getDB(options = {}) {
  const databasePath = resolveDatabasePath(options.databasePath);
  if (!options.forceNew && connections.has(databasePath)) return connections.get(databasePath);
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath, options.readonly ? { readonly: true } : undefined);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (!options.readonly) db.pragma('journal_mode = WAL');
  if (!options.forceNew) connections.set(databasePath, db);
  return db;
}

function closeDB(databasePath) {
  if (databasePath) {
    const resolved = resolveDatabasePath(databasePath);
    const db = connections.get(resolved);
    if (db) db.close();
    connections.delete(resolved);
    return;
  }
  for (const db of connections.values()) db.close();
  connections.clear();
}

module.exports = { getDB, closeDB, resolveDatabasePath };
