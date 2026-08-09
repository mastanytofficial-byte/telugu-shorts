// Stable, idempotent narration-quality guard.
// Strengthens Groq prompts, independently verifies narration against the
// verified fact, repairs one bad narration automatically, and keeps the
// spoken CTA compact so it cannot dominate the final visual scene.

const ORIGINAL_FETCH = global.fetch;
const GUARD_MARKER = 'NARRATION_QUALITY_GUARD_V3';

if (!ORIGINAL_FETCH || ORIGINAL_FETCH.__NARRATION_QUALITY_GUARD__) {
  module.exports = { enabled: true, marker: GUARD_MARKER };
  return;
}

function isGroqChatRequest(url, options) {
  return String(url).includes('api.groq.com/openai/v1/chat/completions') && options && String(options.method || 'GET').toUpperCase() === 'POST';
}

function isGoogleTtsRequest(url, options) {
  return String(url).includes('texttospeech.googleapis.com/v1/text:synthesize') && options && String(options.method || 'GET').toUpperCase() === 'POST';
}

function classifyPrompt(prompt) {
  const p = String(prompt || '');
  if (/STORY BEATS:|VERIFIED FACT|కేవలం తెలుగు narration|professional YouTube Shorts storyteller/i.test(p)) return 'narration';
  if (/story beats ని JSON|"hook".*"question".*"reveal".*"twist".*"ending"/i.test(p)) return 'beats';
  return 'other';
}

function qualitySuffix(kind) {
  if (kind === 'beats') return `\n\n${GUARD_MARKER}: FACT-LOCK RULES\n- VERIFIED FACT లో ఉన్న సంఖ్యలు, పేర్లు, ప్రదేశాలు, కాల పరిమితులు, శాస్త్రీయ పదాలు మరియు cause/effect claims ఏవీ మార్చవద్దు.\n- Fact లో లేని కొత్త సంఖ్య, percentage, year, person, place, comparison లేదా consequence జోడించవద్దు.\n- Hook sensational గా ఉండవచ్చు, కానీ verified claim కి మించి overclaim చేయవద్దు.\n- ప్రతి beat అదే verified fact కి నేరుగా సంబంధించినదే కావాలి.`;
  if (kind === 'narration') return `\n\n${GUARD_MARKER}: FINAL NARRATION QUALITY CONTRACT\n- ఇది natural spoken Telugu. పుస్తక తెలుగు, news-reader style, AI-sounding filler వద్దు.\n- Viewer కి friend ఒక surprising fact చెబుతున్నట్టు conversational గా రాయి.\n- VERIFIED FACT లో ఉన్న సంఖ్యల విలువలు, పేర్లు, స్థలాలు, కాలాలు, technical terms అచ్చంగా preserve చేయాలి. ఒక సంఖ్యను దగ్గరలోని మరో సంఖ్యగా మార్చడం పూర్తిగా నిషేధం.\n- Source fact లో 120 ఉంటే 112/100/125 లాంటి మరో సంఖ్య ఎప్పుడూ రాయకూడదు; 120 ని Telugu words లో రాయాల్సి వస్తే అదే విలువను రాయి.\n- కొత్త fact, statistic, example, comparison, consequence లేదా claim invent చేయవద్దు.\n- Source లో ఉన్న limit words (some, may, can, certain, about, nearly) ను absolute claim గా మార్చవద్దు.\n- ప్రతి line కి purpose ఉండాలి. అదే idea ని వేరే మాటల్లో మళ్లీ చెప్పవద్దు.\n- Artificial Telugu, forced metaphors, literal translations, formal filler వద్దు.\n- "అసలు విషయం ఏంటంటే...", "ఇంకా షాక్ ఏంటంటే..." వంటి templates అవసరమైనప్పుడు మాత్రమే; repeated pattern వద్దు.\n- చివర్లో fact-specific memorable takeaway ఇవ్వు. Generic moral వద్దు.\n- CTA రాయకూడదు; existing pipeline CTA ని స్వయంగా handle చేస్తుంది.\n- ASCII digits వద్దు; సంఖ్యలు Telugu words లో సహజంగా రాయి.\n- Final output narration మాత్రమే.`;
  return '';
}

function patchPrompt(prompt) {
  const kind = classifyPrompt(prompt);
  const suffix = qualitySuffix(kind);
  if (!suffix || String(prompt).includes(GUARD_MARKER)) return { prompt: String(prompt), kind };
  return { prompt: String(prompt) + suffix, kind };
}

function extractSourceNumbers(prompt) {
  const text = String(prompt || '');
  const marker = text.indexOf('VERIFIED FACT');
  if (marker < 0) return [];
  const tail = text.slice(marker);
  const stop = tail.indexOf('\n\nనీ ROLE:');
  const fact = stop >= 0 ? tail.slice(0, stop) : tail.slice(0, 5000);
  return [...new Set(fact.match(/\b\d+(?:\.\d+)?\b/g) || [])];
}

function hasBadAsciiNumber(output) {
  return /\b\d+(?:[.,]\d+)?\b/.test(String(output || ''));
}

function getGroqContent(data) {
  return data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
}

function replaceKnownUnnaturalPhrases(content) {
  return String(content || '')
    .replace(/ఆన్‌లైన్‌ శాపంలో/g, 'ఆన్‌లైన్‌ కొనుగోళ్లలో')
    .replace(/ఆన్‌లైన్ శాపంలో/g, 'ఆన్‌లైన్ కొనుగోళ్లలో')
    .replace(/గణనీయంగా చాలా పెంచుతుంది/g, 'గణనీయంగా పెంచుతుంది')
    .replace(/సుంకించెదు/g, 'తగ్గించవచ్చు');
}

function buildRepairPrompt(originalPrompt, badOutput) {
  const numbers = extractSourceNumbers(originalPrompt);
  const mandatory = numbers.length ? `\nMANDATORY SOURCE NUMERIC VALUES — DO NOT CHANGE THESE VALUES: ${numbers.join(', ')}. Write them in natural Telugu words, but preserve the exact numeric value.` : '';
  return `${originalPrompt}\n\n${GUARD_MARKER}: REPAIR PASS\nThe previous narration was rejected because it violated the fact-lock contract.\n${mandatory}\nPrevious narration to repair:\n${badOutput}\n\nReturn a fresh narration only. Preserve every verified number, name, place, technical term and limitation from VERIFIED FACT. Do not invent anything. Do not use ASCII digits. Use natural spoken Telugu, 12-18 short lines, and keep the original hook-to-reveal-to-twist flow. Do not add CTA, title, emoji or labels.`;
}

async function callOriginalGroq(options, prompt, temperature = 0.12) {
  let parsed;
  try { parsed = JSON.parse(String(options.body || '{}')); } catch (_) { return null; }
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  if (!messages.length) return null;
  messages[messages.length - 1].content = prompt;
  parsed.temperature = temperature;
  return ORIGINAL_FETCH('https://api.groq.com/openai/v1/chat/completions', { ...options, body: JSON.stringify(parsed) });
}

async function verifyNarration(originalPrompt, narration, options) {
  const verifyPrompt = `${GUARD_MARKER}: INDEPENDENT FACT-CONSISTENCY CHECK\n\nVERIFIED FACT AND ORIGINAL STORY CONTEXT:\n${originalPrompt}\n\nGENERATED NARRATION:\n${narration}\n\nCheck ONLY factual consistency. Compare every number/value, named entity, place, technical term, time/quantity, limitation and cause/effect claim in the narration against VERIFIED FACT. A value such as 120 changed to 112 is a FAIL. A source limitation such as "may" changed to "always" is a FAIL. New unsupported claims are a FAIL. Style is irrelevant.\n\nReturn exactly one line: PASS or FAIL`;
  try {
    const response = await callOriginalGroq(options, verifyPrompt, 0.05);
    if (!response || typeof response.clone !== 'function') return true; // fail-open only on verifier infrastructure failure
    const data = await response.clone().json();
    const result = String(getGroqContent(data) || '').trim().toUpperCase();
    console.log(`${GUARD_MARKER}: independent fact check = ${result}`);
    return result.startsWith('PASS');
  } catch (e) {
    console.log(`${GUARD_MARKER}: verifier unavailable (${e.message}) — continuing with primary output.`);
    return true;
  }
}

async function guardedFetch(url, options = {}) {
  if (isGoogleTtsRequest(url, options)) {
    try {
      const parsed = JSON.parse(String(options.body || '{}'));
      const raw = JSON.stringify(parsed.input || {});
      if (/సబ్‌స్క్రైబ్|subscribe|like\s+share/i.test(raw)) {
        parsed.audioConfig = { ...(parsed.audioConfig || {}), speakingRate: 1.75 };
        return ORIGINAL_FETCH(url, { ...options, body: JSON.stringify(parsed) });
      }
    } catch (_) {}
    return ORIGINAL_FETCH(url, options);
  }

  if (!isGroqChatRequest(url, options)) return ORIGINAL_FETCH(url, options);

  let parsed;
  try { parsed = JSON.parse(String(options.body || '{}')); } catch (_) { return ORIGINAL_FETCH(url, options); }
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  const last = messages.length ? messages[messages.length - 1] : null;
  const originalPrompt = last && typeof last.content === 'string' ? last.content : '';
  const patched = patchPrompt(originalPrompt);

  if (patched.kind !== 'other') {
    parsed.temperature = patched.kind === 'narration' ? 0.20 : 0.16;
    if (last) last.content = patched.prompt;
    options = { ...options, body: JSON.stringify(parsed) };
  }

  const response = await ORIGINAL_FETCH(url, options);
  if (patched.kind !== 'narration' || !response || typeof response.clone !== 'function') return response;

  try {
    const data = await response.clone().json();
    let content = getGroqContent(data);
    if (typeof content !== 'string') return response;
    const originalContent = content;
    content = replaceKnownUnnaturalPhrases(content);

    let needsRepair = hasBadAsciiNumber(content) || !content.trim();
    if (!needsRepair) needsRepair = !(await verifyNarration(patched.prompt, content, options));

    if (needsRepair) {
      console.log(`${GUARD_MARKER}: narration contract violation detected — running one automatic repair pass.`);
      const repairResponse = await callOriginalGroq(options, buildRepairPrompt(patched.prompt, content), 0.10);
      if (repairResponse && typeof repairResponse.clone === 'function') {
        const repairData = await repairResponse.clone().json();
        const repaired = getGroqContent(repairData);
        if (typeof repaired === 'string' && repaired.trim() && !hasBadAsciiNumber(repaired)) {
          const cleaned = replaceKnownUnnaturalPhrases(repaired);
          repairData.choices[0].message.content = cleaned;
          return new Response(JSON.stringify(repairData), { status: repairResponse.status, statusText: repairResponse.statusText, headers: repairResponse.headers });
        }
      }
    }

    if (content !== originalContent) {
      data.choices[0].message.content = content;
      return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers: response.headers });
    }
  } catch (_) {}

  return response;
}

guardedFetch.__NARRATION_QUALITY_GUARD__ = true;
global.fetch = guardedFetch;

console.log(`${GUARD_MARKER}: enabled — fact-locked Telugu narration quality rules active.`);
module.exports = { enabled: true, marker: GUARD_MARKER };
