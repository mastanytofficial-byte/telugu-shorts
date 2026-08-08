const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, 'index.js');
let s = fs.readFileSync(file, 'utf8');

if (s.includes('// QUALITY_PATCH_V9_DIRECT_FACT_SCRIPT')) {
  console.log('QUALITY_PATCH_V9_DIRECT_FACT_SCRIPT already applied.');
  process.exit(0);
}

function replaceFunction(source, marker, newFn, label) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('QUALITY_PATCH_V9: ' + label + ' not found');
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
  if (end < 0) throw new Error('QUALITY_PATCH_V9: ' + label + ' end not found');
  return source.slice(0, start) + newFn + source.slice(end);
}

const directFactFn = String.raw`// QUALITY_PATCH_V9_DIRECT_FACT_SCRIPT
async function generateNewFactOutline(category, topic, existingOutlines) {
  const recent = existingOutlines.slice(-18).map(function(x, i) { return (i + 1) + ". " + x.slice(0, 220); }).join("\\n");
  const prompt = [
    "You are the FACT RESEARCHER for a Telugu Amazing Facts Shorts channel.",
    "",
    "TOPIC AREA: " + topic,
    "CATEGORY: " + category,
    "",
    "Find ONE lesser-known, genuinely interesting fact inside this topic that is well-established and safe to state.",
    "",
    "HARD RULES:",
    "- Do not give the obvious textbook fact if a more specific lesser-known fact is available.",
    "- Prefer one surprising specific detail ordinary people are unlikely to know.",
    "- Do not invent numbers, dates, names, places, mechanisms, chemical concentrations, historical events, or causal explanations.",
    "- If an exact number is not certain, omit the number.",
    "- Do not turn association into causation.",
    "- Do not turn can/may/some into always/all.",
    "- Avoid recycled internet trivia and famous facts that appear everywhere.",
    "- One core fact only. A small supporting detail is allowed only if it belongs directly to that same fact.",
    "- If you genuinely cannot give a high-confidence fact, return UNSURE.",
    "",
    "ALREADY USED FACTS — DO NOT REPEAT OR REPHRASE:",
    recent || "(none)",
    "",
    "Return exactly:",
    "FACT: one concise factual claim in Telugu",
    "DETAIL: one short supporting detail, only if strongly established",
    "",
    "Nothing else."
  ].join("\\n");
  const raw = (await callLLM(prompt)).trim();
  if (/\\bUNSURE\\b/i.test(raw)) return null;
  if (!/^FACT\\s*:/mi.test(raw) || !/^DETAIL\\s*:/mi.test(raw)) return null;
  return raw;
}
`;

const verifyFn = String.raw`async function verifyFactOutline(outline) {
  const prompt = [
    "You are a strict fact-checker for a Telugu facts channel.",
    "",
    "CANDIDATE:",
    outline,
    "",
    "Accept only if the claim is safe to publish as factual knowledge without outside assumptions.",
    "REJECT if a specific number/date/name is doubtful, wording overclaims what is known, a causal explanation is unsupported, the claim is a common myth presented as fact, or the claim is too vague to evaluate.",
    "",
    "Return exactly:",
    "ACCURACY: VERIFIED or REJECTED",
    "SCORE: 0-100"
  ].join("\\n");
  const raw = await callLLM(prompt);
  const verified = /ACCURACY:\\s*VERIFIED/i.test(raw);
  const match = raw.match(/SCORE:\\s*(\\d+)/i);
  const score = match ? Math.max(0, Math.min(100, parseInt(match[1], 10))) : 0;
  log("  Fact self-verification: " + (verified ? "VERIFIED ✅" : "REJECTED ❌") + " | Quality score: " + score + "/100");
  return { verified, score };
}
`;

const growFn = String.raw`async function getOrGrowFactOutline(category, discoveredFacts, usedTopics) {
  const previous = (discoveredFacts && discoveredFacts[category]) || [];
  const used = (usedTopics && usedTopics[category]) || [];
  const maxAttempts = 4;
  const scoreBar = 75;
  let best = null;
  const candidates = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const topic = pickTopic(category, used.concat(candidates.map(function(c) { return c.topic; })));
    log("Attempting a fresh high-quality fact for \"" + category + "\" / \"" + topic + "\" (attempt " + attempt + "/" + maxAttempts + ")...");
    try {
      const outline = await generateNewFactOutline(category, topic, previous.concat(candidates.map(function(c) { return c.outline; })));
      if (!outline) { log("  Candidate generation returned UNSURE/malformed — trying another topic."); continue; }

      const normalize = function(text) {
        return text.toLowerCase().replace(/[^\\p{L}\\p{N}\\s]/gu, " ").split(/\\s+/).filter(function(w) { return w.length >= 3; }).slice(0, 80);
      };
      const currentTokens = new Set(normalize(outline));
      const tooSimilar = previous.concat(candidates.map(function(c) { return c.outline; })).some(function(old) {
        const oldTokens = new Set(normalize(old));
        if (!currentTokens.size || !oldTokens.size) return false;
        let overlap = 0;
        currentTokens.forEach(function(t) { if (oldTokens.has(t)) overlap++; });
        return overlap / Math.max(1, Math.min(currentTokens.size, oldTokens.size)) >= 0.72;
      });
      if (tooSimilar) { log("  Duplicate/near-duplicate fact detected — rejecting."); continue; }

      const checked = await verifyFactOutline(outline);
      if (!checked.verified) continue;
      candidates.push({ outline: outline, topic: topic, score: checked.score });
      if (!best || checked.score > best.score) best = { outline: outline, topic: topic, score: checked.score };
      if (checked.score >= scoreBar) return { outline: outline, newlyDiscovered: outline, topic: topic };
      log("  Verified but below " + scoreBar + "; trying another fact.");
    } catch (e) { log("  WARNING: fact attempt " + attempt + " failed (" + e.message + ")."); }
  }

  if (best && best.score >= 72) {
    log("  No " + scoreBar + "+ candidate found; using strongest verified candidate (" + best.score + "/100).");
    return { outline: best.outline, newlyDiscovered: best.outline, topic: best.topic };
  }
  throw new Error("No sufficiently strong verified fact found for " + category + " after " + maxAttempts + " attempts.");
}
`;

const contentFn = String.raw`async function generateContent(category, recentTitles, outline, ctaSentence) {
  log("Generating " + category + " content with DIRECT_FACT_SCRIPT pipeline...");
  const recentTitlesText = recentTitles.slice(-10).join(" | ") || "(none)";
  const prompt = [
    "Write the FINAL spoken narration for a Telugu Amazing Facts YouTube Short.",
    "",
    "VERIFIED FACT — ONLY SOURCE OF TRUTH:",
    outline,
    "",
    "RECENT VIDEO TITLES — do not repeat their subject, wording, or angle:",
    recentTitlesText,
    "",
    "STYLE:",
    "- Sound like a sharp Telugu creator telling one amazing fact to a friend.",
    "- Natural spoken Telugu, not textbook Telugu, not translated English, not a news report.",
    "- Hook with a surprising question or statement.",
    "- Build one natural curiosity question, then reveal the fact clearly.",
    "- Give only the strongest supported detail from the verified fact.",
    "- Finish with a memorable fact-specific takeaway.",
    "- 9-14 short spoken lines, about 80-110 Telugu words.",
    "- One complete thought per line; never create fragments like 'అది.', 'రహస్యం.', 'కానీ.'.",
    "- Use '...' only for genuine suspense, normally no more than 2-3 times.",
    "- Do not force comparisons, personal stories, family examples, Indian examples, or emotional drama.",
    "- Do not repeat the same fact in different wording just to increase length.",
    "- No CTA, title, labels, markdown, or JSON.",
    "- Telugu script. Avoid ASCII digits; if a number is essential, write it naturally in Telugu words.",
    "- Never invent a date, number, name, location, cause, mechanism, example, quote, or consequence.",
    "- Never strengthen may/can/some/about into always/all/exactly.",
    "",
    "GOOD SHAPE:",
    "Hook → curiosity → clear reveal → strongest supported detail → memorable ending.",
    "",
    "Return ONLY the narration text."
  ].join("\\n");

  let script = (await callLLM(prompt)).trim();
  script = script.replace(/<think>[\\s\\S]*?<\\/think>/gi, '').replace(/^```(?:text|telugu)?\\s*/i, '').replace(/```$/i, '').trim();
  script = script.replace(/^(?:TITLE|SCRIPT|NARRATION)\\s*:\\s*/i, '').trim();
  if (typeof normalizeTeluguNumbers === 'function') script = normalizeTeluguNumbers(script);
  script = ensureSentenceBreaks(script);
  script = splitIntoSentences(script).filter(function(x) { return !/సబ్.?స్క్రైబ్|subscribe/i.test(x); }).join("\\n").trim();

  const wc = script.split(/\\s+/).filter(Boolean).length;
  const lines = script.split(/\\r?\\n/).map(function(x) { return x.trim(); }).filter(Boolean);
  if (wc < 55 || lines.length < 8) throw new Error("Direct narration too short (" + wc + " words, " + lines.length + " lines).");
  if (wc > 125) throw new Error("Direct narration too long (" + wc + " words).");

  const first = lines[0] || "అసలు విషయం ఏంటో తెలుసా?";
  const titleWords = first.replace(/[!?…]+/g, '').trim().split(/\\s+/).filter(Boolean).slice(0, 8);
  const title = (titleWords.join(" ") || "ఒక ఆశ్చర్యకరమైన నిజం") + " " + (CATEGORY_EMOJI[category] || "🤯");
  const hookEmoji = first + " " + (CATEGORY_EMOJI[category] || "🤯");
  const keywords = FALLBACK_KEYWORDS[category] || "amazing fact curiosity science";
  log("Title: " + title);
  log("Keywords: " + keywords);
  log("Hook emoji line: " + hookEmoji);
  log("Script (" + wc + " words, " + script.length + " chars): " + script);
  return { title: title, keywords: keywords, hookEmoji: hookEmoji, script: script };
}
`;

const ensureFn = String.raw`function ensureSentenceBreaks(text, maxLen = 140) {
  const ELLIPSIS_PLACEHOLDER = '\\u0001E\\u0001';
  const DECIMAL_PLACEHOLDER = '\\u0001D\\u0001';
  let protectedText = text.replace(/\\.\\.\\./g, ELLIPSIS_PLACEHOLDER);
  protectedText = protectedText.replace(/(\\d)\\.(\\d)/g, '$1' + DECIMAL_PLACEHOLDER + '$2');
  const parts = protectedText.split(/(?<=\\.)\\s*|\\n+/);
  const fixed = [];
  for (let part of parts) {
    while (part.length > maxLen) {
      let cut = part.lastIndexOf(',', maxLen);
      if (cut === -1) cut = part.lastIndexOf(' ', maxLen);
      if (cut === -1) cut = maxLen;
      const before = part.slice(0, cut).replace(/,\\s*$/, '').trim();
      fixed.push(before + '.');
      part = part.slice(cut + 1).trim();
    }
    if (part) fixed.push(part);
  }
  return fixed.join('\\n').replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').split(ELLIPSIS_PLACEHOLDER).join('...').split(DECIMAL_PLACEHOLDER).join('.').trim();
}
`;

s = replaceFunction(s, 'async function generateNewFactOutline(', directFactFn, 'generateNewFactOutline');
s = replaceFunction(s, 'async function verifyFactOutline(', verifyFn, 'verifyFactOutline');
s = replaceFunction(s, 'async function getOrGrowFactOutline(', growFn, 'getOrGrowFactOutline');
s = replaceFunction(s, 'async function generateContent(', contentFn, 'generateContent');
s = replaceFunction(s, 'function ensureSentenceBreaks(', ensureFn, 'ensureSentenceBreaks');

try { new vm.Script(s, { filename: file }); }
catch (err) { throw new Error('QUALITY_PATCH_V9: generated index.js failed syntax validation: ' + err.message); }

fs.writeFileSync(file, s, 'utf8');
console.log('QUALITY_PATCH_V9_DIRECT_FACT_SCRIPT applied successfully.');
