#!/usr/bin/env node
const http = require('node:http');
const { migrate } = require('./db/migrate');
const { createContainer } = require('./container');
const { createScheduler } = require('./scheduler/scheduler');
const logger = require('./utils/logger');

const migration = migrate();
const container = createContainer();
const scheduler = createScheduler(container);
if (container.config.scheduler.enabled) scheduler.start();

const port = Number(process.env.PORT || 3000);
const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    try {
      container.db.prepare('SELECT 1').get();
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, scheduler: container.config.scheduler.enabled }));
    } catch {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false }));
    }
    return;
  }
  response.writeHead(404).end();
});
server.listen(port, '0.0.0.0', () => logger.info('gym.started', { port, migrations: migration.applied }));

function shutdown() { scheduler.stop(); server.close(() => process.exit(0)); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
