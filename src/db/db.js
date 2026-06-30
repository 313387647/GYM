const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { rootPath, ensureDir } = require('../utils/paths');
const { logError } = require('../utils/logger');

function getDbPath() {
  return process.env.GYM_DB_PATH
    ? path.resolve(rootPath(), process.env.GYM_DB_PATH)
    : path.join(rootPath(), 'data', 'gym.db');
}

function openDb(options = {}) {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath) && options.mustExist) {
    throw new Error(`Database is not initialized: ${dbPath}`);
  }
  ensureDir(path.dirname(dbPath));
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  return db;
}

function initDb() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const db = openDb();
  try {
    db.exec(schema);
    return { ok: true, dbPath: getDbPath() };
  } catch (error) {
    logError('init-db failed', error);
    throw error;
  } finally {
    db.close();
  }
}

function withDb(fn) {
  const db = openDb({ mustExist: true });
  try {
    return fn(db);
  } catch (error) {
    logError('database operation failed', error);
    throw error;
  } finally {
    db.close();
  }
}

module.exports = { getDbPath, openDb, initDb, withDb };
