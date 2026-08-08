const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "index.js");
let s = fs.readFileSync(file, "utf8");

if (s.includes("// QUALITY_PATCH_V3_SAFE")) {
  console.log("QUALITY_PATCH_V3_SAFE already applied.");
  process.exit(0);
}

s = s.replace(
  /[ \t]*const beats = await generateStoryBeats\(outline\);/,
  '\n  // QUALITY_PATCH_V3_SAFE: verified outline is the only factual source.\n  const beats = {};'
);

const marker = "function buildNarrationPrompt(category, recentTitles, outline, beats) {";
const start = s.indexOf(marker);
if (start < 0) throw new Error("QUALITY_PATCH_V3_SAFE: buildNarrationPrompt not found");

let depth = 0;
let quote = null;
let escaped = false;
let end = -1;

for (let i = start; i < s.length; i++) {
  const ch = s[i];
  const next = s[i + 1];

  if (quote) {
    if (escaped) escaped = false;
    else if (ch === "\\") escaped = true;
    else if (ch === quote) quote = null;
    continue;
  }

  if (ch === '"' || ch === "'" || ch === "`") {
    quote = ch;
    continue;
  }

  if (ch === "/" && next === "/") {
    const nl = s.indexOf("\n", i + 2);
    i = nl < 0 ? s.length : nl;
    continue;
  }

  if (ch === "/" && next === "*") {
    const close = s.indexOf("*/", i + 2);
    i = close < 0 ? s.length : close + 1;
    continue;
  }

  if (ch === "{") depth++;
  if (ch === "}") {
    depth--;
    if (depth === 0) {
      end = i + 1;
      break;
    }
  }
}

if (end < 0) throw new Error("QUALITY_PATCH_V3_SAFE: function end not found");

const fn = s.slice(start, end);
const instruction =
  "QUALITY PATCH — WRITE THE FINAL NARRATION, NOT A PLAN.\n" +
  "Use ONLY the VERIFIED FACT as factual source. Do not invent any detail.\n" +
  "Write natural spoken Telugu for a viral YouTube Short. Think like a strong storyteller: hook, curiosity, question, gradual reveal, strongest surprising detail, memorable payoff.\n" +
  "Use about 70-100 Telugu words and roughly 10-16 short spoken lines. Every line must add new information; delete filler.\n" +
  "Make the first 2-3 lines scroll-stopping. Do not dump the answer in line one, but do not create fake suspense.\n" +
  "Do not add unsupported names, dates, numbers, places, causes, mechanisms, examples or comparisons.\n" +
  "Use conversational Telugu, not textbook/news Telugu. Telugu script is preferred; necessary English technical terms are okay.\n" +
  "Use Telugu words for numbers instead of ASCII digits.\n" +
  "Punctuation: use comma for a short breath, period for a complete thought, and ellipsis only for meaningful suspense/reveal pauses. Use line breaks as spoken beats.\n" +
  "Do not copy previous title/hook wording. Do not use generic filler such as 'this is amazing' or 'new chapter in history'.\n" +
  "Return ONLY the final narration text.";

const openBrace = fn.indexOf("{", marker.length - 1);
if (openBrace < 0) throw new Error("QUALITY_PATCH_V3_SAFE: opening brace not found");

const firstReturnRel = fn.indexOf("return ", openBrace + 1);
if (firstReturnRel < 0) throw new Error("QUALITY_PATCH_V3_SAFE: return statement not found");

const replacement =
  "const QUALITY_PATCH_V3_SAFE_INSTRUCTION = " + JSON.stringify(instruction) + ";\n  " +
  fn.slice(openBrace + 1, firstReturnRel) +
  "return QUALITY_PATCH_V3_SAFE_INSTRUCTION + \"\\n\\n\" + " +
  fn.slice(firstReturnRel + "return ".length);

const newFn = fn.slice(0, openBrace + 1) + replacement;
s = s.slice(0, start) + newFn + s.slice(end);

s = s.replace(/min:\s*85,\s*max:\s*115/g, "min: 70, max: 100");

fs.writeFileSync(file, s, "utf8");
console.log("QUALITY_PATCH_V3_SAFE applied successfully.");
