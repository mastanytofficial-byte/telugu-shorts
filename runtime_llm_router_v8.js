const fs = require('fs');
const path = require('path');
const child = require('child_process');

const SOURCE = path.join(__dirname, 'index.js');
const RUNTIME = path.join(__dirname, '.index.runtime.v8.js');

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
  if (start < 0) throw new Error('V8 anchor not found: ' + signature);
  const open = source.indexOf('{', start);
  if (open < 0) throw new Error('V8 opening brace not found: ' + signature);
  const close = findMatchingBrace(source, open);
  return source.slice(0, start) + replacement + source.slice(close + 1);
}

const providerReplacement = `async function callLLM(prompt) {
  if (!callLLM.disabledProviders) callLLM.disabledProviders = new Set();
  const providers = [
    { name: 'openai', key: (process.env.OPENAI_API_KEY || '').trim(), model: 'gpt-5.4-mini', kind: 'openai' },
    { name: 'gemini', key: (process.env.GEMINI_API_KEY || '').trim(), model: 'gemini-2.5-flash', kind: 'gemini' },
    { name: 'openrouter', key: (process.env.OPENROUTER_API_KEY || '').trim(), model: 'openrouter/free', kind: 'openrouter' },
    { name: 'huggingface', key: (process.env.HF_TOKEN || '').trim(), model: 'Qwen/Qwen2.5-72B-Instruct', kind: 'huggingface' },
    { name: 'groq-120b', key: (process.env.GROQ_API_KEY || '').trim(), model: 'openai/gpt-oss-120b', kind: 'groq' },
    { name: 'groq-20b', key: (process.env.GROQ_API_KEY || '').trim(), model: 'openai/gpt-oss-20b', kind: 'groq' }
  ].filter(p => p.key && !callLLM.disabledProviders.has(p.name));
  if (!providers.length) throw new Error('LLM_PROVIDER_EXHAUSTED: no healthy configured provider remains for this run.');
  const failures = [];

  for (const p of providers) {
    try {
      log('LLM provider: ' + p.name + ' (' + p.model + ')');
      let content = '';

      if (p.kind === 'gemini') {
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + p.model + ':generateContent';
        const requestBody = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.25,
            maxOutputTokens: 1800,
            thinkingConfig: { thinkingBudget: 0 }
          }
        };
        const res = await fetchWithTimeout(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.key },
          body: JSON.stringify(requestBody)
        }, 30000);
        let data = {};
        try { data = await res.json(); } catch (_) {}
        if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + ((data.error && data.error.message) || 'Gemini request failed'));
        const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
        content = Array.isArray(parts) ? parts.map(x => x && x.text).filter(Boolean).join('') : '';
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
            { role: 'system', content: 'Return only the requested answer. No hidden reasoning, markdown fences, or commentary.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.25
        };
        if (p.kind === 'openai') body.max_completion_tokens = 1800;
        else body.max_tokens = p.name === 'groq-20b' ? 1400 : 1800;

        const res = await fetchWithTimeout(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body)
        }, 30000);
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
      callLLM.disabledProviders.add(p.name);
      failures.push(p.name + ': ' + e.message);
      log('WARNING: ' + p.name + ' failed — disabled for this run. ' + e.message);
    }
  }

  throw new Error('LLM_PROVIDER_EXHAUSTED: ' + failures.join(' | '));
}`;

const factReplacement = `async function getOrGrowFactOutline(category, discoveredFacts, usedTopics) {
  const previousFacts = Object.values(discoveredFacts || {}).flat().slice(-80);
  const previousTopics = Object.values(usedTopics || {}).flat().slice(-80);
  const seen = [...previousTopics, ...previousFacts].join(' | ');
  const maxAttempts = 4;
  let bestCandidate = null;
  let bestScore = -1;
  let bestTopic = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const topicPrompt = 'You are selecting a topic for a Telugu Amazing Facts Shorts channel. Category: ' + category + '. Generate ONE genuinely interesting, specific, established topic that is not among these previously used topics/facts: ' + seen.slice(-9000) + '. Do not use a generic category name. Do not repeat or paraphrase a previous topic. Return only the topic name in English, 2-6 words.';
    const topicRaw = await callLLM(topicPrompt);
    const topic = topicRaw.replace(/^[\\s-*#]+|[\\s]+$/g, '').split(/\\n/)[0].trim();
    if (!topic || topic.length < 3 || topic.length > 100) continue;
    if (previousTopics.some(t => t.toLowerCase() === topic.toLowerCase())) {
      log('  Duplicate topic rejected: ' + topic);
      continue;
    }

    log('Picked fresh online topic for ' + category + ': "' + topic + '"');
    try {
      const candidate = await generateNewFactOutline(category, topic, previousFacts);
      if (!candidate) continue;
      const normCandidate = candidate.toLowerCase().replace(/\\s+/g, ' ').trim();
      if (previousFacts.some(f => {
        const n = f.toLowerCase().replace(/\\s+/g, ' ').trim();
        return n.includes(normCandidate.slice(0, 100)) || normCandidate.includes(n.slice(0, 100));
      })) {
        log('  Duplicate fact rejected.');
        continue;
      }

      const { verified, score } = await verifyFactOutline(candidate);
      if (!verified) continue;
      const existingResults = await checkFactSaturation(candidate);
      if (existingResults > 50) {
        log('  Fact is oversaturated; trying another fresh topic.');
        continue;
      }
      if (score > bestScore) {
        bestCandidate = candidate;
        bestScore = score;
        bestTopic = topic;
      }
      if (score >= 75) return { outline: candidate, newlyDiscovered: candidate, topic };
    } catch (e) {
      if (String(e.message || '').startsWith('LLM_PROVIDER_EXHAUSTED')) throw e;
      log('  WARNING: fresh topic attempt failed: ' + e.message);
    }
  }

  if (bestCandidate) return { outline: bestCandidate, newlyDiscovered: bestCandidate, topic: bestTopic };
  throw new Error('Could not generate a verified fresh fact for ' + category + ' after ' + maxAttempts + ' fresh-topic attempts.');
}`;

let source = fs.readFileSync(SOURCE, 'utf8');
source = replaceFunction(source, 'async function callLLM(', providerReplacement);
source = replaceFunction(source, 'async function getOrGrowFactOutline(', factReplacement);

fs.writeFileSync(RUNTIME, source, 'utf8');
child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });
console.log('LLM_ROUTER_V8: syntax-safe multi-provider fallback + fresh topics + duplicate prevention applied successfully.');
for (const name of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'HF_TOKEN', 'GROQ_API_KEY']) {
  const value = (process.env[name] || '').trim();
  console.log(name + ': ' + (value ? 'present, length=' + value.length : 'missing'));
}
require(RUNTIME);
