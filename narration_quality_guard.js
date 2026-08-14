// Stable narration-quality guard.
// Fact-first Telugu narration: natural sentences, restrained drama, TTS-friendly pacing.

const ORIGINAL_FETCH = global.fetch;
const GUARD_MARKER = 'NARRATION_QUALITY_GUARD_V5';

if (!ORIGINAL_FETCH || ORIGINAL_FETCH.__NARRATION_QUALITY_GUARD__) {
  module.exports = { enabled: true, marker: GUARD_MARKER };
  return;
}

function isGroqChatRequest(url, options) {
  return String(url).includes('api.groq.com/openai/v1/chat/completions') &&
    options && String(options.method || 'GET').toUpperCase() === 'POST';
}

function isGoogleTtsRequest(url, options) {
  return String(url).includes('texttospeech.googleapis.com/v1/text:synthesize') &&
    options && String(options.method || 'GET').toUpperCase() === 'POST';
}

function classifyPrompt(prompt) {
  const p = String(prompt || '');
  const narration = /TARGET RHYTHM|high-retention storyteller|CALL A of Stage 2|final narration text only|12-18 short spoken lines/i.test(p) && /STORY BEATS/i.test(p);
  if (narration) return 'narration';
  const beats = /STORY BEATS/i.test(p) && (/5 beats only|5 beats మాత్రమే|story beats ని JSON|\"hook\".*\"question\".*\"reveal\".*\"twist\".*\"ending\"/is.test(p));
  if (beats) return 'beats';
  return 'other';
}

function qualitySuffix(kind) {
  if (kind === 'beats') return `\n\n${GUARD_MARKER}: FACT-FIRST STORY CONTRACT\n- VERIFIED FACT లో ఉన్న సంఖ్యలు, values, పేర్లు, ప్రదేశాలు, dates, technical terms మరియు cause/effect claims ఏవీ మార్చవద్దు.\n- Fact లో లేని కొత్త number, percentage, year, person, place, comparison, consequence లేదా explanation జోడించవద్దు.\n- Hook curiosity కోసం మాత్రమే; sensational overclaim వద్దు.\n- question సహజమైన curiosity కావాలి.\n- reveal లో fact యొక్క core answer స్పష్టంగా ఉండాలి.\n- twist అనే beat తప్పనిసరిగా dramatic twist కాదు. Fact లో సహజంగా ఉన్న అత్యంత unexpected detail మాత్రమే ఇవ్వు. అలాంటి detail లేకపోతే strongest verified detail ను మళ్లీ చెప్పకుండా ending కోసం ఉపయోగించు.\n- ప్రతి beat ఒకే verified fact కి నేరుగా సంబంధించినదే కావాలి.`;

  if (kind === 'narration') return `\n\n${GUARD_MARKER}: FINAL FACT-NARRATION CONTRACT\n- ఇది fiction/storytelling కాదు. ఇది ఒక verified fact ని clear గా, interesting గా explain చేసే Telugu micro-documentary narration.\n- Fact-first, drama-second. Viewer కి "ఇది నిజంగా జరిగిన/ఉన్న విషయం" అనే feeling రావాలి.\n- Natural spoken Telugu మాత్రమే. పుస్తక తెలుగు, news-reader style, literal translation, AI-sounding filler వద్దు.\n- మొదటి 1-2 lines curiosity hook కావచ్చు; తర్వాత వెంటనే fact ని clear గా explain చేయాలి.\n- ప్రతి line సహజమైన పూర్తి వాక్యం లేదా సహజమైన చిన్న sentence కావాలి. Sentence fragments వరుసగా వాడవద్దు.\n- సాధారణంగా 10-14 lines లోనే complete narration ఇవ్వు. 12-18 అన్నది maximum style range; ప్రతి thought ని చిన్న ముక్కలుగా విరగొట్టవద్దు.\n- ఒక line లో ఒక ప్రధాన thought మాత్రమే. కానీ subject-verb-object కలిసి ఉండాలి. ఉదా: "1971లో నిక్సన్ బంగారం-డాలర్ మార్పిడిని నిలిపివేశాడు." వంటి పూర్తి వాక్యం.\n- ప్రతి line తర్వాత artificial cliffhanger అవసరం లేదు. Natural information flow: hook → context → fact → why/how → important detail → takeaway.\n- "కానీ...", "అసలు విషయం...", "ఇంకా షాక్...", "నమ్మగలరా?" వంటి hooks/transitions ని అవసరమైనప్పుడు మాత్రమే వాడు; template లాగా repeat చేయవద్దు.\n- Forced personal examples, family examples, food examples, metaphors, moral lessons లేదా emotional drama వద్దు.\n- "twist" ను కల్పించవద్దు. Fact లో నిజంగా unexpected detail ఉంటే మాత్రమే దాన్ని చివర్లో highlight చేయి.\n- ఒకే claim ని wording మార్చి మళ్లీ చెప్పవద్దు.\n- VERIFIED FACT లోని numbers, values, names, places, dates, technical terms మరియు uncertainty/limitation words అచ్చంగా preserve చేయాలి.\n- Source fact లో లేని కొత్త number, statistic, example, comparison, distance, consequence లేదా scientific/economic explanation invent చేయవద్దు.\n- Source లో may/can/some/about/nearly/certain వంటి limitation ఉంటే దాన్ని always/all/exactly/guaranteed గా మార్చవద్దు.\n- Telugu grammar first: subject, verb, case endings and sentence agreement సహజంగా ఉండాలి.\n- Random English words వద్దు. Technical term అవసరమైతే మాత్రమే English/standard technical form వాడు.\n- ASCII digits వద్దు. అన్ని సంఖ్యలను తెలుగు మాటల్లోనే రాయి.\n- Commas చాలా తక్కువగా వాడు. ఒక line లో comma పెట్టాల్సిన అవసరం లేకపోతే పెట్టవద్దు. Comma ని dramatic pause కోసం అసలు వాడవద్దు.\n- Ellipsis (...) చాలా అరుదుగా మాత్రమే; సాధారణంగా మొత్తం script లో 0-1 సార్లు. ప్రతి line కి వద్దు.\n- ఒకే line లో comma + ellipsis + question pattern కలపవద్దు.\n- CTA, title, emoji, labels, markdown వద్దు.\n- Final line fact-specific takeaway కావాలి. Generic moral లేదా subscribe request వద్దు.\n- Final output narration మాత్రమే.`;
  return '';
}

function patchPrompt(prompt) {
  const kind = classifyPrompt(prompt);
  const suffix = qualitySuffix(kind);
  if (!suffix || String(prompt).includes(GUARD_MARKER)) return { prompt: String(prompt), kind };
  return { prompt: String(prompt) + suffix, kind };
}

function getGroqContent(data) {
  return data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : null;
}

function cleanNarration(content) {
  return String(content || '')
    .replace(/^```(?:text|telugu)?\s*/i, '')
    .replace(/```$/i, '')
    .replace(/^SCRIPT:\s*/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hasBadAsciiNumber(output) {
  return /\b\d+(?:[.,]\d+)?\b/.test(String(output || ''));
}

function hasObviousRepetition(content) {
  const lines = String(content || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
  const normalized = lines.map(s => s.replace(/[!?.,…]+$/g, '').replace(/\s+/g, ' '));
  const seen = new Set();
  for (const line of normalized) {
    if (line.length < 10) continue;
    if (seen.has(line)) return true;
    seen.add(line);
  }
  for (let i = 0; i < normalized.length - 1; i++) {
    const a = normalized[i].split(/\s+/).slice(0, 5).join(' ');
    const b = normalized[i + 1].split(/\s+/).slice(0, 5).join(' ');
    if (a.length >= 10 && a === b) return true;
  }
  return false;
}

function hasBadStyle(content) {
  const s = String(content || '');
  const lines = s.split(/\n+/).map(x => x.trim()).filter(Boolean);
  const tooFragmented = lines.length > 16;
  const tooManyEllipses = (s.match(/\.\.\./g) || []).length > 1;
  const tooManyQuestions = (s.match(/\?/g) || []).length > 3;
  const tooManyTinyLines = lines.filter(x => x.split(/\s+/).length <= 3).length >= 4;
  return hasObviousRepetition(s) || tooFragmented || tooManyEllipses || tooManyQuestions || tooManyTinyLines;
}

function buildRepairPrompt(originalPrompt, badOutput, reasons) {
  return `${originalPrompt}\n\n${GUARD_MARKER}: FINAL REPAIR PASS\nPrevious narration failed: ${reasons.join('; ')}.\nRewrite the narration from scratch as a factual Telugu micro-documentary. Preserve every verified value exactly. Do not invent any number, date, name, example, comparison, consequence or explanation. Use 10-14 natural lines. Prefer complete sentences over fragments. Avoid unnecessary commas and use at most one ellipsis in the whole script. No dramatic filler. Return narration only.\n\nPREVIOUS NARRATION:\n${badOutput}`;
}

function buildEmptyRetryPrompt(originalPrompt) {
  return `${originalPrompt}\n\n${GUARD_MARKER}: EMPTY-OUTPUT RECOVERY\nReturn ONLY the final Telugu narration. Make it a factual micro-documentary: 85-115 words, 10-14 natural lines, complete spoken sentences, fact-first and conversational. Preserve ONLY the supplied verified fact. No JSON, labels, title, CTA, emoji, markdown or invented detail.`;
}

async function callOriginalGroq(options, prompt, config = {}) {
  let parsed;
  try { parsed = JSON.parse(String(options.body || '{}')); } catch (_) { return null; }
  const messages = Array.isArray(parsed.messages) ? parsed.messages.map(m => ({ ...m })) : [];
  if (!messages.length) return null;
  messages[messages.length - 1].content = prompt;
  parsed.messages = messages;
  parsed.temperature = config.temperature ?? 0.08;
  parsed.reasoning_effort = config.reasoning_effort || 'low';
  parsed.include_reasoning = false;
  parsed.max_tokens = config.max_tokens || 2400;
  return ORIGINAL_FETCH('https://api.groq.com/openai/v1/chat/completions', { ...options, body: JSON.stringify(parsed) });
}

async function verifyNarration(originalPrompt, narration, options) {
  const verifyPrompt = `${GUARD_MARKER}: FACT-CONSISTENCY CHECK\n\nSOURCE CONTEXT:\n${originalPrompt}\n\nNARRATION:\n${narration}\n\nCompare every number/value, named entity, place, technical term, quantity, limitation and cause/effect claim against the supplied verified fact. Any changed value, invented detail, stronger claim, or unsupported explanation is FAIL.\n\nReturn exactly one word: PASS or FAIL`;
  try {
    const response = await callOriginalGroq(options, verifyPrompt, { temperature: 0, max_tokens: 24, reasoning_effort: 'low' });
    if (!response || typeof response.clone !== 'function') return null;
    const data = await response.clone().json();
    const result = String(getGroqContent(data) || '').trim().toUpperCase();
    console.log(`${GUARD_MARKER}: independent fact check = ${result || 'EMPTY'}`);
    if (result.startsWith('PASS')) return true;
    if (result.startsWith('FAIL')) return false;
    return null;
  } catch (e) {
    console.log(`${GUARD_MARKER}: independent fact check = ERROR (${e.message})`);
    return null;
  }
}

function makeJsonResponse(data, response) {
  return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers: response.headers });
}

function normalizeCtaText() {
  return 'వీడియో నచ్చితే లైక్ చేసి షేర్ చేయండి. మరిన్ని ఇలాంటి వీడియోల కోసం సబ్‌స్క్రైబ్ చేయండి.';
}

async function guardedFetch(url, options = {}) {
  if (isGoogleTtsRequest(url, options)) {
    try {
      const parsed = JSON.parse(String(options.body || '{}'));
      const raw = JSON.stringify(parsed.input || {});
      if (/సబ్‌స్క్రైబ్|subscribe/i.test(raw)) {
        parsed.input = { ...(parsed.input || {}), text: normalizeCtaText() };
        parsed.audioConfig = { ...(parsed.audioConfig || {}), speakingRate: 1.75 };
      } else {
        // Slightly faster than the old default, while retaining natural Telugu pronunciation.
        parsed.audioConfig = { ...(parsed.audioConfig || {}), speakingRate: 1.10 };
      }
      return ORIGINAL_FETCH(url, { ...options, body: JSON.stringify(parsed) });
    } catch (_) {
      return ORIGINAL_FETCH(url, options);
    }
  }

  if (!isGroqChatRequest(url, options)) return ORIGINAL_FETCH(url, options);

  let parsed;
  try { parsed = JSON.parse(String(options.body || '{}')); } catch (_) { return ORIGINAL_FETCH(url, options); }
  const messages = Array.isArray(parsed.messages) ? parsed.messages.map(m => ({ ...m })) : [];
  const last = messages.length ? messages[messages.length - 1] : null;
  const originalPrompt = last && typeof last.content === 'string' ? last.content : '';
  const patched = patchPrompt(originalPrompt);

  parsed.reasoning_effort = 'low';
  parsed.include_reasoning = false;
  parsed.max_tokens = patched.kind === 'narration' ? 2400 : patched.kind === 'beats' ? 900 : 1600;
  if (patched.kind !== 'other') {
    parsed.temperature = patched.kind === 'narration' ? 0.16 : 0.10;
    if (last) last.content = patched.prompt;
  }
  options = { ...options, body: JSON.stringify(parsed) };

  const response = await ORIGINAL_FETCH(url, options);
  if (patched.kind !== 'narration' || !response || typeof response.clone !== 'function') return response;

  try {
    const data = await response.clone().json();
    let content = getGroqContent(data);

    if (typeof content !== 'string' || !content.trim()) {
      console.log(`${GUARD_MARKER}: empty narration response detected — running recovery pass.`);
      const recoveryResponse = await callOriginalGroq(options, buildEmptyRetryPrompt(patched.prompt), { temperature: 0.08, max_tokens: 2400, reasoning_effort: 'low' });
      if (recoveryResponse && typeof recoveryResponse.clone === 'function') {
        const recoveryData = await recoveryResponse.clone().json();
        const recovered = cleanNarration(getGroqContent(recoveryData));
        if (recovered && !hasBadAsciiNumber(recovered) && !hasBadStyle(recovered)) {
          recoveryData.choices[0].message.content = recovered;
          console.log(`${GUARD_MARKER}: FINAL NARRATION\n${recovered}`);
          return makeJsonResponse(recoveryData, recoveryResponse);
        }
      }
      return response;
    }

    content = cleanNarration(content);
    const reasons = [];
    if (!content.trim()) reasons.push('empty narration');
    if (hasBadAsciiNumber(content)) reasons.push('ASCII number detected');
    if (hasBadStyle(content)) reasons.push('fragmented/repetitive/dramatic style detected');

    if (!reasons.length) {
      const factPass = await verifyNarration(patched.prompt, content, options);
      if (factPass === false) reasons.push('independent fact check failed');
      else if (factPass === null) console.log(`${GUARD_MARKER}: independent fact check unavailable — keeping locally clean narration.`);
    }

    if (reasons.length) {
      console.log(`${GUARD_MARKER}: narration repair required — ${reasons.join(' | ')}`);
      const repairResponse = await callOriginalGroq(options, buildRepairPrompt(patched.prompt, content, reasons), { temperature: 0.05, max_tokens: 2400, reasoning_effort: 'low' });
      if (repairResponse && typeof repairResponse.clone === 'function') {
        const repairData = await repairResponse.clone().json();
        const repaired = cleanNarration(getGroqContent(repairData));
        if (repaired && !hasBadAsciiNumber(repaired) && !hasBadStyle(repaired)) {
          const repairFactPass = await verifyNarration(patched.prompt, repaired, options);
          if (repairFactPass !== false) {
            repairData.choices[0].message.content = repaired;
            console.log(`${GUARD_MARKER}: repair accepted.`);
            console.log(`${GUARD_MARKER}: FINAL NARRATION\n${repaired}`);
            return makeJsonResponse(repairData, repairResponse);
          }
          console.log(`${GUARD_MARKER}: repaired narration failed fact check — keeping original response rather than accepting a potentially altered fact.`);
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
console.log(`${GUARD_MARKER}: enabled — fact-first Telugu narration + TTS pacing rules active.`);
module.exports = { enabled: true, marker: GUARD_MARKER };