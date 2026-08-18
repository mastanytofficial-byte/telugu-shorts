const fs = require('fs');
const path = require('path');
const child = require('child_process');

const SOURCE = path.join(__dirname, 'index.js');
const RUNTIME = path.join(__dirname, '.index.runtime.js');
const QUALITY_GUARD = path.join(__dirname, 'narration_quality_guard_v14.js');
const EXPECTED_GUARD = 'NARRATION_QUALITY_GUARD_V14';

child.execFileSync(process.execPath, ['--check', SOURCE], { stdio: 'inherit' });
child.execFileSync(process.execPath, ['--check', QUALITY_GUARD], { stdio: 'inherit' });
fs.copyFileSync(SOURCE, RUNTIME);
let runtimeSource = fs.readFileSync(RUNTIME, 'utf8');

// Branding.
const OLD_BRAND = "text='TELUGU ECHO'";
const NEW_BRAND = "text='FACTVERSE TELUGU'";
if (!runtimeSource.includes(OLD_BRAND)) throw new Error('Branding preflight failed: TELUGU ECHO marker not found.');
runtimeSource = runtimeSource.replace(OLD_BRAND, NEW_BRAND);

// Replace sentence parsing with one deterministic implementation. It only
// preserves sentence-ending punctuation already present in the frozen script.
const splitPattern = /function splitIntoSentences[\s\S]*?\n}\n\nfunction ensureSentenceBreaks/;
const splitReplacement = `function splitIntoSentences(text) {
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
if (!splitPattern.test(runtimeSource)) throw new Error('Narration preflight failed: splitIntoSentences boundary not found.');
runtimeSource = runtimeSource.replace(splitPattern, splitReplacement);

// Replace the whole legacy generateContent block. This removes the old
// story-beat call, word-count retries, punctuation optimizer and sentence
// repair chain. The only prose generation is now the V14 verified-fact guard.
const generatePattern = /async function generateContent\(category, recentTitles, outline, ctaSentence\)[\s\S]*?\n}\n\n\/\/ FALLBACK ONLY:/;
const generateReplacement = `async function generateContent(category, recentTitles, outline, ctaSentence) {
  log(\`Generating \\${category} content via the final verified-fact pipeline...\`);

  // Do NOT generate story beats. They were the root source of storyteller
  // language leaking into factual scripts. Send the verified outline directly
  // to the generation boundary; V14 replaces this request with the canonical
  // six-part fact-explainer prompt and uses the verified outline as its only
  // factual source.
  const narrationPrompt = \`VERIFIED FACT — ACCURACY GROUNDING:\n\\${outline}\n\nనీ ROLE: Convert this verified fact into the final factual narration.\n\nFINAL NARRATION: Hook -> Fact -> Explanation -> Important Context -> Meaning -> Conclusion.\`;
  let script = (await callLLM(narrationPrompt)).trim();

  // Only deterministic cleanup is allowed after generation.
  script = script
    .replace(/^\\s*```(?:text|json)?\\s*/i, '')
    .replace(/\\s*```\\s*$/i, '')
    .replace(/(?:^|[\\n\\r])\\s*(?:hook|fact|explanation|context|meaning|conclusion|హుక్|ఫ్యాక్ట్|వివరణ|సందర్భం|అర్థం|ముగింపు)\\s*[:：-]\\s*/gim, ' ')
    .replace(/\\s+/g, ' ')
    .trim();

  const sentences = splitIntoSentences(script);
  if (sentences.length !== 6) {
    throw new Error(\`FINAL FACT SCRIPT REJECTED: expected exactly 6 sentences, got \\${sentences.length}. No repair or rewrite is permitted.\`);
  }
  if (/\\b(?:NaN|undefined|null)\\b/i.test(script)) throw new Error('FINAL FACT SCRIPT REJECTED: invalid token detected.');
  if (/\\b\\d{4,}\\b|\\b\\d{1,3}(?:,\\d{3})+\\b/.test(script)) throw new Error('FINAL FACT SCRIPT REJECTED: large ASCII number reached TTS boundary.');
  if (/(?:^|\\s)(?:hook|fact|explanation|context|meaning|conclusion)\\s*:/i.test(script)) throw new Error('FINAL FACT SCRIPT REJECTED: structural labels leaked into narration.');

  // Reject obvious repetition between meaning and conclusion. This is a
  // safety check, not a style rewrite; a failed check stops publication.
  const words = s => new Set(String(s).toLowerCase().replace(/[^\\p{L}\\p{N}\\s]/gu, ' ').split(/\\s+/).filter(w => w.length >= 4));
  const a = words(sentences[4]);
  const b = words(sentences[5]);
  const overlap = [...a].filter(w => b.has(w)).length;
  const smaller = Math.max(1, Math.min(a.size, b.size));
  if (overlap / smaller > 0.72) throw new Error(\`FINAL FACT SCRIPT REJECTED: meaning/conclusion are overly repetitive (overlap \\${overlap}/\\${smaller}).\`);

  // Freeze the exact six sentences. Nothing below this line may modify the
  // narration text.
  script = sentences.join(' ');
  log(\`FINAL FACT SCRIPT FROZEN — exactly 6 sentences, \\${script.split(/\\s+/).filter(Boolean).length} words.\`);

  // Metadata is generated from the frozen script and cannot modify it.
  const metaRaw = await callLLM(buildMetadataPrompt(script));
  let { title, keywords, hookEmoji } = parseMetadata(metaRaw);
  if (!title) title = deriveHeadline(script);
  if (!keywords) keywords = FALLBACK_KEYWORDS[category];
  if (!hookEmoji) hookEmoji = title;
  const categoryEmoji = CATEGORY_EMOJI[category] || '';
  title = \`\\${title} \\${categoryEmoji}\`.trim();
  hookEmoji = \`\\${hookEmoji} \\${categoryEmoji}\`.trim();
  log(\`Title: \\${title}\`);
  log(\`Keywords: \\${keywords}\`);
  log(\`Hook emoji line: \\${hookEmoji}\`);
  log(\`Script (\\${script.length} chars): \\${script}\`);
  return { title, keywords, hookEmoji, script };
}

// FALLBACK ONLY:`;
if (!generatePattern.test(runtimeSource)) throw new Error('Narration preflight failed: generateContent boundary not found.');
runtimeSource = runtimeSource.replace(generatePattern, generateReplacement);

fs.writeFileSync(RUNTIME, runtimeSource, 'utf8');
child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });

const NATIVE_FETCH = global.fetch;
if (!NATIVE_FETCH) throw new Error('Global fetch is unavailable.');
const NARRATION_KEYS = ['hook','fact','explanation','context','meaning','conclusion'];
const NUMBER_WORDS = ['zero','one','two','three','four','five','six','seven','eight','nine','ten'];

function normalizeTechnicalSpeech(text) {
  return String(text || '').replace(/\\b(10|[0-9])\\s*[- ]?([dDgGkK])\\b/g, (_, n, letter) => {
    const value = Number(n);
    return value >= 0 && value <= 10 ? \`\\${NUMBER_WORDS[value]} \\${letter.toUpperCase()}\` : \`\\${n} \\${letter.toUpperCase()}\`;
  });
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
  const u = String(url);
  if (u.includes('texttospeech.googleapis.com')) {
    const body = sanitizeTtsBody(JSON.parse(String(options.body || '{}')));
    return NATIVE_FETCH(url, { ...options, body: JSON.stringify(body) });
  }
  if (!u.includes('api.groq.com/openai/v1/chat/completions')) return NATIVE_FETCH(url, options);
  let body;
  try { body = JSON.parse(String(options.body || '{}')); } catch (_) { return NATIVE_FETCH(url, options); }
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const last = msgs[msgs.length - 1];
  const prompt = last && typeof last.content === 'string' ? last.content : '';
  const isFinalNarration = /VERIFIED FACT\\s*[—-]\\s*ACCURACY GROUNDING:/i.test(prompt)
    && (/FINAL NARRATION/i.test(prompt) || /FACT-EXPLAINER/i.test(prompt) || /EXACTLY 6 complete sentences/i.test(prompt));
  if (isFinalNarration) {
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
if (!guard || guard.marker !== EXPECTED_GUARD) throw new Error(`Narration quality guard ${EXPECTED_GUARD} failed to load — refusing to run.`);
console.log(`${EXPECTED_GUARD}: source + runtime syntax checks passed; immutable six-sentence fact pipeline loaded.`);
require(RUNTIME);
