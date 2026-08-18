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
// consume the 120B bucket before the important narration call.
//
// IMPORTANT: Groq's TPM limit counts the prompt plus the requested
// completion budget. The previous 6000-token final request was too large:
// the log showed a request of 8110 tokens against an 8000 TPM limit, so the
// request was rejected BEFORE generation. A 2500-token completion budget is
// more than enough for the required six Telugu sentences and leaves ample
// room under the 8000-token request-size ceiling even with the long guard
// prompt.
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

  // This is the actual final narration request before the quality guard.
  const isFinalNarration = /VERIFIED FACT\s*[—-]\s*ACCURACY GROUNDING:/i.test(prompt)
    && /STORY BEATS/i.test(prompt);

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
