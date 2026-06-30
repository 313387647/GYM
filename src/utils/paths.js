const fs = require('fs');
const path = require('path');

function rootPath(...parts) {
  return path.resolve(__dirname, '..', '..', ...parts);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

module.exports = { rootPath, ensureDir };
