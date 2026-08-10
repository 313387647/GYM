const fs = require('node:fs');
const path = require('node:path');
const { ROOT_DIR } = require('../config');

function loadPrompt(name) { return fs.readFileSync(path.join(ROOT_DIR, 'prompts', `${name}.md`), 'utf8'); }
function loadRuntimePrompt() { return ['core', 'coach_policy', 'safety', 'personality'].map(loadPrompt).join('\n\n---\n\n'); }
module.exports = { loadPrompt, loadRuntimePrompt };
