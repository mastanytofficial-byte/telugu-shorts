const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'index.js');
let s = fs.readFileSync(file, 'utf8');

if (s.includes('// QUALITY_PATCH_V4_COMPACT')) {
  console.log('QUALITY_PATCH_V4_COMPACT already applied.');
  process.exit(0);
}

const marker = 'function buildNarrationPrompt(category, recentTitles, outline, beats) {';
const start = s.indexOf(marker);
if (start < 0) throw new Error('QUALITY_PATCH_V4: buildNarrationPrompt not found');

let depth = 0, quote = null, escaped = false, end = -1;
for (let i = start; i < s.length; i++) {
  const ch = s[i], next = s[i + 1];
  if (quote) {
    if (escaped) escaped = false;
    else if (ch === '\\') escaped = true;
    else if (ch === quote) quote = null;
    continue;
  }
  if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
  if (ch === '/' && next === '/') { const nl = s.indexOf('\n', i + 2); i = nl < 0 ? s.length : nl; continue; }
  if (ch === '/' && next === '*') { const cl = s.indexOf('*/', i + 2); i = cl < 0 ? s.length : cl + 1; continue; }
  if (ch === '{') depth++;
  if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
if (end < 0) throw new Error('QUALITY_PATCH_V4: function end not found');

const newFn = String.raw`// QUALITY_PATCH_V4_COMPACT
function buildNarrationPrompt(category, recentTitles, outline, beats) {
  const recent = recentTitles.length ? recentTitles.slice(-8).join(' | ') : 'none';
  return [
    'You are a professional Telugu YouTube Shorts storyteller.',
    'Write ONLY the final narration. Do not explain your process.',
    '',
    'VERIFIED FACT — THE ONLY FACTUAL SOURCE:',
    outline,
    '',
    'GOAL:',
    'Turn this fact into a scroll-stopping spoken story: hook -> curiosity -> question -> gradual reveal -> strongest surprising detail -> memorable payoff.',
    'Think silently before writing. Do not output the plan.',
    '',
    'STYLE:',
    '- Natural conversational Telugu, like an energetic human narrator; never textbook/news style.',
    '- About 70-100 Telugu words, roughly 10-16 short spoken lines.',
    '- First 2-3 lines must create strong curiosity.',
    '- Each line must add new information or move the story forward.',
    '- Use short punchy lines. Line breaks are spoken beats.',
    '- Use "..." only for a few real suspense/reveal pauses; comma for a short breath; period for a complete thought.',
    '- Use Telugu words for numbers, not ASCII digits.',
    '',
    'FACT SAFETY:',
    '- Never invent or infer names, dates, numbers, places, causes, mechanisms, examples or comparisons not supported by the verified fact.',
    '- Never turn a possibility into a certainty.',
    '- Never repeat the same fact just to increase length.',
    '- Delete filler and generic lines such as "this is amazing" or "new chapter in history".',
    '',
    'DO NOT COPY these recent titles/hooks:',
    recent,
    '',
    'Return ONLY the narration text.'
  ].join('\n');
}
`;

s = s.slice(0, start) + newFn + s.slice(end);
fs.writeFileSync(file, s, 'utf8');
console.log('QUALITY_PATCH_V4_COMPACT applied successfully.');
