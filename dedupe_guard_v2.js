const fs = require('fs');
const FILE = 'index.js';
const source = fs.readFileSync(FILE, 'utf8');
const MARK = '/* DEDUPE_GUARD_V2_APPLIED */';
if (source.includes(MARK)) {
  console.log('DEDUPE_GUARD_V2: already applied.');
  process.exit(0);
}

const helpers = `
${MARK}
// ===== DEDUPE GUARD V2 =====
function dedupeNormalize(value) {
  return String(value || '').toLowerCase().normalize('NFKC').replace(/[\\p{P}\\p{S}\\s]+/gu, '').trim();
}
function dedupeTokens(value) {
  return String(value || '').toLowerCase().normalize('NFKC').replace(/[^\\p{L}\\p{N}]+/gu, ' ').split(/\\s+/).filter(Boolean);
}
function dedupeSimilarity(a, b) {
  const A = new Set(dedupeTokens(a)); const B = new Set(dedupeTokens(b));
  if (!A.size || !B.size) return 0;
  let intersection = 0; for (const x of A) if (B.has(x)) intersection++;
  return intersection / (A.size + B.size - intersection);
}
function isDuplicateAgainst(history, candidate, threshold = 0.72) {
  const c = dedupeNormalize(candidate); if (!c) return false;
  for (const old of (history || [])) {
    if (dedupeNormalize(old) === c) return true;
    if (dedupeSimilarity(candidate, old) >= threshold) return true;
  }
  return false;
}
function appendPersistentScriptHistory(script) {
  const raw = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
  raw.discoveredFacts = raw.discoveredFacts || {};
  raw.discoveredFacts.__scripts = Array.isArray(raw.discoveredFacts.__scripts) ? raw.discoveredFacts.__scripts : [];
  raw.discoveredFacts.__scripts.push(script);
  if (raw.discoveredFacts.__scripts.length > 1000) raw.discoveredFacts.__scripts = raw.discoveredFacts.__scripts.slice(-1000);
  fs.writeFileSync(STATE_FILE, JSON.stringify(raw, null, 2));
}
async function generateUniqueContent(category, usedTitles, outline, ctaSentence) {
  const state = loadState();
  const previousScripts = (state.discoveredFacts && state.discoveredFacts.__scripts) || [];
  for (let attempt = 1; attempt <= 5; attempt++) {
    const nonce = attempt === 1 ? '' : '\\n\\nDUPLICATE-PREVENTION RETRY ' + attempt + ': ముందు వచ్చిన narration structure, opening rhythm, wording, comparison, twist మరియు ending pattern ఏదీ పునరావృతం చేయకు. పూర్తిగా కొత్త phrasing మరియు delivery pattern వాడు.';
    const result = await generateContent(category, [...usedTitles, nonce], outline, ctaSentence);
    const titleDuplicate = isDuplicateAgainst(usedTitles, result.title, 0.82);
    const scriptDuplicate = isDuplicateAgainst(previousScripts, result.script, 0.68);
    if (!titleDuplicate && !scriptDuplicate) {
      appendPersistentScriptHistory(result.script);
      log('  DEDUPE: unique title + narration confirmed (attempt ' + attempt + '/5).');
      return result;
    }
    log('  DEDUPE: duplicate/near-duplicate detected (title=' + titleDuplicate + ', script=' + scriptDuplicate + ') — regenerating (' + attempt + '/5).');
  }
  throw new Error('Duplicate-prevention guard rejected all generated narration attempts. No duplicate content will be uploaded.');
}
`;

let patched = source;
const pickTopicOld = `  const unused = topics.filter(t => !usedTopicsForCategory.includes(t));\n  const pool = unused.length > 0 ? unused : topics; // all used at least once — cycle again\n  const topic = pool[Math.floor(Math.random() * pool.length)];`;
const pickTopicNew = `  const unused = topics.filter(t => !usedTopicsForCategory.includes(t));\n  if (unused.length === 0) {\n    throw new Error(\`No unused topic remains in category "\${category}". Duplicate-prevention requires a genuinely new topic before this category can be used again.\`);\n  }\n  const topic = unused[Math.floor(Math.random() * unused.length)];`;
if (!patched.includes(pickTopicOld)) throw new Error('DEDUPE_V2: pickTopic anchor not found');
patched = patched.replace(pickTopicOld, pickTopicNew);

const outlineReturnOld = `  return trimmed;\n}\n\n// Independent second pass:`;
const outlineReturnNew = `  if (isDuplicateAgainst(existingOutlines || [], trimmed, 0.68)) {\n    log('  DEDUPE: generated outline is an exact/near duplicate of an existing fact — rejecting it.');\n    return null;\n  }\n  return trimmed;\n}\n\n// Independent second pass:`;
if (!patched.includes(outlineReturnOld)) throw new Error('DEDUPE_V2: outline return anchor not found');
patched = patched.replace(outlineReturnOld, outlineReturnNew);

const titleTrimOld = `  if (newTitles.length > 50) newTitles = newTitles.slice(-50);`;
const titleTrimNew = `  if (newTitles.length > 1000) newTitles = newTitles.slice(-1000);`;
if (!patched.includes(titleTrimOld)) throw new Error('DEDUPE_V2: title-history anchor not found');
patched = patched.replace(titleTrimOld, titleTrimNew);

const mainCallOld = `  const { title, hookEmoji, script } = await generateContent(category, usedTitles, outline, ctaSentence);`;
const mainCallNew = `  const { title, hookEmoji, script } = await generateUniqueContent(category, usedTitles, outline, ctaSentence);`;
if (!patched.includes(mainCallOld)) throw new Error('DEDUPE_V2: generateContent call anchor not found');
patched = patched.replace(mainCallOld, mainCallNew);

const mainAnchor = `async function main() {`;
if (!patched.includes(mainAnchor)) throw new Error('DEDUPE_V2: main anchor not found');
patched = patched.replace(mainAnchor, helpers + mainAnchor);
fs.writeFileSync(FILE, patched, 'utf8');
console.log('DEDUPE_GUARD_V2: strict category-cycle + topic + outline + title + narration duplicate prevention applied successfully.');
