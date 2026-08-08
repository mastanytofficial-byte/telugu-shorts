const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'index.js');
let s = fs.readFileSync(file, 'utf8');

if (s.includes('// QUALITY_PATCH_V1')) {
  console.log('QUALITY_PATCH_V1 already applied.');
  process.exit(0);
}

const marker = '// QUALITY_PATCH_V1';
const helper = `
${marker}
// Deterministic number-to-Telugu conversion. LLM instructions alone are not
// reliable enough for TTS: digits are converted immediately before speech and
// also applied to metadata so titles/descriptions do not leak raw digits.
const TELUGU_ONES = ['సున్నా','ఒకటి','రెండు','మూడు','నాలుగు','ఐదు','ఆరు','ఏడు','ఎనిమిది','తొమ్మిది','పది','పదకొండు','పన్నెండు','పదమూడు','పద్నాలుగు','పదిహేను','పదహారు','పదిహేడు','పద్దెనిమిది','పందొమ్మిది'];
const TELUGU_TENS = {20:'ఇరవై',30:'ముప్పై',40:'నలభై',50:'యాభై',60:'అరవై',70:'డెబ్బై',80:'ఎనభై',90:'తొంభై'};
const TELUGU_HUNDREDS = {100:'వంద',200:'రెండు వందలు',300:'మూడు వందలు',400:'నాలుగు వందలు',500:'ఐదు వందలు',600:'ఆరు వందలు',700:'ఏడు వందలు',800:'ఎనిమిది వందలు',900:'తొమ్మిది వందలు'};
function teluguBelow100(n) {
  if (n < 20) return TELUGU_ONES[n];
  const ten = Math.floor(n / 10) * 10;
  const rest = n % 10;
  return rest ? TELUGU_TENS[ten] + ' ' + TELUGU_ONES[rest] : TELUGU_TENS[ten];
}
function teluguBelow1000(n) {
  if (n < 100) return teluguBelow100(n);
  const h = Math.floor(n / 100) * 100;
  const rest = n % 100;
  return rest ? TELUGU_HUNDREDS[h] + ' ' + teluguBelow100(rest) : TELUGU_HUNDREDS[h];
}
function numberToTeluguWords(n) {
  n = Number(n);
  if (!Number.isFinite(n) || n < 0 || n > 999999999) return String(n);
  if (n < 1000) return teluguBelow1000(n);
  if (n < 100000) {
    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    return (thousands === 1 ? 'వెయ్యి' : teluguBelow1000(thousands) + ' వేల') + (rest ? ' ' + teluguBelow1000(rest) : '');
  }
  if (n < 10000000) {
    const lakhs = Math.floor(n / 100000);
    const rest = n % 100000;
    return (lakhs === 1 ? 'లక్ష' : teluguBelow1000(lakhs) + ' లక్షలు') + (rest ? ' ' + numberToTeluguWords(rest) : '');
  }
  const crores = Math.floor(n / 10000000);
  const rest = n % 10000000;
  return (crores === 1 ? 'కోటి' : numberToTeluguWords(crores) + ' కోట్లు') + (rest ? ' ' + numberToTeluguWords(rest) : '');
}
function normalizeTeluguNumbers(text) {
  if (!text) return text;
  let out = text;
  out = out.replace(/₹\\s*([0-9][0-9,]*)/g, (_, n) => numberToTeluguWords(n.replace(/,/g, '')) + ' రూపాయలు');
  out = out.replace(/([0-9][0-9,]*)\\.([0-9]+)/g, (_, a, b) => numberToTeluguWords(a.replace(/,/g, '')) + ' పాయింట్ ' + b.split('').map(d => TELUGU_ONES[Number(d)]).join(' '));
  out = out.replace(/([0-9][0-9,]*)%/g, (_, n) => numberToTeluguWords(n.replace(/,/g, '')) + ' శాతం');
  out = out.replace(/\\b[0-9][0-9,]*\\b/g, m => numberToTeluguWords(m.replace(/,/g, '')));
  return out.replace(/\\s{2,}/g, ' ').trim();
}
function narrationLineCount(text) {
  return text.split(/\\r?\\n+/).map(x => x.trim()).filter(Boolean).length;
}
function narrationWordCount(text) {
  return text.split(/\\s+/).filter(Boolean).length;
}
`;

// Insert helpers before generateContent.
const anchor = 'async function generateContent(category, recentTitles, outline, ctaSentence) {';
if (!s.includes(anchor)) throw new Error('quality patch anchor not found: generateContent');
s = s.replace(anchor, helper + '\n' + anchor);

// Make the narration retry enforce the promised visual-beat structure.
const bestScriptAnchor = '  script = bestScript;\n\n  // Safety-net detection: numbers 1000+ written as digits get mispronounced';
const bestScriptReplacement = `  script = bestScript;

  // QUALITY_PATCH_V1: enforce the 12-18 visual/spoken beat contract. If the
  // model ignored line pacing, spend one extra focused call before rendering.
  let lineCount = narrationLineCount(script);
  if (lineCount < 12 || lineCount > 18) {
    log(\`QUALITY PATCH: narration had \${lineCount} lines; requesting a final 12-18 beat pass.\`);
    try {
      const structureRetry = await callLLM(buildNarrationPrompt(category, recentTitles, outline, beats) + 
        \`\\n\\nFINAL HARD CHECK: output exactly 12-18 non-empty spoken lines separated by line breaks. One short spoken thought per line. Do not use numbered lists, labels, title, CTA, emoji, or markdown.\`);
      const retryLines = narrationLineCount(structureRetry);
      const retryWords = narrationWordCount(structureRetry);
      if (retryLines >= 12 && retryLines <= 18 && retryWords >= target.min - 5 && retryWords <= MAX_SAFE_WORDS) {
        script = structureRetry.trim();
        lineCount = retryLines;
        log(\`QUALITY PATCH: accepted final narration (\${retryWords} words, \${retryLines} lines).\`);
      } else {
        log(\`QUALITY PATCH: rejected final narration (\${retryWords} words, \${retryLines} lines); keeping best validated attempt.\`);
      }
    } catch (e) {
      log(\`QUALITY PATCH: final structure pass failed (\${e.message}); keeping best validated attempt.\`);
    }
  }

  // Deterministic TTS safety net: convert every remaining Arabic digit to
  // spoken Telugu before sentence splitting and Google TTS.
  script = normalizeTeluguNumbers(script);

  // Safety-net detection: numbers 1000+ written as digits get mispronounced`;
if (!s.includes(bestScriptAnchor)) throw new Error('quality patch anchor not found: bestScript');
s = s.replace(bestScriptAnchor, bestScriptReplacement);

// Ensure title/hook cannot contain raw digits either.
const titleLogAnchor = '  const categoryEmoji = CATEGORY_EMOJI[category] || \'\';';
const titleReplacement = `  title = normalizeTeluguNumbers(title);
  hookEmoji = normalizeTeluguNumbers(hookEmoji);

  const categoryEmoji = CATEGORY_EMOJI[category] || '';`;
s = s.replace(titleLogAnchor, titleReplacement);

// Prevent the known long-final-slide failure: allow up to 18 sentence/line
// visuals and never merge all extra duration into one giant final slide.
s = s.replace('  const MAX_SLIDES = 10;', '  const MAX_SLIDES = 18;');
const mergeBlock = `  if (imageSentences.length > MAX_SLIDES) {
    const extraDuration = imageDurations.slice(MAX_SLIDES - 1).reduce((a, b) => a + b, 0);
    imageSentences = imageSentences.slice(0, MAX_SLIDES - 1).concat([imageSentences[imageSentences.length - 1]]);
    imageDurations = imageDurations.slice(0, MAX_SLIDES - 1).concat([extraDuration]);
  }`;
const mergeReplacement = `  if (imageSentences.length > MAX_SLIDES) {
    log(\`QUALITY PATCH: limiting visuals to \${MAX_SLIDES}; preserving beat pacing by splitting overflow across the final visual beats.\`);
    const kept = imageSentences.slice(0, MAX_SLIDES);
    const keptDur = imageDurations.slice(0, MAX_SLIDES);
    const overflowDur = imageDurations.slice(MAX_SLIDES).reduce((a, b) => a + b, 0);
    const share = overflowDur / MAX_SLIDES;
    imageSentences = kept;
    imageDurations = keptDur.map(d => d + share);
  }`;
if (!s.includes(mergeBlock)) throw new Error('quality patch anchor not found: MAX_SLIDES block');
s = s.replace(mergeBlock, mergeReplacement);

// If one visual provider fails for a sentence, do not redistribute that
// sentence's time into a giant survivor. Reuse the nearest successful visual
// instead, preserving the original narration-to-visual timing.
const dropBlock = `  // Drop any sentence whose image totally failed, redistributing its share
  // of time to the remaining successful slides so there's no dead/black gap.
  const imagePaths = [];
  const keptDurations = [];
  for (let i = 0; i < rawImagePaths.length; i++) {
    if (rawImagePaths[i]) {
      imagePaths.push(rawImagePaths[i]);
      keptDurations.push(imageDurations[i]);
    }
  }
  if (imagePaths.length === 0) {
    log('WARNING: every per-sentence image failed — falling back to one generic image for the whole video.');
    const fallbackResult = await fetchImagesWithFallback(FALLBACK_KEYWORDS[category], 1, category, 999);
    imagePaths.push({ path: fallbackResult.paths[0], type: 'image' });
    keptDurations.push(imageDurations.reduce((a, b) => a + b, 0));
  } else {
    // Redistribute any dropped sentences' time proportionally across the survivors.
    const totalKept = keptDurations.reduce((a, b) => a + b, 0);
    const totalIntended = imageDurations.reduce((a, b) => a + b, 0);
    if (totalKept > 0 && totalKept < totalIntended) {
      const scale = totalIntended / totalKept;
      for (let i = 0; i < keptDurations.length; i++) keptDurations[i] *= scale;
    }
  }`;
const dropReplacement = `  // QUALITY PATCH: every narration beat keeps its own visual duration.
  // A failed search reuses the nearest successful visual instead of merging
  // its time into the final slide, which previously produced 20-25s static holds.
  const imagePaths = [];
  const keptDurations = [];
  let lastGood = null;
  for (let i = 0; i < rawImagePaths.length; i++) {
    if (rawImagePaths[i]) {
      lastGood = rawImagePaths[i];
      imagePaths.push(rawImagePaths[i]);
    } else if (lastGood) {
      imagePaths.push({ ...lastGood });
      log(\`QUALITY PATCH: visual failed for beat \${i}; reusing nearest successful visual without changing timing.\`);
    } else {
      // No earlier visual exists; borrow the first later successful visual.
      const later = rawImagePaths.slice(i + 1).find(Boolean);
      if (later) imagePaths.push({ ...later });
      else imagePaths.push(null);
    }
    keptDurations.push(imageDurations[i]);
  }
  if (imagePaths.some(x => !x)) {
    const fallbackResult = await fetchImagesWithFallback(FALLBACK_KEYWORDS[category], 1, category, 999);
    for (let i = 0; i < imagePaths.length; i++) {
      if (!imagePaths[i]) imagePaths[i] = { path: fallbackResult.paths[0], type: 'image' };
    }
  }`;
if (!s.includes(dropBlock)) throw new Error('quality patch anchor not found: image drop block');
s = s.replace(dropBlock, dropReplacement);

// Mark after all edits; idempotence check is the first guard above.
fs.writeFileSync(file, s, 'utf8');
console.log('QUALITY_PATCH_V1 applied successfully.');
