const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'index.js');
let s = fs.readFileSync(file, 'utf8');

if (s.includes('// QUALITY_PATCH_V6_FINAL')) {
  console.log('QUALITY_PATCH_V6_FINAL already applied.');
  process.exit(0);
}

function replaceFunction(source, marker, newFn, label) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('QUALITY_PATCH_V6: ' + label + ' not found');
  let depth = 0;
  let quote = null;
  let escaped = false;
  let end = -1;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
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
    if (ch === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end < 0) throw new Error('QUALITY_PATCH_V6: ' + label + ' end not found');
  return source.slice(0, start) + newFn + source.slice(end);
}

const narrationPrompt = String.raw`// QUALITY_PATCH_V6_FINAL
function buildNarrationPrompt(category, recentTitles, outline, beats) {
  const recent = recentTitles.length ? recentTitles.slice(-8).join(' | ') : 'none';
  const target = WORD_COUNT_TARGETS[category] || { min: 85, max: 115 };
  return [
    'Write the final spoken narration for a Telugu Amazing Facts YouTube Short.',
    '',
    'VERIFIED FACT — ONLY SOURCE OF TRUTH:',
    outline,
    '',
    'THINK LIKE A STORY EDITOR BEFORE WRITING:',
    'Silently identify the single most surprising fact, the natural viewer question it creates, the cleanest reveal, and the strongest fact-supported payoff. Do not output this planning.',
    '',
    'TARGET FEEL:',
    'The narration must sound like a sharp Telugu creator telling a fascinating fact to a friend — not like an encyclopedia, school lesson, translated article, documentary, or AI summary.',
    '',
    'STORY SHAPE:',
    '1) Scroll-stopping hook.',
    '2) Curiosity/question.',
    '3) Delay the obvious answer for a beat or two when natural.',
    '4) Reveal the verified fact clearly.',
    '5) Give only the most interesting supporting detail that is actually in the verified fact.',
    '6) Finish with a memorable takeaway that is also supported by the fact.',
    '',
    'LINE/PACING RULES:',
    '- Use 10-16 short spoken lines, normally 2-10 words per line.',
    '- One spoken thought per line. Do not pack multiple clauses into one sentence.',
    '- Every line must do at least one job: create curiosity, reveal a fact, explain a supported detail, or create payoff.',
    '- If a line does none of those jobs, DELETE it. Never add filler to reach word count.',
    '- Use "..." only at genuine suspense/reveal moments. Usually 2-4 times total.',
    '- Use commas only for a natural breath inside a complete thought.',
    '- Use full stops when the thought is complete.',
    '',
    'NATURAL TELUGU:',
    '- Prefer simple spoken Telugu over formal vocabulary.',
    '- Never translate English sentence structure literally into Telugu.',
    '- Avoid unnatural phrases such as “చిన్న రహస్యం”, “జీవనపు ఉప్పు”, “సాహసంగా తవ్వారు”, “చరిత్రలో కొత్త అధ్యాయం” unless the fact itself genuinely requires them.',
    '- Avoid generic filler such as “ఇది చాలా ఆసక్తికరం”, “ఇది మనల్ని ఆశ్చర్యపరుస్తుంది”, “ఇది ప్రత్యేకమైన విషయం”.',
    '- Do not force a daily-life comparison unless it makes the fact clearer and is genuinely natural.',
    '- Do not repeat the same transition (“కానీ...”, “అసలు విషయం...”, “ఇంకా షాక్...”) mechanically.',
    '',
    'FACT SAFETY — HARD RULE:',
    '- Use ONLY claims explicitly supported by VERIFIED FACT.',
    '- Never invent a date, number, name, location, cause, mechanism, example, comparison, quote, historical scene, or scientific explanation.',
    '- Never strengthen “some/may/can/about/almost” into “all/always/definitely/exactly”.',
    '- Never turn an etymology or association into a literal historical event unless the verified fact explicitly says so.',
    '- Never turn a possible explanation into a proven cause.',
    '- If a detail is not needed, omit it rather than guessing.',
    '',
    'TTS:',
    '- Telugu script for the narration.',
    '- Write numbers as Telugu words, not ASCII digits.',
    '- Keep pronunciation-friendly words and short sentences.',
    '',
    'LENGTH:',
    '- Aim for ' + target.min + '-' + target.max + ' words, but accuracy and naturalness are more important than length.',
    '',
    'RECENT TITLES — avoid repeating their wording/pattern:',
    recent,
    '',
    'Do not write CTA, title, keywords, JSON, labels, reasoning, or notes. Return ONLY the narration.'
  ].join('\n');
}
`;

s = replaceFunction(s, 'function buildNarrationPrompt(category, recentTitles, outline, beats) {', narrationPrompt, 'buildNarrationPrompt');

const generateContent = String.raw`async function generateContent(category, recentTitles, outline, ctaSentence) {
  log("Generating " + category + " content via Groq (V6 fact-safe narration pipeline)...");
  const target = WORD_COUNT_TARGETS[category] || { min: 85, max: 115 };
  const prompt = buildNarrationPrompt(category, recentTitles, outline, null);
  let script = (await callLLM(prompt)).trim();

  const suspicious = [
    'చిన్న రహస్యం', 'జీవనపు ఉప్పు', 'సాహసంగా తవ్వారు', 'చరిత్రలో కొత్త అధ్యాయం',
    'మనల్ని ఆశ్చర్యపరుస్తుంది', 'చాలా ఆసక్తికరం', 'వాస్తవానికి ఇదే', 'ఎప్పటికీ మార్చేసింది'
  ];
  const wordCount = () => script.split(/\s+/).filter(Boolean).length;
  const lineCount = () => script.split(/\r?\n/).map(x => x.trim()).filter(Boolean).length;
  const needsRewrite = () => {
    const wc = wordCount();
    const lc = lineCount();
    const badPhrase = suspicious.some(p => script.includes(p));
    const longLine = script.split(/\r?\n/).some(line => line.trim().split(/\s+/).filter(Boolean).length > 16);
    const hasDigits = /\b\d{2,}\b/.test(script);
    return wc < 55 || wc > 135 || lc < 8 || lc > 20 || badPhrase || longLine || hasDigits;
  };

  if (needsRewrite()) {
    log("V6 quality gate: first narration failed naturalness/structure checks — one compact rewrite.");
    const retryPrompt = [
      'Rewrite the draft below into a natural, high-retention Telugu Amazing Facts Short.',
      '',
      'VERIFIED FACT — ONLY SOURCE OF TRUTH:',
      outline,
      '',
      'DRAFT TO REWRITE:',
      script,
      '',
      'Rules:',
      '- 10-16 short spoken lines.',
      '- Hook -> curiosity -> reveal -> strongest supported detail -> memorable supported payoff.',
      '- Natural conversational Telugu, not translated English and not textbook Telugu.',
      '- Every line must add curiosity, fact, explanation, or payoff. Delete filler.',
      '- Do not add any fact that is not explicitly supported by VERIFIED FACT.',
      '- Do not turn associations/etymology into literal historical events.',
      '- No ASCII digits. Write numbers as Telugu words.',
      '- No CTA, title, labels, JSON, reasoning, or notes.',
      '- Return ONLY the final narration.'
    ].join('\n');
    const retry = (await callLLM(retryPrompt)).trim();
    if (retry) script = retry;
  }

  script = script
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  script = ensureSentenceBreaks(script);
  script = splitIntoSentences(script)
    .filter(line => !/సబ్.?స్క్రైబ్|subscribe/i.test(line))
    .join('\n')
    .trim();

  if (!script || wordCount() < 30) {
    throw new Error('V6 refused to build/upload: narration is too short or empty.');
  }

  let title = null, keywords = null, hookEmoji = null;
  try {
    const metaRaw = await callLLM(buildMetadataPrompt(script));
    ({ title, keywords, hookEmoji } = parseMetadata(metaRaw));
  } catch (e) {
    log('WARNING: metadata generation failed (' + e.message + ') — using deterministic fallbacks.');
  }
  if (!title) title = deriveHeadline(script);
  if (!keywords) keywords = FALLBACK_KEYWORDS[category];
  if (!hookEmoji) hookEmoji = splitIntoSentences(script)[0] || title;

  const categoryEmoji = CATEGORY_EMOJI[category] || '';
  title = (title + ' ' + categoryEmoji).trim();
  hookEmoji = (hookEmoji + ' ' + categoryEmoji).trim();
  if (ctaSentence && !/సబ్.?స్క్రైబ్|subscribe/i.test(script)) script += '\n' + ctaSentence;

  const finalWordCount = script.split(/\s+/).filter(Boolean).length;
  log('Title: ' + title);
  log('Keywords: ' + keywords);
  log('Hook emoji line: ' + hookEmoji);
  log('Script (' + finalWordCount + ' words, ' + script.length + ' chars): ' + script);
  return { title, keywords, hookEmoji, script };
}
`;

s = replaceFunction(s, 'async function generateContent(category, recentTitles, outline, ctaSentence) {', generateContent, 'generateContent');

fs.writeFileSync(file, s, 'utf8');
console.log('QUALITY_PATCH_V6_FINAL applied successfully.');
