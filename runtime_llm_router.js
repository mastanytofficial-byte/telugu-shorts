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

// Final TTS safety net. The narration boundary should already return plain
// text, but TTS must NEVER speak structural JSON labels such as "hook:" or
// "fact:" if an older/bypassed generation path slips through. Also normalize
// common 3D spellings to Telugu words so Google Chirp does not read the digit
// in an unwanted English/number style.
function sanitizeTtsText(text) {
  let t = String(text || '');
  t = t.replace(/['\"]?(?:hook|fact|explanation|context|meaning|conclusion)['\"]?\s*:\s*/gi, '');
  t = t.replace(/[{}]/g, '');
  t = t.replace(/\b3\s*[-]?\s*d\b/gi, 'మూడు డీ');
  return t.trim();
}

function sanitizeTtsBody(body) {
  if (!body || !body.input) return body;
  const out = { ...body, input: { ...body.input } };
  if (typeof out.input.text === 'string') {
    out.input.text = sanitizeTtsText(out.input.text);
  }
  if (typeof out.input.ssml === 'string') {
    out.input.ssml = sanitizeTtsText(out.input.ssml);
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
    } catch (_) {
      return NATIVE_FETCH(url, options);
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

  // Detect BOTH the original narration request and the guard's rewritten
  // VERIFIED SOURCE / FACT-EXPLAINER request. The previous version required
  // VERIFIED FACT even after the guard had replaced it with VERIFIED SOURCE,
  // which accidentally routed the guarded final call to 20B.
  const isOriginalFinalNarration = /VERIFIED FACT\s*[—-]\s*ACCURACY GROUNDING:/i.test(prompt)
    && (/STORY BEATS/i.test(prompt) || /high-retention storyteller/i.test(prompt));
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
