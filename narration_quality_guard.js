// Stable narration-quality guard V11.
// Rebuilds the narration prompt so legacy storyteller instructions and
// examples cannot compete with the factual-explainer requirements.
// Quality checks remain non-blocking and no repair/retry Groq call is added.

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

function extractBlock(text, startMarker, endMarker) {
  const source = String(text || '');
  const start = source.indexOf(startMarker);
  if (start < 0) return '';
  const from = start + startMarker.length;
  const end = endMarker ? source.indexOf(endMarker, from) : -1;
  return source.slice(from, end >= 0 ? end : source.length).trim();
}

function buildFactExplainerPrompt(original) {
  const beats = extractBlock(original, 'STORY BEATS:', 'VERIFIED FACT — ACCURACY GROUNDING:');
  const fact = extractBlock(original, 'VERIFIED FACT — ACCURACY GROUNDING:', 'నీ ROLE:');
  const topic = extractBlock(original, 'ఒక original Telugu YouTube Shorts narration రాయి.', 'STORY BEATS:');

  return `Write the final narration for a Telugu YouTube Short using ONLY the verified fact supplied below.\n\nVERIFIED FACT:\n${fact || original}\n\nOPTIONAL PLANNING BEATS:\n${beats || '(none)'}\n\nCORE TASK:\nExplain this one fact clearly, naturally, and accurately to a viewer. This is a factual explainer, not a fictional story. The planning beats are only organizational hints; the VERIFIED FACT is the source of truth. If a beat conflicts with, broadens, or adds information beyond the verified fact, ignore the beat.\n\nFACTUAL STRUCTURE:\n1. Start with a natural opening that identifies the subject or creates curiosity without hiding or distorting the core fact.\n2. State the exact core fact early enough that the viewer understands what is being explained.\n3. Add only relevant supporting details that are present in the verified fact.\n4. Explain what the fact means, how the stated condition/process works, or why the stated detail matters, but only when supported by the verified fact.\n5. End with a concise fact-specific takeaway.\n\nSTRICT ACCURACY:\n- Do not invent or infer any new fact, number, date, name, place, cause, effect, comparison, example, mechanism, or consequence.\n- Preserve the exact scope and subject. Do not turn a fact about one object, location, process, condition, or substance into a claim about a broader category.\n- Preserve qualifiers such as some, certain, may, can, under these conditions, approximate values, ranges, and exceptions. Never turn them into absolute claims.\n- Preserve numerical values and units exactly in meaning.\n- Do not use the planning beats as a second source of facts.\n\nSENTENCE QUALITY:\n- Use natural spoken Telugu suitable for a knowledgeable narrator.\n- Every sentence must be grammatically complete and logically connected to the previous sentence.\n- Each sentence should add, clarify, qualify, or conclude information. Remove filler that adds no information.\n- Avoid disconnected one-line fragments such as “అయితే...”, “కానీ...”, “అసలు విషయం...”, or “ఇంకా షాక్...”.\n- Do not force a hook → question → reveal → twist → ending pattern. A question is optional. A twist is not required.\n- Do not create artificial suspense or emotional exaggeration just to increase retention. Retention should come from the interesting fact and clear explanation.\n- Do not repeat the same fact in slightly different words.\n- Do not add generic morals, motivation, opinions, CTA, title labels, emoji, or markdown.\n- English technical terms, scientific names, brands, places, and acronyms are allowed when they improve accuracy or naturalness. Pure Telugu is not required.\n\nOUTPUT FORMAT:\n- 12-18 spoken lines.\n- Target approximately 85-115 Telugu words.\n- Line breaks are for voice pacing only; never break a grammatical sentence merely to satisfy line count.\n- Final line must be a factual takeaway directly supported by the verified fact.\n- Return ONLY the narration text.`;
}

function factBeatContract() {
  return `\n\n${GUARD_MARKER}: FACT BEAT OVERRIDE\n- These are planning beats for a VERIFIED FACT, not a fictional story.\n- Build beats around factual information flow: context → exact fact → supporting detail → explanation → factual takeaway.\n- Twist is optional and must never be invented. If there is no supported twist, use a clarifying detail.\n- Never invent facts, numbers, names, causes, consequences, comparisons, or examples.`;
}

function patchPrompt(prompt) {
  const original = String(prompt || '');
  const kind = classify(original);
  if (original.includes(GUARD_MARKER)) return { prompt: original, kind };
  if (kind === 'narration') return { prompt: buildFactExplainerPrompt(original), kind };
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
    temperature: (patched.kind === 'narration' || patched.kind === 'beats') ? 0.08 : 0.05,
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
console.log(`${GUARD_MARKER}: enabled — rebuilt factual-explainer prompt + single-request Groq budgets active.`);
module.exports = { enabled: true, marker: GUARD_MARKER };
