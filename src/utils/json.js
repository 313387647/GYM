function stripFence(input) {
  return input.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function firstObject(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0; let inString = false; let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) { escaped = false; continue; }
    if (character === '\\' && inString) { escaped = true; continue; }
    if (character === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }
  return text.slice(start);
}

function removeTrailingCommas(input) {
  let result = ''; let inString = false; let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (escaped) { result += character; escaped = false; continue; }
    if (character === '\\' && inString) { result += character; escaped = true; continue; }
    if (character === '"') { result += character; inString = !inString; continue; }
    if (!inString && character === ',') {
      let next = index + 1;
      while (/\s/.test(input[next] || '')) next += 1;
      if (input[next] === '}' || input[next] === ']') continue;
    }
    result += character;
  }
  return result;
}

function classifyJsonFailure(input) {
  const text = stripFence(String(input || ''));
  if (!text) return 'EMPTY_CONTENT';
  const candidate = firstObject(text);
  if (!candidate) return 'NO_JSON_OBJECT';
  let depth = 0; let inString = false; let escaped = false;
  for (const character of candidate) {
    if (escaped) { escaped = false; continue; }
    if (character === '\\' && inString) { escaped = true; continue; }
    if (character === '"') { inString = !inString; continue; }
    if (!inString && character === '{') depth += 1;
    if (!inString && character === '}') depth -= 1;
  }
  return depth !== 0 || inString ? 'INCOMPLETE_JSON' : 'MALFORMED_JSON';
}

function parseJsonObjectDetailed(input) {
  if (typeof input !== 'string') return { value: input, repaired: false };
  const text = stripFence(input);
  const candidate = firstObject(text);
  if (!candidate) {
    const error = new SyntaxError('LLM output does not contain a JSON object'); error.parseFailureType = classifyJsonFailure(input); throw error;
  }
  try { return { value: JSON.parse(candidate), repaired: false }; }
  catch (originalError) {
    const failureType = classifyJsonFailure(input);
    if (failureType === 'MALFORMED_JSON') {
      const repaired = removeTrailingCommas(candidate).replace(/^\uFEFF/, '');
      try { return { value: JSON.parse(repaired), repaired: true }; }
      catch {}
    }
    originalError.parseFailureType = failureType;
    throw originalError;
  }
}

function parseJsonObject(input) { return parseJsonObjectDetailed(input).value; }

module.exports = { parseJsonObject, parseJsonObjectDetailed, classifyJsonFailure, removeTrailingCommas };
