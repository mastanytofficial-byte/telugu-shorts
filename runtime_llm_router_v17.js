const fs = require('fs');
const path = require('path');
const child = require('child_process');

const V8 = path.join(__dirname, 'runtime_llm_router_v8.js');
const RUNTIME = path.join(__dirname, '.index.runtime.v8.js');

// Stable base: V8 keeps the original duration behavior. This wrapper adds
// only the narration quality gate and mandatory CTA. No 50-60s or word-count
// enforcement is introduced.
child.execFileSync(process.execPath, [V8], {
  stdio: 'inherit',
  env: { ...process.env, LLM_ROUTER_PATCH_ONLY: '1' }
});

let source = fs.readFileSync(RUNTIME, 'utf8');

const narrationAnchor = "const narrationPrompt = buildNarrationPrompt(category, recentTitles, outline, beats);";
const narrationReplacement = "const narrationPrompt = buildNarrationPrompt(category, recentTitles, outline, beats) + '\\n\\nV17 NARRATION QUALITY RULES — MANDATORY:\\n- This must be an explanation, not a chain of questions. Use at most TWO question marks in the entire narration.\\n- After the hook, answer directly using clear declarative Telugu sentences. Do not turn every beat into a question.\\n- At least two-thirds of the lines must communicate concrete information from the VERIFIED FACT or directly explain its verified mechanism/process.\\n- Do not use vague filler or speculative questions such as generic 'ఎలా?', 'ఎందుకు?', 'మనము ఊహించగలమా?' lines.\\n- Keep technical terminology faithful to the verified fact. If the fact is about electrons, do not rewrite it as atoms. Do not broaden the scope beyond the verified fact.\\n- Do not invent mechanisms, applications, consequences, examples, numbers, names, or predictions.\\n- Use this structure: hook -> direct answer -> explanation/mechanism -> surprising verified detail -> memorable factual ending.\\n- Return ONLY natural spoken Telugu narration. No title, keywords, labels, CTA, emoji, or markdown.";
if (!source.includes(narrationAnchor)) throw new Error('V17 narration prompt anchor not found');
source = source.replace(narrationAnchor, narrationReplacement);

const generationAnchor = "let script = (await callLLM(narrationPrompt)).trim();";
const generationReplacement = String.raw`let script = (await callLLM(narrationPrompt)).trim();
  const narrationQuality = (text) => {
    const lines = text.split(/\n+/).map(x => x.trim()).filter(Boolean);
    const questionMarks = (text.match(/\?/g) || []).length;
    const questionLines = lines.filter(x => /\?$/.test(x)).length;
    const declarativeLines = lines.filter(x => /[.!।]$/.test(x) && !/\?$/.test(x)).length;
    const vagueQuestionHits = (text.match(/మనము .*?(ఊహించ|చూపిస్తున్నాయా|ఎలా ఉంటుందో|చేయగలమా)|ఎలా\?|ఎందుకు\?/g) || []).length;
    const fillerHits = (text.match(/అద్భుతంగా కనిపిస్తుందా|మన రోజువారీకి ఎలా|భవిష్యత్తు ఎలా ఉంటుంది|మనము .*?అర్థం చేసుకుంటే/g) || []).length;
    return questionMarks <= 2 && questionLines <= 2 && declarativeLines >= Math.max(5, Math.ceil(lines.length * 0.45)) && vagueQuestionHits <= 1 && fillerHits <= 1;
  };
  if (!narrationQuality(script)) {
    log('WARNING: narration quality gate rejected the first draft — regenerating with direct-explanation constraints.');
    const correctionPrompt = narrationPrompt + '\n\nCORRECTION: The previous draft was rejected because it asked too many questions or failed to explain the verified fact. Write a completely fresh narration. Use no more than TWO question marks total. After the hook, answer directly with concrete verified information. Do not use vague questions, filler, speculation, or repeated statements. Do not change the verified subject, mechanism, numbers, names, or scope. Return only the narration.';
    const corrected = (await callLLM(correctionPrompt)).trim();
    if (!narrationQuality(corrected)) {
      throw new Error('NARRATION_QUALITY_GATE_FAILED: both narration drafts failed the direct-explanation quality gate; refusing to build or upload a broken video.');
    }
    script = corrected;
  }`;
if (!source.includes(generationAnchor)) throw new Error('V17 narration generation anchor not found');
source = source.replace(generationAnchor, generationReplacement);

// Force the CTA at the pipeline level so it cannot disappear even if the
// source/index CTA list changes. Existing pipeline timing remains untouched.
const ctaPattern = /const CTA_VARIATIONS = \[[\s\S]*?\];/;
const ctaReplacement = "const CTA_VARIATIONS = ['వీడియో నచ్చితే లైక్ అండ్ షేర్ చేయండి, మరిన్ని ఇలాంటి వీడియోల కోసం సబ్‌స్క్రైబ్ చేయండి.'];";
if (!ctaPattern.test(source)) throw new Error('V17 CTA anchor not found');
source = source.replace(ctaPattern, ctaReplacement);

child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });
fs.writeFileSync(RUNTIME, source, 'utf8');
child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });
console.log('LLM_ROUTER_V17: V8 duration behavior retained + syntax-safe narration quality gate + mandatory CTA applied successfully.');
if (process.env.LLM_ROUTER_PATCH_ONLY !== '1') require(RUNTIME);
