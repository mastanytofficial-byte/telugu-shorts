const fs = require('fs');
const path = require('path');

const BASE_ROUTER = path.join(__dirname, 'runtime_llm_router_v5.js');
const BASE_INDEX = path.join(__dirname, 'index.js');
const PATCHED_INDEX = path.join(__dirname, '.index.source.v6.js');

// V6 quality gate: keep V5's stable provider router, but strengthen fact generation
// and narration rules after a real run exposed a barley -> jowar translation error
// and TTS splitting an ASCII date (10,000 BCE).
let indexSource = fs.readFileSync(BASE_INDEX, 'utf8');
const oldFactSentence = '"${topic}" గురించి అత్యంత ఆశ్చర్యపరిచే, verified fact ఒకటి తెలుగులో ఇవ్వు — ఇది widely-established, నిజమైన సమాచారం అయ్యుండాలి (కల్పితం కాదు).';
const newFactSentence = '"${topic}" గురించి అత్యంత ఆశ్చర్యపరిచే, verified fact ఒకటి తెలుగులో ఇవ్వు — ఇది widely-established, నిజమైన సమాచారం అయ్యుండాలి (కల్పితం కాదు).\n\nTERMINOLOGY SAFETY:\n- Barley = బార్లీ / యవలు. Sorghum/Jowar = జొన్న / జొన్నలు. ఇవి ఒకే ధాన్యం కావు; ఎప్పుడూ synonyms గా రాయకూడదు.\n- ఇతర పంటలు, జంతువులు, రసాయనాలు, ప్రదేశాలు, వ్యక్తుల పేర్లను కూడా తప్పుగా అనువదించవద్దు. అవసరమైతే English scientific/common name ను అలాగే ఉంచు.\n- "ప్రపంచంలో మొదటిది", "మొట్టమొదటిది", "అత్యంత పురాతనమైనది" వంటి absolute claims కు స్పష్టమైన archaeological/historical evidence లేకపోతే ఆ claim చేయవద్దు; బదులుగా evidence support చేసే పరిమిత wording వాడు.\n- Fact లో ఉన్న సంఖ్యలు, తేదీలు ఖచ్చితంగా ఉండాలి; గుర్తు లేకపోతే ఊహించవద్దు.';
if (!indexSource.includes(oldFactSentence)) throw new Error('V6: fact-generation anchor not found');
indexSource = indexSource.replace(oldFactSentence, newFactSentence);
fs.writeFileSync(PATCHED_INDEX, indexSource, 'utf8');

let routerSource = fs.readFileSync(BASE_ROUTER, 'utf8');
routerSource = routerSource.replace(
  "const SOURCE = path.join(__dirname, 'index.js');",
  "const SOURCE = path.join(__dirname, '.index.source.v6.js');"
);

const oldStyle = "    `- Natural spoken Telugu, preferably Telugu script.\\n` +";
const newStyle = "    `- Natural spoken Telugu, preferably Telugu script.\\n` +\n" +
  "    `- Keep crop/animal/chemical/scientific names semantically correct; NEVER translate one entity into a different entity. Barley = బార్లీ/యవలు; sorghum/jowar = జొన్న/జొన్నలు.\\n` +\n" +
  "    `- Preserve the exact meaning of the SOURCE OF TRUTH. If a term is ambiguous, keep the English term rather than guessing a Telugu equivalent.\\n` +\n" +
  "    `- Write every date, year, quantity and number using Telugu words. Do NOT output ASCII digits such as 10000, 10,000, 2026, or 10,000 BCE.\\n` +\n" +
  "    `- Do not state world-first, first-ever, oldest, most-ancient, or similar absolute claims unless that exact claim is explicitly present in the SOURCE OF TRUTH.\\n` +";
if (!routerSource.includes(oldStyle)) throw new Error('V6: narration style anchor not found');
routerSource = routerSource.replace(oldStyle, newStyle);

// Final safety gate: if the generated narration contains the known barley/jowar
// entity collision or ASCII numbers, ask the provider again with a correction prompt.
const oldScriptLine = "  let script = (await callLLM(prompt)).trim();";
const newScriptLine = "  let script = (await callLLM(prompt)).trim();\n  const terminologyCollision = /బార్లీ.{0,30}(?:అంటే|అనగా).{0,30}జొన్న|జొన్న.{0,30}(?:అంటే|అనగా).{0,30}బార్లీ/i.test(script);\n  const asciiNumber = /\\b\\d+(?:,\\d{3})*(?:\\.\\d+)?\\b/.test(script);\n  if (terminologyCollision || asciiNumber) {\n    log('WARNING: V6 fact/number safety gate rejected the first narration; requesting a corrected version.');\n    const correctionPrompt = `SOURCE OF TRUTH — VERIFIED FACT OUTLINE:\\n${outline}\\n\\nRewrite only the spoken Telugu narration. The previous draft failed a safety check. Keep every entity semantically correct: barley = బార్లీ/యవలు; sorghum/jowar = జొన్న/జొన్నలు. Never treat them as synonyms. Write all dates and numbers in Telugu words, never ASCII digits. Add no fact not present in the source. Return only 7–11 natural Telugu lines, no title, labels, JSON, emoji, markdown or CTA.`;\n    script = (await callLLM(correctionPrompt)).trim();\n  }";
if (!routerSource.includes(oldScriptLine)) throw new Error('V6: script-call anchor not found');
routerSource = routerSource.replace(oldScriptLine, newScriptLine);

routerSource = routerSource.replace(".index.runtime.v5.js", ".index.runtime.v6.js");
routerSource = routerSource.replace(
  "console.log('LLM_ROUTER_V5: clean provider router + fact-locked Telugu script + preflight syntax check applied successfully.');",
  "console.log('LLM_ROUTER_V6: provider fallback + terminology safety + Telugu-number TTS safety + fact-locked narration applied successfully.');"
);

const runtimeRouter = path.join(__dirname, '.runtime_llm_router.v6.generated.js');
fs.writeFileSync(runtimeRouter, routerSource, 'utf8');
require('child_process').execFileSync(process.execPath, ['--check', runtimeRouter], { stdio: 'inherit' });
require(runtimeRouter);
