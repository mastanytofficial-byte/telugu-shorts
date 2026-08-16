// Stable narration-quality guard V11.
// Overrides legacy story-teller prompting so verified facts are narrated as
// factual explanations with connected, grammatically complete sentences.
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

function factBeatContract() {
  return `\n\n${GUARD_MARKER}: FACT BEAT OVERRIDE\n- These are planning beats for a VERIFIED FACT, not a fictional story.\n- Build the beats around factual information flow: context → exact fact → supporting detail → explanation → factual takeaway.\n- Do not require a twist, suspense reveal, dramatic reversal, personal scenario, or artificial consequence.\n- hook may create curiosity, but it must not hide or distort the fact merely to create suspense.\n- question is optional in spirit: it must represent a genuine factual question, not manufactured drama.\n- reveal must state the verified core fact accurately.\n- twist must be replaced by the most interesting VERIFIED DETAIL already supported by the source; if there is no such detail, use another clarifying fact.\n- ending must be a fact-specific takeaway, never a generic moral.\n- Never invent facts, numbers, names, causes, consequences, comparisons, or examples.`;
}

function narrationContract() {
  return `\n\n${GUARD_MARKER}: FINAL FACT-EXPLAINER OVERRIDE — THIS OVERRIDES EARLIER STORYTELLER EXAMPLES AND STYLE RULES\n- This output is a factual explanation of a VERIFIED FACT. It is NOT a fictional story, dramatic story, personal anecdote, or suspense story.\n- Ignore any earlier instruction in this same prompt that says to act as a "high-retention storyteller", hide the answer for suspense, force a twist, or make every line create a "what happens next" feeling. Factual accuracy and sentence clarity take priority.\n- The narration should sound like a knowledgeable person naturally explaining one interesting fact to a viewer. Retention comes from the information itself, not from artificial drama.\n- Every line must be a complete, grammatically correct spoken sentence or a complete meaningful clause. Do not create fragment-only lines such as “అయితే...”, “కానీ...”, “అసలు విషయం...”, “ఇంకా షాక్...” unless they are grammatically attached to a complete thought; preferably avoid standalone fragments entirely.\n- Sentences must form one logical chain. Each sentence should add, clarify, qualify, or conclude information from the VERIFIED FACT.\n- Use this factual progression when supported: identify the subject → state the exact fact → explain the relevant condition/process → give the supported detail or measurement → clarify what it means → finish with a concise fact-specific takeaway.\n- Do not force hook → question → reveal → twist → ending. That structure is optional and must never distort factual explanation.\n- Preserve the source's exact scope. If the fact is about a specific object, location, process, condition, or substance, do not generalize it to a broader subject. For example, a temperature measured at a hydrothermal vent must not be narrated as the temperature of all deep-ocean water.\n- Preserve qualifiers such as “some”, “certain”, “may”, “can”, “under these conditions”, ranges, approximate values, and exceptions. Never turn a qualified claim into an absolute claim.\n- Never infer a cause, effect, comparison, implication, or consequence unless the VERIFIED FACT explicitly supports it.\n- Never invent a new fact, number, date, name, place, example, comparison, scientific explanation, or consequence.\n- English technical terms, brands, names, places, and acronyms are allowed when needed for accuracy. Pure Telugu is NOT required. Avoid random English.\n- Natural spoken Telugu is required, but factual precision is more important than dramatic wording.\n- Do not use generic morals, motivation, opinions, calls to action, title labels, emoji, or markdown.\n- Use Telugu words for numbers in the final narration when the existing project rule requires it; do not change the underlying numerical value.\n- Final line must summarize the verified fact or its supported significance, not give a generic life lesson.\n- Keep 12-18 spoken lines, but do not break grammar merely to satisfy line count.\n- Return only the final narration text.`;
}

function patchPrompt(prompt) {
  const original = String(prompt || '');
  const kind = classify(original);
  if (original.includes(GUARD_MARKER)) return { prompt: original, kind };

  if (kind === 'beats') {
    return { prompt: original + factBeatContract(), kind };
  }

  if (kind === 'narration') {
    return { prompt: original + narrationContract(), kind };
  }

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
console.log(`${GUARD_MARKER}: enabled — factual explainer style + single-request Groq budgets active.`);
module.exports = { enabled: true, marker: GUARD_MARKER };
