const fs = require('fs');
const path = require('path');
const child = require('child_process');

const SOURCE = path.join(__dirname, 'index.js');
const source = fs.readFileSync(SOURCE, 'utf8');
let patched = source;

function mustReplace(oldText, newText, label) {
  if (!patched.includes(oldText)) throw new Error('V9 patch anchor not found: ' + label);
  patched = patched.replace(oldText, newText);
}

// 1) The narration itself must land around 95-102 total words including the
// 12-word CTA. With the measured Google Chirp pacing this targets 50-60s.
patched = patched.replace(/mindblowing:\s*\{ min: 85, max: 115 \}/g, 'mindblowing: { min: 83, max: 90 }');
patched = patched.replace(/psychology:\s*\{ min: 85, max: 115 \}/g, 'psychology: { min: 83, max: 90 }');
patched = patched.replace(/earth_space:\s*\{ min: 85, max: 115 \}/g, 'earth_space: { min: 83, max: 90 }');
patched = patched.replace(/animal:\s*\{ min: 85, max: 115 \}/g, 'animal: { min: 83, max: 90 }');
patched = patched.replace(/money:\s*\{ min: 85, max: 115 \}/g, 'money: { min: 83, max: 90 }');
patched = patched.replace(/history:\s*\{ min: 85, max: 115 \}/g, 'history: { min: 83, max: 90 }');
patched = patched.replace(/human_body:\s*\{ min: 85, max: 115 \}/g, 'human_body: { min: 83, max: 90 }');
patched = patched.replace(/technology:\s*\{ min: 85, max: 115 \}/g, 'technology: { min: 83, max: 90 }');
patched = patched.replace(/food:\s*\{ min: 85, max: 115 \}/g, 'food: { min: 83, max: 90 }');
patched = patched.replace(/ocean:\s*\{ min: 85, max: 115 \}/g, 'ocean: { min: 83, max: 90 }');

// 2) Exact spoken CTA on every video. The old CTA was too short and was not
// reliably present in the V8 output log.
mustReplace(
  "const CTA_VARIATIONS = [\n  'ఇలాంటి Amazing Facts కోసం సబ్‌స్క్రైబ్ చేయండి.'\n];",
  "const CTA_VARIATIONS = [\n  'వీడియో నచ్చితే లైక్ అండ్ షేర్ చేయండి, మరిన్ని ఇలాంటి వీడియోల కోసం సబ్‌స్క్రైబ్ చేయండి.'\n];",
  'CTA_VARIATIONS'
);

// 3) Slightly slower Chirp pacing gives the 95-102 word narration a much more
// reliable 50-60s window. The rate is also adjustable by the duration guard.
mustReplace(
  'const SPEAKING_RATE = 1.08;',
  'const SPEAKING_RATE = Number(globalThis.__TELUGU_TTS_RATE || 0.98);',
  'SPEAKING_RATE'
);

// 4) Give the model more chances to actually hit the required narration
// length instead of accepting a 50-60 word script after only two retries.
mustReplace(
  'retryAttempt <= 2 && (wordCount < target.min - 15 || bestWordCount > MAX_SAFE_WORDS)',
  'retryAttempt <= 4 && (wordCount < target.min || wordCount > target.max || bestWordCount < target.min || bestWordCount > MAX_SAFE_WORDS)',
  'script retry condition'
);

// 5) Replace the one-shot content/audio creation with a measured 50-60s guard.
// If the generated narration is outside the window, regenerate the narration
// instead of uploading a short/long video. After three content attempts, use
// a bounded TTS-rate correction as a final safety net.
const oldBlock = `  const ctaSentence = pickCTA(runCount);\n  const { title, hookEmoji, script } = await generateContent(category, usedTitles, outline, ctaSentence);\n  const allSentences = splitIntoSentences(script);\n  let { audioPath, sentenceDurations, silenceGap } = await generateAudioForScript(allSentences);`;
const newBlock = `  const ctaSentence = pickCTA(runCount);\n  let title, hookEmoji, script, allSentences, audioPath, sentenceDurations, silenceGap;\n  let measuredNarrationDuration = 0;\n  let contentAudioAttempt = 0;\n  for (contentAudioAttempt = 1; contentAudioAttempt <= 3; contentAudioAttempt++) {\n    const generated = await generateContent(category, usedTitles, outline, ctaSentence);\n    title = generated.title;\n    hookEmoji = generated.hookEmoji;\n    script = generated.script;\n    allSentences = splitIntoSentences(script);\n    const generatedAudio = await generateAudioForScript(allSentences);\n    audioPath = generatedAudio.audioPath;\n    sentenceDurations = generatedAudio.sentenceDurations;\n    silenceGap = generatedAudio.silenceGap;\n    measuredNarrationDuration = getAudioDuration(audioPath);\n    log('Duration guard attempt ' + contentAudioAttempt + ': narration=' + measuredNarrationDuration.toFixed(2) + 's (required 50-60s).');\n    if (measuredNarrationDuration >= 50 && measuredNarrationDuration <= 60) break;\n    log('WARNING: narration duration outside 50-60s — regenerating narration before continuing.');\n  }\n\n  // Final measured-rate correction. This is intentionally bounded so the TTS\n  // never becomes unnaturally fast or slow. It only runs if content generation\n  // still missed the hard duration window.\n  if (measuredNarrationDuration < 50 || measuredNarrationDuration > 60) {\n    const targetDuration = 55;\n    const correctedRate = Math.max(0.75, Math.min(1.20, 0.98 * measuredNarrationDuration / targetDuration));\n    globalThis.__TELUGU_TTS_RATE = correctedRate;\n    log('Applying final TTS duration correction: speakingRate=' + correctedRate.toFixed(3));\n    const correctedAudio = await generateAudioForScript(allSentences);\n    audioPath = correctedAudio.audioPath;\n    sentenceDurations = correctedAudio.sentenceDurations;\n    silenceGap = correctedAudio.silenceGap;\n    measuredNarrationDuration = getAudioDuration(audioPath);\n    log('Final duration after TTS correction: ' + measuredNarrationDuration.toFixed(2) + 's.');\n  }\n  if (measuredNarrationDuration < 50 || measuredNarrationDuration > 60) {\n    throw new Error('VIDEO_DURATION_GUARD_FAILED: final narration is ' + measuredNarrationDuration.toFixed(2) + 's; refusing to upload outside the required 50-60s window.');\n  }`;
mustReplace(oldBlock, newBlock, 'main duration guard');

// Write the patched source only for this GitHub Actions run. V8 then applies
// its provider/fresh-topic router to this already-hardened source.
fs.writeFileSync(SOURCE, patched, 'utf8');
child.execFileSync(process.execPath, ['--check', SOURCE], { stdio: 'inherit' });
console.log('LLM_ROUTER_V9_BOOT: 50-60s duration guard + mandatory spoken CTA + narration-length hardening applied.');
require('./runtime_llm_router_v8.js');
