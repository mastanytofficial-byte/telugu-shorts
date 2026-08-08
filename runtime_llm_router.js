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
  '// Stable runtime LLM router: GitHub Models -> Cerebras -> Groq 120B -> Groq 20B -> OpenRouter free.',
  "const ROUTER_GITHUB_TOKEN = (process.env.GITHUB_TOKEN || '').trim();",
  "const ROUTER_CEREBRAS_API_KEY = (process.env.CEREBRAS_API_KEY || '').trim();",
  "const ROUTER_OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || '').trim();",
  "const ROUTER_GROQ_API_KEY = (process.env.GROQ_API_KEY || '').trim();",
  '',
  'const LLM_PROVIDERS = [',
  "  { name: 'github-models', key: ROUTER_GITHUB_TOKEN, url: 'https://models.github.ai/inference/chat/completions', model: 'openai/gpt-4.1', maxTokens: 1400 },",
  "  { name: 'cerebras', key: ROUTER_CEREBRAS_API_KEY, url: 'https://api.cerebras.ai/v1/chat/completions', model: 'gpt-oss-120b', maxTokens: 1600 },",
  "  { name: 'groq-120b', key: ROUTER_GROQ_API_KEY, url: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-120b', maxTokens: 1600 },",
  "  { name: 'groq-20b', key: ROUTER_GROQ_API_KEY, url: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-20b', maxTokens: 1100 },",
  "  { name: 'openrouter-free', key: ROUTER_OPENROUTER_API_KEY, url: 'https://openrouter.ai/api/v1/chat/completions', model: 'qwen/qwen3-235b-a22b-2507:free', maxTokens: 1200 }",
  '].filter(p => p.key);',
  '',
  'const ROUTER_DISABLED_PROVIDERS = new Set();',
  '',
  'function llmErrorMessage(data, status) {',
  "  return String((data && data.error && (data.error.message || data.error.code)) || 'HTTP ' + status);",
  '}',
  '',
  'async function callProvider(provider, prompt) {',
  '  const body = { model: provider.model, messages: [{ role: \'user\', content: prompt }], max_tokens: provider.maxTokens, temperature: 0.35 };',
  "  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + provider.key };",
  "  if (provider.name === 'github-models') headers['X-GitHub-Api-Version'] = '2022-11-28';",
  "  if (provider.name === 'openrouter-free') { headers['HTTP-Referer'] = 'https://github.com/mastanytofficial-byte/telugu-shorts'; headers['X-Title'] = 'Telugu Amazing Facts Shorts'; }",
  '  const res = await fetchWithTimeout(provider.url, { method: \'POST\', headers, body: JSON.stringify(body) }, 30000);',
  '  let data = {}; try { data = await res.json(); } catch (_) {}',
  '  if (!res.ok) { const err = new Error(llmErrorMessage(data, res.status)); err.status = res.status; throw err; }',
  '  const choice = data.choices && data.choices[0];',
  '  const content = choice && choice.message && choice.message.content;',
  "  if (!content || !String(content).trim()) throw new Error('empty response (finish_reason: ' + ((choice && choice.finish_reason) || 'unknown') + ')');",
  "  return String(content).replace(/<think>[\\s\\S]*?<\\/think>/gi, '').trim();",
  '}',
  '',
  'async function callLLM(prompt) {',
  "  if (!LLM_PROVIDERS.length) throw new Error('No LLM API key/token configured. Add GITHUB_TOKEN permission or CEREBRAS_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY.');",
  '  let lastError = null;',
  '  for (const provider of LLM_PROVIDERS) {',
  '    if (ROUTER_DISABLED_PROVIDERS.has(provider.name)) continue;',
  "    log('LLM provider: ' + provider.name + ' (' + provider.model + ')');",
  '    try { const result = await callProvider(provider, prompt); await sleep(400); return result; }',
  "    catch (e) { lastError = e; ROUTER_DISABLED_PROVIDERS.add(provider.name); log('WARNING: ' + provider.name + ' unavailable (' + e.message + ') — disabling it for this run and trying next LLM provider.'); }",
  '  }',
  "  throw new Error('All configured LLM providers failed. Last error: ' + (lastError && lastError.message));",
  '}'
].join('\n');

const directReplacement = [
  'async function generateContent(category, recentTitles, outline, ctaSentence) {',
  "  log('Generating ' + category + ' FINAL DIRECT FACT SCRIPT via provider fallback...');",
  '',
  "  const avoidLine = recentTitles && recentTitles.length ? '\\nRECENT TITLES/OPENINGS — do not reuse their wording, sentence pattern or angle: ' + recentTitles.slice(-12).join(' | ') : '';",
  "  const prompt = 'You are writing the FINAL spoken narration for a Telugu Amazing Facts YouTube Short.\\n\\n' +",
  "    'SOURCE OF TRUTH — VERIFIED FACT ONLY:\\n' + outline + '\\n\\n' +",
  "    'TASK:\\nRewrite ONLY the verified information above into a natural, high-retention Telugu narration.\\n' +",
  "    'Do not research, infer, embellish, speculate, dramatize with new claims, or fill missing information.\\n\\n' +",
  "    'TARGET STYLE:\\n' +",
  "    '- Start with the most surprising part as a curiosity hook.\\n' +",
  "    '- Then reveal the answer step by step, like a smart friend telling a rare fact.\\n' +",
  "    '- 8–12 short spoken lines. About 45–75 words total.\\n' +",
  "    '- Most lines should be complete natural Telugu sentences. A short suspense fragment is allowed only when it creates a real pause.\\n' +",
  "    '- Use the rhythm of: hook → question/curiosity → fact → strongest detail → memorable ending.\\n' +",
  "    '- Use commas for short breath pauses, periods for completed thoughts, and ... only for genuine suspense.\\n' +",
  "    '- Prefer Telugu script. Keep a technical English term only when translating it would make the fact less clear.\\n' +",
  "    '- Write numbers in Telugu words, not ASCII digits.\\n\\n' +",
  "    'STRICT ACCURACY RULES:\\n' +",
  "    '- Every factual statement in the narration must be directly supported by the SOURCE OF TRUTH.\\n' +",
  "    '- You may rearrange, shorten, or paraphrase the verified fact, but you may NOT add a new chemical, reason, date, place, person, number, comparison, effect, metaphor presented as fact, or consequence.\\n' +",
  "    '- Do not turn a possibility into a certainty. Preserve words such as may, can, some, approximately, or believed when they occur in the source.\\n' +",
  "    '- If the source contains only one or two factual details, keep the narration short and do NOT invent filler to reach the word target.\\n' +",
  "    '- Never use phrases such as “ఇది మిమ్మల్ని ఆశ్చర్యపరుస్తుంది”, “కాలాన్ని మోసం చేస్తుంది”, “మాయ”, “మత్తెక్కిస్తుంది”, or similar claims unless those exact ideas are part of the source.\\n' +",
  "    '- No title, JSON, labels, markdown, emoji, CTA, subscribe request, or explanation.\\n\\n' +",
  "    'GOOD RHYTHM EXAMPLE — COPY ONLY THE RHYTHM, NOT THE FACT:\\n' +",
  "    '🤯 ఒక గుహలో దొరికిన చీజ్...\\nదాదాపు ఏడు వేల ఏళ్ల నాటిదని తెలుసా?\\nఇంత పాత చీజ్ ఎలా మిగిలింది?\\nపరిశోధనల్లో...\\nఅది వేల సంవత్సరాల క్రితం తయారైన చీజ్ అవశేషాలని తేలింది.\\nఅంటే...\\nవేల ఏళ్ల క్రితమే ఆహారాన్ని నిల్వ చేసే పద్ధతులు మనుషులకు తెలుసు.\\n' +",
  "    'Do NOT copy that example’s facts or wording.\\n' + avoidLine + '\\n\\nReturn ONLY the narration.';",
  '',
  '  let script = (await callLLM(prompt)).trim();',
  "  script = script.replace(/^```(?:text|telugu)?\\s*/i, '').replace(/```$/i, '').trim();",
  "  script = script.replace(/^SCRIPT:\\s*/i, '').trim();",
  "  script = script.replace(/\\[[A-Z_]+\\]/g, '').replace(/\\n{3,}/g, '\\n').trim();",
  "  if (/^(title|keywords|hook|question|reveal|twist|ending)\\s*:/im.test(script)) throw new Error('Provider returned structured metadata instead of direct narration.');",
  '',
  '  const words = script.split(/\\s+/).filter(Boolean);',
  "  if (words.length < 40) throw new Error('Direct fact script too short: ' + words.length + ' words.');",
  "  if (words.length > 85) throw new Error('Direct fact script too long: ' + words.length + ' words.');",
  '  const lines = script.split(/\\n+/).map(s => s.trim()).filter(Boolean);',
  "  if (lines.length < 7 || lines.length > 12) throw new Error('Direct fact script line count out of range: ' + lines.length + '.');",
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
console.log('LLM_ROUTER_V3: GitHub Models + provider health memory + fact-locked narration applied successfully.');
require(RUNTIME);
