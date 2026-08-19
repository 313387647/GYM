const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { migrate } = require('../../src/db/migrate');
const { getDB } = require('../../src/db');
const { createContainer } = require('../../src/container');
const { loadConfig } = require('../../src/config');

function createTestDb() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-v2-test-'));
  const databasePath = path.join(directory, 'gym.db');
  migrate({ databasePath, skipBackup: true });
  const db = getDB({ databasePath, forceNew: true });
  return { directory, databasePath, db, cleanup() { db.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
}

function fakeClient() {
  return {
    async structuredJson() { return { data: { intent: 'chat', actions: [], needs_followup: false, response_goal: '收到', tone: 'neutral' } }; },
    async text() { return { content: '收到。' }; },
  };
}

function createTestContainer(testDb, overrides = {}) {
  const config = loadConfig({ GYM_DB_PATH: testDb.databasePath, WECHAT_INBOX_DIR: testDb.directory, WECHAT_ALLOWED_INBOX_ROOTS: testDb.directory });
  return createContainer({ db: testDb.db, config, client: overrides.client || fakeClient(), foodVision: overrides.foodVision, workoutVision: overrides.workoutVision });
}

module.exports = { createTestDb, createTestContainer, fakeClient };
