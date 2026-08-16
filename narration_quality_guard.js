// Stable narration-quality guard V10.
// Enforces factual, logically connected narration without requiring pure Telugu.
// Quality checks are non-blocking and never create retry/repair Groq calls.

const ORIGINAL_FETCH = global.fetch;
const GUARD_MARKER = 'NARRATION_QUALITY_GUARD_V10';

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
  if (kind === 'narration') return 3000;
  if (kind === 'beats') return 600;
  if (kind === 'verification') return 350;
  if (kind === 'punctuation') return 700;
  if (kind === 'metadata') return 500;
  return 1000;
}

function getContent(data) {
  return data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content : null;
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

function qualityReasons(text) {
  const s = String(text || '');
  const lines = s.split(/\n+/).map(x => x.trim()).filter(Boolean);
  const reasons = [];
  if (!s) reasons.push('empty narration');
  if (lines.length < 10 || lines.length > 18) reasons.push(`line count ${lines.length}`);
  if (lines.some(x => x.length > 180)) reasons.push('line too long');
  if (/\b\d+(?:[.,]\d+)?\b/.test(s)) reasons.push('ASCII number');
  if ((s.match(/\? /g) || []).length > 2) reasons.push('too many questions');
  return [...new Set(reasons)];
}

function narrationContract() {
  return `\n\n${GUARD_MARKER}: FACT-EXPLANATION NARRATION CONTRACT\n- ఇది verified fact ని explain చేసే narration. Dramatic story, fictional storytelling లేదా news-reader style వద్దు.\n- ప్రతి line ఒక complete, natural spoken Telugu sentence/meaningful spoken thought గా ఉండాలి. అవసరం లేని sentence fragments వద్దు.\n- ప్రతి sentence ముందున్న sentence కి logically connect అవ్వాలి. Context → fact → supporting detail/evidence → explanation → fact-specific conclusion అనే సహజమైన progression వాడు.\n- ప్రతి line కి కొత్త suspense/twist అవసరం లేదు. Information naturally advance అవ్వాలి.\n- Hook curiosity కోసం ఉండొచ్చు, కానీ fake suspense లేదా sensational wording వద్దు. Question వాడితే అది fact ని explain చేయడానికి ఉపయోగపడాలి.\n- ఒక sentence లో vague reference వద్దు. “అది”, “ఇది”, “అక్కడ”, “అప్పుడు” వంటి words కి clear context ఉండాలి.\n- VERIFIED FACT లో ఉన్న numbers, dates, names, places, uncertainty, cause/effect మరియు scope మార్చవద్దు.\n- VERIFIED FACT లేదా story beats లో లేని new fact, number, example, comparison, cause, consequence లేదా claim invent చేయవద్దు.\n- “may/can/some/certain” వంటి limitations ని “అన్నీ/ఎప్పుడూ/ఖచ్చితంగా”గా overclaim చేయవద్దు.\n- English technical terms, brands, names, places, acronyms అవసరమైతే natural Telugu sentence లో వాడొచ్చు. Pure Telugu compulsory కాదు. Random English మాత్రం వద్దు.\n- Generic moral, motivational lesson, personal opinion, subscribe/CTA, title, labels, emoji, markdown వద్దు.\n- Final line తప్పనిసరిగా ఈ fact కి సంబంధించిన concise factual takeaway కావాలి; generic moral కాదు.\n- 12-18 spoken lines. Line breaks pacing కోసం మాత్రమే; grammar ని line-break కోసం break చేయవద్దు.\n- Final narration text మాత్రమే ఇవ్వు.`;
}

function patchPrompt(prompt) {
  const kind = classify(prompt);
  if (kind !== 'narration' || String(prompt).includes(GUARD_MARKER)) return { prompt: String(prompt), kind };
  return { prompt: String(prompt) + narrationContract(), kind };
}

async function guardedFetch(url, options = {}) {
  if (isTts(url, options)) {
    try {
      const body = JSON.parse(String(options.body || '{}'));
      body.audioConfig = { ...(body.audioConfig || {}), speakingRate: /సబ్‌స్క్రైబ్|subscribe/i.test(JSON.stringify(body.input || {})) ? 1.10 : 1.06 };
      return ORIGINAL_FETCH(url, { ...options, body: JSON.stringify(body) });
    } catch (_) {
      return ORIGINAL_FETCH(url, options);
    }
  }

  if (!isGroq(url, options)) return ORIGINAL_FETCH(url, options);

  let body;
  try { body = JSON.parse(String(options.body || '{}')); }
  catch (_) { return ORIGINAL_FETCH(url, options); }
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

  // Exactly one upstream Groq request for each generation.
  const response = await ORIGINAL_FETCH(url, { ...options, body: JSON.stringify(body) });
  if (patched.kind !== 'narration' || !response || typeof response.clone !== 'function') return response;

  try {
    const data = await response.clone().json();
    const content = clean(getContent(data));
    if (!content) {
      console.log(`${GUARD_MARKER}: empty narration response; preserving primary response. No retry/repair request.`);
      return response;
    }

    const reasons = qualityReasons(content);
    if (reasons.length) {
      console.log(`${GUARD_MARKER}: quality warnings — ${reasons.join(' | ')}; accepting single response without another Groq call.`);
    } else {
      console.log(`${GUARD_MARKER}: FINAL FACT NARRATION accepted by local quality checks.`);
    }

    data.choices[0].message.content = content;
    return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (e) {
    console.log(`${GUARD_MARKER}: response parsing/guard handling failed (${e.message}); preserving primary response.`);
    return response;
  }
}

guardedFetch.__NARRATION_QUALITY_GUARD__ = true;
global.fetch = guardedFetch;
console.log(`${GUARD_MARKER}: enabled — fact-explanation sentence style + single-request Groq budgets active.`);
module.exports = { enabled: true, marker: GUARD_MARKER };
