const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'index.js');
let s = fs.readFileSync(file, 'utf8');

if (s.includes('// QUALITY_PATCH_V8_TPM_SAFE')) {
  console.log('QUALITY_PATCH_V8_TPM_SAFE already applied.');
  process.exit(0);
}

function replaceFunction(source, marker, newFn, label) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('QUALITY_PATCH_V8: ' + label + ' not found');
  let depth = 0;
  let quote = null;
  let escaped = false;
  let end = -1;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '/' && next === '/') { const nl = source.indexOf('\n', i + 2); i = nl < 0 ? source.length : nl; continue; }
    if (ch === '/' && next === '*') { const cl = source.indexOf('*/', i + 2); i = cl < 0 ? source.length : cl + 1; continue; }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end < 0) throw new Error('QUALITY_PATCH_V8: ' + label + ' end not found');
  return source.slice(0, start) + newFn + source.slice(end);
}

const callLLMFn = String.raw`// QUALITY_PATCH_V8_TPM_SAFE
async function callLLM(prompt, attempt = 1, model = (primaryModelExhaustedThisRun ? GROQ_FALLBACK_MODEL : GROQ_MODEL), maxTokens = 2400) {
  const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + GROQ_API_KEY
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens
    })
  });
  const data = await res.json();

  if (!data.choices || !data.choices[0]) {
    const errorMessage = (data.error && data.error.message) || '';
    const isRateLimit = data.error && data.error.code === 'rate_limit_exceeded';
    const isDailyLimit = /tokens per day|TPD/i.test(errorMessage);

    if (isRateLimit && isDailyLimit) {
      if (model === GROQ_MODEL) {
        primaryModelExhaustedThisRun = true;
        log('WARNING: "' + GROQ_MODEL + '" daily limit reached — switching to fallback model "' + GROQ_FALLBACK_MODEL + '" for the rest of this run.');
        return callLLM(prompt, 1, GROQ_FALLBACK_MODEL, maxTokens);
      }
      throw new Error('Groq DAILY token limit reached on both models — this run cannot continue today. ' + errorMessage);
    }

    if (isRateLimit && attempt <= 3) {
      const waitMs = 15000 * attempt;
      log('WARNING: Groq rate limit hit (attempt ' + attempt + '/3) — waiting ' + (waitMs / 1000) + 's before retrying.');
      await sleep(waitMs);
      return callLLM(prompt, attempt + 1, model, maxTokens);
    }
    throw new Error('Groq did not return content (model: ' + model + '): ' + JSON.stringify(data));
  }

  const choice = data.choices[0];
  let content = (choice.message && choice.message.content || '').trim();
  const finishReason = choice.finish_reason || 'unknown';

  if (!content && finishReason === 'length' && maxTokens > 1200) {
    log('WARNING: Groq response hit output length at ' + maxTokens + ' tokens — retrying same prompt with a compact ' + Math.floor(maxTokens / 2) + '-token ceiling.');
    await sleep(500);
    return callLLM(prompt, 1, model, Math.floor(maxTokens / 2));
  }

  if (!content) {
    throw new Error('Groq returned an empty response (finish_reason: ' + finishReason + ', model: ' + model + ').');
  }

  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!content) {
    if (finishReason === 'length' && maxTokens > 1200) {
      log('WARNING: Groq output became empty after <think> removal — retrying compactly.');
      return callLLM(prompt, 1, model, Math.floor(maxTokens / 2));
    }
    throw new Error('Groq returned no usable content after cleanup (finish_reason: ' + finishReason + ').');
  }

  await sleep(1500);
  return content;
}
`;

s = replaceFunction(s, 'async function callLLM(prompt, attempt = 1, model = (primaryModelExhaustedThisRun ? GROQ_FALLBACK_MODEL : GROQ_MODEL)) {', callLLMFn, 'callLLM');
fs.writeFileSync(file, s, 'utf8');
console.log('QUALITY_PATCH_V8_TPM_SAFE applied successfully.');
