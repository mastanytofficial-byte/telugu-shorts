// Stable narration-quality guard V6 (strengthened).
// Fact-first Telugu narration with strict sentence, terminology and TTS pacing checks.

const ORIGINAL_FETCH = global.fetch;
const GUARD_MARKER = 'NARRATION_QUALITY_GUARD_V6';

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
  if (
    /TARGET RHYTHM|high-retention storyteller|CALL A of Stage 2|final narration text only|12-18 short spoken lines|natural spoken Telugu/i.test(p) &&
    /STORY BEATS/i.test(p)
  ) return 'narration';
  if (/STORY BEATS/i.test(p) && /5 beats only|5 beats మాత్రమే|story beats ని JSON|"hook".*"question".*"reveal".*"twist".*"ending"/is.test(p)) return 'beats';
  return 'other';
}

function qualitySuffix(kind) {
  if (kind === 'beats') return `\n\n${GUARD_MARKER}: FACT-FIRST STORY CONTRACT\n- VERIFIED FACT లోని numbers, values, names, places, dates, technical terms, uncertainty and cause/effect claims మార్చవద్దు.\n- Fact లో లేని కొత్త number, percentage, year, person, place, comparison, consequence లేదా explanation జోడించవద్దు.\n- Hook curiosity కోసం మాత్రమే; sensational overclaim వద్దు.\n- Question సహజమైన curiosity కావాలి.\n- Reveal లో verified fact యొక్క core answer స్పష్టంగా ఉండాలి.\n- Twist అనే పేరు ఉన్నా కల్పిత dramatic twist వద్దు.\n- ప్రతి beat ఒకే verified fact కి నేరుగా సంబంధించినదే కావాలి.`;

  if (kind === 'narration') return `\n\n${GUARD_MARKER}: FINAL FACT-NARRATION CONTRACT\n- ఇది fiction కాదు. ఇది verified fact ని clear గా explain చేసే Telugu micro-documentary narration.\n- Fact-first, drama-second. మొదటి ఒకటి లేదా రెండు lines curiosity hook కావచ్చు; వెంటనే అసలు fact ని స్పష్టంగా చెప్పాలి.\n- సహజంగా మాట్లాడే తెలుగు మాత్రమే వాడు. పుస్తక తెలుగు, news-reader style, literal translation, AI-sounding filler వద్దు.\n- మొత్తం narration 10-14 meaningful lines గా ఉండాలి. ప్రతి line సాధారణంగా 7-18 spoken words ఉండాలి.\n- ప్రతి line పూర్తి అర్థం ఉన్న సహజమైన వాక్యం కావాలి. "అవును, నిజంగా.", "అది నిజమే.", "అసలు, ఏమిటంటే." వంటి fragment-only lines వద్దు.\n- ఒక thought ని అనవసరంగా రెండు చిన్న lines గా విరగొట్టవద్దు. ప్రతి sentence లో subject/action/meaning స్పష్టంగా ఉండాలి.\n- Information flow: hook → context → verified fact → how/why → important detail → fact-specific takeaway.\n- ప్రతి sentence తరువాత suspense question లేదా cliffhanger పెట్టవద్దు. గరిష్ఠంగా రెండు ప్రశ్నలు మాత్రమే.\n- ఒకే claim ని మళ్లీ synonyms తో repeat చేయవద్దు.\n- Forced metaphors, generic morals, emotional drama, personal examples లేదా unsupported comparisons వద్దు.\n- VERIFIED FACT లోని numbers, values, names, places, dates, technical terms, uncertainty and limitations మార్చవద్దు.\n- Fact లో లేని కొత్త number, statistic, example, distance, comparison, consequence లేదా scientific/economic explanation invent చేయవద్దు.\n- Technical acronyms అవసరమైతే మాత్రమే వాడు. Final Telugu narration లో raw English acronyms ని comma-separated list లాగా ఇవ్వవద్దు. ఉదాహరణకు CLOCK, BMAL1, PER, CRY అని వరుసగా రాయకుండా, అవి అవసరమైనప్పుడు "క్లాక్", "బీఎంఏఎల్ ఒకటి", "పీఈఆర్", "సీఆర్‌వై" వంటి తెలుగు ఉచ్చారణ రూపంలో సహజమైన వాక్యంలో కలపాలి.\n- Random English words వద్దు. Brand/model/product names మాత్రమే అవసరమైతే original form లో ఉంచవచ్చు.\n- ASCII digits వద్దు. సంఖ్యలు తెలుగు మాటల్లోనే రాయి.\n- Comma breath/pause కోసం మాత్రమే అధికంగా వాడవద్దు. Meaning/grammar కి అవసరమైనప్పుడు మాత్రమే comma పెట్టు.\n- Ellipsis (...) వద్దు.\n- ప్రతి line చివర suspense punctuation పెట్టవద్దు. Full-stop లేదా సహజమైన punctuation వాడు.\n- CTA, title, emoji, labels, markdown వద్దు.\n- చివరి line verified fact కి సంబంధించిన memorable takeaway కావాలి; generic moral కాదు.\n- Final output narration మాత్రమే.`;
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
    .replace(/^NARRATION:\s*/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hasBadAsciiNumber(output) {
  return /\b\d+(?:[.,]\d+)?\b/.test(String(output || ''));
}

const RAW_ACRONYM_RE = /\b(?:CLOCK|BMAL1|BMAL-1|PER|CRY|SCN|DNA|RNA|MRI|CPU|GPU|GPS|AI|API|TTS|STM|CRISPR)\b/;
const ALLOWED_ENGLISH = new Set(['YouTube', 'Google', 'Groq', 'Pexels', 'AI']);

function hasRawTechnicalAcronym(content) {
  return RAW_ACRONYM_RE.test(String(content || ''));
}

function hasUnexpectedEnglish(content) {
  const words = String(content || '').match(/\b[A-Za-z][A-Za-z0-9-]{2,}\b/g) || [];
  return words.some(w => !ALLOWED_ENGLISH.has(w) && !RAW_ACRONYM_RE.test(w));
}

function hasObviousRepetition(content) {
  const lines = String(content || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
  const normalized = lines.map(s => s.replace(/[!?.,…]+$/g, '').replace(/\s+/g, ' '));
  const seen = new Set();
  for (const line of normalized) {
    if (line.length >= 12 && seen.has(line)) return true;
    if (line.length >= 12) seen.add(line);
  }
  for (let i = 0; i < normalized.length - 1; i++) {
    const a = normalized[i].split(/\s+/).slice(0, 6).join(' ');
    const b = normalized[i + 1].split(/\s+/).slice(0, 6).join(' ');
    if (a.length >= 14 && a === b) return true;
  }
  return false;
}

function hasBadStyle(content) {
  const s = String(content || '');
  const lines = s.split(/\n+/).map(x => x.trim()).filter(Boolean);
  if (lines.length < 9 || lines.length > 14) return true;
  if (lines.filter(x => x.split(/\s+/).filter(Boolean).length < 5).length >= 2) return true;
  if (lines.some(x => x.length > 150)) return true;
  if ((s.match(/\.\.\./g) || []).length > 0) return true;
  if ((s.match(/\?/g) || []).length > 2) return true;
  if (hasObviousRepetition(s)) return true;
  return false;
}

function hasFragmentPatterns(content) {
  const lines = String(content || '').split(/\n+/).map(x => x.trim()).filter(Boolean);
  return lines.some(line => /^(అవును|నిజంగా|సరే|అదే|అది|ఇది|అంటే|కానీ|అయితే)\s*[,.!?…]*$/.test(line));
}

function buildRepairPrompt(originalPrompt, badOutput, reasons) {
  return `${originalPrompt}\n\n${GUARD_MARKER}: STRICT FINAL REPAIR PASS\nPrevious narration failed: ${reasons.join('; ')}.\nRewrite ONLY the narration as a natural Telugu fact-video script. Preserve every verified fact, value, limitation, name, date and cause/effect claim. Do not invent any new number, example, comparison, consequence or explanation.\n\nMANDATORY OUTPUT RULES:\n- 10-14 meaningful lines.\n- Each line should normally contain 7-18 spoken words and be a complete natural sentence.\n- Never output fragment-only lines such as "అవును, నిజంగా."\n- Do not split one thought into multiple tiny lines.\n- Use conversational Telugu with normal Telugu word order.\n- Explain the fact directly instead of stacking rhetorical questions. Maximum two questions total.\n- Do not repeat the same claim.\n- Do not use raw acronym lists such as CLOCK, BMAL1, PER, CRY. If a technical acronym is essential, render it in Telugu pronunciation inside a normal sentence: క్లాక్, బీఎంఏఎల్ ఒకటి, పీఈఆర్, సీఆర్‌వై.\n- No ASCII digits, no ellipsis, no JSON, no labels, no title, no emoji, no CTA, no markdown.\n- Commas only where grammar or meaning requires them.\n- Last line must be a fact-specific takeaway.\nReturn narration only.\n\nPREVIOUS NARRATION:\n${badOutput}`;
}

function buildEmptyRetryPrompt(originalPrompt) {
  return `${originalPrompt}\n\n${GUARD_MARKER}: EMPTY-OUTPUT RECOVERY\nReturn ONLY the final Telugu narration. Use 10-14 meaningful lines, 7-18 spoken words per line, complete natural sentences, fact-first and conversational. Preserve ONLY the supplied verified fact. No JSON, labels, title, CTA, emoji, markdown, ASCII digits or invented detail.`;
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
  const verifyPrompt = `${GUARD_MARKER}: FACT-CONSISTENCY CHECK\n\nSOURCE CONTEXT:\n${originalPrompt}\n\nNARRATION:\n${narration}\n\nCheck every number/value, named entity, place, technical term, quantity, limitation and cause/effect claim against the supplied verified fact. Telugu pronunciation forms of the same technical acronym are allowed. Any changed value, invented detail, stronger claim or unsupported explanation is FAIL. Return exactly one word: PASS or FAIL`;
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

async function guardedFetch(url, options = {}) {
  if (isGoogleTtsRequest(url, options)) {
    try {
      const parsed = JSON.parse(String(options.body || '{}'));
      const raw = JSON.stringify(parsed.input || {});
      const isCta = /సబ్‌స్క్రైబ్|subscribe/i.test(raw);
      parsed.audioConfig = { ...(parsed.audioConfig || {}), speakingRate: isCta ? 1.10 : 1.06 };
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
    parsed.temperature = 0.10;
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
      const recoveryResponse = await callOriginalGroq(options, buildEmptyRetryPrompt(patched.prompt), { temperature: 0.06, max_tokens: 2400, reasoning_effort: 'low' });
      if (recoveryResponse && typeof recoveryResponse.clone === 'function') {
        const recoveryData = await recoveryResponse.clone().json();
        const recovered = cleanNarration(getGroqContent(recoveryData));
        const recoveryBad = hasBadAsciiNumber(recovered) || hasRawTechnicalAcronym(recovered) || hasUnexpectedEnglish(recovered) || hasBadStyle(recovered) || hasFragmentPatterns(recovered);
        if (recovered && !recoveryBad) {
          recoveryData.choices[0].message.content = recovered;
          console.log(`${GUARD_MARKER}: recovery accepted.`);
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
    if (hasRawTechnicalAcronym(content)) reasons.push('raw technical acronym detected');
    if (hasUnexpectedEnglish(content)) reasons.push('unnecessary English word detected');
    if (hasBadStyle(content)) reasons.push('bad sentence length/pacing/repetition detected');
    if (hasFragmentPatterns(content)) reasons.push('sentence fragment detected');

    if (!reasons.length) {
      const factPass = await verifyNarration(patched.prompt, content, options);
      if (factPass === false) reasons.push('independent fact check failed');
      else if (factPass === null) console.log(`${GUARD_MARKER}: independent fact check unavailable — keeping locally clean narration.`);
    }

    if (reasons.length) {
      console.log(`${GUARD_MARKER}: narration repair required — ${reasons.join(' | ')}`);
      const repairResponse = await callOriginalGroq(options, buildRepairPrompt(patched.prompt, content, reasons), { temperature: 0.03, max_tokens: 2400, reasoning_effort: 'low' });
      if (repairResponse && typeof repairResponse.clone === 'function') {
        const repairData = await repairResponse.clone().json();
        const repaired = cleanNarration(getGroqContent(repairData));
        const repairedBad = !repaired || hasBadAsciiNumber(repaired) || hasRawTechnicalAcronym(repaired) || hasUnexpectedEnglish(repaired) || hasBadStyle(repaired) || hasFragmentPatterns(repaired);
        if (!repairedBad) {
          const repairFactPass = await verifyNarration(patched.prompt, repaired, options);
          if (repairFactPass !== false) {
            repairData.choices[0].message.content = repaired;
            console.log(`${GUARD_MARKER}: repair accepted.`);
            console.log(`${GUARD_MARKER}: FINAL NARRATION\n${repaired}`);
            return makeJsonResponse(repairData, repairResponse);
          }
          console.log(`${GUARD_MARKER}: repaired narration failed fact check.`);
        } else {
          console.log(`${GUARD_MARKER}: repaired narration still violates local style rules — refusing it.`);
        }
      }
      throw new Error(`${GUARD_MARKER}: narration quality gate failed after repair — refusing to publish broken narration.`);
    }

    data.choices[0].message.content = content;
    console.log(`${GUARD_MARKER}: FINAL NARRATION\n${content}`);
    return makeJsonResponse(data, response);
  } catch (e) {
    if (String(e.message || '').includes('narration quality gate failed')) throw e;
    console.log(`${GUARD_MARKER}: post-processing failed (${e.message}) — preserving primary response.`);
    return response;
  }
}

guardedFetch.__NARRATION_QUALITY_GUARD__ = true;
global.fetch = guardedFetch;
console.log(`${GUARD_MARKER}: enabled — fact-first Telugu narration + strict natural sentence/TTS rules active.`);
module.exports = { enabled: true, marker: GUARD_MARKER };
