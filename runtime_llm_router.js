const fs = require('fs');
const path = require('path');
const child = require('child_process');

const SOURCE = path.join(__dirname, 'index.js');
const RUNTIME = path.join(__dirname, '.index.runtime.js');
const QUALITY_GUARD = path.join(__dirname, 'narration_quality_guard_v14.js');
const EXPECTED_GUARD = 'NARRATION_QUALITY_GUARD_V14';

// Preflight: syntax must pass before the video pipeline can start.
child.execFileSync(process.execPath, ['--check', SOURCE], { stdio: 'inherit' });
child.execFileSync(process.execPath, ['--check', QUALITY_GUARD], { stdio: 'inherit' });

fs.copyFileSync(SOURCE, RUNTIME);
let runtimeSource = fs.readFileSync(RUNTIME, 'utf8');

// Keep the existing channel branding.
const OLD_BRAND = "text='TELUGU ECHO'";
const NEW_BRAND = "text='FACTVERSE TELUGU'";
if (runtimeSource.includes(OLD_BRAND)) runtimeSource = runtimeSource.replace(OLD_BRAND, NEW_BRAND);

// The V14 guard already produces the canonical six-sentence narration.
// The legacy source had a post-generation sentence repair call that could
// insert extra periods. Disable only that call; do not rewrite the narration.
const OLD_SENTENCE_REPAIR = 'script = ensureSentenceBreaks(script);';
if (runtimeSource.includes(OLD_SENTENCE_REPAIR)) {
  runtimeSource = runtimeSource.replace(OLD_SENTENCE_REPAIR, 'script = script;');
}

fs.writeFileSync(RUNTIME, runtimeSource, 'utf8');
child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });

const NATIVE_FETCH = global.fetch;
if (!NATIVE_FETCH) throw new Error('Global fetch is unavailable.');

// V14 is the authoritative final-narration generator.
const guard = require(QUALITY_GUARD);
if (!guard || guard.marker !== EXPECTED_GUARD) {
  throw new Error(`Narration quality guard ${EXPECTED_GUARD} failed to load — refusing to run.`);
}

let frozenNarration = '';

function isGroq(url) {
  return String(url).includes('api.groq.com/openai/v1/chat/completions');
}

function getPrompt(options) {
  try {
    const body = JSON.parse(String(options.body || '{}'));
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const last = messages[messages.length - 1];
    return last && typeof last.content === 'string' ? last.content : '';
  } catch (_) {
    return '';
  }
}

function makeResponseLike(original, data) {
  return new Response(JSON.stringify(data), {
    status: original.status,
    statusText: original.statusText,
    headers: original.headers
  });
}

function frozenGroqResponse(original) {
  const data = {
    choices: [{
      message: { role: 'assistant', content: frozenNarration },
      finish_reason: 'stop'
    }]
  };
  return makeResponseLike(original, data);
}

function isFinalNarrationPrompt(prompt) {
  return /VERIFIED FACT\s*[—-]\s*ACCURACY GROUNDING:/i.test(prompt)
    && (/STORY BEATS/i.test(prompt) || /high-retention storyteller/i.test(prompt) || /final narration/i.test(prompt));
}

function isDownstreamNarrationRewrite(prompt) {
  return /Speech Punctuation Optimizer/i.test(prompt)
    || /పదాలు ఏమీ మార్చకుండా, కేవలం punctuation మాత్రమే/i.test(prompt)
    || /story beats/i.test(prompt) && /word count/i.test(prompt)
    || /ఖచ్చితంగా \d+-\d+ తెలుగు పదాలు/i.test(prompt);
}

function normalizeTechnicalSpeech(text) {
  let value = String(text || '');
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  value = value.replace(/\b(10|[0-9])\s*[- ]?([dDgGkK])\b/g, function (_, n, letter) {
    const number = Number(n);
    return number >= 0 && number <= 10 ? words[number] + ' ' + letter.toUpperCase() : n + ' ' + letter.toUpperCase();
  });
  return value;
}

function sanitizeTtsBody(body) {
  if (!body || !body.input) return body;
  const out = { ...body, input: { ...body.input } };
  if (typeof out.input.text === 'string') out.input.text = normalizeTechnicalSpeech(out.input.text);
  if (typeof out.input.ssml === 'string') out.input.ssml = normalizeTechnicalSpeech(out.input.ssml);
  const spoken = typeof out.input.text === 'string' ? out.input.text : out.input.ssml;
  if (!spoken || !String(spoken).trim()) throw new Error('TTS preflight rejected empty speech text.');
  if (/(?:^|\s)(?:hook|fact|explanation|context|meaning|conclusion)\s*:/i.test(spoken)) {
    throw new Error('TTS preflight rejected structural narration labels.');
  }
  return out;
}

// Wrap the guard's fetch rather than replacing it. This creates an immutable
// narration boundary: once V14 accepts the fact narration, legacy word-count
// retries and punctuation passes receive the frozen narration instead of being
// allowed to rewrite it. Metadata calls remain untouched.
const GUARDED_FETCH = global.fetch;
global.fetch = async function protectedFetch(url, options = {}) {
  const urlString = String(url);

  if (urlString.includes('texttospeech.googleapis.com')) {
    const body = sanitizeTtsBody(JSON.parse(String(options.body || '{}')));
    return NATIVE_FETCH(url, { ...options, body: JSON.stringify(body) });
  }

  if (!isGroq(url)) return GUARDED_FETCH(url, options);

  const prompt = getPrompt(options);
  if (frozenNarration && isDownstreamNarrationRewrite(prompt)) {
    console.log(`${EXPECTED_GUARD}: blocked downstream narration rewrite; returning frozen six-sentence script.`);
    return frozenGroqResponse(new Response(null, { status: 200 }));
  }

  const response = await GUARDED_FETCH(url, options);

  if (isFinalNarrationPrompt(prompt)) {
    try {
      const data = await response.clone().json();
      const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (typeof content === 'string' && content.trim()) {
        frozenNarration = content.trim();
        const normalized = frozenNarration.replace(/\.\.\./g, '');
        const sentenceCount = (normalized.match(/[.!?।]+/g) || []).length;
        if (sentenceCount !== 6) {
          throw new Error(`Final narration boundary returned ${sentenceCount} sentences; expected exactly 6.`);
        }
        if (/\b(?:hook|fact|explanation|context|meaning|conclusion)\s*:/i.test(frozenNarration)) {
          throw new Error('Structural narration label leaked into final script.');
        }
        console.log(`${EXPECTED_GUARD}: immutable final narration captured — 6 sentences.`);
      }
    } catch (error) {
      throw error;
    }
  }

  return response;
};

console.log(`${EXPECTED_GUARD}: source + runtime syntax checks passed; immutable six-sentence narration boundary loaded.`);
require(RUNTIME);
