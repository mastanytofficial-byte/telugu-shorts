const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'index.js');
let s = fs.readFileSync(file, 'utf8');

if (s.includes('// QUALITY_PATCH_V7_VISUALS')) {
  console.log('QUALITY_PATCH_V7_VISUALS already applied.');
  process.exit(0);
}

function replaceFunction(source, marker, newFn, label) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('QUALITY_PATCH_V7: ' + label + ' not found');
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
  if (end < 0) throw new Error('QUALITY_PATCH_V7: ' + label + ' end not found');
  return source.slice(0, start) + newFn + source.slice(end);
}

const visualFn = String.raw`// QUALITY_PATCH_V7_VISUALS
async function getSentenceKeywords(sentences, outline) {
  const numbered = sentences.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const outlineContext = outline ? `\n\nVERIFIED SOURCE FACT — VISUALS MUST NOT GO BEYOND THIS:\n${outline}` : '';
  const prompt = [
    'Create documentary-style visual search keywords and AI-image scene descriptions for a Telugu Amazing Facts Short.',
    '',
    'CRITICAL: the verified source fact is the only factual source. A visual must depict only an object, place, person, action, or process explicitly supported by the source fact or by the exact sentence. Never invent a historical event, scientific mechanism, measurement, costume, location, person, laboratory scene, military scene, or causal action just to make the image interesting.',
    'If a sentence is abstract, use a truthful concept visualization or a neutral close-up of the verified subject. Do not manufacture a literal event.',
    'If a historical event is not explicitly documented in the source, show the verified artifact/place/object or a neutral reconstruction labelled by wording as a reconstruction; do not show people performing an invented action.',
    'If a location or culture is explicitly present in the source, preserve it. If it is not present, do NOT force an Indian/South Indian background and do not guess a country.',
    '',
    'SUBJECT: one precise recurring English subject from the verified fact. Do not add attributes not supported by the fact.',
    'KEYWORDS: each sentence gets 3-5 concrete English search words for real Pexels footage. Prefer the exact verified object/place/species/process. Avoid abstract words.',
    'SCENES: each sentence gets a 15-25 word realistic English scene description. Every noun/action in the scene must be traceable to the verified fact or sentence.',
    'Never use invented numbers, dates, labels, brands, uniforms, equipment, chemical structures, scientific diagrams, or named people unless explicitly supported by the source.',
    'Do not visualize the narrator metaphor literally. For example, if the script says “salary came from salt”, do not show Roman soldiers being paid salt unless the verified fact explicitly establishes that event.',
    '',
    'VERIFIED SOURCE FACT:',
    outline || '(none)',
    '',
    'SENTENCES:',
    numbered,
    '',
    'Return exactly this format and nothing else:',
    'SUBJECT:',
    '1. subject',
    '',
    'KEYWORDS:',
    '1. keyword phrase',
    '2. keyword phrase',
    '...',
    '',
    'SCENES:',
    '1. scene description',
    '2. scene description',
    '...'
  ].join('\n');

  const raw = await callLLM(prompt);
  log(`Raw sentence-keywords/scenes response from Groq:\n${raw}`);
  const character = parseNumberedSection(raw, 'SUBJECT:', 1)[0];
  const keywords = parseNumberedSection(raw, 'KEYWORDS:', sentences.length);
  const scenes = parseNumberedSection(raw, 'SCENES:', sentences.length);
  log(`  main character: ${character || '(none parsed)'}`);
  sentences.forEach((_, i) => {
    log(`  sentence ${i} keyword: ${keywords[i] || '(none — fallback)'} | scene: ${scenes[i] ? scenes[i].slice(0, 50) + '...' : '(none — will use keyword)'}`);
  });
  return { character, keywords, scenes };
}
`;

s = replaceFunction(s, 'async function getSentenceKeywords(sentences, outline) {', visualFn, 'getSentenceKeywords');
fs.writeFileSync(file, s, 'utf8');
console.log('QUALITY_PATCH_V7_VISUALS applied successfully.');
