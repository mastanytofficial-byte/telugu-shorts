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

const OLD_BRAND = "text='TELUGU ECHO'";
const NEW_BRAND = "text='FACTVERSE TELUGU'";
if (runtimeSource.includes(OLD_BRAND)) runtimeSource = runtimeSource.replace(OLD_BRAND, NEW_BRAND);

const OLD_SENTENCE_REPAIR = 'script = ensureSentenceBreaks(script);';
if (runtimeSource.includes(OLD_SENTENCE_REPAIR)) runtimeSource = runtimeSource.replace(OLD_SENTENCE_REPAIR, 'script = script;');

// Final narration is allowed a larger request window than ordinary API calls.
// The V14 guard performs structured validation and bounded retries; the old
// 25s global timeout could abort a valid GPT-OSS completion mid-generation.
runtimeSource = runtimeSource.replace(/timeoutMs\s*=\s*25000/g, 'timeoutMs = 60000');
fs.writeFileSync(RUNTIME, runtimeSource, 'utf8');
child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });

const NATIVE_FETCH = global.fetch;
if (!NATIVE_FETCH) throw new Error('Global fetch is unavailable.');

const guard = require(QUALITY_GUARD);
if (!guard || guard.marker !== EXPECTED_GUARD) throw new Error(`Narration quality guard ${EXPECTED_GUARD} failed to load — refusing to run.`);

let frozenNarration = '';
function isGroq(url) { return String(url).includes('api.groq.com/openai/v1/chat/completions'); }
function getBody(options) { try { return JSON.parse(String(options.body || '{}')); } catch (_) { return null; } }
function getPrompt(options) { const body = getBody(options); const messages = body && Array.isArray(body.messages) ? body.messages : []; const last = messages[messages.length - 1]; return last && typeof last.content === 'string' ? last.content : ''; }
function makeResponseLike(original, data) { return new Response(JSON.stringify(data), { status: original.status, statusText: original.statusText, headers: original.headers }); }
function frozenGroqResponse(original) { return makeResponseLike(original, { choices: [{ message: { role: 'assistant', content: frozenNarration }, finish_reason: 'stop' }] }); }
function isFinalNarrationPrompt(prompt) { return /VERIFIED FACT\s*[—-]\s*ACCURACY GROUNDING:/i.test(prompt) && (/STORY BEATS/i.test(prompt) || /high-retention storyteller/i.test(prompt) || /FINAL NARRATION:/i.test(prompt)); }
function isDownstreamNarrationRewrite(prompt) { return /Speech Punctuation Optimizer/i.test(prompt) || /పదాలు ఏమీ మార్చకుండా, కేవలం punctuation మాత్రమే/i.test(prompt) || (/story beats/i.test(prompt) && /word count/i.test(prompt)) || /ఖచ్చితంగా \d+-\d+ తెలుగు పదాలు/i.test(prompt); }
function normalizeTechnicalSpeech(text) {
  let value = String(text || '');
  const words = ['zero','one','two','three','four','five','six','seven','eight','nine','ten'];
  return value.replace(/\b(10|[0-9])\s*[- ]?([dDgGkK])\b/g, function (_, n, letter) {
    if (String(n) === '3' && String(letter).toUpperCase() === 'D') return '3D';
    const number = Number(n);
    return number >= 0 && number <= 10 ? words[number] + ' ' + letter.toUpperCase() : n + ' ' + letter.toUpperCase();
  });
}
function sanitizeTtsBody(body) {
  if (!body || !body.input) return body;
  const out = { ...body, input: { ...body.input } };
  if (typeof out.input.text === 'string') out.input.text = normalizeTechnicalSpeech(out.input.text);
  if (typeof out.input.ssml === 'string') out.input.ssml = normalizeTechnicalSpeech(out.input.ssml);
  const spoken = typeof out.input.text === 'string' ? out.input.text : out.input.ssml;
  if (!spoken || !String(spoken).trim()) throw new Error('TTS preflight rejected empty speech text.');
  if (/(?:^|\s)(?:hook|fact|explanation|context|meaning|conclusion)\s*:/i.test(spoken)) throw new Error('TTS preflight rejected structural narration labels.');
  return out;
}
const GUARDED_FETCH = global.fetch;
global.fetch = async function protectedFetch(url, options = {}) {
  const urlString = String(url);
  if (urlString.includes('texttospeech.googleapis.com')) {
    const parsed = getBody(options);
    const body = sanitizeTtsBody(parsed);
    return NATIVE_FETCH(url, { ...options, body: JSON.stringify(body) });
  }
  if (!isGroq(url)) return GUARDED_FETCH(url, options);
  const prompt = getPrompt(options);
  if (frozenNarration && isDownstreamNarrationRewrite(prompt)) {
    console.log(`${EXPECTED_GUARD}: blocked downstream narration rewrite; returning frozen six-sentence script.`);
    return frozenGroqResponse(new Response(null, { status: 200 }));
  }
  let requestOptions = options;
  if (!isFinalNarrationPrompt(prompt)) {
    const body = getBody(options);
    if (body) {
      const capped = { ...body, max_tokens: Math.min(Number(body.max_tokens) || 1800, 1800) };
      delete capped.max_completion_tokens;
      requestOptions = { ...options, body: JSON.stringify(capped) };
    }
  }
  const response = await GUARDED_FETCH(url, requestOptions);
  if (isFinalNarrationPrompt(prompt)) {
    let data;
    try { data = await response.clone().json(); } catch (_) { throw new Error(`Final narration returned non-JSON response (HTTP ${response.status}).`); }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) {
      frozenNarration = content.trim();
      const normalized = frozenNarration.replace(/\.\.\./g, '');
      const sentenceCount = (normalized.match(/[.!?।]+/g) || []).length;
      if (sentenceCount !== 6) throw new Error(`Final narration boundary returned ${sentenceCount} sentences; expected exactly 6.`);
      if (/\b(?:hook|fact|explanation|context|meaning|conclusion)\s*:/i.test(frozenNarration)) throw new Error('Structural narration label leaked into final script.');
      console.log(`${EXPECTED_GUARD}: immutable final narration captured — 6 sentences.`);
    }
  }
  return response;
};
console.log(`${EXPECTED_GUARD}: source + runtime syntax checks passed; immutable six-sentence narration boundary loaded.`);
require(RUNTIME);
