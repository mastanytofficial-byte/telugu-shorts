// Narration quality guard V14 — hardened implementation.
// Purpose: intercept the real final narration request, generate only the
// narration structure, validate it, normalize harmless formatting variation,
// and refuse publication only when the actual narration is unusable.

const PREVIOUS = global.fetch;
const GUARD_MARKER = 'NARRATION_QUALITY_GUARD_V14';

if (!PREVIOUS || PREVIOUS.__NARRATION_QUALITY_GUARD_V14__) {
  module.exports = { enabled: true, marker: GUARD_MARKER };
  return;
}

function isGroq(url, options) {
  return String(url).includes('api.groq.com/openai/v1/chat/completions')
    && options
    && String(options.method || 'GET').toUpperCase() === 'POST';
}

function isNarrationPrompt(prompt) {
  const p = String(prompt || '');
  return /VERIFIED FACT\s*[—-]\s*ACCURACY GROUNDING:/i.test(p)
    && (/final narration text only/i.test(p)
      || /high-retention storyteller/i.test(p)
      || /12-18 short spoken lines/i.test(p));
}

function extractVerifiedSource(prompt) {
  const source = String(prompt || '');
  const marker = 'VERIFIED FACT — ACCURACY GROUNDING:';
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const from = start + marker.length;
  const end = source.indexOf('\n\nనీ ROLE:', from);
  return source.slice(from, end >= 0 ? end : source.length).trim();
}

function cleanText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^["“”'`]+|["“”'`]+$/g, '')
    .trim();
}

function stripTerminalPunctuation(text) {
  return cleanText(text).replace(/[.!?。！？]+$/g, '').trim();
}

function countWords(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

function parseJsonContent(data) {
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) return { obj: null, reason: 'model returned empty content' };

  let obj;
  try {
    obj = JSON.parse(String(raw).replace(/^```json\s*/i, '').replace(/```$/i, '').trim());
  } catch (e) {
    return { obj: null, reason: `model returned non-JSON content (${String(raw).slice(0, 160)})` };
  }

  return { obj, reason: '' };
}

function normalizeField(value) {
  let s = cleanText(value);
  // If the model accidentally puts the structural label inside a field,
  // remove it here instead of allowing it to reach narration/TTS.
  s = s.replace(/^(?:hook|fact|explanation|context|meaning|conclusion)\s*:\s*/i, '');
  s = s.replace(/^(?:హుక్|ఫ్యాక్ట్|వివరణ|సందర్భం|అర్థం|ముగింపు)\s*:\s*/i, '');
  return stripTerminalPunctuation(s);
}

function validateAndBuildScript(data) {
  const parsed = parseJsonContent(data);
  if (!parsed.obj) return { script: null, reason: parsed.reason };

  const keys = ['hook', 'fact', 'explanation', 'context', 'meaning', 'conclusion'];
  const obj = parsed.obj;

  if (!keys.every(k => typeof obj[k] === 'string' && obj[k].trim())) {
    return { script: null, reason: 'missing one or more of the six required narration fields' };
  }

  const fields = keys.map(k => normalizeField(obj[k]));
  if (fields.some(s => !s)) return { script: null, reason: 'one or more narration fields became empty after normalization' };

  // A field may contain commas, dashes, quotes, numbers and technical terms,
  // but it must represent one spoken sentence. We check sentence-ending marks
  // after terminal punctuation has already been normalized away.
  const badField = fields.findIndex(s => /[.!?。！？]/.test(s));
  if (badField >= 0) {
    return { script: null, reason: `field ${keys[badField]} contains multiple sentence-ending marks` };
  }

  const parts = fields.map((s, i) => i === 0 ? `${s}?` : `${s}.`);
  const script = parts.join(' ');
  const wordCount = countWords(script);

  // 85–115 is the preferred target. 75–125 is a deliberate safety band so
  // harmless Telugu tokenization/model variation does not kill an otherwise
  // valid fact. The prompt still asks the model for 85–115 words.
  if (wordCount < 75 || wordCount > 125) {
    return { script: null, reason: `word count ${wordCount} outside safety band 75-125 (preferred target 85-115)` };
  }

  if ((script.match(/\?/g) || []).length !== 1) {
    return { script: null, reason: 'final narration does not contain exactly one hook question mark' };
  }

  if (/\b(?:hook|fact|explanation|context|meaning|conclusion)\s*:/i.test(script)
      || /(?:హుక్|ఫ్యాక్ట్|వివరణ|సందర్భం|అర్థం|ముగింపు)\s*:/i.test(script)) {
    return { script: null, reason: 'structural narration label survived normalization' };
  }

  if (/అసలు విషయం ఏంటంటే|ఇంకా షాక్ ఏంటంటే|ఇది వింటే షాక్/i.test(script)) {
    return { script: null, reason: 'legacy viral-template transition detected' };
  }

  return { script, reason: '' };
}

function buildFactNarrationPrompt(originalPrompt, attempt) {
  const source = extractVerifiedSource(originalPrompt);
  const retry = attempt > 0
    ? `\n\nRETRY ${attempt}: The previous output failed a mechanical validation check. Do not add labels, markdown, explanations outside JSON, or extra sentences. Keep each field to one natural spoken sentence and keep the total close to 90-105 Telugu words.\n`
    : '';

  return `నువ్వు ఒక VERIFIED FACT ని Telugu YouTube Shorts కోసం సహజమైన FACT-EXPLAINER narration గా మార్చాలి.

VERIFIED SOURCE:
${source}

పై source మాత్రమే factual authority. Source లో లేని కొత్త fact, number, date, name, cause, effect, example, comparison, background లేదా conclusion ని నీ స్వంత జ్ఞానంతో జోడించకూడదు.

ఇది STORY కాదు. Twist, cliffhanger, dramatic reveal లేదా generic life lesson వద్దు. ఒక knowledgeable person ఒక interesting verified fact ని viewer కి స్పష్టంగా explain చేస్తున్నట్టు natural spoken Telugu లో ఉండాలి.

ఖచ్చితమైన semantic order:
1) HOOK — topic పై సహజమైన curiosity question లేదా statement.
2) FACT — hook కి నేరుగా సమాధానం ఇచ్చే core verified fact.
3) EXPLANATION — ముఖ్యమైన concept/term/mechanism/value ని సులభంగా explain చేయాలి.
4) CONTEXT — source లో ఉన్న relevant date/background/condition మాత్రమే.
5) MEANING — fact + explanation + context logically connect చేయాలి.
6) CONCLUSION — అదే verified fact నుంచి వచ్చే clear takeaway.

STRICT OUTPUT RULES:
- EXACTLY these six JSON keys: hook, fact, explanation, context, meaning, conclusion.
- ప్రతి field లో exactly ONE spoken sentence మాత్రమే.
- JSON బయట ఒక్క character కూడా రాయకూడదు.
- Labels such as Hook:, Fact:, Explanation:, హుక్:, ఫ్యాక్ట్: field value లో రాయకూడదు.
- ప్రతి sentence naturally continue కావాలి; six unrelated facts లాగా ఉండకూడదు.
- Hook తర్వాత fact ని దాచవద్దు; sentence 2 లో core fact స్పష్టంగా చెప్పు.
- “అసలు విషయం ఏంటంటే”, “ఇంకా షాక్ ఏంటంటే”, “ఇది వింటే షాక్” వంటి template transitions వద్దు.
- “నమ్మగలరా?”, “ఊహించండి” వంటి forced engagement వద్దు.
- Unsupported hype, superlatives, generic moral, CTA, title, keywords, emoji వద్దు.
- Technical English terms source లో అవసరమైతే natural Telugu sentence లో ఉంచవచ్చు.
- Numbers/dates ఉంటే TTS-friendly Telugu words లో రాయి; ASCII digits అవసరం లేకపోతే వాడవద్దు.
- 3D వంటి technical terms ని numeric form లోనే ఉంచు; దాన్ని “మూడు D” లేదా “మూడు డీ”గా రాయకూడదు.
- Source qualifiers preserve చేయాలి; overclaim చేయవద్దు.
- Same information ని rephrase చేసి repeat చేయవద్దు.
- మొత్తం 85-115 తెలుగు పదాల target ఉంచు; filler వద్దు.
${retry}

OUTPUT SCHEMA:
{"hook":"one complete sentence","fact":"one complete sentence","explanation":"one complete sentence","context":"one complete sentence","meaning":"one complete sentence","conclusion":"one complete sentence"}`;
}

async function requestStructuredNarration(url, options, prompt, attempt) {
  let body;
  try {
    body = JSON.parse(String(options.body || '{}'));
  } catch (_) {
    throw new Error('Could not parse original Groq request body.');
  }

  body.messages = [{ role: 'user', content: buildFactNarrationPrompt(prompt, attempt) }];
  body.temperature = attempt === 0 ? 0.05 : 0.0;
  body.reasoning_effort = 'low';
  body.include_reasoning = false;
  body.max_completion_tokens = 1800;
  delete body.max_tokens;
  body.response_format = {
    type: 'json_schema',
    json_schema: {
      name: 'telugu_fact_narration',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          hook: { type: 'string' },
          fact: { type: 'string' },
          explanation: { type: 'string' },
          context: { type: 'string' },
          meaning: { type: 'string' },
          conclusion: { type: 'string' }
        },
        required: ['hook', 'fact', 'explanation', 'context', 'meaning', 'conclusion'],
        additionalProperties: false
      }
    }
  };

  return PREVIOUS(url, { ...options, body: JSON.stringify(body) });
}

async function guardedFetch(url, options = {}) {
  if (!isGroq(url, options)) return PREVIOUS(url, options);

  let body;
  try { body = JSON.parse(String(options.body || '{}')); } catch (_) { return PREVIOUS(url, options); }
  const last = Array.isArray(body.messages) && body.messages[body.messages.length - 1];
  const originalPrompt = last?.content || '';
  if (!isNarrationPrompt(originalPrompt)) return PREVIOUS(url, options);

  console.log(`${GUARD_MARKER}: intercepted final narration request at generation boundary.`);

  let lastReason = 'unknown validation failure';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await requestStructuredNarration(url, options, originalPrompt, attempt);

    try {
      const data = await response.clone().json();
      const result = validateAndBuildScript(data);

      if (result.script) {
        data.choices[0].message.content = result.script;
        data.choices[0].finish_reason = 'stop';
        console.log(`${GUARD_MARKER}: FINAL FACT NARRATION accepted — ${countWords(result.script)} words, 6 connected sentences.`);
        return new Response(JSON.stringify(data), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }

      lastReason = result.reason;
      console.log(`${GUARD_MARKER}: validation attempt ${attempt + 1}/3 rejected — ${lastReason}`);
    } catch (e) {
      lastReason = `response processing error: ${e.message}`;
      console.log(`${GUARD_MARKER}: attempt ${attempt + 1}/3 failed — ${lastReason}`);
    }
  }

  throw new Error(`Clean fact narration failed after 3 bounded attempts — ${lastReason}`);
}

guardedFetch.__NARRATION_QUALITY_GUARD_V14__ = true;
global.fetch = guardedFetch;
console.log(`${GUARD_MARKER}: enabled — hardened narration validation boundary loaded.`);
module.exports = { enabled: true, marker: GUARD_MARKER };