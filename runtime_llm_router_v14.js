const fs = require('fs');
const path = require('path');
const child = require('child_process');

const V8 = path.join(__dirname, 'runtime_llm_router_v8.js');
const RUNTIME = path.join(__dirname, '.index.runtime.v8.js');

// Start from V8. This deliberately excludes the later experimental
// 50-60s duration and 88-105-word enforcement added by V10+.
child.execFileSync(process.execPath, [V8], {
  stdio: 'inherit',
  env: { ...process.env, LLM_ROUTER_PATCH_ONLY: '1' }
});

let source = fs.readFileSync(RUNTIME, 'utf8');

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
  throw new Error('V14: could not find matching brace');
}

function replaceFunction(signature, replacement) {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error('V14 anchor not found: ' + signature);
  const open = source.indexOf('{', start);
  if (open < 0) throw new Error('V14 opening brace not found: ' + signature);
  const close = findMatchingBrace(source, open);
  source = source.slice(0, start) + replacement + source.slice(close + 1);
}

// Rotate providers and remember unhealthy providers for the current run.
replaceFunction('async function callLLM(', `async function callLLM(prompt) {
  if (!callLLM.disabledProviders) callLLM.disabledProviders = new Set();
  if (!Number.isInteger(callLLM.cursor)) callLLM.cursor = 0;
  const providers = [
    { name: 'openrouter', key: (process.env.OPENROUTER_API_KEY || '').trim(), model: 'openrouter/free', kind: 'openrouter' },
    { name: 'huggingface', key: (process.env.HF_TOKEN || '').trim(), model: 'Qwen/Qwen2.5-72B-Instruct', kind: 'huggingface' },
    { name: 'openai', key: (process.env.OPENAI_API_KEY || '').trim(), model: 'gpt-5.4-mini', kind: 'openai' },
    { name: 'gemini', key: (process.env.GEMINI_API_KEY || '').trim(), model: 'gemini-2.5-flash', kind: 'gemini' },
    { name: 'groq-120b', key: (process.env.GROQ_API_KEY || '').trim(), model: 'openai/gpt-oss-120b', kind: 'groq' },
    { name: 'groq-20b', key: (process.env.GROQ_API_KEY || '').trim(), model: 'openai/gpt-oss-20b', kind: 'groq' }
  ];
  const available = providers.filter(p => p.key && !callLLM.disabledProviders.has(p.name));
  if (!available.length) throw new Error('LLM_PROVIDER_EXHAUSTED: no healthy configured provider remains. Missing keys=' + providers.filter(p => !p.key).map(p => p.name).join(','));
  const ordered = [];
  for (let i = 0; i < available.length; i++) ordered.push(available[(callLLM.cursor + i) % available.length]);
  const failures = [];
  for (const p of ordered) {
    try {
      log('LLM provider: ' + p.name + ' (' + p.model + ')');
      let content = '';
      if (p.kind === 'gemini') {
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + p.model + ':generateContent';
        const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.25, maxOutputTokens: 1800, thinkingConfig: { thinkingBudget: 0 } } };
        const res = await fetchWithTimeout(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.key }, body: JSON.stringify(body) }, 30000);
        let data = {}; try { data = await res.json(); } catch (_) {}
        if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + ((data.error && data.error.message) || 'Gemini request failed'));
        const parts = data?.candidates?.[0]?.content?.parts;
        content = Array.isArray(parts) ? parts.map(x => x?.text).filter(Boolean).join('') : '';
      } else {
        let url = 'https://api.openai.com/v1/chat/completions';
        const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.key };
        if (p.kind === 'openrouter') { url = 'https://openrouter.ai/api/v1/chat/completions'; headers['HTTP-Referer'] = 'https://github.com/mastanytofficial-byte/telugu-shorts'; headers['X-Title'] = 'Telugu Amazing Facts Shorts'; }
        else if (p.kind === 'huggingface') url = 'https://router.huggingface.co/v1/chat/completions';
        else if (p.kind === 'groq') url = 'https://api.groq.com/openai/v1/chat/completions';
        const body = { model: p.model, messages: [{ role: 'system', content: 'Return only the requested answer. No hidden reasoning, markdown fences, or commentary.' }, { role: 'user', content: prompt }], temperature: 0.25 };
        if (p.kind === 'openai') body.max_completion_tokens = 1400;
        else body.max_tokens = p.kind === 'groq' ? 1800 : 1600;
        const res = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(body) }, 30000);
        let data = {}; try { data = await res.json(); } catch (_) {}
        if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + ((data.error && (data.error.message || data.error.code)) || 'provider request failed'));
        const choice = data?.choices?.[0];
        content = choice?.message?.content ? String(choice.message.content) : '';
        if (!content.trim()) throw new Error('empty response (finish_reason: ' + (choice?.finish_reason || 'unknown') + ')');
      }
      content = String(content).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      if (!content) throw new Error('empty cleaned response');
      callLLM.cursor = (providers.findIndex(x => x.name === p.name) + 1) % providers.length;
      log('LLM provider success: ' + p.name + ' — rotating provider for next request.');
      return content;
    } catch (e) {
      const msg = String(e?.message || e);
      failures.push(p.name + ': ' + msg);
      callLLM.disabledProviders.add(p.name);
      log('WARNING: ' + p.name + ' failed/limited — disabled for this run. ' + msg);
    }
  }
  throw new Error('LLM_PROVIDER_EXHAUSTED: ' + failures.join(' | '));
}`);

// Keep the requested spoken CTA. No duration or word-count enforcement is added.
const beforeCTA = source;
source = source.replace(/const CTA_VARIATIONS = \[[\s\S]*?\];/, "const CTA_VARIATIONS = ['వీడియో నచ్చితే లైక్ అండ్ షేర్ చేయండి, మరిన్ని ఇలాంటి వీడియోల కోసం సబ్‌స్క్రైబ్ చేయండి.'];");
if (source === beforeCTA) throw new Error('V14 CTA anchor not found');

child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });
fs.writeFileSync(RUNTIME, source, 'utf8');
child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });
console.log('LLM_ROUTER_V14: V8 original duration behavior restored + rotating provider health + fresh-topic/duplicate system retained + mandatory CTA.');

if (process.env.LLM_ROUTER_PATCH_ONLY === '1') process.exit(0);
require(RUNTIME);
