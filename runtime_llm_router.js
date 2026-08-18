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

// Current channel branding: every generated video uses FactVerse Telugu.
// Patch only the copied runtime so index.js remains the single source of truth.
const runtimeSource = fs.readFileSync(RUNTIME, 'utf8');
const OLD_BRAND = "text='TELUGU ECHO'";
const NEW_BRAND = "text='FACTVERSE TELUGU'";
if (!runtimeSource.includes(OLD_BRAND)) {
  throw new Error('Branding preflight failed: TELUGU ECHO marker not found in index.js');
}
fs.writeFileSync(RUNTIME, runtimeSource.replace(OLD_BRAND, NEW_BRAND), 'utf8');

child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });

// Groq routing/preflight.
// GPT-OSS 120B is reserved for the final narration where its stronger
// reasoning/language quality matters. Fact discovery, verification, story
// beats, punctuation and metadata use 20B so repeated helper calls do not
// consume the 120B rate-limit bucket before the important narration call.
// The previous router also capped every request at 3000 completion tokens.
// That caused the 120B narration request to end with finish_reason="length"
// and an empty message after reasoning consumed the cap. Groq currently
// allows much more for GPT-OSS 120B; we give the final narration enough
// headroom while keeping reasoning effort low and hidden.
const NATIVE_FETCH = global.fetch;
if (!NATIVE_FETCH) throw new Error('Global fetch is unavailable.');

global.fetch = async (url, options = {}) => {
  if (!String(url).includes('api.groq.com/openai/v1/chat/completions')) {
    return NATIVE_FETCH(url, options);
  }

  let body;
  try { body = JSON.parse(String(options.body || '{}')); } catch (_) {
    return NATIVE_FETCH(url, options);
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = messages[messages.length - 1];
  const prompt = last && typeof last.content === 'string' ? last.content : '';

  // This is the actual narration request before the quality guard rewrites it.
  const isFinalNarration = /VERIFIED FACT\s*[—-]\s*ACCURACY GROUNDING:/i.test(prompt)
    && /STORY BEATS/i.test(prompt);

  if (isFinalNarration) {
    body.model = 'openai/gpt-oss-120b';
    body.max_completion_tokens = 6000;
    delete body.max_tokens;
    body.reasoning_effort = 'low';
    body.include_reasoning = false;
    // The V14 guard asks for this exact six-field JSON object. Structured
    // output prevents the model from spending tokens on malformed wrappers.
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
    body.max_completion_tokens = 2500;
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
