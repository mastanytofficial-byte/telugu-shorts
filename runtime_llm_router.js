const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, 'index.js');
const RUNTIME = path.join(__dirname, '.index.runtime.js');

function findMatchingBrace(text, openIndex) {
  let depth = 0, state = 'code', escaped = false, regex = false, charClass = false, prevSig = '';
  const canStartRegex = c => !c || '([{=,:;!&|?+-*%^~<>'.includes(c);
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (state === 'line') { if (c === '\n') state = 'code'; continue; }
    if (state === 'block') { if (c === '*' && n === '/') { state = 'code'; i++; } continue; }
    if (state === 'single' || state === 'double' || state === 'template') {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if ((state === 'single' && c === "'") || (state === 'double' && c === '"') || (state === 'template' && c === '`')) state = 'code';
      continue;
    }
    if (regex) {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (charClass) { if (c === ']') charClass = false; continue; }
      if (c === '[') { charClass = true; continue; }
      if (c === '/') regex = false;
      continue;
    }
    if (c === '/' && n === '/') { state = 'line'; i++; continue; }
    if (c === '/' && n === '*') { state = 'block'; i++; continue; }
    if (c === "'") { state = 'single'; continue; }
    if (c === '"') { state = 'double'; continue; }
    if (c === '`') { state = 'template'; continue; }
    if (c === '/' && canStartRegex(prevSig)) { regex = true; charClass = false; continue; }
    if (!/\s/.test(c)) prevSig = c;
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  throw new Error('Could not find matching brace');
}

function replaceFunction(source, signature, replacement) {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error('Router anchor not found: ' + signature);
  const open = source.indexOf('{', start);
  if (open < 0) throw new Error('Router opening brace not found: ' + signature);
  const close = findMatchingBrace(source, open);
  return source.slice(0, start) + replacement + source.slice(close + 1);
}

const providerReplacement = [
  '// Stable runtime LLM router: Cerebras -> Groq 120B -> Groq 20B -> OpenRouter free.',
  "const CEREBRAS_API_KEY = (process.env.CEREBRAS_API_KEY || '').trim();",
  "const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || '').trim();",
  "const GROQ_API_KEY = (process.env.GROQ_API_KEY || '').trim();",
  '',
  'const LLM_PROVIDERS = [',
  "  { name: 'cerebras', key: CEREBRAS_API_KEY, url: 'https://api.cerebras.ai/v1/chat/completions', model: 'gpt-oss-120b', maxTokens: 2200 },",
  "  { name: 'groq-120b', key: GROQ_API_KEY, url: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-120b', maxTokens: 2200 },",
  "  { name: 'groq-20b', key: GROQ_API_KEY, url: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-20b', maxTokens: 1600 },",
  "  { name: 'openrouter-free', key: OPENROUTER_API_KEY, url: 'https://openrouter.ai/api/v1/chat/completions', model: 'qwen/qwen3-235b-a22b-2507:free', maxTokens: 1800 }",
  '].filter(p => p.key);',
  '',
  'function llmErrorMessage(data, status) {',
  "  return String((data && data.error && (data.error.message || data.error.code)) || 'HTTP ' + status);",
  '}',
  '',
  'async function callProvider(provider, prompt) {',
  '  const body = { model: provider.model, messages: [{ role: \'user\', content: prompt }], max_tokens: provider.maxTokens, temperature: 0.55 };',
  '  if (provider.name === \'cerebras\') body.max_completion_tokens = provider.maxTokens;',
  "  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + provider.key };",
  "  if (provider.name === 'openrouter-free') { headers['HTTP-Referer'] = 'https://github.com/mastanytofficial-byte/telugu-shorts'; headers['X-Title'] = 'Telugu Amazing Facts Shorts'; }",
  '  const res = await fetchWithTimeout(provider.url, { method: \'POST\', headers, body: JSON.stringify(body) }, 30000);',
  '  let data = {}; try { data = await res.json(); } catch (_) {}',
  '  if (!res.ok) throw new Error(llmErrorMessage(data, res.status));',
  '  const choice = data.choices && data.choices[0];',
  '  const content = choice && choice.message && choice.message.content;',
  "  if (!content || !String(content).trim()) throw new Error('empty response (finish_reason: ' + ((choice && choice.finish_reason) || 'unknown') + ')');",
  "  return String(content).replace(/<think>[\\s\\S]*?<\\/think>/gi, '').trim();",
  '}',
  '',
  'async function callLLM(prompt) {',
  "  if (!LLM_PROVIDERS.length) throw new Error('No LLM API key configured. Add CEREBRAS_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY to GitHub Secrets.');",
  '  let lastError = null;',
  '  for (const provider of LLM_PROVIDERS) {',
  "    log('LLM provider: ' + provider.name + ' (' + provider.model + ')');",
  '    try { const result = await callProvider(provider, prompt); await sleep(500); return result; }',
  "    catch (e) { lastError = e; log('WARNING: ' + provider.name + ' unavailable (' + e.message + ') — trying next LLM provider.'); }",
  '  }',
  "  throw new Error('All configured LLM providers failed. Last error: ' + (lastError && lastError.message));",
  '}'
].join('\n');

const directReplacement = [
  'async function generateContent(category, recentTitles, outline, ctaSentence) {',
  "  log('Generating ' + category + ' FINAL DIRECT FACT SCRIPT via provider fallback...');",
  '',
  "  const avoidLine = recentTitles && recentTitles.length ? '\\nRecently used titles/openings — do NOT reuse their wording or structure: ' + recentTitles.slice(-12).join(' | ') : '';",
  "  const prompt = 'You are the final Telugu YouTube Shorts scriptwriter.\\n\\n' +",
  "    'VERIFIED FACT:\\n' + outline + '\\n\\n' +",
  "    'Write ONE original 20–30 second Telugu narration from this verified fact.\\n\\n' +",
  "    'STYLE TARGET:\\n' +",
  "    '- Natural spoken Telugu, like a smart friend telling an unbelievable fact.\\n' +",
  "    '- Start with a strong curiosity hook, then reveal the fact step by step.\\n' +",
  "    '- Use 8–14 short spoken lines.\\n' +",
  "    '- Usually 3–10 Telugu words per line.\\n' +",
  "    '- Every line must add information, curiosity, or a reveal.\\n' +",
  "    '- Use pauses such as ... only where they sound natural; do not put them on every line.\\n' +",
  "    '- Keep the core fact accurate and unchanged.\\n' +",
  "    '- Use only information supported by VERIFIED FACT. Do not invent names, dates, numbers, locations, causes, comparisons, or consequences.\\n' +",
  "    '- If the fact has a limitation such as some, may, or can, preserve that limitation.\\n' +",
  "    '- Write all numbers in natural Telugu words, never ASCII digits.\\n' +",
  "    '- Telugu script is preferred. If a technical term is genuinely clearer in English, keep only that term.\\n' +",
  "    '- Do not write a title, labels, JSON, markdown, emoji, CTA, subscribe, or explanation outside the narration.\\n' +",
  "    '- Do not use textbook/news-reader language.\\n' +",
  "    '- Do not create fake suspense or a fake twist just to make the script longer.\\n' +",
  "    '- End with the strongest fact-specific takeaway.\\n' +",
  "    '- Target roughly 55–80 Telugu words. Never pad the script just to reach the target.\\n' +",
  "    avoidLine + '\\n\\nReturn ONLY the final narration text.';",
  '',
  '  let script = (await callLLM(prompt)).trim();',
  "  script = script.replace(/^```(?:text|telugu)?\\s*/i, '').replace(/```$/i, '').trim();",
  "  script = script.replace(/^SCRIPT:\\s*/i, '').trim();",
  "  script = script.replace(/\\[[A-Z_]+\\]/g, '').replace(/\\n{3,}/g, '\\n\\n').trim();",
  "  if (/^(title|keywords|hook|question|reveal|twist|ending)\\s*:/im.test(script)) throw new Error('Provider returned structured metadata instead of direct narration.');",
  '',
  '  const words = script.split(/\\s+/).filter(Boolean);',
  "  if (words.length < 45) throw new Error('Direct fact script too short: ' + words.length + ' words.');",
  "  if (words.length > 95) throw new Error('Direct fact script too long: ' + words.length + ' words.');",
  '  const lines = script.split(/\\n+/).map(s => s.trim()).filter(Boolean);',
  "  if (lines.length < 7 || lines.length > 16) throw new Error('Direct fact script line count out of range: ' + lines.length + '.');",
  '',
  "  const firstLine = lines[0].replace(/^🤯\\s*/, '').trim();",
  "  const title = firstLine.length > 70 ? firstLine.slice(0, 67) + '...' : firstLine;",
  "  const keywords = (FALLBACK_KEYWORDS[category] || category).toString();",
  "  const hookEmoji = '🤯 ' + firstLine;",
  "  log('Title: ' + title);",
  "  log('Keywords: ' + keywords);",
  "  log('Hook emoji line: ' + hookEmoji);",
  "  log('Script (' + script.length + ' chars): ' + script);",
  "  return { title: (title + ' ' + (CATEGORY_EMOJI[category] || '')).trim(), keywords, hookEmoji, script };",
  '}'
].join('\n');

let source = fs.readFileSync(SOURCE, 'utf8');
source = replaceFunction(source, 'async function callLLM(', providerReplacement);
source = replaceFunction(source, 'async function generateContent(', directReplacement);
fs.writeFileSync(RUNTIME, source);
console.log('LLM_ROUTER_V1: provider fallback + direct-fact script applied successfully.');
require(RUNTIME);
