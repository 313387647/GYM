#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', '.git', 'backups', '.restore-backup'].includes(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (/\.(js|mjs)$/.test(entry.name)) files.push(target);
  }
}
walk(path.join(root, 'src'));
walk(path.join(root, 'scripts'));
walk(path.join(root, 'tests'));
const failures = [];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) failures.push(`${path.relative(root, file)}: ${result.stderr.trim()}`);
}
const forbidden = [
  [/execSync\s*\(.*curl/s, 'MiMo/API calls must not use execSync(curl)'],
  [/Authorization:\s*Bearer\s*\$\{/s, 'secrets must not be interpolated into shell commands'],
];
for (const file of files.filter((entry) => entry.includes(`${path.sep}src${path.sep}`))) {
  const source = fs.readFileSync(file, 'utf8');
  for (const [pattern, message] of forbidden) if (pattern.test(source)) failures.push(`${path.relative(root, file)}: ${message}`);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`lint ok (${files.length} files)`);
