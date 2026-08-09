const fs = require('fs');
const path = require('path');
const child = require('child_process');

const SOURCE = path.join(__dirname, 'index.js');
const RUNTIME = path.join(__dirname, '.index.runtime.js');

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  let state = 'code';
  let escaped = false;
  let regex = false;
  let charClass = false;
  let prevSig = '';
  const canStartRegex = c => !c || '([{=,:;!&|?+-*%^~<>'.includes(c);

  for (let i = openIndex; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
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
    if (c === '}') { depth--; if (depth === 0) return i; }
  }
  throw new Error('Could not find matching brace');
}

function replaceFunction(source, signature, replacement) {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error('Stable router anchor not found: ' + signature);
  const open = source.indexOf('{', start);
  if (open < 0) throw new Error('Stable router opening brace not found: ' + signature);
  const close = findMatchingBrace(source, open);
  return source.slice(0, start) + replacement + source.slice(close + 1);
}

const providerReplacement = String.raw`async function callLLM(prompt) {
  if (!callLLM.disabledProviders) callLLM.disabledProviders = new Set();
  const providers = [
    { name: 'openai', key: (process.env.OPENAI_API_KEY || '').trim(), model: 'gpt-5.4-mini', kind: 'openai' },
    { name: 'gemini', key: (process.env.GEMINI_API_KEY || '').trim(), model: 'gemini-2.5-flash', kind: 'gemini' },
    { name: 'groq-120b', key: (process.env.GROQ_API_KEY || '').trim(), model: 'openai/gpt-oss-120b', kind: 'groq' },
    { name: 'groq-20b', key: (process.env.GROQ_API_KEY || '').trim(), model: 'openai/gpt-oss-20b', kind: 'groq' },
    { name: 'openrouter', key: (process.env.OPENROUTER_API_KEY || '').trim(), model: 'openrouter/free', kind: 'openrouter' },
    { name: 'huggingface', key: (process.env.HF_TOKEN || '').trim(), model: 'Qwen/Qwen2.5-72B-Instruct', kind: 'huggingface' }
  ].filter(p => p.key && !callLLM.disabledProviders.has(p.name));

  if (!providers.length) throw new Error('LLM_PROVIDER_EXHAUSTED: no configured provider remains.');
  const failures = [];

  for (const p of providers) {
    try {
      log('LLM provider: ' + p.name + ' (' + p.model + ')');
      let content = '';

      if (p.kind === 'gemini') {
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + p.model + ':generateContent';
        const body = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.25, maxOutputTokens: 2200, thinkingConfig: { thinkingBudget: 0 } }
        };
        const res = await fetchWithTimeout(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.key },
          body: JSON.stringify(body)
        }, 30000);
        let data = {};
        try { data = await res.json(); } catch (_) {}
        if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + ((data.error && data.error.message) || 'Gemini request failed'));
        const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
        content = Array.isArray(parts) ? parts.map(x => x && x.text).filter(Boolean).join('') : '';
      } else {
        let url = 'https://api.openai.com/v1/chat/completions';
        const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.key };
        if (p.kind === 'groq') url = 'https://api.groq.com/openai/v1/chat/completions';
        if (p.kind === 'openrouter') {
          url = 'https://openrouter.ai/api/v1/chat/completions';
          headers['HTTP-Referer'] = 'https://github.com/mastanytofficial-byte/telugu-shorts';
          headers['X-Title'] = 'Telugu Amazing Facts Shorts';
        }
        if (p.kind === 'huggingface') url = 'https://router.huggingface.co/v1/chat/completions';

        const body = {
          model: p.model,
          messages: [
            { role: 'system', content: 'Return only the requested answer. No hidden reasoning, markdown fences, or commentary.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.25
        };
        if (p.kind === 'openai') body.max_completion_tokens = 2200;
        else body.max_tokens = p.kind === 'groq' ? 3000 : 2200;

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

      content = String(content).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      if (!content) throw new Error('empty cleaned response');
      log('LLM provider success: ' + p.name);
      return content;
    } catch (e) {
      callLLM.disabledProviders.add(p.name);
      failures.push(p.name + ': ' + e.message);
      log('WARNING: ' + p.name + ' unavailable — trying next provider. ' + e.message);
    }
  }

  throw new Error('LLM_PROVIDER_EXHAUSTED: ' + failures.join(' | '));
}`;

const freshFactReplacement = String.raw`async function getOrGrowFactOutline(category, discoveredFacts, usedTopics) {
  const oldFacts = Object.values(discoveredFacts || {}).flat().slice(-120);
  const oldTopics = Object.values(usedTopics || {}).flat().slice(-120);
  const seen = [...oldTopics, ...oldFacts].join(' | ').slice(-18000);
  const maxAttempts = 6;
  const candidatesThisRun = [];

  async function onlineTopics() {
    const query = encodeURIComponent(category.replace('_', ' ') + ' science history facts');
    const url = 'https://news.google.com/rss/search?q=' + query + '&hl=en-IN&gl=IN&ceid=IN:en';
    try {
      const res = await fetchWithTimeout(url, {}, 12000);
      if (!res.ok) throw new Error('Google News HTTP ' + res.status);
      const xml = await res.text();
      const titles = [];
      const re = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<\/item>/gi;
      let m;
      while ((m = re.exec(xml)) && titles.length < 12) {
        const title = m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
        if (title && !titles.some(x => x.toLowerCase() === title.toLowerCase())) titles.push(title);
      }
      return titles;
    } catch (e) {
      log('  Online topic feed unavailable: ' + e.message);
      return [];
    }
  }

  const online = await onlineTopics();
  const seed = online.length ? online.join(' | ') : 'Choose a specific established fact from the category.';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = 'Select ONE specific topic for a Telugu Amazing Facts Short. Category: ' + category + '. ' +
      'Use the online candidate headlines below when useful, but do not copy a headline as the topic unless it describes a stable factual subject. ' +
      'Never repeat or paraphrase anything already used. Return only a 2-7 word topic name. ' +
      '\nONLINE CANDIDATES: ' + seed +
      '\nALREADY USED TOPICS/FACTS: ' + seen +
      '\nTHIS RUN CANDIDATES: ' + candidatesThisRun.join(' | ');

    const rawTopic = await callLLM(prompt);
    const topic = rawTopic.replace(/[\s\-*#]+|[\s]+$/g, '').split(/\n/)[0].trim();
    if (!topic || topic.length < 3 || topic.length > 100) continue;

    const normTopic = topic.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const duplicateTopic = [...oldTopics, ...candidatesThisRun].some(t => {
      const n = String(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      return n === normTopic || (n.length > 10 && normTopic.length > 10 && (n.includes(normTopic) || normTopic.includes(n)));
    });
    if (duplicateTopic) {
      log('  Duplicate topic rejected: ' + topic);
      continue;
    }
    candidatesThisRun.push(topic);
    log('Picked fresh online topic for ' + category + ': "' + topic + '"');

    try {
      const candidate = await generateNewFactOutline(category, topic, oldFacts);
      if (!candidate) continue;
      const normalizedFact = candidate.toLowerCase().replace(/\s+/g, ' ').trim();
      const duplicateFact = [...oldFacts].some(f => {
        const n = String(f).toLowerCase().replace(/\s+/g, ' ').trim();
        const a = n.slice(0, 120);
        const b = normalizedFact.slice(0, 120);
        return a && b && (a === b || (a.length > 60 && b.length > 60 && (a.includes(b) || b.includes(a))));
      });
      if (duplicateFact) {
        log('  Duplicate fact rejected.');
        continue;
      }

      const check = await verifyFactOutline(candidate);
      if (!check.verified) continue;
      const saturation = await checkFactSaturation(candidate);
      if (saturation > 50) {
        log('  Topic appears saturated; trying another topic.');
        continue;
      }
      return { outline: candidate, newlyDiscovered: candidate, topic };
    } catch (e) {
      if (/LLM_PROVIDER_EXHAUSTED/.test(String(e.message || ''))) throw e;
      log('  Fresh-topic attempt failed: ' + e.message);
    }
  }

  throw new Error('Could not generate a verified fresh fact for "' + category + '" after ' + maxAttempts + ' attempts.');
}`;

const categoryReplacement = String.raw`function pickCategory(runCount) {
  const statePath = path.join(__dirname, 'state.json');
  let state = {};
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (_) {}
  let history = Array.isArray(state.categoryHistory) ? state.categoryHistory : [];
  if (!history.length && runCount >= FACT_SUBNICHES.length) {
    const count = FACT_SUBNICHES.length;
    history = Array.from({ length: count }, (_, i) => FACT_SUBNICHES[(runCount - count + i) % count]);
  }
  const recent = new Set(history.slice(-FACT_SUBNICHES.length));
  const startIndex = ((runCount % FACT_SUBNICHES.length) + FACT_SUBNICHES.length) % FACT_SUBNICHES.length;
  let category = null;
  for (let offset = 0; offset < FACT_SUBNICHES.length; offset++) {
    const candidate = FACT_SUBNICHES[(startIndex + offset) % FACT_SUBNICHES.length];
    if (!recent.has(candidate)) { category = candidate; break; }
  }
  if (!category) category = FACT_SUBNICHES[startIndex];
  log('Today\\'s category: ' + category + ' (run #' + runCount + ', recent categories: ' + history.slice(-5).join(', ') + ')');
  return category;
}`;

const saveStateReplacement = String.raw`function saveState(title, category, newlyDiscovered, topic) {
  const state = loadState();
  const usedTitles = Array.isArray(state.usedTitles) ? state.usedTitles : [];
  const discoveredFacts = state.discoveredFacts || {};
  const usedTopics = state.usedTopics || {};
  const categoryHistory = Array.isArray(state.categoryHistory) ? state.categoryHistory : [];

  const newTitles = [...usedTitles, title].slice(-100);
  const newDiscoveredFacts = { ...discoveredFacts };
  if (newlyDiscovered) newDiscoveredFacts[category] = [...(newDiscoveredFacts[category] || []), newlyDiscovered].slice(-100);

  const newUsedTopics = { ...usedTopics };
  if (topic) newUsedTopics[category] = [...(newUsedTopics[category] || []), topic].slice(-100);

  const newCategoryHistory = [...categoryHistory, category].slice(-FACT_SUBNICHES.length * 2);
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    usedTitles: newTitles,
    runCount: (state.runCount || 0) + 1,
    discoveredFacts: newDiscoveredFacts,
    usedTopics: newUsedTopics,
    categoryHistory: newCategoryHistory,
    lastDate: new Date().toISOString()
  }, null, 2));
}`;

let source = fs.readFileSync(SOURCE, 'utf8');
source = replaceFunction(source, 'async function callLLM(', providerReplacement);
source = replaceFunction(source, 'async function getOrGrowFactOutline(', freshFactReplacement);
source = replaceFunction(source, 'function pickCategory(', categoryReplacement);
source = replaceFunction(source, 'function saveState(', saveStateReplacement);

{
  const sig = 'async function generateContent(';
  const start = source.indexOf(sig);
  if (start < 0) throw new Error('Stable router anchor not found: ' + sig);
  const open = source.indexOf('{', start);
  const close = findMatchingBrace(source, open);
  let fn = source.slice(start, close + 1);
  const old = '  script = script.trim();';
  const cta = String.raw`  const spokenCTA = 'వీడియో నచ్చితే లైక్ అండ్ షేర్ చేయండి, మరిన్ని ఇలాంటి వీడియోల కోసం సబ్‌స్క్రైబ్ చేయండి.';
  script = script.trim();
  if (!script.includes(spokenCTA)) script = script.replace(/[\s.!?…]+$/, '') + '.\n' + spokenCTA;`;
  if (!fn.includes(old)) throw new Error('Stable router CTA anchor not found inside generateContent.');
  fn = fn.replace(old, cta);
  source = source.slice(0, start) + fn + source.slice(close + 1);
}

fs.writeFileSync(RUNTIME, source, 'utf8');
child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });
console.log('STABLE LLM ROUTER: one canonical runtime, fresh online topics, persistent category/topic/fact dedupe, multi-provider fallback.');
require(RUNTIME);
