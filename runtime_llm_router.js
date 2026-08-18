const fs = require('fs');
const path = require('path');
const child = require('child_process');

// Stable launcher: index.js remains the single source of truth.
const SOURCE = path.join(__dirname, 'index.js');
const RUNTIME = path.join(__dirname, '.index.runtime.js');
const QUALITY_GUARD = path.join(__dirname, 'narration_quality_guard_v14.js');
const EXPECTED_GUARD = 'NARRATION_QUALITY_GUARD_V14';

child.execFileSync(process.execPath, ['--check', SOURCE], { stdio: 'inherit' });
child.execFileSync(process.execPath, ['--check', QUALITY_GUARD], { stdio: 'inherit' });
fs.copyFileSync(SOURCE, RUNTIME);

const runtimeSource = fs.readFileSync(RUNTIME, 'utf8');
const OLD_BRAND = "text='TELUGU ECHO'";
const NEW_BRAND = "text='FACTVERSE TELUGU'";
if (!runtimeSource.includes(OLD_BRAND)) throw new Error('Branding preflight failed: TELUGU ECHO marker not found in index.js');
fs.writeFileSync(RUNTIME, runtimeSource.replace(OLD_BRAND, NEW_BRAND), 'utf8');
child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });

const NATIVE_FETCH = global.fetch;
if (!NATIVE_FETCH) throw new Error('Global fetch is unavailable.');

const NARRATION_KEYS = ['hook', 'fact', 'explanation', 'context', 'meaning', 'conclusion'];
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

function normalizeTechnicalSpeech(text) {
  let t = String(text || '');
  t = t.replace(/\b(10|[0-9])\s*[- ]?([dDgGkK])\b/g, (_, n, letter) => {
    const value = Number(n);
    return value >= 0 && value <= 10 ? `${NUMBER_WORDS[value]} ${letter.toUpperCase()}` : `${n} ${letter.toUpperCase()}`;
  });
  return t;
}
function extractSpeechText(value) {
  let t = String(value || '').trim();
  if (!t) return '';
  try {
    const parsed = JSON.parse(t.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim());
    if (parsed && typeof parsed === 'object' && NARRATION_KEYS.some(k => typeof parsed[k] === 'string')) {
      t = NARRATION_KEYS.map(k => parsed[k]).filter(v => typeof v === 'string' && v.trim()).join(' ');
    }
  } catch (_) {}
  t = t.replace(/^```(?:json|text)?\s*/i, '').replace(/```$/i, '').replace(/[{}]/g, '');
  t = t.replace(/(?:^|[\n\r])\s*["']?(?:hook|fact|explanation|context|meaning|conclusion)["']?\s*[:：-]\s*/gim, '\n');
  t = t.replace(/(?:^|[\n\r])\s*(?:హుక్|ఫ్యాక్ట్|వివరణ|సందర్భం|అర్థం|ముగింపు)\s*[:：-]\s*/gim, '\n');
  return normalizeTechnicalSpeech(t.replace(/\s+/g, ' ').trim());
}
function sanitizeTtsBody(body) {
  if (!body || !body.input) return body;
  const out = { ...body, input: { ...body.input } };
  if (typeof out.input.text === 'string') out.input.text = extractSpeechText(out.input.text);
  if (typeof out.input.ssml === 'string') out.input.ssml = extractSpeechText(out.input.ssml);
  const spoken = typeof out.input.text === 'string' ? out.input.text : out.input.ssml;
  if (!spoken) throw new Error('TTS preflight rejected empty speech text.');
  if (/(?:^|\s)(?:hook|fact|explanation|context|meaning|conclusion)\s*:/i.test(spoken)) throw new Error('TTS preflight rejected structural narration labels.');
  if (/\b(?:NaN|undefined|null)\b/i.test(spoken)) throw new Error('TTS preflight rejected invalid narration token.');
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

  const isOriginalFinalNarration = /VERIFIED FACT\s*[—-]\s*ACCURACY GROUNDING:/i.test(prompt)
    && (/STORY BEATS/i.test(prompt) || /high-retention storyteller/i.test(prompt) || /final narration/i.test(prompt));
  const isGuardedFinalNarration = /VERIFIED SOURCE:/i.test(prompt)
    && /FACT-EXPLAINER/i.test(prompt)
    && /EXACTLY 6 complete sentences/i.test(prompt);
  const isFinalNarration = isOriginalFinalNarration || isGuardedFinalNarration;

  if (isFinalNarration) {
    body.model = 'openai/gpt-oss-120b';
    // Do not overwrite the guard's completion budget. GPT-OSS reasoning tokens
    // are included in the completion budget; the guard needs 4000 to reliably
    // finish the structured six-part answer.
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
console.log(`${EXPECTED_GUARD}: source + runtime syntax checks passed; final narration guard loaded.`);
require(RUNTIME);
