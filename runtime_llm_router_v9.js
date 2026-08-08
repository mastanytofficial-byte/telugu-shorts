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

// Target 83-90 content words + the 12-word spoken CTA = 95-102 total words.
// Combined with the measured Google Chirp pacing this is aimed at 50-60s.
for (const category of ['mindblowing','psychology','earth_space','animal','money','history','human_body','technology','food','ocean']) {
  const re = new RegExp(category + ':\\s*\\{ min: 85, max: 115 \\}', 'g');
  patched = patched.replace(re, category + ': { min: 83, max: 90 }');
}

// Exact spoken CTA on every video.
mustReplace(
  "const CTA_VARIATIONS = [\n  'ఇలాంటి Amazing Facts కోసం సబ్‌స్క్రైబ్ చేయండి.'\n];",
  "const CTA_VARIATIONS = [\n  'వీడియో నచ్చితే లైక్ అండ్ షేర్ చేయండి, మరిన్ని ఇలాంటి వీడియోల కోసం సబ్‌స్క్రైబ్ చేయండి.'\n];",
  'CTA_VARIATIONS'
);

// Slightly slower Chirp pacing gives the target word count a reliable 50-60s window.
mustReplace(
  'const SPEAKING_RATE = 1.08;',
  'const SPEAKING_RATE = Number(globalThis.__TELUGU_TTS_RATE || 0.98);',
  'SPEAKING_RATE'
);

// More retries to hit the hard narration length instead of accepting a very short script.
mustReplace(
  'retryAttempt <= 2 && (wordCount < target.min - 15 || bestWordCount > MAX_SAFE_WORDS)',
  'retryAttempt <= 4 && (wordCount < target.min || wordCount > target.max || bestWordCount < target.min || bestWordCount > MAX_SAFE_WORDS)',
  'script retry condition'
);

// Measured 50-60s guard. If content misses the window, regenerate before upload.
const oldBlock = `  const ctaSentence = pickCTA(runCount);\n  const { title, hookEmoji, script } = await generateContent(category, usedTitles, outline, ctaSentence);\n  const allSentences = splitIntoSentences(script);\n  let { audioPath, sentenceDurations, silenceGap } = await generateAudioForScript(allSentences);`;
const newBlock = `  const ctaSentence = pickCTA(runCount);\n  let title, hookEmoji, script, allSentences, audioPath, sentenceDurations, silenceGap;\n  let measuredNarrationDuration = 0;\n  let contentAudioAttempt = 0;\n  for (contentAudioAttempt = 1; contentAudioAttempt <= 3; contentAudioAttempt++) {\n    const generated = await generateContent(category, usedTitles, outline, ctaSentence);\n    title = generated.title;\n    hookEmoji = generated.hookEmoji;\n    script = generated.script;\n    allSentences = splitIntoSentences(script);\n    const generatedAudio = await generateAudioForScript(allSentences);\n    audioPath = generatedAudio.audioPath;\n    sentenceDurations = generatedAudio.sentenceDurations;\n    silenceGap = generatedAudio.silenceGap;\n    measuredNarrationDuration = getAudioDuration(audioPath);\n    log('Duration guard attempt ' + contentAudioAttempt + ': narration=' + measuredNarrationDuration.toFixed(2) + 's (target 50-60s final video).');\n    // buildVideo adds a fixed 0.3s safety buffer, so narration itself must be 49.7-59.7s.\n    if (measuredNarrationDuration >= 49.7 && measuredNarrationDuration <= 59.7) break;\n    log('WARNING: narration duration outside the safe 49.7-59.7s range — regenerating narration before continuing.');\n  }\n\n  // Final measured-rate correction. Bounded so TTS never becomes wildly fast or slow.\n  if (measuredNarrationDuration < 49.7 || measuredNarrationDuration > 59.7) {\n    const targetDuration = 54.7;\n    const correctedRate = Math.max(0.75, Math.min(1.20, 0.98 * measuredNarrationDuration / targetDuration));\n    globalThis.__TELUGU_TTS_RATE = correctedRate;\n    log('Applying final TTS duration correction: speakingRate=' + correctedRate.toFixed(3));\n    const correctedAudio = await generateAudioForScript(allSentences);\n    audioPath = correctedAudio.audioPath;\n    sentenceDurations = correctedAudio.sentenceDurations;\n    silenceGap = correctedAudio.silenceGap;\n    measuredNarrationDuration = getAudioDuration(audioPath);\n    log('Final narration duration after TTS correction: ' + measuredNarrationDuration.toFixed(2) + 's.');\n  }\n  if (measuredNarrationDuration < 49.7 || measuredNarrationDuration > 59.7) {\n    throw new Error('VIDEO_DURATION_GUARD_FAILED: final narration is ' + measuredNarrationDuration.toFixed(2) + 's; refusing to upload outside the required 50-60s final-video window.');\n  }`;
mustReplace(oldBlock, newBlock, 'main duration guard');

// Patch only the working copy used by this GitHub Actions run. V8 then applies
// its provider/fresh-topic router to this hardened source.
fs.writeFileSync(SOURCE, patched, 'utf8');
child.execFileSync(process.execPath, ['--check', SOURCE], { stdio: 'inherit' });
console.log('LLM_ROUTER_V9_BOOT: 50-60s duration guard + mandatory spoken CTA + narration-length hardening applied.');
require('./runtime_llm_router_v8.js');
