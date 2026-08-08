const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, 'index.js');
let s = fs.readFileSync(file, 'utf8');

if (s.includes('// QUALITY_PATCH_V10_DIRECT_FACT_SCRIPT')) {
  console.log('QUALITY_PATCH_V10_DIRECT_FACT_SCRIPT already applied.');
  process.exit(0);
}

function replaceFunction(source, marker, newFn, label) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('QUALITY_PATCH_V10: ' + label + ' not found');
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
  if (end < 0) throw new Error('QUALITY_PATCH_V10: ' + label + ' end not found');
  return source.slice(0, start) + newFn + source.slice(end);
}

const directFactFn = String.raw`// QUALITY_PATCH_V10_DIRECT_FACT_SCRIPT
async function generateNewFactOutline(category, topic, existingOutlines) {
  const recent = existingOutlines.slice(-20).map(function(x, i) {
    return (i + 1) + ". " + x.slice(0, 260);
  }).join("\\n");

  const prompt = [
    "You are the fact researcher for a Telugu Amazing Facts Shorts channel.",
    "TOPIC: " + topic,
    "CATEGORY: " + category,
    "",
    "Find ONE genuinely interesting, lesser-known, well-established fact about this topic.",
    "The fact must be safe to state as factual knowledge without guessing.",
    "",
    "RULES:",
    "- Prefer a specific surprising detail over an obvious textbook fact.",
    "- One core fact only; one directly related supporting detail is allowed.",
    "- Do not invent or guess numbers, dates, names, places, mechanisms, causes, measurements or historical details.",
    "- If an exact number is uncertain, omit it.",
    "- Do not turn may/can/some/about into always/all/exactly.",
    "- Avoid common viral trivia and recycled famous facts when a better fact is known.",
    "- Do not use a myth, exaggeration or disputed claim as fact.",
    "- If you cannot confidently produce a good fact, return UNSURE.",
    "",
    "ALREADY USED FACTS. Do not repeat these facts or merely rewrite them:",
    recent || "(none)",
    "",
    "Return exactly two lines:",
    "FACT: one concise factual claim in Telugu",
    "DETAIL: one concise supporting detail in Telugu, or NONE",
    "Nothing else."
  ].join("\\n");

  const raw = (await callLLM(prompt)).trim();
  if (/\\bUNSURE\\b/i.test(raw)) return null;
  if (!/^FACT\\s*:/mi.test(raw)) return null;
  if (!/^DETAIL\\s*:/mi.test(raw)) return null;
  return raw;
}
`;

const verifyFn = String.raw`async function verifyFactOutline(outline) {
  const prompt = [
    "You are a strict fact-checker for a Telugu facts channel.",
    "CANDIDATE FACT:",
    outline,
    "",
    "Accept only if the central claim is well-established and safe to publish.",
    "Reject if any important number/date/name is doubtful, the wording overclaims the evidence, a causal explanation is unsupported, the claim is a common myth, or the claim is too vague to verify.",
    "Do not reward a fact merely because it sounds surprising.",
    "",
    "Return exactly:",
    "ACCURACY: VERIFIED or REJECTED",
    "SCORE: 0-100"
  ].join("\\n");

  const raw = await callLLM(prompt);
  const verified = /ACCURACY:\\s*VERIFIED/i.test(raw);
  const match = raw.match(/SCORE:\\s*(\\d+)/i);
  const score = match ? Math.max(0, Math.min(100, parseInt(match[1], 10))) : 0;
  log("  Fact verification: " + (verified ? "VERIFIED" : "REJECTED") + " | Quality score: " + score + "/100");
  return { verified: verified, score: score };
}
`;

const growFn = String.raw`async function getOrGrowFactOutline(category, discoveredFacts, usedTopics) {
  const previous = (discoveredFacts && discoveredFacts[category]) || [];
  const used = (usedTopics && usedTopics[category]) || [];
  const maxAttempts = 5;
  const scoreBar = 78;
  let best = null;
  const candidates = [];

  function tokens(text) {
    return text.toLowerCase().replace(/[^\\p{L}\\p{N}\\s]/gu, " ").split(/\\s+/).filter(function(w) { return w.length >= 3; });
  }

  function isDuplicate(candidate, oldList) {
    const a = new Set(tokens(candidate));
    return oldList.some(function(old) {
      const b = new Set(tokens(old));
      if (!a.size || !b.size) return false;
      let overlap = 0;
      a.forEach(function(t) { if (b.has(t)) overlap++; });
      const ratio = overlap / Math.max(1, Math.min(a.size, b.size));
      return ratio >= 0.68;
    });
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const topic = pickTopic(category, used.concat(candidates.map(function(c) { return c.topic; })));
    log("Attempting fresh fact for " + category + " / " + topic + " (" + attempt + "/" + maxAttempts + ")...");
    try {
      const outline = await generateNewFactOutline(category, topic, previous.concat(candidates.map(function(c) { return c.outline; })));
      if (!outline) { log("  Candidate unavailable/UNSURE — trying another topic."); continue; }
      if (isDuplicate(outline, previous.concat(candidates.map(function(c) { return c.outline; })))) {
        log("  Duplicate or near-duplicate fact — rejecting.");
        continue;
      }

      const checked = await verifyFactOutline(outline);
      if (!checked.verified) continue;
      const candidate = { outline: outline, topic: topic, score: checked.score };
      candidates.push(candidate);
      if (!best || candidate.score > best.score) best = candidate;
      if (candidate.score >= scoreBar) {
        return { outline: candidate.outline, newlyDiscovered: candidate.outline, topic: candidate.topic };
      }
      log("  Verified but below " + scoreBar + "; trying another candidate.");
    } catch (e) {
      log("  WARNING: fact attempt failed: " + e.message);
    }
  }

  if (best && best.score >= 75) {
    log("  Using strongest verified candidate: " + best.score + "/100");
    return { outline: best.outline, newlyDiscovered: best.outline, topic: best.topic };
  }
  throw new Error("No sufficiently strong verified fact found after " + maxAttempts + " attempts.");
}
`;

const contentFn = String.raw`async function generateContent(category, recentTitles, outline, ctaSentence) {
  log("Generating " + category + " FINAL DIRECT FACT SCRIPT...");
  const recentTitlesText = recentTitles.slice(-15).join(" | ") || "(none)";

  const prompt = [
    "Write the FINAL spoken narration for a Telugu Amazing Facts YouTube Short.",
    "",
    "VERIFIED FACT — THIS IS THE ONLY SOURCE OF TRUTH:",
    outline,
    "",
    "RECENT TITLES — avoid repeating their subject, wording or angle:",
    recentTitlesText,
    "",
    "STYLE:",
    "- Natural spoken Telugu, like a smart creator telling one surprising fact to a friend.",
    "- Not textbook Telugu, not translated English, not a news report.",
    "- Start with a strong curiosity hook.",
    "- Build one natural question and then reveal the fact clearly.",
    "- Use only information contained in the verified fact. Do not add outside facts.",
    "- Do not repeat the same fact in different wording.",
    "- End with the strongest memorable point from the same fact.",
    "- 8-12 short natural lines, roughly 70-100 Telugu words.",
    "- Every line must be a complete natural thought. Never output fragments such as 'అది.', 'రహస్యం.', 'కానీ.'.",
    "- Use ... only when it creates genuine suspense, at most 2 times.",
    "- Do not force comparisons, personal stories, emotional drama or generic morals.",
    "- No CTA, title, labels, markdown, JSON or English explanation.",
    "- Telugu script. If a number is essential, write it in Telugu words.",
    "- Never invent or strengthen a number, date, name, cause, mechanism, example, location or consequence.",
    "",
    "STRUCTURE: hook -> curiosity -> reveal -> strongest detail -> memorable ending.",
    "",
    "Return ONLY the narration text."
  ].join("\\n");

  let script = (await callLLM(prompt)).trim();
  script = script.replace(/<think>[\\s\\S]*?<\\/think>/gi, '').replace(/^```(?:text|telugu)?\\s*/i, '').replace(/```$/i, '').trim();
  script = script.replace(/^(?:TITLE|SCRIPT|NARRATION)\\s*:\\s*/i, '').trim();
  if (typeof normalizeTeluguNumbers === 'function') script = normalizeTeluguNumbers(script);
  script = splitIntoSentences(script).filter(function(x) {
    return !/సబ్.?స్క్రైబ్|subscribe/i.test(x);
  }).join("\\n").trim();

  const wc = script.split(/\\s+/).filter(Boolean).length;
  const lines = script.split(/\\r?\\n/).map(function(x) { return x.trim(); }).filter(Boolean);
  if (wc < 55 || lines.length < 7) throw new Error("Final script too short: " + wc + " words / " + lines.length + " lines.");
  if (wc > 115) throw new Error("Final script too long: " + wc + " words.");

  const first = lines[0] || "అసలు విషయం ఏంటో తెలుసా?";
  const titleWords = first.replace(/[!?…]+/g, '').trim().split(/\\s+/).filter(Boolean).slice(0, 8);
  const title = (titleWords.join(" ") || "ఒక ఆశ్చర్యకరమైన నిజం") + " " + (CATEGORY_EMOJI[category] || "🤯");
  const hookEmoji = first + " " + (CATEGORY_EMOJI[category] || "🤯");
  const keywords = FALLBACK_KEYWORDS[category] || "amazing fact curiosity science";
  log("Title: " + title);
  log("Script (" + wc + " words): " + script);
  return { title: title, keywords: keywords, hookEmoji: hookEmoji, script: script };
}
`;

s = replaceFunction(s, 'async function generateNewFactOutline(', directFactFn, 'generateNewFactOutline');
s = replaceFunction(s, 'async function verifyFactOutline(', verifyFn, 'verifyFactOutline');
s = replaceFunction(s, 'async function getOrGrowFactOutline(', growFn, 'getOrGrowFactOutline');
s = replaceFunction(s, 'async function generateContent(', contentFn, 'generateContent');

try {
  new vm.Script(s, { filename: file });
} catch (err) {
  throw new Error('QUALITY_PATCH_V10: generated index.js failed syntax validation: ' + err.message);
}

fs.writeFileSync(file, s, 'utf8');
console.log('QUALITY_PATCH_V10_DIRECT_FACT_SCRIPT applied successfully.');
