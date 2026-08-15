// Stable narration-quality guard V8 (rate-limit friendly).
// Keeps the quality gate, but avoids extra Groq calls that can exhaust TPM.

const ORIGINAL_FETCH = global.fetch;
const GUARD_MARKER = 'NARRATION_QUALITY_GUARD_V8';

if (!ORIGINAL_FETCH || ORIGINAL_FETCH.__NARRATION_QUALITY_GUARD__) {
  module.exports = { enabled: true, marker: GUARD_MARKER };
  return;
}

function isGroq(url, options) {
  return String(url).includes('api.groq.com/openai/v1/chat/completions') &&
    options && String(options.method || 'GET').toUpperCase() === 'POST';
}

function isTts(url, options) {
  return String(url).includes('texttospeech.googleapis.com/v1/text:synthesize') &&
    options && String(options.method || 'GET').toUpperCase() === 'POST';
}

function classify(prompt) {
  const p = String(prompt || '');
  if (/TARGET RHYTHM|high-retention storyteller|CALL A of Stage 2|final narration text only|12-18 short spoken lines|natural spoken Telugu/i.test(p) && /STORY BEATS/i.test(p)) return 'narration';
  if (/STORY BEATS/i.test(p) && /5 beats only|5 beats మాత్రమే|story beats ని JSON|"hook".*"question".*"reveal".*"twist".*"ending"/is.test(p)) return 'beats';
  return 'other';
}

function getContent(data) {
  return data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : null;
}

function clean(text) {
  return String(text || '')
    .replace(/^```(?:text|telugu)?\s*/i, '')
    .replace(/```$/i, '')
    .replace(/^SCRIPT:\s*/i, '')
    .replace(/^NARRATION:\s*/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeTechnicalTerms(text) {
  let s = String(text || '');
  const map = {
    'BMAL-1':'బీఎంఏఎల్ ఒకటి','BMAL1':'బీఎంఏఎల్ ఒకటి','CLOCK':'క్లాక్','GPS':'జీపీఎస్',
    'DNA':'డీఎన్ఏ','RNA':'ఆర్ఎన్ఏ','MRI':'ఎంఆర్ఐ','CPU':'సీపీయూ','GPU':'జీపీయూ',
    'API':'ఏపీఐ','TTS':'టీఎటీఎస్','CRISPR':'క్రిస్పర్','PER':'పీఈఆర్','CRY':'సీఆర్‌వై',
    'SCN':'ఎస్‌సీఎన్','STM':'ఎస్‌టీఎమ్','AI':'ఏఐ'
  };
  for (const [from,to] of Object.entries(map)) s = s.replace(new RegExp(`\\b${from}\\b`, 'gi'), to);
  return s.replace(/\b[A-Z]{2,8}\b/g, m => m.split('').map(c => ({A:'ఏ',B:'బీ',C:'సీ',D:'డీ',E:'ఈ',F:'ఎఫ్',G:'జీ',H:'ఏచ్',I:'ఐ',J:'జే',K:'కే',L:'ఎల్',M:'ఎమ్',N:'ఎన్',O:'ఓ',P:'పీ',Q:'క్యూ',R:'ఆర్',S:'ఎస్',T:'టీ',U:'యూ',V:'వీ',W:'డబ్ల్యూ',X:'ఎక్స్',Y:'వై',Z:'జెడ్'}[c] || c)).join(''));
}

function badReasons(text) {
  const s = String(text || '');
  const lines = s.split(/\n+/).map(x => x.trim()).filter(Boolean);
  const reasons = [];
  if (!s) reasons.push('empty narration');
  if (lines.length < 9 || lines.length > 14) reasons.push('wrong line count');
  if (lines.filter(x => x.split(/\s+/).filter(Boolean).length < 5).length >= 2) reasons.push('fragment lines');
  if (lines.some(x => x.length > 150)) reasons.push('line too long');
  if (/\b\d+(?:[.,]\d+)?\b/.test(s)) reasons.push('ASCII number');
  if (/\.\.\./.test(s)) reasons.push('ellipsis');
  if ((s.match(/\?/g) || []).length > 2) reasons.push('too many questions');
  if (/\b(?:CLOCK|BMAL1|BMAL-1|PER|CRY|SCN|DNA|RNA|MRI|CPU|GPU|GPS|AI|API|TTS|STM|CRISPR)\b/i.test(s)) reasons.push('raw technical acronym');
  const english = s.match(/\b[A-Za-z][A-Za-z0-9-]{2,}\b/g) || [];
  if (english.some(w => !['YouTube','Google','Groq','Pexels'].includes(w))) reasons.push('unnecessary English');
  const seen = new Set();
  for (const line of lines) {
    const n = line.replace(/[!?.,…]+$/g,'').replace(/\s+/g,' ');
    if (n.length >= 12 && seen.has(n)) reasons.push('repetition');
    if (n.length >= 12) seen.add(n);
  }
  return [...new Set(reasons)];
}

function suffix(kind) {
  if (kind === 'beats') return `\n\n${GUARD_MARKER}: FACT-FIRST STORY CONTRACT\n- VERIFIED FACT లోని numbers, values, names, places, dates and cause/effect claims మార్చవద్దు.\n- Fact లో లేని కొత్త number, percentage, year, person, place, comparison లేదా consequence invent చేయవద్దు.\n- Hook curiosity కోసం మాత్రమే; sensational overclaim వద్దు.`;
  if (kind === 'narration') return `\n\n${GUARD_MARKER}: FINAL NARRATION CONTRACT\n- సహజంగా మాట్లాడే తెలుగు మాత్రమే వాడు.\n- 10-14 meaningful lines; ప్రతి line సాధారణంగా 7-18 spoken words.\n- ప్రతి line పూర్తి సహజమైన వాక్యం కావాలి; fragment-only lines వద్దు.\n- మొదట curiosity hook ఉండవచ్చు, కానీ verified fact వెంటనే స్పష్టంగా చెప్పాలి.\n- VERIFIED FACT లోని numbers, values, names, places, dates, uncertainty మరియు cause/effect claims మార్చవద్దు.\n- Fact లో లేని కొత్త detail, number, comparison లేదా explanation invent చేయవద్దు.\n- Technical acronyms అవసరమైతే తెలుగు ఉచ్చారణలో రాయి; raw English acronyms వద్దు.\n- ASCII digits, unnecessary English, ellipsis, CTA, title, emoji, markdown వద్దు.\n- గరిష్ఠంగా రెండు ప్రశ్నలు. చివరి line fact-specific takeaway కావాలి.\n- Final output narration మాత్రమే.`;
  return '';
}

function patchPrompt(prompt) {
  const kind = classify(prompt);
  const extra = suffix(kind);
  if (!extra || String(prompt).includes(GUARD_MARKER)) return { prompt:String(prompt), kind };
  return { prompt:String(prompt) + extra, kind };
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function retryGroq(options, prompt, maxTokens) {
  let body;
  try { body = JSON.parse(String(options.body || '{}')); } catch (_) { return null; }
  if (!Array.isArray(body.messages) || !body.messages.length) return null;
  body.messages = body.messages.map(m => ({ ...m }));
  body.messages[body.messages.length - 1].content = prompt;
  body.temperature = 0.05;
  body.max_tokens = maxTokens;
  body.reasoning_effort = 'low';
  body.include_reasoning = false;
  return ORIGINAL_FETCH('https://api.groq.com/openai/v1/chat/completions', { ...options, body:JSON.stringify(body) });
}

async function guardedFetch(url, options = {}) {
  if (isTts(url, options)) {
    try {
      const body = JSON.parse(String(options.body || '{}'));
      const raw = JSON.stringify(body.input || {});
      body.audioConfig = { ...(body.audioConfig || {}), speakingRate:/సబ్‌స్క్రైబ్|subscribe/i.test(raw) ? 1.10 : 1.06 };
      return ORIGINAL_FETCH(url, { ...options, body:JSON.stringify(body) });
    } catch (_) { return ORIGINAL_FETCH(url, options); }
  }

  if (!isGroq(url, options)) return ORIGINAL_FETCH(url, options);

  let body;
  try { body = JSON.parse(String(options.body || '{}')); } catch (_) { return ORIGINAL_FETCH(url, options); }
  const last = Array.isArray(body.messages) && body.messages.length ? body.messages[body.messages.length - 1] : null;
  const originalPrompt = last && typeof last.content === 'string' ? last.content : '';
  const patched = patchPrompt(originalPrompt);

  if (patched.kind === 'other') return ORIGINAL_FETCH(url, options);

  body = { ...body, messages:body.messages.map(m => ({ ...m })), temperature:0.10, reasoning_effort:'low', include_reasoning:false };
  body.max_tokens = patched.kind === 'narration' ? 900 : 700;
  body.messages[body.messages.length - 1].content = patched.prompt;
  const patchedOptions = { ...options, body:JSON.stringify(body) };

  const response = await ORIGINAL_FETCH(url, patchedOptions);
  if (patched.kind !== 'narration' || !response || typeof response.clone !== 'function') return response;

  try {
    const data = await response.clone().json();
    let content = normalizeTechnicalTerms(clean(getContent(data)));

    if (!content) {
      console.log(`${GUARD_MARKER}: empty narration response; waiting before one low-token retry.`);
      await wait(20000);
      const retry = await retryGroq(patchedOptions, `${patched.prompt}\n\nReturn ONLY the narration now. Do not explain your process.`, 900);
      if (retry && typeof retry.clone === 'function') {
        const retryData = await retry.clone().json();
        content = normalizeTechnicalTerms(clean(getContent(retryData)));
        const retryReasons = badReasons(content);
        if (content && !retryReasons.length) {
          retryData.choices[0].message.content = content;
          console.log(`${GUARD_MARKER}: low-token retry accepted.`);
          return new Response(JSON.stringify(retryData), { status:retry.status, statusText:retry.statusText, headers:retry.headers });
        }
      }
      console.log(`${GUARD_MARKER}: narration still empty/invalid after one retry; returning primary response so the main pipeline can handle it.`);
      return response;
    }

    let reasons = badReasons(content);
    if (!reasons.length) {
      data.choices[0].message.content = content;
      console.log(`${GUARD_MARKER}: FINAL NARRATION accepted by local quality gate.`);
      return new Response(JSON.stringify(data), { status:response.status, statusText:response.statusText, headers:response.headers });
    }

    console.log(`${GUARD_MARKER}: repair required — ${reasons.join(' | ')}`);
    await wait(5000);
    const repairPrompt = `${patched.prompt}\n\n${GUARD_MARKER}: REPAIR\nPrevious output failed: ${reasons.join('; ')}. Rewrite ONLY the narration. Preserve the supplied verified fact exactly. Use natural Telugu, 10-14 complete lines, 7-18 spoken words per line, no English words, no Latin acronyms, no ASCII digits, no title or labels.`;
    const repair = await retryGroq(patchedOptions, repairPrompt, 900);
    if (repair && typeof repair.clone === 'function') {
      const repairData = await repair.clone().json();
      const repaired = normalizeTechnicalTerms(clean(getContent(repairData)));
      const repairReasons = badReasons(repaired);
      if (repaired && !repairReasons.length) {
        repairData.choices[0].message.content = repaired;
        console.log(`${GUARD_MARKER}: repair accepted.`);
        return new Response(JSON.stringify(repairData), { status:repair.status, statusText:repair.statusText, headers:repair.headers });
      }
      console.log(`${GUARD_MARKER}: repair rejected — ${repairReasons.join(' | ')}`);
    }
    throw new Error(`${GUARD_MARKER}: narration quality gate failed after one repair — refusing to publish broken narration.`);
  } catch (e) {
    if (String(e.message || '').includes('narration quality gate failed')) throw e;
    console.log(`${GUARD_MARKER}: response parsing/guard handling failed (${e.message}); preserving primary response.`);
    return response;
  }
}

guardedFetch.__NARRATION_QUALITY_GUARD__ = true;
global.fetch = guardedFetch;
console.log(`${GUARD_MARKER}: enabled — low-token narration checks + rate-limit-friendly recovery active.`);
module.exports = { enabled:true, marker:GUARD_MARKER };
