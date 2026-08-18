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
if (!runtimeSource.includes(OLD_BRAND)) {
  throw new Error('Branding preflight failed: TELUGU ECHO marker not found in index.js');
}
fs.writeFileSync(RUNTIME, runtimeSource.replace(OLD_BRAND, NEW_BRAND), 'utf8');

child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });

// GPT-OSS 120B is reserved for the final narration. Helper calls remain on
// 20B so the 120B bucket is available for the one request that matters.
const NATIVE_FETCH = global.fetch;
if (!NATIVE_FETCH) throw new Error('Global fetch is unavailable.');

// Permanent TTS boundary: anything sent to Google TTS is converted to
// speech-only text first. This is structural, not prompt-dependent, so future
// model changes cannot make JSON labels, code fences or section names audible.
const NARRATION_KEYS = ['hook', 'fact', 'explanation', 'context', 'meaning', 'conclusion'];
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

function normalizeTechnicalSpeech(text) {
  let t = String(text || '');

  // Generic technical notation pronunciation. Examples:
  // 3D -> three D, 5G -> five G, 4K -> four K, 10D -> ten D.
  // This deliberately handles the class of problem instead of patching one term.
  t = t.replace(/\b(10|[0-9])\s*[- ]?([dDgGkK])\b/g, (_, n, letter) => {
    const value = Number(n);
    if (value >= 0 && value <= 10) return `${NUMBER_WORDS[value]} ${letter.toUpperCase()}`;
    return `${n} ${letter.toUpperCase()}`;
  });

  return t;
}

function extractSpeechText(value) {
  let t = String(value || '').trim();
  if (!t) return '';

  // If a bypassed path hands TTS a JSON object, flatten it in the canonical
  // six-part order so structural keys can never be spoken.
  try {
    const parsed = JSON.parse(t.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim());
    if (parsed && typeof parsed === 'object' && NARRATION_KEYS.some(k => typeof parsed[k] === 'string')) {
      t = NARRATION_KEYS.map(k => parsed[k]).filter(v => typeof v === 'string' && v.trim()).join(' ');
    }
  } catch (_) {
    // Not JSON; continue with plain-text cleanup.
  }

  // Strip structural labels whether they arrive as JSON-ish text or plain text.
  t = t.replace(/^```(?:json|text)?\s*/i, '').replace(/```$/i, '');
  t = t.replace(/[{}]/g, '');
  t = t.replace(/(?:^|[\n\r])\s*["']?(?:hook|fact|explanation|context|meaning|conclusion)["']?\s*[:：-]\s*/gim, '\n');
  t = t.replace(/(?:^|[\n\r])\s*(?:హుక్|ఫ్యాక్ట్|వివరణ|సందర్భం|అర్థం|ముగింపు)\s*[:：-]\s*/gim, '\n');
  t = t.replace(/\s+/g, ' ').trim();

  return normalizeTechnicalSpeech(t);
}

function sanitizeTtsText(text) {
  return extractSpeechText(text);
}

function sanitizeTtsBody(body) {
  if (!body || !body.input) return body;
  const out = { ...body, input: { ...body.input } };

  if (typeof out.input.text === 'string') {
    out.input.text = sanitizeTtsText(out.input.text);
  }
  if (typeof out.input.ssml === 'string') {
    // Keep the existing SSML payload path, while applying the same structural
    // cleanup. The normalizer is intentionally conservative about markup.
    out.input.ssml = sanitizeTtsText(out.input.ssml);
  }

  const spoken = typeof out.input.text === 'string' ? out.input.text : out.input.ssml;
  if (!spoken) {
    throw new Error('TTS preflight rejected empty speech text.');
  }
  if (/(?:^|\s)(?:hook|fact|explanation|context|meaning|conclusion)\s*:/i.test(spoken)) {
    throw new Error('TTS preflight rejected structural narration labels.');
  }
  if (/\b(?:NaN|undefined|null)\b/i.test(spoken)) {
    throw new Error('TTS preflight rejected invalid narration token: NaN/undefined/null.');
  }

  return out;
}

global.fetch = async (url, options = {}) => {
  const urlString = String(url);

  // Intercept Google Cloud TTS requests and clean only the actual speech
  // payload. This does not alter the visible script/title/metadata.
  if (urlString.includes('texttospeech.googleapis.com')) {
    let body;
    try {
      body = JSON.parse(String(options.body || '{}'));
      body = sanitizeTtsBody(body);
      return NATIVE_FETCH(url, { ...options, body: JSON.stringify(body) });
    } catch (e) {
      throw e;
    }
  }

  if (!urlString.includes('api.groq.com/openai/v1/chat/completions')) {
    return NATIVE_FETCH(url, options);
  }

  let body;
  try { body = JSON.parse(String(options.body || '{}')); } catch (_) {
    return NATIVE_FETCH(url, options);
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = messages[messages.length - 1];
  const prompt = last && typeof last.content === 'string' ? last.content : '';

  // Detect both the legacy final narration request and the guarded
  // VERIFIED SOURCE / FACT-EXPLAINER request. The guard owns final wording;
  // this router only ensures the final narration receives the 120B model.
  const isOriginalFinalNarration = /VERIFIED FACT\s*[—-]\s*ACCURACY GROUNDING:/i.test(prompt)
    && (/STORY BEATS/i.test(prompt) || /high-retention storyteller/i.test(prompt) || /final narration/i.test(prompt));
  const isGuardedFinalNarration = /VERIFIED SOURCE:/i.test(prompt)
    && /FACT-EXPLAINER/i.test(prompt)
    && /EXACTLY 6 complete sentences/i.test(prompt);
  const isFinalNarration = isOriginalFinalNarration || isGuardedFinalNarration;

  if (isFinalNarration) {
    body.model = 'openai/gpt-oss-120b';
    body.max_completion_tokens = 2500;
    delete body.max_tokens;
    body.reasoning_effort = 'low';
    body.include_reasoning = false;
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'telugu_fact_narration',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            hook: { type: 'string' },
            fact: { type: 'string' },
            explanation: { type: 'string' },
            context: { type: 'string' },
            meaning: { type: 'string' },
            conclusion: { type: 'string' }
          },
          required: ['hook', 'fact', 'explanation', 'context', 'meaning', 'conclusion']
        }
      }
    };
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
if (!guard || guard.marker !== EXPECTED_GUARD) {
  throw new Error(`Narration quality guard ${EXPECTED_GUARD} failed to load — refusing to run the video pipeline.`);
}
console.log(`${EXPECTED_GUARD}: source + runtime syntax checks passed; final six-sentence fact narration guard loaded.`);
require(RUNTIME);
