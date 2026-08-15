// Stable narration-quality guard V9.
// Quality checks are non-blocking: one Groq request per narration generation.
// This avoids retry/repair request loops that can amplify rate limits.

const ORIGINAL_FETCH = global.fetch;
const GUARD_MARKER = 'NARRATION_QUALITY_GUARD_V9';

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
  if (/ACCURACY:\s*(VERIFIED|REJECTED)|VIRAL APPEAL|SCORE:\s*\(0-100/i.test(p)) return 'verification';
  if (/punctuation|PUNCTUATION|పదాలు ఏమీ మార్చకుండా|కేవలం punctuation మాత్రమే/i.test(p)) return 'punctuation';
  if (/HOOK:|TITLE:|KEYWORDS:/i.test(p) && /metadata|metadata ఇవ్వు|ఖచ్చితంగా ఈ 3-లైన్ల/i.test(p)) return 'metadata';
  return 'other';
}

function tokenBudget(kind) {
  // GPT-OSS reasoning tokens share the completion budget, so keep enough
  // headroom for both reasoning and the requested Telugu narration.
  if (kind === 'narration') return 3000;
  if (kind === 'beats') return 600;
  if (kind === 'verification') return 350;
  if (kind === 'punctuation') return 700;
  if (kind === 'metadata') return 500;
  return 1000;
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

function qualityReasons(text) {
  const s = String(text || '');
  const lines = s.split(/\n+/).map(x => x.trim()).filter(Boolean);
  const reasons = [];
  if (!s) reasons.push('empty narration');
  if (lines.length < 10 || lines.length > 18) reasons.push(`line count ${lines.length}`);
  if (lines.some(x => x.length > 180)) reasons.push('line too long');
  if (/\b\d+(?:[.,]\d+)?\b/.test(s)) reasons.push('ASCII number');
  if (/\.\.\./.test(s)) reasons.push('ellipsis');
  if ((s.match(/\?/g) || []).length > 2) reasons.push('too many questions');
  if (/\b(?:CLOCK|BMAL1|BMAL-1|PER|CRY|SCN|DNA|RNA|MRI|CPU|GPU|GPS|AI|API|TTS|STM|CRISPR)\b/i.test(s)) reasons.push('raw technical acronym');
  const english = s.match(/\b[A-Za-z][A-Za-z0-9-]{2,}\b/g) || [];
  if (english.some(w => !['YouTube','Google','Groq','Pexels'].includes(w))) reasons.push('unnecessary English');
  return [...new Set(reasons)];
}

function suffix(kind) {
  if (kind === 'beats') return `\n\n${GUARD_MARKER}: FACT-FIRST STORY CONTRACT\n- VERIFIED FACT లోని numbers, values, names, places, dates and cause/effect claims మార్చవద్దు.\n- Fact లో లేని కొత్త number, percentage, year, person, place, comparison లేదా consequence invent చేయవద్దు.\n- Hook curiosity కోసం మాత్రమే; sensational overclaim వద్దు.`;
  if (kind === 'narration') return `\n\n${GUARD_MARKER}: FINAL NARRATION CONTRACT\n- సహజంగా మాట్లాడే తెలుగు మాత్రమే వాడు.\n- 12-18 meaningful lines; ప్రతి line సాధారణంగా 5-18 spoken words.\n- ప్రతి line పూర్తి సహజమైన spoken sentence లేదా natural spoken beat కావాలి; చాలా చిన్న fragment మాత్రమే వద్దు.\n- మొదట curiosity hook ఉండవచ్చు, కానీ verified fact వెంటనే స్పష్టంగా చెప్పాలి.\n- VERIFIED FACT లోని numbers, values, names, places, dates, uncertainty మరియు cause/effect claims మార్చవద్దు.\n- Fact లో లేని కొత్త detail, number, comparison లేదా explanation invent చేయవద్దు.\n- Technical acronyms అవసరమైతే తెలుగు ఉచ్చారణలో రాయి; raw English acronyms వద్దు.\n- ASCII digits, unnecessary English, ellipsis, CTA, title, emoji, markdown వద్దు.\n- గరిష్ఠంగా రెండు ప్రశ్నలు. చివరి line fact-specific takeaway కావాలి.\n- Final output narration మాత్రమే.`;
  return '';
}

function patchPrompt(prompt) {
  const kind = classify(prompt);
  const extra = suffix(kind);
  if (!extra || String(prompt).includes(GUARD_MARKER)) return { prompt:String(prompt), kind };
  return { prompt:String(prompt) + extra, kind };
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
  if (!Array.isArray(body.messages) || !body.messages.length) return ORIGINAL_FETCH(url, options);

  const last = body.messages[body.messages.length - 1];
  const originalPrompt = last && typeof last.content === 'string' ? last.content : '';
  const patched = patchPrompt(originalPrompt);

  body = {
    ...body,
    messages: body.messages.map(m => ({ ...m })),
    temperature: patched.kind === 'narration' ? 0.10 : 0.05,
    reasoning_effort: 'low',
    include_reasoning: false,
    max_completion_tokens: tokenBudget(patched.kind)
  };
  delete body.max_tokens;
  body.messages[body.messages.length - 1].content = patched.prompt;

  // Exactly ONE upstream Groq request for this generation.
  const response = await ORIGINAL_FETCH(url, { ...options, body:JSON.stringify(body) });
  if (patched.kind !== 'narration' || !response || typeof response.clone !== 'function') return response;

  try {
    const data = await response.clone().json();
    const content = normalizeTechnicalTerms(clean(getContent(data)));
    if (!content) {
      console.log(`${GUARD_MARKER}: empty narration response; preserving primary response. No retry/repair request.`);
      return response;
    }

    const reasons = qualityReasons(content);
    if (reasons.length) {
      console.log(`${GUARD_MARKER}: quality warnings — ${reasons.join(' | ')}; accepting single response without another Groq call.`);
    } else {
      console.log(`${GUARD_MARKER}: FINAL NARRATION accepted by local quality checks.`);
    }

    data.choices[0].message.content = content;
    return new Response(JSON.stringify(data), { status:response.status, statusText:response.statusText, headers:response.headers });
  } catch (e) {
    console.log(`${GUARD_MARKER}: response parsing/guard handling failed (${e.message}); preserving primary response.`);
    return response;
  }
}

guardedFetch.__NARRATION_QUALITY_GUARD__ = true;
global.fetch = guardedFetch;
console.log(`${GUARD_MARKER}: enabled — single-request Groq budgets + non-blocking narration quality checks active.`);
module.exports = { enabled:true, marker:GUARD_MARKER };