// Stable narration-quality guard V11.
// Restores the actual approved Telugu Amazing Facts Shorts target:
// conversational Telugu storyteller narration, 20-30 seconds, short spoken
// beats, curiosity -> reveal -> surprising detail -> factual takeaway.
// The verified fact remains the only factual source. No repair/retry Groq call.

const ORIGINAL_FETCH = global.fetch;
const GUARD_MARKER = 'NARRATION_QUALITY_GUARD_V11';

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
  if (kind === 'narration') return 1800;
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

function wordCount(text) {
  return String(text || '').split(/\s+/).map(x => x.trim()).filter(Boolean).length;
}

function qualityReasons(text) {
  const s = String(text || '');
  const lines = s.split(/\n+/).map(x => x.trim()).filter(Boolean);
  const words = wordCount(s);
  const reasons = [];
  if (!s) reasons.push('empty narration');
  if (lines.length < 12 || lines.length > 18) reasons.push(`line count ${lines.length}`);
  if (words < 45 || words > 80) reasons.push(`word count ${words} (target 55-75)`);
  if (lines.some(x => x.length > 120)) reasons.push('line too long');
  if (/\b\d+(?:[.,]\d+)?\b/.test(s)) reasons.push('ASCII number');
  if ((s.match(/\? /g) || []).length > 2) reasons.push('too many questions');
  if (/\b(అసలు విషయం ఏంటంటే|ఇంకా షాక్ ఏంటంటే|ఇది వింటే షాక్|అయితే\.\.\.|కానీ\.\.\.)/gi.test(s)) reasons.push('template transition');
  return [...new Set(reasons)];
}

function extractBlock(text, startMarker, endMarker) {
  const source = String(text || '');
  const start = source.indexOf(startMarker);
  if (start < 0) return '';
  const from = start + startMarker.length;
  const end = endMarker ? source.indexOf(endMarker, from) : -1;
  return source.slice(from, end >= 0 ? end : source.length).trim();
}

function buildTargetNarrationPrompt(original) {
  const fact = extractBlock(original, 'VERIFIED FACT — ACCURACY GROUNDING:', 'నీ ROLE:');

  return `కింద ఉన్న VERIFIED FACT ఆధారంగా Telugu YouTube Short కోసం final narration రాయి.

VERIFIED FACT — ఇదొక్కటే factual source:
${fact || original}

TARGET:
ఇది 20-30 seconds లో సహజంగా వినిపించే conversational Telugu fact narration. Viewer కి ఒక knowledgeable friend ఒక ఆశ్చర్యకరమైన నిజం చెబుతున్నట్టు ఉండాలి. Textbook, documentary, news-reader లేదా formal lecture లాగా ఉండకూడదు.

NARRATION FLOW:
- మొదటి 1-2 lines: curiosity కలిగించే natural hook. Core answer ని వెంటనే పూర్తిగా reveal చేయకు.
- తర్వాత: viewer కి “అయితే అసలు విషయం ఏమిటి?” అనిపించేలా fact ని step-by-step reveal చేయి.
- మధ్యలో: verified fact లో ఉన్న అత్యంత interesting supporting detail మాత్రమే ఇవ్వు.
- తర్వాత: ఆ detail ఎందుకు surprising/important అనేది, verified fact support చేస్తే, సహజంగా చెప్పు.
- చివర: memorable, fact-specific takeaway. Generic moral కాదు.
- “hook → curiosity → reveal → surprising detail → twist → takeaway” ఒక guide మాత్రమే. Twist తప్పనిసరి కాదు; verified fact లో genuine interesting detail లేకపోతే twist invent చేయకుండా clean takeaway ఇవ్వు.

STRICT FACT SAFETY:
- VERIFIED FACT మాత్రమే source. దాని బయట కొత్త fact, number, date, name, place, cause, effect, comparison, example, mechanism లేదా consequence invent చేయకు.
- Story beats, imagination, common knowledge లేదా your own inference ని factual source గా ఉపయోగించకు.
- Fact ఒక specific object/location/process/condition గురించి ఉంటే అదే scope లో ఉంచు. Broader claim గా మార్చకు.
- “may/can/some/certain/under these conditions” వంటి qualifiers ఉంటే వాటి meaning మార్చకు.
- Numerical/scientific notation అవసరం లేకపోతే narration లో raw equation లాగా చెప్పకు. Fact ని simplify చేయవచ్చు, కానీ numerical meaning మార్చకూడదు.
- ASCII digits (`3`, `10^21`, `97×10^24`, `0005`) final spoken narration లో పెట్టకు. అవసరమైన numbers ని natural Telugu words లో చెప్పు. Number essential కాకపోతే, verified fact ని మార్చకుండా దాన్ని omit చేయి.

SPOKEN STYLE:
- Natural Telugu conversation. అవసరమైన English technical terms/names/brands/acronyms మాత్రమే natural గా వాడొచ్చు. Pure Telugu compulsory కాదు.
- మొత్తం 12-18 short spoken lines.
- మొత్తం target 55-75 words; absolute range 45-80 words.
- సాధారణంగా ప్రతి line 2-8 words; కొన్ని lines 9-10 words ఉండొచ్చు.
- ప్రతి line ఒక natural spoken beat. కానీ grammar ని కావాలనే విరగ్గొట్టే fragments వద్దు.
- ఒక line లో చాలా clauses పెట్టొద్దు.
- అదే fact ని వేరే పదాలతో repeat చేయొద్దు.
- ప్రతి 1-3 lines కి కొత్త relevant information లేదా clarification ఉండాలి.
- “అయితే...”, “కానీ...”, “అసలు విషయం ఏంటంటే...”, “ఇంకా షాక్ ఏంటంటే...” వంటి template transitions ని repeated pattern గా వాడొద్దు. అవసరమైతే natural sentence లో మాత్రమే వాడు.
- Forced personal scenarios, family examples, food examples, daily-life comparisons, motivational lessons, generic morals, opinions, CTA, title, labels, emoji, markdown వద్దు.
- Final narration text మాత్రమే ఇవ్వు.

IMPORTANT:
ఈ script ని 45-60 seconds లేదా 80 seconds script లాగా expand చేయకు. ఇది 20-30 second Short. Shortగా ఉండటం వల్ల fact incomplete అవుతుందని అనిపిస్తే, irrelevant detail తొలగించి core fact + strongest supported detail + takeaway మాత్రమే ఉంచు.`;
}

function factBeatContract() {
  return `\n\n${GUARD_MARKER}: TARGET BEAT OVERRIDE\n- These are planning beats for a 20-30 second Telugu fact Short.\n- Prefer curiosity → reveal → strongest supported detail → takeaway.\n- Twist is optional; never invent one.\n- Keep beats short and factual. Never invent facts, numbers, causes, consequences, comparisons, or examples.`;
}

function patchPrompt(prompt) {
  const original = String(prompt || '');
  const kind = classify(original);
  if (original.includes(GUARD_MARKER)) return { prompt: original, kind };
  if (kind === 'narration') return { prompt: buildTargetNarrationPrompt(original), kind };
  if (kind === 'beats') return { prompt: original + factBeatContract(), kind };
  return { prompt: original, kind };
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
    temperature: patched.kind === 'narration' ? 0.15 : (patched.kind === 'beats' ? 0.08 : 0.05),
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
      console.log(`${GUARD_MARKER}: TARGET 20-30s FACT NARRATION accepted by local quality checks.`);
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
console.log(`${GUARD_MARKER}: enabled — target 20-30s conversational fact narration + single-request Groq budgets active.`);
module.exports = { enabled: true, marker: GUARD_MARKER };
