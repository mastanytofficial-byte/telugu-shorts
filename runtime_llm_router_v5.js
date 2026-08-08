const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, 'index.js');
const RUNTIME = path.join(__dirname, '.index.runtime.v5.js');

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

const providerReplacement = `async function callLLM(prompt) {
  const providers = [
    { name: 'gemini', key: (process.env.GEMINI_API_KEY || '').trim(), model: 'gemini-2.5-flash', kind: 'gemini' },
    { name: 'openai', key: (process.env.OPENAI_API_KEY || '').trim(), model: 'gpt-5.4-mini', kind: 'openai' },
    { name: 'openrouter', key: (process.env.OPENROUTER_API_KEY || '').trim(), model: 'openrouter/free', kind: 'openrouter' },
    { name: 'huggingface', key: (process.env.HF_TOKEN || '').trim(), model: 'openai/gpt-oss-120b:fastest', kind: 'huggingface' },
    { name: 'groq-20b', key: (process.env.GROQ_API_KEY || '').trim(), model: 'openai/gpt-oss-20b', kind: 'groq' },
    { name: 'groq-120b', key: (process.env.GROQ_API_KEY || '').trim(), model: 'openai/gpt-oss-120b', kind: 'groq' }
  ].filter(p => p.key);

  if (!providers.length) throw new Error('No LLM API key configured.');
  const failures = [];

  for (const p of providers) {
    try {
      log('LLM provider: ' + p.name + ' (' + p.model + ')');
      let content = '';

      if (p.kind === 'gemini') {
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + p.model + ':generateContent';
        const res = await fetchWithTimeout(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.key },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.25, maxOutputTokens: 2200, thinkingConfig: { thinkingBudget: 0 } }
          })
        }, 30000);
        let data = {};
        try { data = await res.json(); } catch (_) {}
        if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + ((data.error && data.error.message) || 'Gemini request failed'));
        const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
        content = Array.isArray(parts) ? parts.map(x => x && x.text).filter(Boolean).join('') : '';
        if (!content.trim()) throw new Error('empty Gemini response');
      } else {
        let url = 'https://api.openai.com/v1/chat/completions';
        const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.key };
        if (p.kind === 'openrouter') {
          url = 'https://openrouter.ai/api/v1/chat/completions';
          headers['HTTP-Referer'] = 'https://github.com/mastanytofficial-byte/telugu-shorts';
          headers['X-Title'] = 'Telugu Amazing Facts Shorts';
        } else if (p.kind === 'huggingface') {
          url = 'https://router.huggingface.co/v1/chat/completions';
        } else if (p.kind === 'groq') {
          url = 'https://api.groq.com/openai/v1/chat/completions';
        }
        const body = {
          model: p.model,
          messages: [
            { role: 'system', content: 'Return only the requested answer. Do not include hidden reasoning, analysis, markdown fences, or commentary.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.25,
          max_tokens: p.name === 'groq-20b' ? 1500 : 2200
        };
        const res = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(body) }, 30000);
        let data = {};
        try { data = await res.json(); } catch (_) {}
        if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + ((data.error && (data.error.message || data.error.code)) || 'provider request failed'));
        const choice = data && data.choices && data.choices[0];
        content = choice && choice.message && choice.message.content ? String(choice.message.content) : '';
        if (!content.trim()) throw new Error('empty response (finish_reason: ' + ((choice && choice.finish_reason) || 'unknown') + ')');
      }

      content = String(content).replace(/<think>[\\s\\S]*?<\\/think>/gi, '').trim();
      if (!content) throw new Error('empty cleaned response');
      log('LLM provider success: ' + p.name);
      return content;
    } catch (e) {
      failures.push(p.name + ': ' + e.message);
      log('WARNING: ' + p.name + ' failed — trying next provider. ' + e.message);
    }
  }

  throw new Error('All LLM providers failed. ' + failures.join(' | '));
}`;

const directReplacement = `async function generateContent(category, recentTitles, outline, ctaSentence) {
  log('Generating ' + category + ' FINAL FACT-LOCKED DIRECT SCRIPT...');
  const avoid = recentTitles && recentTitles.length
    ? '\\nRecent titles/openings to avoid repeating: ' + recentTitles.slice(-15).join(' | ')
    : '';

  const prompt = \`SOURCE OF TRUTH — VERIFIED FACT OUTLINE:\\n\${outline}\\n\\n\` +
    \`Write the final spoken narration for a Telugu Amazing Facts YouTube Short.\\n\` +
    \`IMPORTANT: The outline above is the only factual source. Do not add any new factual detail.\\n\` +
    \`Do not invent dates, numbers, places, causes, chemicals, comparisons, consequences, or examples.\\n\` +
    \`You may only rearrange and naturally paraphrase facts already present in the outline.\\n\\n\` +
    \`STYLE:\\n\` +
    \`- Natural spoken Telugu, preferably Telugu script.\\n\` +
    \`- Start with the most surprising detail as a curiosity hook.\\n\` +
    \`- Flow naturally: hook -> curiosity/question -> verified fact -> strongest detail -> memorable ending.\\n\` +
    \`- 7 to 11 short lines, approximately 45 to 80 words.\\n\` +
    \`- Complete natural sentences; do not create broken fragments like \"అది.\", \"రహస్యం.\", \"కానీ.\"\\n\` +
    \`- Use ... only for a genuine suspense pause.\\n\` +
    \`- No title, JSON, labels, emoji, markdown, CTA, or subscribe request.\\n\` +
    \`- Do not copy the wording of recent videos.\\n\` + avoid;

  let script = (await callLLM(prompt)).trim();
  script = script.replace(/^\`\`\`(?:text|telugu)?\\s*/i, '').replace(/\`\`\`$/i, '').trim();
  script = script.replace(/^SCRIPT:\\s*/i, '').trim();
  script = script.replace(/<think>[\\s\\S]*?<\\/think>/gi, '').trim();

  const words = script.split(/\\s+/).filter(Boolean).length;
  const lines = script.split(/\\n+/).map(s => s.trim()).filter(Boolean);
  if (words < 40) throw new Error('Final fact script too short: ' + words + ' words / ' + lines.length + ' lines.');
  if (words > 90) throw new Error('Final fact script too long: ' + words + ' words / ' + lines.length + ' lines.');
  if (lines.length < 7 || lines.length > 11) throw new Error('Final fact script line count invalid: ' + lines.length + '.');
  if (/^(title|keywords|hook|question|reveal|twist|ending)\\s*:/im.test(script)) throw new Error('Final script contains metadata labels.');

  const first = lines[0].replace(/^🤯\\s*/, '').trim();
  const title = first.length > 70 ? first.slice(0, 67) + '...' : first;
  const keywords = (FALLBACK_KEYWORDS[category] || category || '').toString();
  const hookEmoji = '🤯 ' + first;
  log('Title: ' + title);
  log('Keywords: ' + keywords);
  log('Hook emoji line: ' + hookEmoji);
  log('Script (' + script.length + ' chars): ' + script);
  return { title: (title + ' ' + (CATEGORY_EMOJI[category] || '')).trim(), keywords, hookEmoji, script };
}`;

let source = fs.readFileSync(SOURCE, 'utf8');
source = replaceFunction(source, 'async function callLLM(', providerReplacement);
source = replaceFunction(source, 'async function generateContent(', directReplacement);

fs.writeFileSync(RUNTIME, source, 'utf8');
require('child_process').execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });
console.log('LLM_ROUTER_V5: clean provider router + fact-locked Telugu script + preflight syntax check applied successfully.');
require(RUNTIME);
