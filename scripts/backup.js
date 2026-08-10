#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { resolveDatabasePath } = require('../src/db');

const source = resolveDatabasePath();
if (!fs.existsSync(source)) { console.error(`数据库不存在: ${source}`); process.exit(1); }
const directory = path.join(path.dirname(source), 'backups');
fs.mkdirSync(directory, { recursive: true });
const destination = path.join(directory, `gym_coach.backup-${Date.now()}.db`);
const db = new Database(source, { readonly: true });
db.backup(destination)
  .then(() => {
    const check = new Database(destination, { readonly: true });
    const integrity = check.pragma('integrity_check', { simple: true });
    check.close();
    if (integrity !== 'ok') throw new Error(`backup integrity check failed: ${integrity}`);
    console.log(JSON.stringify({ ok: true, destination }, null, 2));
  })
  .catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; })
  .finally(() => db.close());
