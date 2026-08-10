#!/usr/bin/env node
const { migrate } = require('../db/migrate');
const { createContainer } = require('../container');
const { getLogicalDate } = require('../utils/date');
const args = process.argv.slice(2);
const requestedDate = args.includes('--date') ? args[args.indexOf('--date') + 1] : null;
migrate();
const container = createContainer();
const time = getLogicalDate();
const logicalDate = requestedDate || time.logical_date;
const state = container.services.stateService.build({ logicalDate, weekday: time.weekday, hour: time.hour });
if (args.includes('--save')) {
  container.db.prepare(`INSERT INTO daily_state (logical_date,state_json,updated_at) VALUES (?,?,?)
    ON CONFLICT(logical_date) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at`)
    .run(logicalDate, JSON.stringify(state), new Date().toISOString());
}
console.log(JSON.stringify(state, null, 2));
