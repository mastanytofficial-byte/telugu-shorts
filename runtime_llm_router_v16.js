const fs = require('fs');
const path = require('path');
const child = require('child_process');

const V14 = path.join(__dirname, 'runtime_llm_router_v14.js');
const RUNTIME = path.join(__dirname, '.index.runtime.v8.js');

// Keep V8's original duration behavior. V14 supplies provider fallback,
// fresh-topic/duplicate logic and mandatory CTA. This wrapper only adds a
// fail-closed narration quality gate; it does not add a word-count or
// duration target.
child.execFileSync(process.execPath, [V14], {
  stdio: 'inherit',
  env: { ...process.env, LLM_ROUTER_PATCH_ONLY: '1' }
});

let source = fs.readFileSync(RUNTIME, 'utf8');

const narrationAnchor = "const narrationPrompt = buildNarrationPrompt(category, recentTitles, outline, beats);";
const narrationReplacement = "const narrationPrompt = buildNarrationPrompt(category, recentTitles, outline, beats) + '\\n\\nV16 NARRATION QUALITY RULES — MANDATORY:\\n- This must be an explanation, not a chain of questions. Use at most TWO question marks in the entire narration, normally only in the hook/curiosity setup. After the hook, answer the question with clear declarative Telugu sentences.\\n- Do NOT turn every beat into a question. Never use repeated patterns such as \\\"ఎలా...?\\\", \\\"ఎందుకు...?\\\", \\\"మనము...?\\\" across multiple lines.\\n- At least two-thirds of the lines must communicate concrete information from the VERIFIED FACT or directly explain the verified mechanism/process.\\n- Do not fill lines with vague speculation such as \\\"మనము ఊహించగలమా?\\\", \\\"ఇవి చూపిస్తున్నాయా?\\\", \\\"భవిష్యత్తులో ఎలా ఉంటుందో?\\\" or generic curiosity questions. Replace them with the actual verified explanation.\\n- Every technical noun must match the verified fact exactly. If the fact is about electrons or other particles, do not rewrite it as \\\"atoms\\\". Do not generalize from electrons to atoms, or from a specific device to all matter, unless the verified fact explicitly supports it.\\n- Do not invent mechanisms, applications, consequences, examples, locations, numbers, or future predictions.\\n- Prefer this structure: hook/question -> direct answer -> how the verified mechanism works -> one verified surprising detail -> memorable factual ending.\\n- The narration must teach the viewer something concrete by the middle of the video.\\n- Avoid filler and repeated statements of the same idea.\\n- Keep natural spoken Telugu, short lines, and the existing pacing style.\\n- Return ONLY narration text. No title, keywords, labels, CTA, emoji, or markdown.';";
if (!source.includes(narrationAnchor)) throw new Error('V16 narration prompt anchor not found');
source = source.replace(narrationAnchor, narrationReplacement);

const generationAnchor = "let script = (await callLLM(narrationPrompt)).trim();";
const generationReplacement = `let script = (await callLLM(narrationPrompt)).trim();
  const narrationQuality = (text) => {
    const lines = text.split(/\\n+/).map(x => x.trim()).filter(Boolean);
    const questionMarks = (text.match(/\\?/g) || []).length;
    const questionLines = lines.filter(x => /\\?$/.test(x)).length;
    const declarativeLines = lines.filter(x => /[.!।]$/.test(x) && !/\\?$/.test(x)).length;
    const vagueQuestionHits = (text.match(/మనము .*?(ఊహించ|చూపిస్తున్నాయా|ఎలా ఉంటుందో|చేయగలమా)|ఎలా\\?|ఎందుకు\\?/g) || []).length;
    const fillerHits = (text.match(/అద్భుతంగా కనిపిస్తుందా|మన రోజువారీకి ఎలా|భవిష్యత్తు ఎలా ఉంటుంది|మనము .*?అర్థం చేసుకుంటే/g) || []).length;
    return questionMarks <= 2 && questionLines <= 2 && declarativeLines >= Math.max(5, Math.ceil(lines.length * 0.45)) && vagueQuestionHits <= 1 && fillerHits <= 1;
  };
  if (!narrationQuality(script)) {
    log('WARNING: narration quality gate rejected the first draft — regenerating with direct-explanation constraints.');
    const correctionPrompt = narrationPrompt + '\\n\\nCORRECTION: The previous draft was rejected because it asked too many questions or failed to explain the verified fact. Write a completely fresh narration. Use no more than TWO question marks total. After the hook, answer directly with concrete verified information. Do not use vague questions, filler, speculation, or repeated statements. Do not change the verified subject, mechanism, numbers, names, or scope. Return only the narration.';
    const corrected = (await callLLM(correctionPrompt)).trim();
    if (!narrationQuality(corrected)) {
      throw new Error('NARRATION_QUALITY_GATE_FAILED: both the initial and corrective narration drafts failed the direct-explanation quality gate; refusing to build or upload a broken video.');
    }
    script = corrected;
  }`;
if (!source.includes(generationAnchor)) throw new Error('V16 narration generation anchor not found');
source = source.replace(generationAnchor, generationReplacement);

// Never allow an LLM output containing a CTA/title/keyword wrapper to be
// mistaken for clean narration. The existing pipeline appends the CTA and
// handles title/keywords separately.
const cleanAnchor = "script = script.replace(/^\\`\\`\\`(?:text|telugu)?\\s*/i, '').replace(/\\`\\`\\`$/i, '').replace(/^SCRIPT:\\s*/i, '').replace(/[\\s\\S]*?<\\/think>/gi, '').trim();";
if (source.includes(cleanAnchor)) {
  source = source.replace(cleanAnchor, cleanAnchor + "\\nif (/^(title|keywords|cta|script)\\s*:/im.test(script)) throw new Error('NARRATION_FORMAT_GATE_FAILED: narration contains an unexpected wrapper/label.');");
}

child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });
fs.writeFileSync(RUNTIME, source, 'utf8');
child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });
console.log('LLM_ROUTER_V16: fail-closed narration quality gate + fact-locked terminology applied; original V8 duration behavior retained.');
require(RUNTIME);
