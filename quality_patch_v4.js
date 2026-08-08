const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'index.js');
let s = fs.readFileSync(file, 'utf8');

if (s.includes('// QUALITY_PATCH_V5_FINAL')) {
  console.log('QUALITY_PATCH_V5_FINAL already applied.');
  process.exit(0);
}

function replaceFunction(source, marker, newFn, label) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('QUALITY_PATCH_V5: ' + label + ' not found');
  let depth = 0, quote = null, escaped = false, end = -1;
  for (let i = start; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '/' && next === '/') { const nl = source.indexOf('\n', i + 2); i = nl < 0 ? source.length : nl; continue; }
    if (ch === '/' && next === '*') { const cl = source.indexOf('*/', i + 2); i = cl < 0 ? source.length : cl + 1; continue; }
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error('QUALITY_PATCH_V5: ' + label + ' end not found');
  return source.slice(0, start) + newFn + source.slice(end);
}

const newNarrationPrompt = String.raw`// QUALITY_PATCH_V5_FINAL
function buildNarrationPrompt(category, recentTitles, outline, beats) {
  const recent = recentTitles.length ? recentTitles.slice(-8).join(' | ') : 'none';
  const target = WORD_COUNT_TARGETS[category] || { min: 85, max: 115 };
  return [
    'You are writing the final spoken narration for a Telugu Amazing Facts YouTube Short.',
    '',
    'VERIFIED FACT — THIS IS THE ONLY SOURCE OF TRUTH:',
    outline,
    '',
    'Think silently first. Output ONLY the final narration. Never output reasoning, outline, story beats, JSON, labels, or notes.',
    '',
    'STYLE:',
    '- Natural conversational Telugu, like a strong human narrator; never textbook or news-reader style.',
    '- Hook immediately, then create curiosity, reveal the answer gradually, give the strongest supported surprising detail, and finish with a memorable fact-specific line.',
    '- Make it feel like a polished Telugu Short: simple, punchy, emotional/curious, easy to hear.',
    '- Use 12-18 short spoken lines. Line breaks are pacing beats; do not write one paragraph.',
    '- Each line should add information, curiosity, reveal, or payoff. Remove filler.',
    '- Use "..." only at genuine suspense/reveal moments; do not put ellipses on every line.',
    '- Vary transitions naturally. Do not mechanically repeat the same transition.',
    '',
    'FACT SAFETY:',
    '- Never invent or infer a date, number, name, place, cause, mechanism, example, comparison, or conclusion not supported by the verified fact.',
    '- Never turn may/can/some/certain into always/all/definitely.',
    '- Preserve the exact meaning of names, numbers, dates, and technical terms.',
    '- Do not add fake drama such as "history changed forever" unless the fact supports it.',
    '',
    'TTS:',
    '- Telugu script only.',
    '- Write numbers as natural Telugu words, never ASCII digits.',
    '- Keep sentences short and grammatically complete.',
    '- English technical terms only when genuinely needed.',
    '',
    'LENGTH:',
    '- Aim for ' + target.min + '-' + target.max + ' words for the main narration, excluding the CTA.',
    '- Do not pad with invented information.',
    '',
    'DO NOT COPY these recent title patterns:',
    recent,
    '',
    'CTA: do not write a CTA; the program appends it separately.',
    '',
    'Return ONLY the final narration text.'
  ].join('\\n');
}
`;

s = replaceFunction(s, 'function buildNarrationPrompt(category, recentTitles, outline, beats) {', newNarrationPrompt, 'buildNarrationPrompt');

const newGenerateContent = String.raw`async function generateContent(category, recentTitles, outline, ctaSentence) {
  log("Generating " + category + " content via Groq (compact final-narration pipeline)...");

  const target = WORD_COUNT_TARGETS[category] || { min: 85, max: 115 };
  const prompt = buildNarrationPrompt(category, recentTitles, outline, null);
  let script = (await callLLM(prompt)).trim();
  let wordCount = script.split(/\\s+/).filter(Boolean).length;

  // At most one compact retry. It reuses the verified fact and does not carry
  // a growing story-beat/optimizer prompt, keeping TPM safely bounded.
  if (wordCount < Math.max(45, target.min - 20) || wordCount > 140) {
    log("WARNING: narration length " + wordCount + " words is outside the safe range — one compact retry.");
    const retryPrompt = [
      'Rewrite the narration into a stronger final Telugu YouTube Shorts narration using ONLY the VERIFIED FACT.',
      '',
      'VERIFIED FACT:',
      outline,
      '',
      'PREVIOUS ATTEMPT:',
      script,
      '',
      'Requirements:',
      '- Natural spoken Telugu in Telugu script.',
      '- 12-18 short spoken lines.',
      '- Hook -> curiosity -> gradual reveal -> strongest supported detail -> memorable ending.',
      '- Target ' + target.min + '-' + target.max + ' words, but never invent facts to fill length.',
      '- No labels, JSON, explanation, reasoning, CTA, or ASCII digits.',
      '- Return ONLY the final narration.'
    ].join('\\n');
    const retry = (await callLLM(retryPrompt)).trim();
    const retryCount = retry.split(/\\s+/).filter(Boolean).length;
    log("Compact narration retry produced " + retryCount + " words.");
    if (retryCount >= Math.max(45, target.min - 20) && retryCount <= 140) {
      script = retry;
      wordCount = retryCount;
    }
  }

  if (wordCount < 30) {
    throw new Error("Narration is not viable (" + wordCount + " words) — refusing to build/upload a broken video.");
  }

  script = script
    .replace(/<think>[\\s\\S]*?<\\/think>/gi, '')
    .replace(/^[A-Z_]+\\s*:\\s*/gm, '')
    .replace(/\\n{3,}/g, '\\n\\n')
    .trim();

  script = ensureSentenceBreaks(script);

  // Remove any accidental CTA so the programmatic CTA is the only one.
  script = splitIntoSentences(script)
    .filter(line => !/సబ్.?స్క్రైబ్|subscribe/i.test(line))
    .join('\\n')
    .trim();

  if (!/[.!?]$/.test(script)) script += '.';

  // One small metadata call from the finished narration. No punctuation
  // optimizer or second story-generation stage.
  let title = null, keywords = null, hookEmoji = null;
  try {
    const metaRaw = await callLLM(buildMetadataPrompt(script));
    ({ title, keywords, hookEmoji } = parseMetadata(metaRaw));
  } catch (e) {
    log("WARNING: metadata generation failed (" + e.message + ") — using deterministic fallbacks.");
  }

  if (!title) title = deriveHeadline(script);
  if (!keywords) keywords = FALLBACK_KEYWORDS[category];
  if (!hookEmoji) hookEmoji = splitIntoSentences(script)[0] || title;

  const categoryEmoji = CATEGORY_EMOJI[category] || '';
  title = (title + ' ' + categoryEmoji).trim();
  hookEmoji = (hookEmoji + ' ' + categoryEmoji).trim();

  // Spoken CTA is appended separately so the main story ends on its payoff.
  if (ctaSentence && !/సబ్.?స్క్రైబ్|subscribe/i.test(script)) {
    script = script + '\\n' + ctaSentence;
  }

  const finalWordCount = script.split(/\\s+/).filter(Boolean).length;
  log("Title: " + title);
  log("Keywords: " + keywords);
  log("Hook emoji line: " + hookEmoji);
  log("Script (" + finalWordCount + " words, " + script.length + " chars): " + script);
  return { title, keywords, hookEmoji, script };
}
`;

s = replaceFunction(s, 'async function generateContent(category, recentTitles, outline, ctaSentence) {', newGenerateContent, 'generateContent');

// Keep every individual Groq request safely below the fallback model's 8k TPM ceiling.
s = s.replace('max_tokens: 6000', 'max_tokens: 2400');

fs.writeFileSync(file, s, 'utf8');
console.log('QUALITY_PATCH_V5_FINAL applied successfully.');
