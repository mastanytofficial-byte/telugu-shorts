const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "index.js");
let s = fs.readFileSync(file, "utf8");

if (s.includes("// QUALITY_PATCH_V3_DIRECT")) {
  console.log("QUALITY_PATCH_V3_DIRECT already applied.");
  process.exit(0);
}

const oldBeats = /[ \t]*const beats = await generateStoryBeats\(outline\);/;
if (oldBeats.test(s)) {
  s = s.replace(oldBeats, '\n  // QUALITY_PATCH_V3_DIRECT: verified outline is the only factual source.\n  const beats = {};');
}

const marker = "function buildNarrationPrompt(category, recentTitles, outline, beats) {";
const start = s.indexOf(marker);
if (start < 0) throw new Error("QUALITY_PATCH_V3_DIRECT: buildNarrationPrompt not found");

let depth = 0;
let inString = null;
let escaped = false;
let end = -1;

for (let i = start; i < s.length; i++) {
  const ch = s[i];
  const next = s[i + 1];
  if (inString) {
    if (escaped) escaped = false;
    else if (ch === "\\") escaped = true;
    else if (ch === inString) inString = null;
    continue;
  }
  if (ch === '"' || ch === "'" || ch === "`") { inString = ch; continue; }
  if (ch === "/" && next === "/") { const nl = s.indexOf("\n", i + 2); i = nl < 0 ? s.length : nl; continue; }
  if (ch === "/" && next === "*") { const close = s.indexOf("*/", i + 2); i = close < 0 ? s.length : close + 1; continue; }
  if (ch === "{") depth++;
  if (ch === "}") {
    depth--;
    if (depth === 0) { end = i + 1; break; }
  }
}

if (end < 0) throw new Error("QUALITY_PATCH_V3_DIRECT: could not find end of buildNarrationPrompt");

const newFunction = [
  "function buildNarrationPrompt(category, recentTitles, outline, beats) {",
  "  const target = WORD_COUNT_TARGETS[category] || { min: 70, max: 100 };",
  "  const recent = recentTitles.length",
  "    ? '\\n\\nఇటీవల వాడిన titles/hooks: ' + recentTitles.slice(-10).join(' | ') + '\\nవాటి wording, opening pattern, twist లేదా ending pattern ని copy చేయకు.'",
  "    : '';",
  "  const prompt = [",
  "    'VERIFIED FACT — THIS IS THE ONLY SOURCE OF TRUTH:',",
  "    compactOutlineForGrounding(outline),",
  "    '',",
  "    'నీ ROLE: నువ్వు professional Telugu YouTube Shorts storyteller. Textbook లేదా news-reader లాగా కాకుండా natural spoken Telugu లో చెప్పాలి.',",
  "    '',",
  "    'ముందుగా silently plan చేయి: curiosity ఏది, viewer question ఏది, answer ని ఎలా step-by-step reveal చేయాలి, strongest surprise ఏది, చివరి memorable payoff ఏది. ఈ plan ని output లో చూపించకు.',",
  "    '',",
  "    'FLOW: Hook → curiosity → question → partial reveal → real fact → strongest surprising detail → memorable payoff.',",
  "    'ప్రతి line తర్వాత వచ్చే line వినాలనిపించేలా information ముందుకు కదలాలి.',",
  "    '',",
  "    'TARGET: ' + target.min + '-' + target.max + ' తెలుగు words. Filler కోసం word count పెంచవద్దు.',",
  "    'సుమారు 10-16 short spoken lines. One line = one natural spoken thought.',",
  "    'మొదటి 2-3 lines scroll-stopping curiosity కలిగించాలి. Core answer ని మొదటి line లో మొత్తం dump చేయవద్దు.',",
  "    '',",
  "    'STYLE EXAMPLE ONLY:',",
  "    '🤯 ఒక గుహలో దొరికిన చీజ్...',",
  "    'దాదాపు ఏడు వేల ఏళ్ల నాటిదని తెలుసా?',",
  "    'ఇంత పాత చీజ్ ఎలా మిగిలింది?',",
  "    'ఈ wording ని copy చేయవద్దు. ప్రతి fact కి కొత్త hook రాయాలి.',",
  "    '',",
  "    'NO FILLER:',",
  "    'Unnecessary scene-setting, generic emotion, repeated facts, artificial adjectives, textbook explanations వద్దు.',",
  "    'Word count కోసం కొత్త details invent చేయవద్దు.',
  "    '',",
  "    'FACTUAL DISCIPLINE — ABSOLUTE:',",
  "    'VERIFIED FACT లో లేని number, name, date, location, cause, mechanism, comparison లేదా example జోడించకూడదు.',",
  "    'Source లో limitation ఉంటే overclaim చేయవద్దు.',",
  "    'found in ని made in గా మార్చవద్దు. used to filter ని made from గా మార్చవద్దు.',",
  "    'Interesting చేయడానికి hallucination లేదా invented bridge detail strictly forbidden.',",
  "    '',",
  "    'LANGUAGE:',",
  "    'సహజమైన మాట్లాడే తెలుగు. Telugu script ప్రధానంగా వాడు. Technical English terms అవసరమైతే మాత్రమే వాడు.',",
  "    'ASCII digits వద్దు; సంఖ్యలను తెలుగు మాటల్లో రాయి.',",
  "    '',",
  "    'PUNCTUATION / TTS:',",
  "    '... = meaningful suspense or reveal pause. సాధారణంగా 2-4 places మాత్రమే.',",
  "    ', = చిన్న natural breath. . = complete thought ముగింపు.',",
  "    'Line break = spoken beat. Punctuation ని decoration కోసం వాడవద్దు.',",
  "    '',",
  "    'ENDING: చివరి 1-2 lines fact యొక్క strongest memorable takeaway కావాలి. Generic CTA వద్దు.',",
  "    recent,",
  "    '',",
  "    'FINAL CHECK: natural spoken Telugu, strong first 3 lines, every line adds new information, no filler, no unsupported claims, clear reveal, memorable ending, natural punctuation.',",
  "    '',",
  "    'కేవలం final narration text మాత్రమే ఇవ్వు.'",
  "  ].join('\\n');",
  "  return prompt;",
  "}"
].join("\n");

s = s.slice(0, start) + newFunction + s.slice(end);
s = s.replace(/min:\s*85,\s*max:\s*115/g, "min: 70, max: 100");
fs.writeFileSync(file, s, "utf8");
console.log("QUALITY_PATCH_V3_DIRECT applied successfully.");
