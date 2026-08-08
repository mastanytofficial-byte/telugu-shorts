const fs = require('fs');
const path = require('path');
const child = require('child_process');

const V10 = path.join(__dirname, 'runtime_llm_router_v10.js');
const RUNTIME = path.join(__dirname, '.index.runtime.v8.js');

// Start from the known-good V10 provider/duration runtime. Do not execute V11:
// V11 itself contained a patcher-template interpolation bug (target was being
// evaluated while building the patcher, before the generated runtime existed).
child.execFileSync(process.execPath, [V10], {
  stdio: 'inherit',
  env: { ...process.env, LLM_ROUTER_PATCH_ONLY: '1' }
});

let source = fs.readFileSync(RUNTIME, 'utf8');

function mustChange(re, replacement, label) {
  const before = source;
  source = source.replace(re, replacement);
  if (source === before) throw new Error('V12 patch anchor not found: ' + label);
}

// V10 already enforces 88-105 words and the measured 50-60s audio guard.
// Make the narration generation itself aim slightly higher so the model has
// room to land inside the range.
source = source.replace(
  /const narrationPrompt = buildNarrationPrompt\(category, recentTitles, outline, beats\) \+ '[^;]*;?/,
  "const narrationPrompt = buildNarrationPrompt(category, recentTitles, outline, beats) + '\\n\\nHARD LENGTH REQUIREMENT: write 100-105 spoken Telugu words. Do not stop at a short summary. Expand all five verified beats naturally. Do not invent facts, numbers, names, examples or claims. CTA is added separately.';"
);

// IMPORTANT: V11's expansion patch used a template literal inside another
// template literal and therefore evaluated ${target.min} in the patcher.
// V12 builds the generated code from ordinary quoted strings instead, so the
// target variables are evaluated only when the generated runtime runs.
const expansionMarker = '  // CRITICAL: if the script is essentially empty even after all retries,';
if (!source.includes(expansionMarker)) {
  throw new Error('V12 patch anchor not found: expansion insertion point');
}

const expansionLines = [
  '  // V12 expansion rescue: expand the best verified narration when the LLM',
  '  // repeatedly undershoots the required 88-105 spoken-word range.',
  '  if (bestWordCount < target.min) {',
  '    for (let expansionAttempt = 1; expansionAttempt <= 3; expansionAttempt++) {',
  '      const expansionPrompt = "Rewrite and EXPAND the narration below into exactly " + target.min + "-" + target.max + " spoken Telugu words. The current narration is only " + bestWordCount + " words. Keep the exact same verified fact, topic, hook, reveal and conclusion. Do NOT invent any new fact, number, name, example, comparison, consequence or claim. Do not merely repeat sentences. Naturally expand explanations, transitions, cause-and-effect wording, and the meaning of details already present. Use simple, natural spoken Telugu suitable for a 50-60 second YouTube Short. Return ONLY the narration text. No title, no hook label, no CTA, no emoji, no markdown.\\n\\nCURRENT NARRATION:\\n" + bestScript;',
  '      const expanded = (await callLLM(expansionPrompt)).trim();',
  '      const expandedCount = expanded.split(/\\s+/).filter(Boolean).length;',
  '      log("  Expansion pass " + expansionAttempt + " produced " + expandedCount + " words.");',
  '      if (expandedCount >= target.min && expandedCount <= target.max) {',
  '        bestScript = expanded;',
  '        bestWordCount = expandedCount;',
  '        break;',
  '      }',
  '      const distance = (wc) => wc < target.min ? target.min - wc : (wc > target.max ? wc - target.max : 0);',
  '      if (distance(expandedCount) < distance(bestWordCount)) {',
  '        bestScript = expanded;',
  '        bestWordCount = expandedCount;',
  '      }',
  '    }',
  '  }',
  ''
];
const expansionBlock = expansionLines.join('\n');
source = source.replace(expansionMarker, expansionBlock + expansionMarker);

// After the expansion rescue, keep V10's hard minimum guard. Never build or
// upload a short video if the required narration length was not achieved.
source = source.replace(
  /if \(bestWordCount < target\.min\) \{\n    throw new Error\(`SCRIPT_LENGTH_GUARD_FAILED:[\s\S]*?\n  \}/,
  "if (bestWordCount < target.min) {\n    throw new Error(`SCRIPT_LENGTH_GUARD_FAILED: narration is ${bestWordCount} words after 4 generation retries + 3 expansion passes; target is ${target.min}-${target.max}. Refusing to build/upload a short video.`);\n  }"
);

// Make sure the generated runtime is valid JavaScript BEFORE requiring it.
child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });
fs.writeFileSync(RUNTIME, source, 'utf8');
child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });
console.log('LLM_ROUTER_V12: V10 stable base + safe 3-pass narration expansion + hard 88-105 words + hard 50-60s duration + mandatory CTA.');
require(RUNTIME);
