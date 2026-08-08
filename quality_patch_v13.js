const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, 'index.js');
let s = fs.readFileSync(file, 'utf8');

if (s.includes('// QUALITY_PATCH_V13_GROQ_MODEL_FALLBACK')) {
  console.log('QUALITY_PATCH_V13_GROQ_MODEL_FALLBACK already applied.');
  process.exit(0);
}

function replaceFunction(source, marker, newFn, label) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('QUALITY_PATCH_V13: ' + label + ' not found');
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
  if (end < 0) throw new Error('QUALITY_PATCH_V13: ' + label + ' end not found');
  return source.slice(0, start) + newFn + source.slice(end);
}

const fn = String.raw`// QUALITY_PATCH_V13_GROQ_MODEL_FALLBACK
async function callGroq(prompt) {
  const apiKey = (process.env.GROQ_API_KEY || '').trim();
  if (!apiKey) throw new Error('GROQ_API_KEY is missing.');

  const models = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];
  let lastError = null;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      log('Groq model: ' + model);
      const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 800,
          temperature: 0.7
        })
      });
      const data = await res.json();

      if (!res.ok) {
        const msg = data && data.error && data.error.message ? data.error.message : ('HTTP ' + res.status);
        const code = data && data.error && data.error.code ? data.error.code : '';
        const retryable = res.status === 429 || res.status >= 500 || /rate|quota|limit|exhausted|TPD|tokens per day/i.test(msg + ' ' + code);
        if (!retryable || i === models.length - 1) {
          throw new Error('Groq API error (' + model + '): ' + msg);
        }
        log('WARNING: Groq model ' + model + ' unavailable (' + msg + ') — switching immediately to ' + models[i + 1] + '.');
        lastError = new Error('Groq API error (' + model + '): ' + msg);
        continue;
      }

      let text = data && data.choices && data.choices[0] && data.choices[0].message
        ? (data.choices[0].message.content || '')
        : '';
      text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      if (!text) {
        const finish = data && data.choices && data.choices[0] ? data.choices[0].finish_reason : 'unknown';
        if (i < models.length - 1) {
          log('WARNING: Groq ' + model + ' returned empty content (finish_reason: ' + finish + ') — switching to ' + models[i + 1] + '.');
          lastError = new Error('Groq returned empty content from ' + model + '.');
          continue;
        }
        throw new Error('Groq returned empty content (model: ' + model + ', finish_reason: ' + finish + ').');
      }

      return text;
    } catch (e) {
      lastError = e;
      const message = e && e.message ? e.message : String(e);
      const retryable = /rate|quota|limit|exhausted|TPD|tokens per day|empty|timeout/i.test(message);
      if (i < models.length - 1 && retryable) {
        log('WARNING: Groq model ' + model + ' failed (' + message + ') — switching immediately to ' + models[i + 1] + '.');
        continue;
      }
      throw e;
    }
  }

  throw lastError || new Error('All Groq models failed.');
}`;

s = replaceFunction(s, 'async function callGroq(', fn, 'callGroq');

try {
  new vm.Script(s, { filename: file });
} catch (err) {
  throw new Error('QUALITY_PATCH_V13: generated index.js failed syntax validation: ' + err.message);
}

fs.writeFileSync(file, s, 'utf8');
console.log('QUALITY_PATCH_V13_GROQ_MODEL_FALLBACK applied successfully.');
