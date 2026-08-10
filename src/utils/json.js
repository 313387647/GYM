function parseJsonObject(input) {
  if (typeof input !== 'string') return input;
  const trimmed = input.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(trimmed); } catch {}
  const start = trimmed.indexOf('{');
  if (start < 0) throw new SyntaxError('LLM output does not contain a JSON object');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (escaped) { escaped = false; continue; }
    if (character === '\\' && inString) { escaped = true; continue; }
    if (character === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    if (depth === 0) return JSON.parse(trimmed.slice(start, index + 1));
  }
  throw new SyntaxError('LLM output contains incomplete JSON');
}

module.exports = { parseJsonObject };
