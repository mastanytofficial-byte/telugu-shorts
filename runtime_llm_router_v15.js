const fs = require('fs');
const path = require('path');
const child = require('child_process');

const V14 = path.join(__dirname, 'runtime_llm_router_v14.js');
const RUNTIME = path.join(__dirname, '.index.runtime.v8.js');

// V14 is the stable base: provider fallback, fresh-topic/duplicate logic,
// mandatory CTA, and the original V8 duration behavior. Patch it only; do
// not run the actual video generator until this patch is complete.
child.execFileSync(process.execPath, [V14], {
  stdio: 'inherit',
  env: { ...process.env, LLM_ROUTER_PATCH_ONLY: '1' }
});

let source = fs.readFileSync(RUNTIME, 'utf8');

// Strengthen the narration prompt without changing word-count or duration
// behavior. The observed failure was not length: it was a narration made
// almost entirely of rhetorical questions and vague guesses instead of
// explaining the verified fact.
const narrationAnchor = "const narrationPrompt = buildNarrationPrompt(category, recentTitles, outline, beats);";
const narrationReplacement = "const narrationPrompt = buildNarrationPrompt(category, recentTitles, outline, beats) + '\\n\\nV15 NARRATION QUALITY RULES — MANDATORY:\\n- This must be an explanation, not a chain of questions. Use at most TWO question marks in the entire narration, normally only in the hook/curiosity setup. After the hook, answer the question with clear declarative Telugu sentences.\\n- Do NOT turn every beat into a question. Never use repeated patterns such as \\\"ఎలా...?\\\", \\\"ఎందుకు...?\\\", \\\"మనము...?\\\" across multiple lines.\\n- At least two-thirds of the lines must communicate concrete information from the VERIFIED FACT or directly explain the verified mechanism/process.\\n- Do not fill lines with vague speculation such as \\\"మనము ఊహించగలమా?\\\", \\\"ఇవి చూపిస్తున్నాయా?\\\", \\\"భవిష్యత్తులో ఎలా ఉంటుందో?\\\" or generic curiosity questions. Replace them with the actual verified explanation.\\n- Every technical noun must match the verified fact exactly. If the fact is about electrons or other particles, do not rewrite it as \\\"atoms\\\". Do not generalize from electrons to atoms, or from a specific device to all matter, unless the verified fact explicitly supports it.\\n- Do not invent mechanisms, applications, consequences, examples, locations, numbers, or future predictions.\\n- Prefer this structure: hook/question -> direct answer -> how the verified mechanism works -> one verified surprising detail -> memorable factual ending.\\n- The narration must teach the viewer something concrete by the middle of the video.\\n- Avoid filler and repeated statements of the same idea.\\n- Keep natural spoken Telugu, short lines, and the existing pacing style.\\n- Return ONLY narration text. No title, keywords, labels, CTA, emoji, or markdown.';";
if (!source.includes(narrationAnchor)) throw new Error('V15 narration prompt anchor not found');
source = source.replace(narrationAnchor, narrationReplacement);

// Add a lightweight quality gate after the first narration generation. Bad
// outputs are regenerated with a corrective prompt; duration is untouched.
const generationAnchor = "let script = (await callLLM(narrationPrompt)).trim();";
const generationReplacement = `let script = (await callLLM(narrationPrompt)).trim();
  const narrationQuality = (text) => {
    const lines = text.split(/\\n+/).map(x => x.trim()).filter(Boolean);
    const questionMarks = (text.match(/\\?/g) || []).length;
    const questionLines = lines.filter(x => /\\?$/.test(x)).length;
    const declarativeLines = lines.filter(x => /[.!।]$/.test(x) && !/\\?$/.test(x)).length;
    const vagueQuestionHits = (text.match(/మనము .*?(ఊహించ|చూపిస్తున్నాయా|ఎలా ఉంటుందో|చేయగలమా)|ఎలా\\?|ఎందుకు\\?/g) || []).length;
    return questionMarks <= 2 && questionLines <= 2 && declarativeLines >= Math.max(5, Math.ceil(lines.length * 0.45)) && vagueQuestionHits <= 1;
  };
  if (!narrationQuality(script)) {
    log('WARNING: narration quality gate rejected a question-heavy/vague draft — regenerating with direct-explanation constraints.');
    const correctionPrompt = narrationPrompt + '\\n\\nCORRECTION: The previous draft was rejected because it asked too many questions and did not explain the fact. Write a fresh narration. Use no more than TWO question marks total. After the hook, answer directly with concrete verified information. Do not use vague questions or speculative lines. Do not change the verified subject or mechanism. Return only the narration.';
    const corrected = (await callLLM(correctionPrompt)).trim();
    if (narrationQuality(corrected)) script = corrected;
    else log('WARNING: corrected narration still failed the style gate; retaining the better first draft rather than altering verified content.');
  }`;
if (!source.includes(generationAnchor)) throw new Error('V15 narration generation anchor not found');
source = source.replace(generationAnchor, generationReplacement);

child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });
fs.writeFileSync(RUNTIME, source, 'utf8');
child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });
console.log('LLM_ROUTER_V15: direct-explanation narration quality gate + fact-locked terminology applied; original V8 duration behavior retained.');
require(RUNTIME);
