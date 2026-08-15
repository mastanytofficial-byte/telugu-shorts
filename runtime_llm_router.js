const fs = require('fs');
const path = require('path');
const child = require('child_process');

// Stable launcher: index.js remains the single source of truth.
// No generated vN runtime files and no source rewriting/regex patching.
const SOURCE = path.join(__dirname, 'index.js');
const RUNTIME = path.join(__dirname, '.index.runtime.js');
const QUALITY_GUARD = path.join(__dirname, 'narration_quality_guard.js');
const EXPECTED_GUARD = 'NARRATION_QUALITY_GUARD_V8';

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

// Preflight wrapper: keep every Groq request below the configured token ceiling.
// The narration quality guard handles only narration-specific prompt/quality work.
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

  body.max_tokens = Math.min(Number(body.max_tokens) || 2400, 2400);

  if (Array.isArray(body.messages) && body.messages.length) {
    const last = body.messages[body.messages.length - 1];
    if (last && typeof last.content === 'string' && /story beats/i.test(last.content) && /STORY BEATS/i.test(last.content) && /VERIFIED FACT/i.test(last.content) && !/TARGET RHYTHM|FINAL NARRATION QUALITY CONTRACT/i.test(last.content)) {
      last.content = last.content.replace(/VERIFIED FACT/g, 'SOURCE FACT');
    }
  }

  return NATIVE_FETCH(url, { ...options, body: JSON.stringify(body) });
};

const guard = require(QUALITY_GUARD);
if (!guard || guard.marker !== EXPECTED_GUARD) {
  throw new Error(`Narration quality guard ${EXPECTED_GUARD} failed to load — refusing to run the video pipeline.`);
}
console.log(`${EXPECTED_GUARD}: source + runtime syntax checks passed; narration quality guard loaded.`);
require(RUNTIME);
