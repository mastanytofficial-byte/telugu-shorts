const fs = require('fs');
const path = require('path');
const child = require('child_process');

// FINAL RUNTIME LAUNCHER
// index.js stays the source of truth, but this launcher applies only
// deterministic runtime-safe transformations before execution. The key
// design rule is: generate the fact narration once, validate it once, then
// freeze the exact six sentences. No later LLM call or punctuation pass is
// allowed to rewrite the narration.
const SOURCE = path.join(__dirname, 'index.js');
const RUNTIME = path.join(__dirname, '.index.runtime.js');
const QUALITY_GUARD = path.join(__dirname, 'narration_quality_guard_v14.js');
const EXPECTED_GUARD = 'NARRATION_QUALITY_GUARD_V14';

child.execFileSync(process.execPath, ['--check', SOURCE], { stdio: 'inherit' });
child.execFileSync(process.execPath, ['--check', QUALITY_GUARD], { stdio: 'inherit' });
fs.copyFileSync(SOURCE, RUNTIME);

let runtimeSource = fs.readFileSync(RUNTIME, 'utf8');

// Channel branding.
const OLD_BRAND = "text='TELUGU ECHO'";
const NEW_BRAND = "text='FACTVERSE TELUGU'";
if (!runtimeSource.includes(OLD_BRAND)) {
  throw new Error('Branding preflight failed: TELUGU ECHO marker not found in index.js');
}
runtimeSource = runtimeSource.replace(OLD_BRAND, NEW_BRAND);

// Replace the old sentence splitter with a deterministic splitter that
// understands Telugu danda/question punctuation and never invents or removes
// sentence boundaries. The narration guard guarantees exactly six sentences;
// this function merely preserves those boundaries for TTS.
const splitterPattern = /function splitIntoSentences[\s\S]*?\n}\n\nfunction ensureSentenceBreaks/;
const splitterReplacement = `function splitIntoSentences(text) {
  const normalized = String(text || '').replace(/\\r?\\n+/g, ' ').replace(/[ \\t]+/g, ' ').trim();
  if (!normalized) return [];
  const matches = normalized.match(/[^.!?।]+[.!?।]+/g) || [];
  const sentences = matches.map(s => s.trim()).filter(Boolean);
  const consumed = sentences.join(' ');
  const remainder = normalized.slice(consumed.length).trim();
  if (remainder) {
    if (sentences.length) sentences[sentences.length - 1] = (sentences[sentences.length - 1] + ' ' + remainder).trim();
    else sentences.push(remainder);
  }
  return sentences;
}

function ensureSentenceBreaks`;
if (!splitterPattern.test(runtimeSource)) {
  throw new Error('Narration preflight failed: splitIntoSentences boundary not found. Refusing to run.');
}
runtimeSource = runtimeSource.replace(splitterPattern, splitterReplacement);

// Replace the entire legacy generateContent implementation. The old version
// generated STORY BEATS, retried on word counts, ran a punctuation LLM, and
// then called ensureSentenceBreaks — all of those downstream transformations
// could change a valid six-sentence narration. The final implementation has a
// single narration generation boundary and then freezes the exact text.
const generatePattern = /async function generateContent\(category, recentTitles, outline, ctaSentence\)[\s\S]*?\n}\n\n\/\/ FALLBACK ONLY:/;
const generateReplacement = `async function generateContent(category, recentTitles, outline, ctaSentence) {
  log(\`Generating \\${category} content via Groq — final fact narration pipeline...\`);

  // The original prompt is still used so the V14 guard can intercept it and
  // replace all legacy storyteller instructions with the canonical
  // Hook -> Fact -> Explanation -> Context -> Meaning -> Conclusion prompt.
  // The guard uses the VERIFIED FACT as the sole factual source.
  const narrationPrompt = buildNarrationPrompt(category, recentTitles, outline, {});
  let script = (await callLLM(narrationPrompt)).trim();

  // Canonical cleanup only: whitespace and accidental structural wrappers.
  script = script
    .replace(/^\\s*\\{[\\s\\S]*?\\}\\s*$/g, script)
    .replace(/(?:^|[\\n\\r])\\s*(?:hook|fact|explanation|context|meaning|conclusion|హుక్|ఫ్యాక్ట్|వివరణ|సందర్భం|అర్థం|ముగింపు)\\s*[:：-]\\s*/gim, ' ')
    .replace(/\\s+/g, ' ')
    .trim();

  const sentences = splitIntoSentences(script);
  if (sentences.length !== 6) {
    throw new Error(\`FINAL FACT SCRIPT REJECTED: expected exactly 6 sentences immediately after generation, got \\${sentences.length}. No downstream repair is allowed.\`);
  }
  if ((script.match(/\\b(?:NaN|undefined|null)\\b/i))) {
    throw new Error('FINAL FACT SCRIPT REJECTED: invalid token detected.');
  }
  if (/\\b\\d{4,}\\b|\\b\\d{1,3}(?:,\\d{3})+\\b/.test(script)) {
    throw new Error('FINAL FACT SCRIPT REJECTED: large ASCII number reached narration boundary; write the number in words for TTS.');
  }
  if (/(?:^|\\s)(?:hook|fact|explanation|context|meaning|conclusion)\\s*:/i.test(script)) {
    throw new Error('FINAL FACT SCRIPT REJECTED: structural labels leaked into narration.');
  }

  // Reject obvious conclusion duplication instead of publishing a script that
  // says the same thing twice in sentences 5 and 6. This is intentionally a
  // conservative lexical-overlap check, not a generic style score.
  const contentWords = (s) => new Set(String(s).toLowerCase().replace(/[^\\p{L}\\p{N}\\s]/gu, ' ').split(/\\s+/).filter(w => w.length >= 4));
  const fifth = contentWords(sentences[4]);
  const sixth = contentWords(sentences[5]);
  const overlap = [...fifth].filter(w => sixth.has(w)).length;
  const smaller = Math.max(1, Math.min(fifth.size, sixth.size));
  if (overlap / smaller > 0.72) {
    throw new Error(\`FINAL FACT SCRIPT REJECTED: conclusion repeats the meaning sentence too closely (overlap \\${overlap}/\\${smaller}).\`);
  }

  // Freeze the exact six sentences. From this point onward no punctuation
  // optimizer, sentence repairer, word-count retry, or prose rewrite may
  // modify them.
  script = sentences.join(' ');
  log(\`FINAL FACT SCRIPT FROZEN — exactly 6 sentences, \\${script.split(/\\s+/).filter(Boolean).length} words. No downstream rewrite permitted.\`);

  // Metadata is generated FROM the frozen narration and cannot modify it.
  const metadataPrompt = buildMetadataPrompt(script);
  const metaRaw = await callLLM(metadataPrompt);
  let { title, keywords, hookEmoji } = parseMetadata(metaRaw);
  if (!title) title = deriveHeadline(script);
  if (!keywords) keywords = FALLBACK_KEYWORDS[category];
  if (!hookEmoji) hookEmoji = title;

  const categoryEmoji = CATEGORY_EMOJI[category] || '';
  title = \`\\${title} \\${categoryEmoji}\`.trim();
  hookEmoji = \`\\${hookEmoji} \\${categoryEmoji}\`.trim();

  // Spoken CTA is intentionally disabled. The visual CTA remains separate.
  log(\`Title: \\${title}\`);
  log(\`Keywords: \\${keywords}\`);
  log(\`Hook emoji line: \\${hookEmoji}\`);
  log(\`Script (\\${script.length} chars): \\${script}\`);
  return { title, keywords, hookEmoji, script };
}

// FALLBACK ONLY:`;
if (!generatePattern.test(runtimeSource)) {
  throw new Error('Narration preflight failed: legacy generateContent boundary not found. Refusing to run.');
}
runtimeSource = runtimeSource.replace(generatePattern, generateReplacement);

// Remove the old punctuation optimizer invocation even if an older
// generateContent fragment survives in a future source merge. This is a hard
// safety rule: narration is immutable after the guard.
runtimeSource = runtimeSource.replace(/\\n\\s*\/\/ CALL B\\.5: Speech Punctuation Optimizer[\\s\\S]*?\\n\\s*} catch \(e\) \{[\\s\\S]*?\\n\\s*}\n/g, '\\n');

// Final pre-metadata integrity marker. This is a second boundary check in
// addition to generateContent's own check; it makes accidental future edits
// fail closed before metadata/TTS/video work begins.
const metadataMarker = '  // CALL C: metadata (title/keywords/hook) extracted from the FINISHED,';
const integrityCode = `  // FINAL FACT PUBLISH BOUNDARY — narration must already be frozen.
`;
// The clean generateContent above contains metadata itself, so this marker is
// expected only in the legacy source. It is intentionally not required here.

fs.writeFileSync(RUNTIME, runtimeSource, 'utf8');
child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });

const NATIVE_FETCH = global.fetch;
if (!NATIVE_FETCH) throw new Error('Global fetch is unavailable.');

const NARRATION_KEYS = ['hook', 'fact', 'explanation', 'context', 'meaning', 'conclusion'];
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

function normalizeTechnicalSpeech(text) {
  let t = String(text || '');
  // Technical notation is kept in English speech form. This is generic:
  // 3D -> three D, 4K -> four K, 5G -> five G, 2D -> two D, etc.
  t = t.replace(/\\b(10|[0-9])\\s*[- ]?([dDgGkK])\\b/g, (_, n, letter) => {
    const value = Number(n);
    return value >= 0 && value <= 10 ? \`\\${NUMBER_WORDS[value]} \\${letter.toUpperCase()}\` : \`\\${n} \\${letter.toUpperCase()}\`;
  });
  return t;
}
function extractSpeechText(value) {
  let t = String(value || '').trim();
  if (!t) return '';
  try {
    const parsed = JSON.parse(t.replace(/^```(?:json)?\\s*/i, '').replace(/```$/i, '').trim());
    if (parsed && typeof parsed === 'object' && NARRATION_KEYS.some(k => typeof parsed[k] === 'string')) {
      t = NARRATION_KEYS.map(k => parsed[k]).filter(v => typeof v === 'string' && v.trim()).join(' ');
    }
  } catch (_) {}
  t = t.replace(/^```(?:json|text)?\\s*/i, '').replace(/```$/i, '');
  t = t.replace(/(?:^|[\\n\\r])\\s*["']?(?:hook|fact|explanation|context|meaning|conclusion)["']?\\s*[:：-]\\s*/gim, ' ');
  t = t.replace(/(?:^|[\\n\\r])\\s*(?:హుక్|ఫ్యాక్ట్|వివరణ|సందర్భం|అర్థం|ముగింపు)\\s*[:：-]\\s*/gim, ' ');
  return normalizeTechnicalSpeech(t.replace(/\\s+/g, ' ').trim());
}
function sanitizeTtsBody(body) {
  if (!body || !body.input) return body;
  const out = { ...body, input: { ...body.input } };
  if (typeof out.input.text === 'string') out.input.text = extractSpeechText(out.input.text);
  if (typeof out.input.ssml === 'string') out.input.ssml = extractSpeechText(out.input.ssml);
  const spoken = typeof out.input.text === 'string' ? out.input.text : out.input.ssml;
  if (!spoken) throw new Error('TTS preflight rejected empty speech text.');
  if (/(?:^|\\s)(?:hook|fact|explanation|context|meaning|conclusion)\\s*:/i.test(spoken)) throw new Error('TTS preflight rejected structural narration labels.');
  if (/\\b(?:NaN|undefined|null)\\b/i.test(spoken)) throw new Error('TTS preflight rejected invalid narration token.');
  return out;
}

global.fetch = async (url, options = {}) => {
  const urlString = String(url);
  if (urlString.includes('texttospeech.googleapis.com')) {
    const body = sanitizeTtsBody(JSON.parse(String(options.body || '{}')));
    return NATIVE_FETCH(url, { ...options, body: JSON.stringify(body) });
  }
  if (!urlString.includes('api.groq.com/openai/v1/chat/completions')) return NATIVE_FETCH(url, options);

  let body;
  try { body = JSON.parse(String(options.body || '{}')); } catch (_) { return NATIVE_FETCH(url, options); }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = messages[messages.length - 1];
  const prompt = last && typeof last.content === 'string' ? last.content : '';

  const isOriginalFinalNarration = /VERIFIED FACT\\s*[—-]\\s*ACCURACY GROUNDING:/i.test(prompt)
    && (/STORY BEATS/i.test(prompt) || /high-retention storyteller/i.test(prompt) || /final narration/i.test(prompt));
  const isGuardedFinalNarration = /VERIFIED SOURCE:/i.test(prompt)
    && /FACT-EXPLAINER/i.test(prompt)
    && /EXACTLY 6 complete sentences/i.test(prompt);

  if (isOriginalFinalNarration || isGuardedFinalNarration) {
    body.model = 'openai/gpt-oss-120b';
    const requested = Number(body.max_completion_tokens);
    body.max_completion_tokens = Number.isFinite(requested) && requested > 0 ? requested : 4000;
    delete body.max_tokens;
    body.reasoning_effort = 'low';
    body.include_reasoning = false;
  } else {
    body.model = 'openai/gpt-oss-20b';
    body.max_completion_tokens = 2000;
    delete body.max_tokens;
    body.reasoning_effort = 'low';
    body.include_reasoning = false;
  }

  return NATIVE_FETCH(url, { ...options, body: JSON.stringify(body) });
};

const guard = require(QUALITY_GUARD);
if (!guard || guard.marker !== EXPECTED_GUARD) throw new Error(`Narration quality guard ${EXPECTED_GUARD} failed to load — refusing to run the video pipeline.`);
console.log(`${EXPECTED_GUARD}: source + runtime syntax checks passed; final six-sentence fact narration guard loaded with immutable downstream boundary.`);
require(RUNTIME);
