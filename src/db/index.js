// src/db/index.js — 统一 SQLite 连接
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.resolve(__dirname, '../../gym_coach.db');

let _db = null;

function getDB(opts = {}) {
    if (_db && !opts.forceNew) return _db;
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    if (!opts.forceNew) _db = db;
    return db;
}

function closeDB() {
    if (_db) { _db.close(); _db = null; }
}

module.exports = { getDB, closeDB, DB_PATH };
