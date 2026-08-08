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

// 50-60s target: 88-105 spoken words including the mandatory CTA.
for (const category of ['mindblowing','psychology','earth_space','animal','money','history','human_body','technology','food','ocean']) {
  const re = new RegExp(category + ':\\s*\\{ min: 85, max: 115 \\}', 'g');
  patched = patched.replace(re, category + ': { min: 88, max: 105 }');
}

mustReplace(
  "const CTA_VARIATIONS = [\n  'ఇలాంటి Amazing Facts కోసం సబ్‌స్క్రైబ్ చేయండి.'\n];",
  "const CTA_VARIATIONS = [\n  'వీడియో నచ్చితే లైక్ అండ్ షేర్ చేయండి, మరిన్ని ఇలాంటి వీడియోల కోసం సబ్‌స్క్రైబ్ చేయండి.'\n];",
  'CTA_VARIATIONS'
);

mustReplace(
  'const SPEAKING_RATE = 1.08;',
  'const SPEAKING_RATE = Number(globalThis.__TELUGU_TTS_RATE || 0.98);',
  'SPEAKING_RATE'
);

// The previous patch changed the loop condition but left the old "retry 1/2"
// messaging and still accepted a short script. Make the retry loop genuinely
// enforce the range and never accept a sub-target script when duration matters.
mustReplace(
  'retryAttempt <= 2 && (wordCount < target.min - 15 || bestWordCount > MAX_SAFE_WORDS)',
  'retryAttempt <= 4 && (wordCount < target.min || wordCount > target.max || bestWordCount < target.min || bestWordCount > MAX_SAFE_WORDS)',
  'script retry condition'
);

mustReplace(
  'retry ${retryAttempt}/2',
  'retry ${retryAttempt}/4',
  'retry counter text'
);

mustReplace(
  'const MIN_VIABLE_WORDS = 20;',
  'const MIN_VIABLE_WORDS = target.min;',
  'minimum viable narration length'
);

mustReplace(
  'if (bestWordCount < target.min - 15) {\n    log(`⚠️ WARNING: after all retries, script is still short (${bestWordCount} words, target ${target.min}-${target.max}) — using the best attempt available. Video will be shorter than intended this time.`);',
  'if (bestWordCount < target.min) {\n    throw new Error(`SCRIPT_LENGTH_GUARD_FAILED: after 4 retries the narration is still only ${bestWordCount} words; target is ${target.min}-${target.max}. Refusing to build a short video.`);',
  'short script hard fail'
);

// Groq GPT-OSS often reports finish_reason=length when the reasoning/output
// budget is too tight. Give it a larger completion budget for the provider
// router, while keeping OpenAI on max_completion_tokens.
mustReplace(
  "else body.max_tokens = p.name === 'groq-20b' ? 1400 : 1800;",
  "else body.max_tokens = p.kind === 'groq' ? 3000 : 1800;",
  'Groq completion budget'
);

// Do not spend the scarce OpenAI RPM on repeated narration retries if a
// secondary provider is available. The provider router itself remains the
// fallback mechanism; this only controls content-generation preference.
mustReplace(
  "const narrationPrompt = buildNarrationPrompt(category, recentTitles, outline, beats);\n  let script = (await callLLM(narrationPrompt)).trim();",
  "const narrationPrompt = buildNarrationPrompt(category, recentTitles, outline, beats) + '\\n\\nHARD LENGTH REQUIREMENT: produce 88-105 spoken Telugu words. Do not stop early. Expand every beat naturally with factual explanation and transitions. The final spoken CTA will be added separately.';\n  let script = (await callLLM(narrationPrompt)).trim();",
  'narration length prompt'
);

// Measured 50-60s guard. Never upload outside the required window.
const oldBlock = `  const ctaSentence = pickCTA(runCount);\n  const { title, hookEmoji, script } = await generateContent(category, usedTitles, outline, ctaSentence);\n  const allSentences = splitIntoSentences(script);\n  let { audioPath, sentenceDurations, silenceGap } = await generateAudioForScript(allSentences);`;
const newBlock = `  const ctaSentence = pickCTA(runCount);\n  let title, hookEmoji, script, allSentences, audioPath, sentenceDurations, silenceGap;\n  let measuredNarrationDuration = 0;\n  for (let contentAudioAttempt = 1; contentAudioAttempt <= 3; contentAudioAttempt++) {\n    const generated = await generateContent(category, usedTitles, outline, ctaSentence);\n    title = generated.title;\n    hookEmoji = generated.hookEmoji;\n    script = generated.script;\n    allSentences = splitIntoSentences(script);\n    const generatedAudio = await generateAudioForScript(allSentences);\n    audioPath = generatedAudio.audioPath;\n    sentenceDurations = generatedAudio.sentenceDurations;\n    silenceGap = generatedAudio.silenceGap;\n    measuredNarrationDuration = getAudioDuration(audioPath);\n    log('Duration guard attempt ' + contentAudioAttempt + ': narration=' + measuredNarrationDuration.toFixed(2) + 's (target 50-60s final video).');\n    if (measuredNarrationDuration >= 49.7 && measuredNarrationDuration <= 59.7) break;\n    log('WARNING: narration duration outside safe 49.7-59.7s — regenerating before upload.');\n  }\n  if (measuredNarrationDuration < 49.7 || measuredNarrationDuration > 59.7) {\n    const targetDuration = 54.7;\n    const correctedRate = Math.max(0.75, Math.min(1.20, 0.98 * measuredNarrationDuration / targetDuration));\n    globalThis.__TELUGU_TTS_RATE = correctedRate;\n    log('Applying final TTS duration correction: speakingRate=' + correctedRate.toFixed(3));\n    const correctedAudio = await generateAudioForScript(allSentences);\n    audioPath = correctedAudio.audioPath;\n    sentenceDurations = correctedAudio.sentenceDurations;\n    silenceGap = correctedAudio.silenceGap;\n    measuredNarrationDuration = getAudioDuration(audioPath);\n    log('Final narration duration after TTS correction: ' + measuredNarrationDuration.toFixed(2) + 's.');\n  }\n  if (measuredNarrationDuration < 49.7 || measuredNarrationDuration > 59.7) {\n    throw new Error('VIDEO_DURATION_GUARD_FAILED: final narration is ' + measuredNarrationDuration.toFixed(2) + 's; refusing to upload outside the required 50-60s final-video window.');\n  }`;
mustReplace(oldBlock, newBlock, 'main duration guard');

// Harden V8 fresh-topic/fact reservation without brittle exact multiline anchors.
const v8Path = path.join(__dirname, 'runtime_llm_router_v8.js');
let v8 = fs.readFileSync(v8Path, 'utf8');
const topicsBefore = v8;
v8 = v8.replace(/const previousTopics = Object\.values\(usedTopics \|\| \{\}\)\.flat\(\)\.slice\(-80\);/, 'const previousTopics = [...Object.values(usedTopics || {}).flat().slice(-80)];');
if (v8 === topicsBefore) throw new Error('V9 V8-anchor not found: previousTopics');
const topicBlockRe = /(if \(previousTopics\.some\(t => t\.toLowerCase\(\) === topic\.toLowerCase\(\)\)\) \{[\s\S]*?continue;\s*\})/;
if (!topicBlockRe.test(v8)) throw new Error('V9 V8-anchor not found: duplicate topic block');
v8 = v8.replace(topicBlockRe, '$1\n    previousTopics.push(topic);');
const factBlockRe = /(if \(previousFacts\.some\(f => \{[\s\S]*?\}\)\) \{[\s\S]*?continue;\s*\})/;
if (!factBlockRe.test(v8)) throw new Error('V9 V8-anchor not found: duplicate fact block');
v8 = v8.replace(factBlockRe, '$1\n      previousFacts.push(candidate);');
fs.writeFileSync(v8Path, v8, 'utf8');
child.execFileSync(process.execPath, ['--check', v8Path], { stdio: 'inherit' });

fs.writeFileSync(SOURCE, patched, 'utf8');
child.execFileSync(process.execPath, ['--check', SOURCE], { stdio: 'inherit' });
console.log('LLM_ROUTER_V9_BOOT: duplicate lock + hard 88-105 word target + hard 50-60s duration guard + mandatory spoken CTA applied.');
require('./runtime_llm_router_v8.js');
