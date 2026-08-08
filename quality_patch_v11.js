const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, 'index.js');
let s = fs.readFileSync(file, 'utf8');

if (s.includes('// QUALITY_PATCH_V11_DIRECT_FACT_SCRIPT')) {
  console.log('QUALITY_PATCH_V11_DIRECT_FACT_SCRIPT already applied.');
  process.exit(0);
}

function replaceFunction(source, marker, newFn, label) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('QUALITY_PATCH_V11: ' + label + ' not found');
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
  if (end < 0) throw new Error('QUALITY_PATCH_V11: ' + label + ' end not found');
  return source.slice(0, start) + newFn + source.slice(end);
}

const factFn = [
'// QUALITY_PATCH_V11_DIRECT_FACT_SCRIPT',
'async function generateNewFactOutline(category, topic, existingOutlines) {',
'  const recent = (existingOutlines || []).slice(-25).map(function(x, i) { return (i + 1) + ". " + x.slice(0, 300); }).join("\\n");',
'  const prompt = [',
'    "You are the research brain of a Telugu Amazing Facts Shorts channel.",',
'    "TOPIC: " + topic,',
'    "CATEGORY: " + category,',
'    "",',
'    "Find ONE real, rare, surprising and well-established fact that most ordinary viewers do not already know.",',
'    "Think like a high-quality search engine answer: give the fact directly, not a story invented around it.",',
'    "Prefer a concrete unusual fact with a clear real-world subject, place, object, animal, science finding, historical detail or human-body detail.",',
'    "",',
'    "STRICT RULES:",',
'    "- One core fact only. One directly supporting detail is allowed.",',
'    "- Never invent or guess dates, numbers, names, locations, causes, mechanisms or examples.",',
'    "- Do not use myths, clickbait claims or disputed trivia as established fact.",',
'    "- Avoid famous recycled facts unless the angle is genuinely different and supported.",',
'    "- If confidence is not high, return UNSURE.",',
'    "",',
'    "USED FACTS. Do not repeat these subjects, claims or near-duplicates:",',
'    recent || "(none)",',
'    "",',
'    "Return exactly:",',
'    "FACT: one concise factual claim in Telugu",',
'    "DETAIL: one concise supporting detail in Telugu, or NONE",',
'    "Nothing else."',',',
'  ].join("\\n");',
'  const raw = (await callLLM(prompt)).trim();',
'  if (/\\bUNSURE\\b/i.test(raw)) return null;',
'  if (!/^FACT\\s*:/mi.test(raw) || !/^DETAIL\\s*:/mi.test(raw)) return null;',
'  return raw;',
'}'
].join('\n');

const verifyFn = [
'async function verifyFactOutline(outline) {',
'  const prompt = [',
'    "You are a strict fact checker. Evaluate only the candidate below.",',
'    "CANDIDATE:",',
'    outline,',
'    "",',
'    "VERIFIED only when the central claim is well-established and safe to publish.",',
'    "Reject myths, unsupported causation, doubtful numbers, doubtful names, exaggerated wording and claims that merely sound viral.",',
'    "",',
'    "Return exactly two lines:",',
'    "ACCURACY: VERIFIED or REJECTED",',
'    "SCORE: 0-100"',',',
'  ].join("\\n");',
'  const raw = await callLLM(prompt);',
'  const verified = /ACCURACY\\s*:\\s*VERIFIED/i.test(raw);',
'  const m = raw.match(/SCORE\\s*:\\s*(\\d+)/i);',
'  const score = m ? Math.max(0, Math.min(100, parseInt(m[1], 10))) : 0;',
'  log("  Fact verification: " + (verified ? "VERIFIED" : "REJECTED") + " | Quality score: " + score + "/100");',
'  return { verified: verified, score: score };',
'}'
].join('\n');

const growFn = [
'async function getOrGrowFactOutline(category, discoveredFacts, usedTopics) {',
'  const previous = (discoveredFacts && discoveredFacts[category]) || [];',
'  const used = (usedTopics && usedTopics[category]) || [];',
'  const attempts = 5;',
'  const minimum = 78;',
'  let best = null;',
'  function tokens(text) { return String(text || "").toLowerCase().replace(/[^\\p{L}\\p{N}\\s]/gu, " ").split(/\\s+/).filter(function(w) { return w.length >= 3; }); }',
'  function duplicate(candidate, oldList) {',
'    const a = new Set(tokens(candidate));',
'    return oldList.some(function(old) {',
'      const b = new Set(tokens(old));',
'      if (!a.size || !b.size) return false;',
'      let overlap = 0; a.forEach(function(t) { if (b.has(t)) overlap++; });',
'      return overlap / Math.max(1, Math.min(a.size, b.size)) >= 0.68;',
'    });',
'  }',
'  for (let i = 1; i <= attempts; i++) {',
'    const topic = pickTopic(category, used);',
'    log("Attempting fresh rare fact for " + category + " / " + topic + " (" + i + "/" + attempts + ")...");',
'    try {',
'      const outline = await generateNewFactOutline(category, topic, previous);',
'      if (!outline) { log("  Candidate unavailable/UNSURE — trying another topic."); continue; }',
'      if (duplicate(outline, previous)) { log("  Duplicate or near-duplicate fact — rejecting."); continue; }',
'      const checked = await verifyFactOutline(outline);',
'      if (!checked.verified) continue;',
'      const candidate = { outline: outline, topic: topic, score: checked.score };',
'      if (!best || candidate.score > best.score) best = candidate;',
'      if (candidate.score >= minimum) return { outline: candidate.outline, newlyDiscovered: candidate.outline, topic: candidate.topic };',
'    } catch (e) { log("  WARNING: fact attempt failed: " + e.message); }',
'  }',
'  if (best && best.score >= 75) return { outline: best.outline, newlyDiscovered: best.outline, topic: best.topic };',
'  throw new Error("No sufficiently strong verified fact found after " + attempts + " attempts.");',
'}'
].join('\n');

const contentFn = [
'// QUALITY_PATCH_V11_DIRECT_FACT_SCRIPT',
'async function generateContent(category, recentTitles, outline, ctaSentence) {',
'  log("Generating " + category + " FINAL DIRECT FACT SCRIPT...");',
'  const recent = (recentTitles || []).slice(-15).join(" | ") || "(none)";',
'  const prompt = [',
'    "Write ONLY the final spoken narration for a Telugu Amazing Facts YouTube Short.",',
'    "",',
'    "VERIFIED FACT — ONLY SOURCE OF TRUTH:",',
'    outline,',
'    "",',
'    "RECENT TITLES — do not repeat their subject, wording or angle:",',
'    recent,',
'    "",',
'    "TARGET STYLE:",',
'    "- Natural spoken Telugu, like a sharp creator telling one surprising fact to a friend.",',
'    "- Emotional curiosity is okay; do not add fake drama.",',
'    "- Hook first, then one curiosity question, then clear reveal, then the strongest supporting detail, then a memorable ending.",',
'    "- 8-12 short lines, about 70-100 Telugu words.",',
'    "- Every line must sound natural when spoken aloud.",',
'    "- Never output one-word or fragment-only lines.",',
'    "- Use ... only for genuine suspense, normally 1-2 times.",',
'    "- Do not repeat the same fact just to increase length.",',
'    "- Do not add outside facts, comparisons, examples, causes or consequences not present in the verified fact.",',
'    "- No title, CTA, labels, markdown, JSON or explanation.",',
'    "- Telugu script. Write essential numbers naturally in Telugu words, not digit-by-digit ASCII numbers.",',
'    "- Never strengthen may/can/some/about into always/all/exactly.",',
'    "",',
'    "Return ONLY narration text."',',',
'  ].join("\\n");',
'  let script = (await callLLM(prompt)).trim();',
'  script = script.replace(new RegExp("<think>[\\\\s\\\\S]*?<\\/think>", "gi"), "").trim();',
'  script = script.replace(/^```(?:text|telugu)?\\s*/i, "").replace(/```$/i, "").trim();',
'  script = script.replace(/^(?:TITLE|SCRIPT|NARRATION)\\s*:\\s*/i, "").trim();',
'  if (typeof normalizeTeluguNumbers === "function") script = normalizeTeluguNumbers(script);',
'  script = splitIntoSentences(script).filter(function(x) { return !/సబ్.?స్క్రైబ్|subscribe/i.test(x); }).join("\\n").trim();',
'  const wc = script.split(/\\s+/).filter(Boolean).length;',
'  const lines = script.split(/\\r?\\n/).map(function(x) { return x.trim(); }).filter(Boolean);',
'  if (wc < 55 || lines.length < 7) throw new Error("Final script too short: " + wc + " words / " + lines.length + " lines.");',
'  if (wc > 115) throw new Error("Final script too long: " + wc + " words.");',
'  const first = lines[0] || "అసలు విషయం ఏంటో తెలుసా?";',
'  const titleWords = first.replace(/[!?…]+/g, "").trim().split(/\\s+/).filter(Boolean).slice(0, 8);',
'  const title = (titleWords.join(" ") || "ఒక ఆశ్చర్యకరమైన నిజం") + " " + (CATEGORY_EMOJI[category] || "🤯");',
'  const hookEmoji = first + " " + (CATEGORY_EMOJI[category] || "🤯");',
'  const keywords = FALLBACK_KEYWORDS[category] || "rare amazing fact curiosity";',
'  log("Title: " + title);',
'  log("Script (" + wc + " words): " + script);',
'  return { title: title, keywords: keywords, hookEmoji: hookEmoji, script: script };',
'}'
].join('\n');

s = replaceFunction(s, 'async function generateNewFactOutline(', factFn, 'generateNewFactOutline');
s = replaceFunction(s, 'async function verifyFactOutline(', verifyFn, 'verifyFactOutline');
s = replaceFunction(s, 'async function getOrGrowFactOutline(', growFn, 'getOrGrowFactOutline');
s = replaceFunction(s, 'async function generateContent(', contentFn, 'generateContent');

try {
  new vm.Script(s, { filename: file });
} catch (err) {
  throw new Error('QUALITY_PATCH_V11: generated index.js failed syntax validation: ' + err.message);
}

fs.writeFileSync(file, s, 'utf8');
console.log('QUALITY_PATCH_V11_DIRECT_FACT_SCRIPT applied successfully.');