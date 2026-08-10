#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { migrate } = require('../src/db/migrate');
const { createContainer } = require('../src/container');
const { createId } = require('../src/utils/id');
migrate();
const container = createContainer();
const context = container.contextBuilder.build({ id: createId('context'), type: 'scheduled_check', user_id: container.config.defaultUserId, timestamp: new Date().toISOString(), payload: {} });
if (process.argv.includes('--save')) fs.writeFileSync(path.join(container.config.dataDir, 'context.json'), `${JSON.stringify(context, null, 2)}\n`);
console.log(process.argv.includes('--minify') ? JSON.stringify(context) : JSON.stringify(context, null, 2));
