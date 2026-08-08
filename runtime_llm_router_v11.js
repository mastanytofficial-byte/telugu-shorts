const fs = require('fs');
const path = require('path');
const child = require('child_process');

const V8 = path.join(__dirname, 'runtime_llm_router_v8.js');
const RUNTIME = path.join(__dirname, '.index.runtime.v8.js');

// V8 builds the provider/fresh-topic runtime. V11 then applies the narration
// length fix and the final measured 50-60s guard before executing it.
child.execFileSync(process.execPath, [V8], {
  stdio: 'inherit',
  env: { ...process.env, LLM_ROUTER_PATCH_ONLY: '1' }
});

let source = fs.readFileSync(RUNTIME, 'utf8');

function mustChange(re, replacement, label) {
  const before = source;
  source = source.replace(re, replacement);
  if (source === before) throw new Error('V11 patch anchor not found: ' + label);
}

// 88-105 content words; the mandatory CTA is appended separately.
for (const category of ['mindblowing','psychology','earth_space','animal','money','history','human_body','technology','food','ocean']) {
  const re = new RegExp(category + ':\\s*\\{\\s*min:\\s*(?:85|88),\\s*max:\\s*(?:105|115)\\s*\\}', 'g');
  source = source.replace(re, category + ': { min: 88, max: 105 }');
}

// Mandatory spoken CTA.
source = source.replace(
  /const CTA_VARIATIONS = \[[\s\S]*?\];/,
  "const CTA_VARIATIONS = ['వీడియో నచ్చితే లైక్ అండ్ షేర్ చేయండి, మరిన్ని ఇలాంటి వీడియోల కోసం సబ్‌స్క్రైబ్ చేయండి.'];"
);

// Allow the duration guard to correct TTS speed only when necessary.
source = source.replace(
  /const SPEAKING_RATE = [^;]+;/,
  'const SPEAKING_RATE = Number(globalThis.__TELUGU_TTS_RATE || 0.98);'
);

// The old runtime only retried twice and only cared about being 15 words short.
// V11 retries four times and requires the actual target range.
source = source.replace(
  /for \(let retryAttempt = 1; retryAttempt <= \d+ && \([\s\S]*?\); retryAttempt\+\+\)/,
  'for (let retryAttempt = 1; retryAttempt <= 4 && (wordCount < target.min || wordCount > target.max || bestWordCount < target.min || bestWordCount > MAX_SAFE_WORDS); retryAttempt++)'
);
source = source.replace(/retry \$\{retryAttempt\}\/\d+/g, 'retry ${retryAttempt}/4');

// Never use the old 20-word "viable" threshold as the final guard.
source = source.replace(/const MIN_VIABLE_WORDS = \d+;/, 'const MIN_VIABLE_WORDS = target.min;');

// Replace the old warning-only short-script branch if it exists.
source = source.replace(
  /if \(bestWordCount < target\.min - 15\) \{[\s\S]*?\n  \} else if \(bestWordCount > MAX_SAFE_WORDS\) \{/,
  "if (bestWordCount < target.min) {\n    throw new Error(`SCRIPT_LENGTH_GUARD_FAILED: after all expansion/retry passes narration is ${bestWordCount} words; target is ${target.min}-${target.max}. Refusing to build a short video.`);\n  } else if (bestWordCount > MAX_SAFE_WORDS) {"
);

// Stronger first-pass narration instruction. Ask for 100-105 words so the
// model has headroom against its tendency to under-shoot the requested range.
source = source.replace(
  /const narrationPrompt = buildNarrationPrompt\(category, recentTitles, outline, beats\);/,
  "const narrationPrompt = buildNarrationPrompt(category, recentTitles, outline, beats) + '\\n\\nHARD LENGTH REQUIREMENT: write 100-105 spoken Telugu words for the content narration. Do not stop at a summary. Fully expand all five beats into natural spoken sentences with curiosity, reveal and detail. Do not invent facts, numbers, examples or claims. CTA is added separately.';"
);

// V8's provider router already has a larger Groq budget. Keep older runtimes
// safe as well.
source = source.replace(
  /else body\.max_tokens = p\.name === 'groq-20b' \? 1400 : 1800;/g,
  "else body.max_tokens = p.kind === 'groq' ? 3000 : 2200;"
);

// IMPORTANT FIX: if four normal generation attempts still under-shoot, do not
// immediately fail. Run up to three dedicated EXPANSION passes on the best
// existing script. This is much more reliable than asking the model to create
// a new 100-word script from five tiny beats, and it preserves the verified
// fact instead of encouraging invented filler.
const expansionMarker = '  // CRITICAL: if the script is essentially empty even after all retries,';
if (!source.includes(expansionMarker)) {
  throw new Error('V11 patch anchor not found: expansion insertion point');
}
const expansionBlock = `  // V11 expansion rescue: turn a short but valid narration into the required
  // length by expanding the SAME verified content, rather than regenerating
  // unrelated prose. This directly fixes repeated 56-72 word outputs.
  if (bestWordCount < target.min) {
    for (let expansionAttempt = 1; expansionAttempt <= 3; expansionAttempt++) {
      const expansionPrompt = \`Rewrite and EXPAND the narration below into exactly \\${target.min}-\\${target.max} spoken Telugu words. The current narration is only \\${bestWordCount} words. Keep the exact same verified fact, topic, hook, reveal and conclusion. Do NOT invent any new fact, number, name, example, comparison, consequence or claim. Do not merely repeat sentences. Instead, naturally expand explanations, transitions, cause-and-effect wording, and the meaning of details already present. Use simple, natural spoken Telugu suitable for a 50-60 second YouTube Short. Return ONLY the narration text. No title, no hook label, no CTA, no emoji, no markdown.\\n\\nCURRENT NARRATION:\\n\\${bestScript}\`;\n      const expanded = (await callLLM(expansionPrompt)).trim();\n      const expandedCount = expanded.split(/\\s+/).filter(Boolean).length;\n      log('  Expansion pass ' + expansionAttempt + ' produced ' + expandedCount + ' words.');\n      if (expandedCount >= target.min && expandedCount <= target.max) {\n        bestScript = expanded;\n        bestWordCount = expandedCount;\n        break;\n      }\n      const distance = (wc) => wc < target.min ? target.min - wc : (wc > target.max ? wc - target.max : 0);\n      if (distance(expandedCount) < distance(bestWordCount)) {\n        bestScript = expanded;\n        bestWordCount = expandedCount;\n      }\n    }\n  }\n\n`;
source = source.replace(expansionMarker, expansionBlock + expansionMarker);

// Replace the old minimum check with a real target check. Do this after the
// expansion block so a 72-word script can never slip through.
source = source.replace(
  /const MIN_VIABLE_WORDS = target\.min;\n  if \(bestWordCount < MIN_VIABLE_WORDS\) \{[\s\S]*?\n  \}/,
  "const MIN_VIABLE_WORDS = target.min;\n  if (bestWordCount < target.min) {\n    throw new Error(`SCRIPT_LENGTH_GUARD_FAILED: narration is ${bestWordCount} words after 4 generation retries + 3 expansion passes; target is ${target.min}-${target.max}. Refusing to build/upload a short video.`);\n  }"
);

// Measured 50-60s guard. Regenerate content if needed, then correct TTS rate
// once. Never upload a video outside the requested window.
mustChange(
  /  const ctaSentence = pickCTA\(runCount\);\n  const \{ title, hookEmoji, script \} = await generateContent\(category, usedTitles, outline, ctaSentence\);\n  const allSentences = splitIntoSentences\(script\);\n  let \{ audioPath, sentenceDurations, silenceGap \} = await generateAudioForScript\(allSentences\);/,
  `  const ctaSentence = pickCTA(runCount);
  let title, hookEmoji, script, allSentences, audioPath, sentenceDurations, silenceGap;
  let measuredNarrationDuration = 0;
  for (let contentAudioAttempt = 1; contentAudioAttempt <= 4; contentAudioAttempt++) {
    const generated = await generateContent(category, usedTitles, outline, ctaSentence);
    title = generated.title;
    hookEmoji = generated.hookEmoji;
    script = generated.script;
    allSentences = splitIntoSentences(script);
    const generatedAudio = await generateAudioForScript(allSentences);
    audioPath = generatedAudio.audioPath;
    sentenceDurations = generatedAudio.sentenceDurations;
    silenceGap = generatedAudio.silenceGap;
    measuredNarrationDuration = getAudioDuration(audioPath);
    log('Duration guard attempt ' + contentAudioAttempt + ': narration=' + measuredNarrationDuration.toFixed(2) + 's (target 50-60s final video).');
    if (measuredNarrationDuration >= 49.7 && measuredNarrationDuration <= 59.7) break;
    log('WARNING: narration duration outside safe 49.7-59.7s — regenerating content before continuing.');
  }
  if (measuredNarrationDuration < 49.7 || measuredNarrationDuration > 59.7) {
    const targetDuration = 54.7;
    const correctedRate = Math.max(0.75, Math.min(1.20, 0.98 * measuredNarrationDuration / targetDuration));
    globalThis.__TELUGU_TTS_RATE = correctedRate;
    log('Applying final TTS duration correction: speakingRate=' + correctedRate.toFixed(3));
    const correctedAudio = await generateAudioForScript(allSentences);
    audioPath = correctedAudio.audioPath;
    sentenceDurations = correctedAudio.sentenceDurations;
    silenceGap = correctedAudio.silenceGap;
    measuredNarrationDuration = getAudioDuration(audioPath);
    log('Final narration duration after TTS correction: ' + measuredNarrationDuration.toFixed(2) + 's.');
  }
  if (measuredNarrationDuration < 49.7 || measuredNarrationDuration > 59.7) {
    throw new Error('VIDEO_DURATION_GUARD_FAILED: final narration is ' + measuredNarrationDuration.toFixed(2) + 's; refusing to upload outside the required 50-60s window.');
  }`,
  'hard 50-60s duration guard'
);

child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });
fs.writeFileSync(RUNTIME, source, 'utf8');
child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });
console.log('LLM_ROUTER_V11: provider fallback + 88-105 target + 3-pass short-script expansion rescue + hard 50-60s duration guard + mandatory CTA applied successfully.');
require(RUNTIME);
