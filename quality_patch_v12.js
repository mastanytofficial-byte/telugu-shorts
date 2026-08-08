const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, 'index.js');
let s = fs.readFileSync(file, 'utf8');

if (s.includes('// QUALITY_PATCH_V12_PROVIDER_FINAL')) {
  console.log('QUALITY_PATCH_V12_PROVIDER_FINAL already applied.');
  process.exit(0);
}

function replaceFunction(source, marker, newFn, label) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('QUALITY_PATCH_V12: ' + label + ' not found');
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
  if (end < 0) throw new Error('QUALITY_PATCH_V12: ' + label + ' end not found');
  return source.slice(0, start) + newFn + source.slice(end);
}

// String.raw is intentional: regex backslashes and literal \n sequences must
// survive insertion into index.js exactly as JavaScript source.
const callFn = String.raw`// QUALITY_PATCH_V12_PROVIDER_FINAL
let llmProviderForRun = null;
let llmProviderExhausted = new Set();

function providerNames() {
  return [
    process.env.GEMINI_API_KEY ? 'gemini' : null,
    process.env.OPENAI_API_KEY ? 'openai' : null,
    process.env.GROQ_API_KEY ? 'groq' : null
  ].filter(Boolean);
}

async function callGemini(prompt) {
  const model = 'gemini-2.5-flash';
  const res = await fetchWithTimeout('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY.trim()
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1200 }
    })
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : ('HTTP ' + res.status);
    const err = new Error('Gemini API error: ' + msg);
    err.status = res.status;
    throw err;
  }
  const text = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts
    ? data.candidates[0].content.parts.map(p => p.text || '').join('').trim()
    : '';
  if (!text) throw new Error('Gemini returned empty content.');
  return text;
}

async function callOpenAI(prompt) {
  const model = 'gpt-5-mini';
  const res = await fetchWithTimeout('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY.trim()
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: 1200
    })
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : ('HTTP ' + res.status);
    const err = new Error('OpenAI API error: ' + msg);
    err.status = res.status;
    throw err;
  }
  const text = data && typeof data.output_text === 'string' ? data.output_text.trim() : '';
  if (!text) throw new Error('OpenAI returned empty content.');
  return text;
}

async function callGroq(prompt) {
  const model = 'openai/gpt-oss-120b';
  const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + process.env.GROQ_API_KEY.trim()
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1200
    })
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : ('HTTP ' + res.status);
    const err = new Error('Groq API error: ' + msg);
    err.status = res.status;
    throw err;
  }
  let text = data && data.choices && data.choices[0] && data.choices[0].message ? (data.choices[0].message.content || '') : '';
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!text) throw new Error('Groq returned empty content.');
  return text;
}

async function callLLM(prompt) {
  const available = providerNames();
  if (!available.length) throw new Error('No LLM API key configured. Add GEMINI_API_KEY, OPENAI_API_KEY or GROQ_API_KEY.');

  const order = [];
  if (llmProviderForRun && available.includes(llmProviderForRun)) order.push(llmProviderForRun);
  for (const p of available) if (!order.includes(p)) order.push(p);

  let lastError = null;
  for (const provider of order) {
    if (llmProviderExhausted.has(provider)) continue;
    try {
      log('LLM provider: ' + provider);
      const text = provider === 'gemini' ? await callGemini(prompt) : provider === 'openai' ? await callOpenAI(prompt) : await callGroq(prompt);
      llmProviderForRun = provider;
      await sleep(700);
      return text;
    } catch (e) {
      lastError = e;
      const status = e.status || 0;
      const retryable = status === 401 || status === 403 || status === 429 || status >= 500 || /rate|quota|limit|exhausted|empty/i.test(e.message || '');
      if (!retryable) throw e;
      llmProviderExhausted.add(provider);
      log('WARNING: ' + provider + ' unavailable (' + e.message + ') — trying next LLM provider.');
    }
  }
  throw new Error('All configured LLM providers failed. Last error: ' + (lastError ? lastError.message : 'unknown'));
}`;

const contentFn = String.raw`// QUALITY_PATCH_V12_PROVIDER_FINAL
async function generateContent(category, recentTitles, outline, ctaSentence) {
  log('Generating ' + category + ' FINAL DIRECT FACT SCRIPT via provider fallback...');
  const recent = (recentTitles || []).slice(-15).join(' | ') || '(none)';
  const prompt = [
    'You are the final Telugu Amazing Facts Shorts narrator.',
    '',
    'VERIFIED FACT — THIS IS THE ONLY SOURCE OF TRUTH:',
    outline,
    '',
    'RECENT TITLES — avoid repeating the same subject or angle:',
    recent,
    '',
    'Write ONLY the final spoken narration in natural Telugu.',
    'Style target: emotional curiosity, direct factual delivery, human-sounding Telugu, easy for a Telugu viewer to understand on first listen.',
    'Structure: hook with the surprising fact, one curiosity question, clear reveal, strongest supporting detail, memorable ending.',
    'Use 6-10 short spoken sentences. Target about 55-95 Telugu words.',
    'Every sentence must be complete and natural. Do not create one-word fragments.',
    'Use ellipsis (...) only for real suspense, normally 1-2 times. Use commas for short breath pauses and periods at complete thought boundaries.',
    'Do not invent any new fact, number, date, name, place, cause, comparison or consequence beyond the verified fact.',
    'Do not write a title, labels, JSON, markdown or explanation.',
    'Do not add a subscribe CTA; the automation handles CTA separately.',
    'Write numbers in natural Telugu words when possible.',
    'Return narration only.'
  ].join('\n');

  let script = (await callLLM(prompt)).trim();
  script = script.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  script = script.replace(/^(?:TITLE|SCRIPT|NARRATION)\s*:\s*/i, '').trim();
  if (typeof normalizeTeluguNumbers === 'function') script = normalizeTeluguNumbers(script);
  const lines = splitIntoSentences(script).filter(function(x) { return !/సబ్.?స్క్రైబ్|subscribe/i.test(x); }).map(function(x) { return x.trim(); }).filter(Boolean);
  script = lines.join('\n').trim();
  const wc = script.split(/\s+/).filter(Boolean).length;
  if (wc < 55) throw new Error('Final script too short: ' + wc + ' words.');
  if (wc > 115) throw new Error('Final script too long: ' + wc + ' words.');
  if (lines.length < 6 || lines.length > 10) throw new Error('Final script sentence count out of range: ' + lines.length + ' sentences.');
  const titleWords = (lines[0] || 'ఒక ఆశ్చర్యకరమైన నిజం').replace(/[!?…]+/g, '').trim().split(/\s+/).filter(Boolean).slice(0, 8);
  const title = (titleWords.join(' ') || 'ఒక ఆశ్చర్యకరమైన నిజం') + ' ' + (CATEGORY_EMOJI[category] || '🤯');
  const hookEmoji = (lines[0] || 'ఒక ఆశ్చర్యకరమైన నిజం') + ' ' + (CATEGORY_EMOJI[category] || '🤯');
  const keywords = FALLBACK_KEYWORDS[category] || 'rare amazing fact curiosity';
  log('Title: ' + title);
  log('Script (' + wc + ' words, ' + lines.length + ' sentences): ' + script);
  return { title: title, keywords: keywords, hookEmoji: hookEmoji, script: script };
}`;

s = replaceFunction(s, 'async function callLLM(', callFn, 'callLLM');
s = replaceFunction(s, 'async function generateContent(', contentFn, 'generateContent');

try {
  new vm.Script(s, { filename: file });
} catch (err) {
  throw new Error('QUALITY_PATCH_V12: generated index.js failed syntax validation: ' + err.message);
}

fs.writeFileSync(file, s, 'utf8');
console.log('QUALITY_PATCH_V12_PROVIDER_FINAL applied successfully.');
