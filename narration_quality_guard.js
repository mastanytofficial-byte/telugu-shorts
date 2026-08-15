// Stable narration-quality guard V10.
// Enforces factual, logically connected narration style without forcing pure Telugu.
// Quality checks are non-blocking: one Groq request per narration generation.

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

function qualityReasons(text) {
  const s = String(text || '');
  const lines = s.split(/\n+/).map(x => x.trim()).filter(Boolean);
  const reasons = [];
  if (!s) reasons.push('empty narration');
  if (lines.length < 10 || lines.length > 18) reasons.push(`line count ${lines.length}`);
  if (lines.some(x => x.length > 180)) reasons.push('line too long');
  if ((s.match(/\?/g) || []).length > 2) reasons.push('too many questions');
  return [...new Set(reasons)];
}

function suffix(kind) {
  if (kind === 'beats') return `\n\n${GUARD_MARKER}: FACT-FIRST STORY CONTRACT\n- VERIFIED FACT లోని numbers, values, names, places, dates, uncertainty and cause/effect claims మార్చవద్దు.\n- Fact లో లేని కొత్త number, percentage, year, person, place, comparison లేదా consequence invent చేయవద్దు.\n- Hook curiosity కోసం మాత్రమే; sensational overclaim వద్దు.`;

  if (kind === 'narration') return `\n\n${GUARD_MARKER}: FACT-NARRATION CONTRACT — HIGHEST PRIORITY\n- Final output ఒక verified fact ని explain చేసే natural Telugu fact script అయి ఉండాలి. ఇది fiction, personal story లేదా generic motivational story కాదు.\n- నీ role storyteller కంటే fact explainer / science-documentary narrator. Story Beats ని final story గా copy చేయకుండా, వాటి information ని logically connected factual narration గా convert చేయి.\n- Information flow: hook/context → what the verified fact says → supporting detail/evidence → how or why it happens (ONLY if supported by VERIFIED FACT) → important implication/detail → fact-specific conclusion.\n- ప్రతి sentence ముందు sentence కి logical connection కలిగి ఉండాలి. ఒక sentence లో చెప్పిన విషయం తర్వాతి sentence కి context ఇవ్వాలి. Random facts లేదా disconnected punch lines వద్దు.\n- ప్రతి sentence పూర్తి అర్థం ఉన్న natural spoken sentence కావాలి. Suspense కోసం fragment-only lines ని ఎక్కువగా వాడవద్దు.\n- Hook curiosity కోసం ఉండొచ్చు, కానీ hook itself factual scope ని distort చేయకూడదు. Fake shock, fake twist, clickbait claim, exaggerated consequence వద్దు.\n- Final narration చదివినప్పుడు “ఒక విషయం/వాస్తవాన్ని narrator explain చేస్తున్నాడు” అనిపించాలి; “ఒక కథ చెప్తున్నాడు” అనిపించకూడదు.\n- VERIFIED FACT లో లేని కొత్త detail, number, example, location, person, comparison, cause/effect claim లేదా scientific explanation invent చేయవద్దు.\n- Source fact లో uncertainty/limits ఉంటే అదే uncertainty maintain చేయి. “may/can/some/certain” ని “always/all/definitely” గా మార్చవద్దు.\n- Technical terms, English words, acronyms, names and places అవసరమైనప్పుడు original form లో ఉంచవచ్చు. Pure Telugu గా మార్చాల్సిన అవసరం లేదు. Natural Telugu-English technical usage is allowed.\n- Numbers source fact లో ఉన్న form లో ఉండొచ్చు. TTS clarity కోసం మాత్రమే number wording మార్చాల్సి వస్తే meaning/value మాత్రం మార్చవద్దు.\n- Generic moral, life lesson, personal opinion, subscribe CTA లేదా unrelated conclusion వద్దు. Last line verified fact కి సంబంధించిన conclusion కావాలి.\n- గరిష్ఠంగా రెండు rhetorical questions. ప్రతి sentence తర్వాత suspense question వద్దు.\n- Punctuation natural spoken delivery కోసం వాడు; ellipsis ని overuse చేయవద్దు.\n- 12-18 meaningful lines లో రాయి. Line break visual/voice pacing కోసం మాత్రమే; ఒక logical sentence ని unnecessary fragments గా విరగొట్టవద్దు.\n- Final output narration మాత్రమే. Title, labels, emoji, markdown వద్దు.`;

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
    return new Response(JSON.stringify(data), { status:response.status, statusText:response.statusText, headers:response.headers });
  } catch (e) {
    console.log(`${GUARD_MARKER}: response parsing/guard handling failed (${e.message}); preserving primary response.`);
    return response;
  }
}

guardedFetch.__NARRATION_QUALITY_GUARD__ = true;
global.fetch = guardedFetch;
console.log(`${GUARD_MARKER}: enabled — factual narration contract + single-request Groq budget + non-blocking quality checks active.`);
module.exports = { enabled:true, marker:GUARD_MARKER };