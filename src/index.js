#!/usr/bin/env node
const { loadEnv } = require('./utils/env');
loadEnv();

const app = require('./app');

async function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'init-db':
      app.initializeDatabase();
      break;
    case 'health':
      app.healthcheck();
      break;
    case 'start':
      await app.start();
      break;
    case 'dev':
      await app.dev();
      break;
    case 'message':
      await app.handleMessage(args.join(' '));
      break;
    case 'image':
      await app.handleImage(args.join(' '));
      break;
    case 'reminder':
      await app.handleReminder(args[0], { force: args.includes('--force') });
      break;
    default:
      console.log('用法：node src/index.js init-db|health|start|message \"97.8\"|reminder morning_checkin');
      process.exitCode = command ? 1 : 0;
  }
}

main().catch(error => {
  console.error(`启动失败：${error.message}`);
  process.exitCode = 1;
});
