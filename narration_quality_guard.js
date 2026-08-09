// Stable narration-quality guard.
// One guard only; no generated vN patch files.

const ORIGINAL_FETCH = global.fetch;
const GUARD_MARKER = 'NARRATION_QUALITY_GUARD_V4';

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

// IMPORTANT: classify beats BEFORE narration. Both prompts contain
// "VERIFIED FACT"; using that phrase alone was the root cause of the
// previous bug where Story Beats were mislabeled as FINAL NARRATION.
function classifyPrompt(prompt) {
  const p = String(prompt || '');

  const isBeats =
    /STORY BEATS/i.test(p) &&
    (/5 beats only|5 beats మాత్రమే|story beats ని JSON|\"hook\".*\"question\".*\"reveal\".*\"twist\".*\"ending\"/is.test(p));
  if (isBeats) return 'beats';

  const isNarration =
    /CALL A of Stage 2|high-retention storyteller|TARGET RHYTHM|final narration text only|12-18 short spoken lines/i.test(p) &&
    /STORY BEATS/i.test(p);
  if (isNarration) return 'narration';

  return 'other';
}

function qualitySuffix(kind) {
  if (kind === 'beats') return `\n\n${GUARD_MARKER}: FACT-LOCK RULES
- VERIFIED FACT లో ఉన్న సంఖ్యలు, పేర్లు, ప్రదేశాలు, కాల పరిమితులు, శాస్త్రీయ పదాలు మరియు cause/effect claims ఏవీ మార్చవద్దు.
- Fact లో లేని కొత్త సంఖ్య, percentage, year, person, place, comparison లేదా consequence జోడించవద్దు.
- Hook sensational గా ఉండవచ్చు, కానీ verified claim కి మించి overclaim చేయవద్దు.
- ప్రతి beat అదే verified fact కి నేరుగా సంబంధించినదే కావాలి.
- ఒకే fact ని రెండు beats లో duplicate చేయవద్దు.`;

  if (kind === 'narration') return `\n\n${GUARD_MARKER}: FINAL NARRATION QUALITY CONTRACT
- Natural spoken Telugu మాత్రమే. పుస్తక తెలుగు, news-reader style, literal translation, AI-sounding filler వద్దు.
- Viewer ఒక friend దగ్గర surprising fact వింటున్నట్టు conversational గా చెప్పు.
- VERIFIED FACT లోని సంఖ్యలు, values, names, places, dates, technical terms మరియు uncertainty/limitation words అచ్చంగా preserve చేయాలి.
- Source fact లో ఉన్న value మార్చవద్దు. కొత్త number, statistic, example, comparison, distance, consequence లేదా biological/economic explanation invent చేయవద్దు.
- Source లో may/can/some/about/nearly/certain వంటి limitation ఉంటే దాన్ని always/all/exactly/guaranteed గా మార్చవద్దు.
- ఒకే claim ని synonym మార్చి మళ్లీ చెప్పవద్దు. ప్రతి line కొత్త information లేదా meaningful transition ఇవ్వాలి.
- Forced metaphors, generic poetic filler, vague slogans వద్దు.
- Telugu grammar first: subject, verb, case endings and sentence agreement సహజంగా ఉండాలి.
- Technical term English లో అవసరమైతే మాత్రమే; random English words వద్దు.
- ASCII digits వద్దు. సంఖ్యలు తెలుగు మాటల్లోనే రాయి.
- CTA, title, emoji, labels, markdown వద్దు.
- 12-18 short spoken lines; repeated sentences వద్దు.
- Final line fact-specific memorable takeaway కావాలి.
- Final output narration మాత్రమే.`;

  return '';
}

function patchPrompt(prompt) {
  const kind = classifyPrompt(prompt);
  const suffix = qualitySuffix(kind);
  if (!suffix || String(prompt).includes(GUARD_MARKER)) return { prompt: String(prompt), kind };
  return { prompt: String(prompt) + suffix, kind };
}

function getGroqContent(data) {
  return data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : null;
}

function hasBadAsciiNumber(output) {
  return /\b\d+(?:[.,]\d+)?\b/.test(String(output || ''));
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
  return /పేరు గుర్తింపు|కొంచెం ఒకేలా|అద్భుతమైన మాయ|సుంకించెదు|ఆన్‌లైన్.?శాపం/.test(s) || hasObviousRepetition(s);
}

function buildRepairPrompt(originalPrompt, badOutput, reasons) {
  return `${originalPrompt}\n\n${GUARD_MARKER}: FINAL REPAIR PASS
The previous narration failed these checks: ${reasons.join('; ')}.
Rewrite ONLY the narration from scratch. Preserve every verified fact and value. Remove repetition and unnatural Telugu. Do not invent any fact, number, example, comparison, consequence or location. Keep 12-18 short spoken lines and natural conversational Telugu. Return narration only.` +
    `\n\nPREVIOUS NARRATION:\n${badOutput}`;
}

function buildEmptyRetryPrompt(originalPrompt) {
  return `${originalPrompt}\n\n${GUARD_MARKER}: EMPTY-OUTPUT RECOVERY
Your previous response was empty because it exhausted its output budget. Do NOT reason aloud. Do NOT explain. Return only the final Telugu narration, 85-115 words, 12-18 short lines, preserving ONLY the supplied verified fact. No JSON, labels, title, CTA, emoji or markdown.`;
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
  if (config.max_tokens) parsed.max_tokens = config.max_tokens;
  return ORIGINAL_FETCH('https://api.groq.com/openai/v1/chat/completions', {
    ...options,
    body: JSON.stringify(parsed)
  });
}

async function verifyNarration(originalPrompt, narration, options) {
  const verifyPrompt = `${GUARD_MARKER}: FACT-CONSISTENCY CHECK

VERIFIED FACT AND STORY CONTEXT:
${originalPrompt}

GENERATED NARRATION:
${narration}

Compare every number/value, named entity, place, technical term, quantity, limitation and cause/effect claim against the verified fact. Any changed value, invented detail, or stronger claim is FAIL.

Return exactly one word: PASS or FAIL`;
  try {
    const response = await callOriginalGroq(options, verifyPrompt, { temperature: 0, max_tokens: 24, reasoning_effort: 'low' });
    if (!response || typeof response.clone !== 'function') {
      console.log(`${GUARD_MARKER}: independent fact check = SKIPPED`);
      return null;
    }
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
  return new Response(JSON.stringify(data), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

function normalizeCtaText(text) {
  if (!/సబ్‌స్క్రైబ్|subscribe/i.test(text)) return text;
  return 'వీడియో నచ్చితే లైక్ చేసి షేర్ చేయండి. మరిన్ని ఇలాంటి వీడియోల కోసం సబ్‌స్క్రైబ్ చేయండి.';
}

async function guardedFetch(url, options = {}) {
  if (isGoogleTtsRequest(url, options)) {
    try {
      const parsed = JSON.parse(String(options.body || '{}'));
      const raw = JSON.stringify(parsed.input || {});
      if (/సబ్‌స్క్రైబ్|subscribe/i.test(raw)) {
        parsed.input = { ...(parsed.input || {}), text: normalizeCtaText(String(parsed.input.text || '')) };
        parsed.audioConfig = { ...(parsed.audioConfig || {}), speakingRate: 1.75 };
        return ORIGINAL_FETCH(url, { ...options, body: JSON.stringify(parsed) });
      }
    } catch (_) {}
    return ORIGINAL_FETCH(url, options);
  }

  if (!isGroqChatRequest(url, options)) return ORIGINAL_FETCH(url, options);

  let parsed;
  try { parsed = JSON.parse(String(options.body || '{}')); } catch (_) { return ORIGINAL_FETCH(url, options); }
  const messages = Array.isArray(parsed.messages) ? parsed.messages.map(m => ({ ...m })) : [];
  const last = messages.length ? messages[messages.length - 1] : null;
  const originalPrompt = last && typeof last.content === 'string' ? last.content : '';
  const patched = patchPrompt(originalPrompt);

  // Keep every Groq request inside the practical token budget. GPT-OSS
  // reasoning tokens are part of the completion budget, so low reasoning is
  // important for these short production tasks.
  parsed.reasoning_effort = 'low';
  parsed.include_reasoning = false;
  parsed.max_tokens = patched.kind === 'narration' ? 3000 :
    patched.kind === 'beats' ? 900 :
    Math.min(Number(parsed.max_tokens) || 6000, 1600);

  if (patched.kind !== 'other') {
    parsed.temperature = patched.kind === 'narration' ? 0.20 : 0.14;
    parsed.messages = messages;
    if (last) last.content = patched.prompt;
    options = { ...options, body: JSON.stringify(parsed) };
  } else {
    options = { ...options, body: JSON.stringify(parsed) };
  }

  const response = await ORIGINAL_FETCH(url, options);
  if (patched.kind !== 'narration' || !response || typeof response.clone !== 'function') return response;

  try {
    const data = await response.clone().json();
    let content = getGroqContent(data);

    // GPT-OSS can spend the whole completion budget on reasoning and return
    // an empty visible message. Recover once with low reasoning and a compact
    // output budget instead of letting the whole video run die.
    if (typeof content !== 'string' || !content.trim()) {
      console.log(`${GUARD_MARKER}: empty narration response detected — running compact recovery pass.`);
      const recoveryResponse = await callOriginalGroq(options, buildEmptyRetryPrompt(patched.prompt), {
        temperature: 0.12,
        max_tokens: 2200,
        reasoning_effort: 'low'
      });
      if (recoveryResponse && typeof recoveryResponse.clone === 'function') {
        const recoveryData = await recoveryResponse.clone().json();
        const recovered = getGroqContent(recoveryData);
        if (typeof recovered === 'string' && recovered.trim()) {
          const cleanedRecovered = cleanNarration(recovered);
          if (cleanedRecovered && !hasBadAsciiNumber(cleanedRecovered) && !hasBadStyle(cleanedRecovered)) {
            recoveryData.choices[0].message.content = cleanedRecovered;
            console.log(`${GUARD_MARKER}: empty-response recovery accepted.`);
            console.log(`${GUARD_MARKER}: FINAL NARRATION\n${cleanedRecovered}`);
            return makeJsonResponse(recoveryData, recoveryResponse);
          }
        }
      }
      return response;
    }

    content = cleanNarration(content);
    const reasons = [];
    if (!content.trim()) reasons.push('empty narration');
    if (hasBadAsciiNumber(content)) reasons.push('ASCII number detected');
    if (hasBadStyle(content)) reasons.push('repetition or unnatural Telugu detected');

    // A verifier outage/rate-limit is not itself a reason to rewrite a good
    // narration. This prevents the old empty-verifier -> repair -> more
    // Groq calls -> rate-limit cascade.
    if (!reasons.length) {
      const factPass = await verifyNarration(patched.prompt, content, options);
      if (factPass === false) reasons.push('independent fact check failed');
      else if (factPass === null) console.log(`${GUARD_MARKER}: independent fact check unavailable — keeping locally clean narration.`);
    }

    if (reasons.length) {
      console.log(`${GUARD_MARKER}: narration contract violation detected — repair reasons: ${reasons.join(' | ')}`);
      const repairResponse = await callOriginalGroq(options, buildRepairPrompt(patched.prompt, content, reasons), {
        temperature: 0.08,
        max_tokens: 2600,
        reasoning_effort: 'low'
      });
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
