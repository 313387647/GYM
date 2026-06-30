const fs = require('fs');
const path = require('path');
const { rootPath } = require('./paths');

function readJson(relativePath) {
  const filePath = rootPath(relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing config file: ${relativePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadConfig() {
  return {
    user: readJson('config/user.json'),
    schedule: readJson('config/schedule.json'),
    plan: readJson('config/plan.json'),
    persona: readJson('config/persona.json')
  };
}

module.exports = { readJson, loadConfig };
