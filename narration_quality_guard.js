// Stable, idempotent narration-quality guard.
// This is the single narration guard used by runtime_llm_router.js.
// It does not create or depend on any vN patch files.

const ORIGINAL_FETCH = global.fetch;
const GUARD_MARKER = 'NARRATION_QUALITY_GUARD_V4';

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
  if (/STORY BEATS:|VERIFIED FACT|కేవలం final narration text|final narration only|natural spoken Telugu/i.test(p)) return 'narration';
  if (/story beats ని JSON|"hook".*"question".*"reveal".*"twist".*"ending"/i.test(p)) return 'beats';
  return 'other';
}

function qualitySuffix(kind) {
  if (kind === 'beats') return `\n\n${GUARD_MARKER}: FACT-LOCK RULES\n- VERIFIED FACT లో ఉన్న సంఖ్యలు, పేర్లు, ప్రదేశాలు, కాల పరిమితులు, శాస్త్రీయ పదాలు మరియు cause/effect claims ఏవీ మార్చవద్దు.\n- Fact లో లేని కొత్త సంఖ్య, percentage, year, person, place, comparison లేదా consequence జోడించవద్దు.\n- Hook sensational గా ఉండవచ్చు, కానీ verified claim కి మించి overclaim చేయవద్దు.\n- ప్రతి beat అదే verified fact కి నేరుగా సంబంధించినదే కావాలి.\n- ఒకే fact ని రెండు beats లో duplicate చేయవద్దు.`;

  if (kind === 'narration') return `\n\n${GUARD_MARKER}: FINAL NARRATION QUALITY CONTRACT\n- Natural spoken Telugu మాత్రమే. పుస్తక తెలుగు, news-reader style, literal translation, AI-sounding filler వద్దు.\n- Viewer ఒక friend దగ్గర surprising fact వింటున్నట్టు conversational గా చెప్పు.\n- VERIFIED FACT లోని సంఖ్యలు, values, names, places, dates, technical terms మరియు uncertainty/limitation words అచ్చంగా preserve చేయాలి.\n- Source fact లో 120 ఉంటే 112/100/125 లాంటి మరో value ఎప్పుడూ రాయకూడదు.\n- Source లో may/can/some/about/nearly/certain వంటి limitation ఉంటే దాన్ని always/all/exactly/guaranteed గా మార్చవద్దు.\n- Source fact లో లేని statistic, example, comparison, distance, consequence, family detail, biological explanation లేదా real-world implication invent చేయవద్దు.\n- Hook ని question గా ఉంచినా answer ని false certainty గా మార్చవద్దు.\n- ఒకే claim ని synonym మార్చి మళ్లీ చెప్పవద్దు. ప్రతి line కొత్త information లేదా meaningful transition ఇవ్వాలి.\n- ఒక noun/claim ని వరుసగా 2-3 lines లో repeat చేయకుండా natural pronouns/transitions వాడు.\n- Forced metaphors เช่น సముద్రపు గుండె, ప్రకృతి రహస్యం, మాయ, అద్భుతం వంటి generic poetic filler వద్దు.\n- "అసలు విషయం ఏంటంటే", "ఇంకా షాక్ ఏంటంటే", "అయితే" వంటి stock transitions ను అవసరమైనప్పుడు మాత్రమే వాడు.\n- "దూరం ఎంతైనా", "పేరు గుర్తింపు", "కొంచెం ఒకేలా" వంటి vague or grammatically incomplete phrases వద్దు.\n- Telugu grammar first: subject, verb, case endings and sentence agreement సహజంగా ఉండాలి.\n- Technical term English లో అవసరమైతే మాత్రమే; Telugu sentence మధ్య random English words వద్దు.\n- ASCII digits వద్దు. సంఖ్యలు Telugu words లో సహజంగా రాయి.\n- CTA, title, emoji, labels, markdown వద్దు. Existing pipeline CTA ని separately handle చేస్తుంది.\n- 12-18 short spoken lines; repeated sentences వద్దు.\n- Final line fact-specific memorable takeaway కావాలి; generic moral వద్దు.\n- Final output narration మాత్రమే.`;

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
  const fact = stop >= 0 ? tail.slice(0, stop) : tail.slice(0, 7000);
  return [...new Set(fact.match(/\b\d+(?:\.\d+)?\b/g) || [])];
}

function hasBadAsciiNumber(output) {
  return /\b\d+(?:[.,]\d+)?\b/.test(String(output || ''));
}

function getGroqContent(data) {
  return data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
}

function cleanNarration(content) {
  return String(content || '')
    .replace(/^```(?:text|telugu)?\s*/i, '')
    .replace(/```$/i, '')
    .replace(/^SCRIPT:\s*/i, '')
    .replace(/ఆన్‌లైన్‌ శాపంలో/g, 'ఆన్‌లైన్‌ కొనుగోళ్లలో')
    .replace(/ఆన్‌లైన్ శాపంలో/g, 'ఆన్‌లైన్ కొనుగోళ్లలో')
    .replace(/గణనీయంగా చాలా పెంచుతుంది/g, 'గణనీయంగా పెంచుతుంది')
    .replace(/సుంకించెదు/g, 'తగ్గించవచ్చు')
    .replace(/సముద్రపు గుండెలా,?\s*/g, '')
    .replace(/అంతే,\s*దూరం ఎంతైనా పేరు గుర్తింపు\.?/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hasObviousRepetition(content) {
  const lines = String(content || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
  const normalized = lines.map(s => s.replace(/[!?.,…]+$/g, '').replace(/\s+/g, ' '));
  const seen = new Set();
  for (const line of normalized) {
    if (line.length < 8) continue;
    if (seen.has(line)) return true;
    seen.add(line);
  }
  for (let i = 0; i < normalized.length - 1; i++) {
    const a = normalized[i].split(/\s+/).slice(0, 4).join(' ');
    const b = normalized[i + 1].split(/\s+/).slice(0, 4).join(' ');
    if (a.length >= 8 && a === b) return true;
  }
  return false;
}

function hasBadStyle(content) {
  const s = String(content || '');
  return /సముద్రపు గుండె|పేరు గుర్తింపు|కొంచెం ఒకేలా|అద్భుతమైన మాయ|సుంకించెదు|ఆన్‌లైన్.?శాపం/.test(s) || hasObviousRepetition(s);
}

function buildRepairPrompt(originalPrompt, badOutput, reasons) {
  const numbers = extractSourceNumbers(originalPrompt);
  const mandatory = numbers.length ? `\nMANDATORY SOURCE NUMERIC VALUES — DO NOT CHANGE: ${numbers.join(', ')}. If numbers appear in output, preserve their exact values.` : '';
  return `${originalPrompt}\n\n${GUARD_MARKER}: FINAL REPAIR PASS\nThe previous narration failed these checks: ${reasons.join('; ')}.\n${mandatory}\n\nPREVIOUS NARRATION:\n${badOutput}\n\nRewrite the narration from scratch while preserving ONLY the verified information. Do not merely edit one sentence. Remove repetition, vague phrases, forced metaphors and unnatural Telugu. Do not invent facts, numbers, distances, examples, consequences or family details. Keep 12-18 short spoken lines, natural conversational Telugu, hook → reveal → detail → twist → fact-specific ending. Return narration only. No CTA, title, emoji, labels or markdown.`;
}

async function callOriginalGroq(options, prompt, temperature = 0.08) {
  let parsed;
  try { parsed = JSON.parse(String(options.body || '{}')); } catch (_) { return null; }
  const messages = Array.isArray(parsed.messages) ? messagesFrom(parsed.messages) : [];
  if (!messages.length) return null;
  messages[messages.length - 1].content = prompt;
  parsed.messages = messages;
  parsed.temperature = temperature;
  return ORIGINAL_FETCH('https://api.groq.com/openai/v1/chat/completions', { ...options, body: JSON.stringify(parsed) });
}

function messagesFrom(messages) {
  return messages.map(m => ({ ...m }));
}

async function verifyNarration(originalPrompt, narration, options) {
  const verifyPrompt = `${GUARD_MARKER}: INDEPENDENT FACT-CONSISTENCY CHECK\n\nVERIFIED FACT AND STORY CONTEXT:\n${originalPrompt}\n\nGENERATED NARRATION:\n${narration}\n\nCheck factual consistency only. Compare every number/value, named entity, place, technical term, quantity, limitation and cause/effect claim in narration against VERIFIED FACT. Any changed number/value, invented detail, or stronger claim than the source is FAIL. Repetition or style is not the reason for PASS/FAIL here.\n\nReturn exactly one line: PASS or FAIL`;
  try {
    const response = await callOriginalGroq(options, verifyPrompt, 0.02);
    if (!response || typeof response.clone !== 'function') {
      console.log(`${GUARD_MARKER}: independent fact check = SKIPPED (verifier response unavailable)`);
      return false;
    }
    const data = await response.clone().json();
    const result = String(getGroqContent(data) || '').trim().toUpperCase();
    console.log(`${GUARD_MARKER}: independent fact check = ${result || 'EMPTY'}`);
    if (!result) return false;
    return result.startsWith('PASS');
  } catch (e) {
    console.log(`${GUARD_MARKER}: independent fact check = ERROR (${e.message})`);
    return false;
  }
}

function makeJsonResponse(data, response) {
  return new Response(JSON.stringify(data), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
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
  const messages = Array.isArray(parsed.messages) ? messagesFrom(parsed.messages) : [];
  const last = messages.length ? messages[messages.length - 1] : null;
  const originalPrompt = last && typeof last.content === 'string' ? last.content : '';
  const patched = patchPrompt(originalPrompt);

  if (patched.kind !== 'other') {
    parsed.temperature = patched.kind === 'narration' ? 0.20 : 0.14;
    parsed.messages = messages;
    if (last) last.content = patched.prompt;
    options = { ...options, body: JSON.stringify(parsed) };
  }

  const response = await ORIGINAL_FETCH(url, options);
  if (patched.kind !== 'narration' || !response || typeof response.clone !== 'function') return response;

  try {
    const data = await response.clone().json();
    let content = getGroqContent(data);
    if (typeof content !== 'string') return response;

    content = cleanNarration(content);
    const reasons = [];
    if (!content.trim()) reasons.push('empty narration');
    if (hasBadAsciiNumber(content)) reasons.push('ASCII number detected');
    if (hasBadStyle(content)) reasons.push('repetition or unnatural Telugu detected');

    if (!reasons.length) {
      const factPass = await verifyNarration(patched.prompt, content, options);
      if (!factPass) reasons.push('independent fact check failed');
    }

    if (reasons.length) {
      console.log(`${GUARD_MARKER}: narration contract violation detected — repair reasons: ${reasons.join(' | ')}`);
      const repairResponse = await callOriginalGroq(options, buildRepairPrompt(patched.prompt, content, reasons), 0.08);
      if (repairResponse && typeof repairResponse.clone === 'function') {
        const repairData = await repairResponse.clone().json();
        const repaired = getGroqContent(repairData);
        if (typeof repaired === 'string' && repaired.trim()) {
          const cleaned = cleanNarration(repaired);
          if (!hasBadAsciiNumber(cleaned) && !hasBadStyle(cleaned)) {
            repairData.choices[0].message.content = cleaned;
            console.log(`${GUARD_MARKER}: repair accepted.`);
            console.log(`${GUARD_MARKER}: FINAL NARRATION\n${cleaned}`);
            return makeJsonResponse(repairData, repairResponse);
          }
          console.log(`${GUARD_MARKER}: repair rejected — still violates local style checks; using original response.`);
        }
      }
    }

    data.choices[0].message.content = content;
    console.log(`${GUARD_MARKER}: FINAL NARRATION\n${content}`);
    return makeJsonResponse(data, response);
  } catch (e) {
    console.log(`${GUARD_MARKER}: post-processing failed (${e.message}) — preserving primary response.`);
    return response;
  }
}

guardedFetch.__NARRATION_QUALITY_GUARD__ = true;
global.fetch = guardedFetch;

console.log(`${GUARD_MARKER}: enabled — fact-locked Telugu narration quality rules active.`);
module.exports = { enabled: true, marker: GUARD_MARKER };
