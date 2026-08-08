const fs = require('fs');
const path = require('path');
const child = require('child_process');

const SOURCE = path.join(__dirname, 'index.js');
const RUNTIME = path.join(__dirname, '.index.runtime.v7.js');

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
  if (start < 0) throw new Error('V7 anchor not found: ' + signature);
  const open = source.indexOf('{', start);
  if (open < 0) throw new Error('V7 opening brace not found: ' + signature);
  const close = findMatchingBrace(source, open);
  return source.slice(0, start) + replacement + source.slice(close + 1);
}

const providerReplacement = `async function callLLM(prompt) {
  const disabled = global.__TELUGU_V7_DISABLED || (global.__TELUGU_V7_DISABLED = new Set());
  const providers = [
    { name: 'openai', key: (process.env.OPENAI_API_KEY || '').trim(), model: 'gpt-5.4-mini', kind: 'openai' },
    { name: 'openrouter', key: (process.env.OPENROUTER_API_KEY || '').trim(), model: 'openrouter/free', kind: 'openrouter' },
    { name: 'huggingface', key: (process.env.HF_TOKEN || '').trim(), model: 'openai/gpt-oss-120b:fastest', kind: 'huggingface' },
    { name: 'groq-20b', key: (process.env.GROQ_API_KEY || '').trim(), model: 'openai/gpt-oss-20b', kind: 'groq' },
    { name: 'groq-120b', key: (process.env.GROQ_API_KEY || '').trim(), model: 'openai/gpt-oss-120b', kind: 'groq' },
    { name: 'gemini', key: (process.env.GEMINI_API_KEY || '').trim(), model: 'gemini-2.5-flash', kind: 'gemini' }
  ].filter(p => p.key && !disabled.has(p.name));
  if (!providers.length) throw new Error('No available LLM provider/key configured.');
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
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.25, maxOutputTokens: 2200, thinkingConfig: { thinkingBudget: 0 } } })
        }, 30000);
        let data = {}; try { data = await res.json(); } catch (_) {}
        if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + ((data.error && data.error.message) || 'Gemini request failed'));
        const parts = data?.candidates?.[0]?.content?.parts;
        content = Array.isArray(parts) ? parts.map(x => x?.text).filter(Boolean).join('') : '';
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
          temperature: 0.25,
          ...(p.kind === 'openai' ? { max_completion_tokens: 2200 } : { max_tokens: p.name === 'groq-20b' ? 1500 : 2200 })
        };
        const res = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(body) }, 30000);
        let data = {}; try { data = await res.json(); } catch (_) {}
        if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + ((data.error && (data.error.message || data.error.code)) || 'provider request failed'));
        const choice = data?.choices?.[0];
        content = choice?.message?.content ? String(choice.message.content) : '';
        if (!content.trim()) throw new Error('empty response (finish_reason: ' + (choice?.finish_reason || 'unknown') + ')');
      }
      content = String(content).replace(/<think>[\\s\\S]*?<\\/think>/gi, '').trim();
      if (!content) throw new Error('empty cleaned response');
      log('LLM provider success: ' + p.name);
      return content;
    } catch (e) {
      disabled.add(p.name);
      failures.push(p.name + ': ' + e.message);
      log('WARNING: ' + p.name + ' failed — disabling it for this run. ' + e.message);
    }
  }
  throw new Error('All configured LLM providers failed. ' + failures.join(' | '));
}`;

const categoryReplacement = `function pickCategory(runCount) {
  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) {}
  const recent = Array.isArray(state.recentCategories) ? state.recentCategories : [];
  const unused = FACT_SUBNICHES.filter(c => !recent.includes(c));
  const pool = unused.length ? unused : FACT_SUBNICHES;
  const preferred = FACT_SUBNICHES[runCount % FACT_SUBNICHES.length];
  const category = pool.includes(preferred) ? preferred : pool[0];
  log('Today's category: ' + category + ' (run #' + runCount + ', recent categories: ' + (recent.join(', ') || 'none') + ')');
  return category;
}`;

const factReplacement = `async function getOrGrowFactOutline(category, discoveredFacts, usedTopics) {
  const priorFacts = Object.values(discoveredFacts || {}).flat().filter(Boolean).slice(-80);
  const priorTopics = Object.values(usedTopics || {}).flat().filter(Boolean).slice(-80);
  const maxAttempts = 6;
  const usedThisRunTopics = [];
  const usedThisRunFacts = [];
  const similarity = (a, b) => {
    const words = s => new Set(String(s).toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu, ' ').split(/\\s+/).filter(w => w.length > 2));
    const A = words(a), B = words(b);
    if (!A.size || !B.size) return 0;
    let common = 0; for (const w of A) if (B.has(w)) common++;
    return common / Math.min(A.size, B.size);
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const topicPrompt = 'You generate NEW topics for a Telugu Amazing Facts Shorts channel.\\nCATEGORY: ' + category + '\\nUSED TOPICS — NEVER REUSE: ' + [...priorTopics, ...usedThisRunTopics].slice(-100).join(' | ') + '\\nUSED FACTS — avoid the same subject/claim even if wording changes: ' + [...priorFacts, ...usedThisRunFacts].slice(-40).map(x => x.slice(0, 220)).join(' | ') + '\\nReturn exactly ONE fresh, specific topic in English, 2-6 words. Do not return a topic that is a synonym or narrower/wider restatement of a used topic.';
    let topic = (await callLLM(topicPrompt)).replace(/^[-*#`\s]+|[`\s]+$/g, '').split(/\\n/)[0].trim();
    if (!topic || topic.length < 3 || priorTopics.concat(usedThisRunTopics).some(t => similarity(t, topic) >= 0.65)) {
      log('  Duplicate/invalid topic candidate — trying another topic.');
      continue;
    }
    usedThisRunTopics.push(topic);
    log('Picked fresh online topic for ' + category + ': "' + topic + '"');

    const factPrompt = 'Create ONE fresh, well-established, verifiable fact for a Telugu Amazing Facts Short.\\nCATEGORY: ' + category + '\\nTOPIC: ' + topic + '\\nDO NOT repeat or paraphrase any previous fact below:\\n' + [...priorFacts, ...usedThisRunFacts].slice(-50).map(x => x.slice(0, 280)).join('\\n---\\n') + '\\nReturn exactly:\\nహుక్: one curiosity question\\nవివరణ: 2-3 factual sentences\\nTwist: 1-2 factual sentences\\nOnly use facts you are confident are established. If the topic cannot produce a precise, established fact, return UNSURE.';
    const candidate = (await callLLM(factPrompt)).trim();
    if (!candidate || /UNSURE/i.test(candidate) || !candidate.includes('హుక్') || !candidate.includes('వివరణ')) continue;
    if (priorFacts.concat(usedThisRunFacts).some(f => similarity(f, candidate) >= 0.62)) {
      log('  Duplicate fact/outline detected — rejecting candidate.');
      continue;
    }
    usedThisRunFacts.push(candidate);

    const verify = await (async () => {
      const raw = await callLLM('Check this fact for clear factual errors and score its viral appeal.\\nFACT:\\n' + candidate + '\\nReturn exactly two lines:\\nACCURACY: VERIFIED or REJECTED\\nSCORE: 0-100');
      return { verified: /ACCURACY:\\s*VERIFIED/i.test(raw), score: Number((raw.match(/SCORE:\\s*(\\d+)/i) || [])[1] || 0) };
    })();
    log('  Fact self-verification: ' + (verify.verified ? 'VERIFIED ✅' : 'REJECTED ❌') + ' | Viral score: ' + verify.score + '/100');
    if (!verify.verified) continue;
    if (verify.score >= 70) {
      log('  Fresh unique fact VERIFIED — using topic "' + topic + '" for this video.');
      return { outline: candidate, newlyDiscovered: candidate, topic };
    }
  }
  throw new Error('Could not generate a unique verified fresh fact for ' + category + ' after ' + maxAttempts + ' attempts.');
}`;

const saveReplacement = `function saveState(title, category, newlyDiscovered, topic) {
  const state = loadState();
  let newTitles = [...state.usedTitles, title].filter(Boolean).slice(-100);
  const discoveredFacts = { ...state.discoveredFacts };
  if (newlyDiscovered) discoveredFacts[category] = [...(discoveredFacts[category] || []), newlyDiscovered].slice(-100);
  const usedTopics = { ...state.usedTopics };
  if (topic) usedTopics[category] = [...(usedTopics[category] || []), topic].slice(-100);
  const recentCategories = [...(state.recentCategories || []), category].filter(Boolean).slice(-FACT_SUBNICHES.length);
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    usedTitles: newTitles,
    runCount: (state.runCount || 0) + 1,
    discoveredFacts,
    usedTopics,
    recentCategories,
    lastDate: new Date().toISOString()
  }, null, 2));
  log('Persisted category rotation + topic/fact/title duplicate state. Recent categories: ' + recentCategories.join(' → '));
}`;

const contentReplacement = `async function generateContent(category, recentTitles, outline, ctaSentence) {
  log('Generating ' + category + ' FINAL FACT-LOCKED DIRECT SCRIPT...');
  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) {}
  const priorFacts = Object.values(state.discoveredFacts || {}).flat().slice(-20).map(x => String(x).slice(0, 240)).join('\\n---\\n');
  const recent = (recentTitles || []).slice(-15).join(' | ');
  const prompt = 'VERIFIED FACT — ONLY SOURCE OF TRUTH:\\n' + outline + '\\n\\nRECENT TITLES TO AVOID:\\n' + recent + '\\n\\nRECENT FACT CONTENT TO AVOID REPEATING:\\n' + priorFacts + '\\n\\nWrite the final spoken narration for a Telugu Amazing Facts YouTube Short.\\nRULES:\\n- Use only information contained in the verified fact outline. Do not add facts, dates, numbers, names, examples, causes or consequences.\\n- Natural spoken Telugu.\\n- 7-11 short lines, 45-80 words before the CTA.\\n- Hook → curiosity → reveal → strongest detail → memorable ending.\\n- Do not copy wording, structure or opening from recent videos.\\n- No title, metadata, labels, emoji, markdown or CTA inside the generated body.\\n- Complete natural sentences; do not create fragments like "అది.", "రహస్యం.", "కానీ."';
  let script = (await callLLM(prompt)).trim();
  script = script.replace(/^\\`\\`\\`(?:text|telugu)?\\s*/i, '').replace(/\\`\\`\\`$/i, '').replace(/^SCRIPT:\\s*/i, '').replace(/<think>[\\s\\S]*?<\\/think>/gi, '').trim();
  const bodyLines = script.split(/\\n+/).map(s => s.trim()).filter(Boolean);
  const words = script.split(/\\s+/).filter(Boolean).length;
  if (words < 45 || words > 90 || bodyLines.length < 7 || bodyLines.length > 12) throw new Error('Narration quality check failed: ' + words + ' words / ' + bodyLines.length + ' lines.');

  const cta = 'వీడియో నచ్చితే లైక్ అండ్ షేర్ చేయండి, మరిన్ని ఇలాంటి వీడియోల కోసం సబ్‌స్క్రైబ్ చేయండి.';
  script = script + '\\n' + cta;

  const first = bodyLines[0].replace(/^🤯\\s*/, '').replace(/[!?。]+$/g, '').trim();
  let titleWords = first.split(/\\s+/).filter(Boolean);
  let title = titleWords.slice(0, 9).join(' ').replace(/[!?]+$/g, '').trim();
  if (titleWords.length > 9) title += '...';
  if (title.length < 12) title = bodyLines.slice(0, 2).join(' ').replace(/[!?]+$/g, '').trim().slice(0, 70);

  const emojiRules = [
    [/space|planet|star|moon|solar|black hole|galaxy|universe|asteroid|meteor|aurora/i, '🌌'],
    [/ocean|sea|marine|whale|squid|coral|deep.?sea|trench/i, '🌊'],
    [/animal|octopus|elephant|bee|bird|wolf|dolphin|shark|frog|tardigrade/i, '🐾'],
    [/food|honey|chocolate|coffee|tea|cheese|salt|sugar|bread|ferment|taste/i, '🍯'],
    [/brain|mind|memory|psychology|bias|conscious|sleep|neuron/i, '🧠'],
    [/money|currency|coin|bank|bitcoin|tax|finance|interest|gold/i, '💰'],
    [/history|ancient|roman|egypt|war|empire|king|queen|pyramid/i, '🏛️'],
    [/body|heart|bone|blood|kidney|liver|skin|immune|gene|cell/i, '🩺'],
    [/computer|internet|technology|robot|ai|chip|gps|quantum|software|cable/i, '💻'],
    [/mystery|strange|shocking|impossible|unknown/i, '🤯']
  ];
  const combined = title + ' ' + outline;
  const emoji = (emojiRules.find(([re]) => re.test(combined)) || [null, '🤯'])[1];
  title = (title + ' ' + emoji).trim();
  const keywords = (FALLBACK_KEYWORDS[category] || category).toString();
  const hookEmoji = emoji + ' ' + first;
  log('Title: ' + title);
  log('Keywords: ' + keywords);
  log('Hook emoji line: ' + hookEmoji);
  log('Script (' + script.length + ' chars): ' + script);
  return { title, keywords, hookEmoji, script };
}`;

let source = fs.readFileSync(SOURCE, 'utf8');
source = replaceFunction(source, 'async function callLLM(', providerReplacement);
source = replaceFunction(source, 'function pickCategory(', categoryReplacement);
source = replaceFunction(source, 'async function getOrGrowFactOutline(', factReplacement);
source = replaceFunction(source, 'function saveState(', saveReplacement);
source = replaceFunction(source, 'async function generateContent(', contentReplacement);

fs.writeFileSync(RUNTIME, source, 'utf8');
child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });
console.log('LLM_ROUTER_V7: rotating categories + fresh online topics + persistent fact/content dedupe + Telugu CTA + keyword-matched title emojis applied successfully.');
require(RUNTIME);
