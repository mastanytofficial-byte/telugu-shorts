// Narration quality guard V13.
// Target: one connected six-sentence Telugu fact explainer.
// Hook -> Fact -> Explanation -> Important Context -> Meaning -> Conclusion.
// This guard deliberately removes all legacy storyteller/beat instructions from
// the narration generation call and returns a single natural paragraph.

const ORIGINAL_FETCH = global.fetch;
const GUARD_MARKER = 'NARRATION_QUALITY_GUARD_V13';

if (!ORIGINAL_FETCH || ORIGINAL_FETCH.__NARRATION_QUALITY_GUARD__) {
  module.exports = { enabled: true, marker: GUARD_MARKER };
  return;
}

function isGroq(url, options) {
  return String(url).includes('api.groq.com/openai/v1/chat/completions') && options && String(options.method || 'GET').toUpperCase() === 'POST';
}
function isTts(url, options) {
  return String(url).includes('texttospeech.googleapis.com/v1/text:synthesize') && options && String(options.method || 'GET').toUpperCase() === 'POST';
}
function getContent(data) {
  return data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : null;
}
function clean(text) {
  return String(text || '').replace(/^```(?:json|text|telugu)?\s*/i, '').replace(/```$/i, '').trim();
}
function extractFact(original) {
  const marker = 'VERIFIED FACT — ACCURACY GROUNDING:';
  const start = String(original || '').indexOf(marker);
  if (start < 0) return String(original || '').trim();
  const from = start + marker.length;
  const end = String(original || '').indexOf('నీ ROLE:', from);
  return String(original || '').slice(from, end >= 0 ? end : undefined).trim();
}
function isNarrationPrompt(prompt) {
  const p = String(prompt || '');
  return /STORY BEATS/i.test(p) && /TARGET RHYTHM|high-retention storyteller|CALL A of Stage 2|final narration text only|12-18 short spoken lines/i.test(p);
}
function buildPrompt(original) {
  const fact = extractFact(original);
  return `నువ్వు verified fact ని ఒక PROFESSIONAL Telugu YouTube Shorts fact-explainer narration గా మార్చాలి.

VERIFIED FACT — ఇది మాత్రమే factual source:
${fact}

దీని బయట నీకు తెలిసిన ఏ fact, number, date, example, comparison, cause, effect, interpretation లేదా background ఉపయోగించవద్దు. Story beats ని source గా పరిగణించవద్దు.

TARGET FORMATION — ఇది తప్పనిసరి:
1. HOOK: topic పై సహజమైన curiosity question లేదా curiosity statement.
2. FACT: hook కి నేరుగా సమాధానం ఇచ్చే core verified fact.
3. EXPLANATION: ఇప్పుడే చెప్పిన fact లోని ముఖ్యమైన concept/term/value ని సులభంగా అర్థమయ్యేలా explain చేయాలి.
4. IMPORTANT CONTEXT: verified fact లో ఉన్న relevant date/background/detail మాత్రమే.
5. MEANING: ఇప్పటివరకు చెప్పిన fact + context కలిపితే దాని significance ఏమిటో అదే verified information ఆధారంగా connect చేయాలి.
6. CONCLUSION: అదే fact నుంచి వచ్చే memorable, fact-specific takeaway.

ఇది STORY కాదు. Twist, cliffhanger, dramatic reveal, artificial suspense, “అసలు విషయం ఏంటంటే”, “ఇంకా షాక్ ఏంటంటే” వంటి template lines వద్దు.
ఇది FACT EXPLANATION. ఒక knowledgeable person viewer కి ఒక interesting verified fact ని సహజంగా explain చేస్తున్నట్టు ఉండాలి.

REFERENCE — FORMATION మాత్రమే చూడాలి; facts లేదా wording copy చేయకూడదు:
Hook: “వెలుతురు ఎంత వేగంగా ప్రయాణిస్తుందో తెలుసా?”
Fact: “శూన్యంలో వెలుతురు సెకనుకు సుమారు రెండు లక్షల తొంభై తొమ్మిది వేల కిలోమీటర్ల వేగంతో ప్రయాణిస్తుంది.”
Explanation: “ఈ వేగాన్ని శాస్త్రవేత్తలు ‘c’ అనే గుర్తుతో సూచిస్తారు.”
Important Context: “1983లో మీటర్‌ను నిర్వచించే విధానాన్ని మార్చినప్పుడు, ఈ వేగాన్ని ఖచ్చితమైన విలువగా ఉపయోగించారు.”
Meaning: “అందుకే ఇప్పుడు మీటర్ నిర్వచనం కూడా వెలుతురు వేగంతో నేరుగా సంబంధం కలిగి ఉంది.”
Conclusion: “అంటే వెలుతురు వేగం కేవలం ఒక శాస్త్రీయ సంఖ్య కాదు; మన పొడవు కొలతకు కూడా అది ప్రాథమిక ఆధారం.”

WRITING RULES:
- మొత్తం EXACTLY 6 sentences మాత్రమే.
- ప్రతి sentence పై 6 parts లో ఒక్క part ని మాత్రమే fulfill చేయాలి.
- Sentence 1 = Hook. Sentence 2 = Fact. Sentence 3 = Explanation. Sentence 4 = Important Context. Sentence 5 = Meaning. Sentence 6 = Conclusion.
- Sentence 2, Sentence 1 కి direct answer కావాలి.
- Sentence 3, Sentence 2 లోని concept ని explain చేయాలి.
- Sentence 4, కొత్త unrelated fact కాకూడదు; source లోని context మాత్రమే.
- Sentence 5, ముందు చెప్పిన information ని connect చేయాలి; unsupported opinion వద్దు.
- Sentence 6, అదే fact కి సంబంధించిన clear takeaway కావాలి.
- ప్రతి sentence complete natural Telugu sentence కావాలి. Fragments వద్దు.
- మొత్తం script ఒక connected explanation లాగా అనిపించాలి; six unrelated lines లాగా కాదు.
- Same information ని repeat చేయవద్దు.
- Generic moral, motivational message, CTA, title, keywords, emoji వద్దు.
- Personal scenario, family example, forced comparison వద్దు.
- English technical term అవసరమైతే మాత్రమే natural Telugu sentence లో వాడు.
- Numbers/dates అవసరమైతే TTS-friendly Telugu wording లో రాయి.
- Source qualifier ని preserve చేయి; overclaim చేయవద్దు.
- Verified fact లో context లేకపోతే fake date/background invent చేయవద్దు. అప్పుడు Sentence 4 ని source లో ఉన్న directly-supported clarification తో నిర్మించు.

OUTPUT:
JSON object మాత్రమే. Exactly these six string fields and no others:
{
  "hook": "...",
  "fact": "...",
  "explanation": "...",
  "context": "...",
  "meaning": "...",
  "conclusion": "..."
}
Each field must contain exactly one complete sentence. JSON బయట ఏ text రాయకూడదు.`;
}
function normalizeSentence(value, index) {
  let s = String(value || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/[.!?。]+$/g, '').trim();
  if (index === 0) return s + '?';
  return s + '.';
}
function buildNarrationResponse(data) {
  const raw = clean(getContent(data));
  if (!raw) return null;
  let obj;
  try { obj = JSON.parse(raw); } catch (_) { return null; }
  const keys = ['hook', 'fact', 'explanation', 'context', 'meaning', 'conclusion'];
  if (!keys.every(k => typeof obj[k] === 'string' && obj[k].trim())) return null;
  const parts = keys.map((k, i) => normalizeSentence(obj[k], i));
  if (parts.some((x, i) => /\n/.test(x) || x.length < 12)) return null;
  return parts.join(' ');
}
function countSentences(text) {
  return String(text || '').split(/[.!?।]+/).map(x => x.trim()).filter(Boolean).length;
}
function qualityReasons(text) {
  const reasons = [];
  const s = String(text || '');
  if (countSentences(s) !== 6) reasons.push(`sentence count ${countSentences(s)} (target exactly 6)`);
  if (/\n/.test(s)) reasons.push('line breaks present');
  if ((s.match(/\?/g) || []).length !== 1) reasons.push('hook question count is not exactly 1');
  if (/అసలు విషయం ఏంటంటే|ఇంకా షాక్ ఏంటంటే|ఇది వింటే షాక్/gi.test(s)) reasons.push('storyteller filler detected');
  return reasons;
}

async function guardedFetch(url, options = {}) {
  if (isTts(url, options)) {
    try {
      const body = JSON.parse(String(options.body || '{}'));
      body.audioConfig = { ...(body.audioConfig || {}), speakingRate: /సబ్‌స్క్రైబ్|subscribe/i.test(JSON.stringify(body.input || {})) ? 1.10 : 1.06 };
      return ORIGINAL_FETCH(url, { ...options, body: JSON.stringify(body) });
    } catch (_) { return ORIGINAL_FETCH(url, options); }
  }
  if (!isGroq(url, options)) return ORIGINAL_FETCH(url, options);

  let body;
  try { body = JSON.parse(String(options.body || '{}')); } catch (_) { return ORIGINAL_FETCH(url, options); }
  if (!Array.isArray(body.messages) || !body.messages.length) return ORIGINAL_FETCH(url, options);

  const last = body.messages[body.messages.length - 1];
  const originalPrompt = last && typeof last.content === 'string' ? last.content : '';
  if (!isNarrationPrompt(originalPrompt)) {
    return ORIGINAL_FETCH(url, options);
  }

  const patchedPrompt = buildPrompt(originalPrompt);
  body.messages = [{ role: 'user', content: patchedPrompt }];
  body.temperature = 0.08;
  body.reasoning_effort = 'low';
  body.include_reasoning = false;
  body.max_completion_tokens = 1400;
  delete body.max_tokens;
  body.response_format = {
    type: 'json_schema',
    json_schema: {
      name: 'telugu_fact_script_v13',
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

  const response = await ORIGINAL_FETCH(url, { ...options, body: JSON.stringify(body) });
  if (!response || typeof response.clone !== 'function') return response;
  try {
    const data = await response.clone().json();
    const content = buildNarrationResponse(data);
    if (!content) {
      console.log(`${GUARD_MARKER}: invalid six-part structured response — preserving primary response.`);
      return response;
    }
    const reasons = qualityReasons(content);
    if (reasons.length) {
      console.log(`${GUARD_MARKER}: target warnings — ${reasons.join(' | ')}; preserving structured response.`);
    } else {
      console.log(`${GUARD_MARKER}: EXACT SIX-SENTENCE FACT SCRIPT accepted.`);
    }
    data.choices[0].message.content = content;
    return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (e) {
    console.log(`${GUARD_MARKER}: structured response parsing failed (${e.message}); preserving primary response.`);
    return response;
  }
}

guardedFetch.__NARRATION_QUALITY_GUARD__ = true;
global.fetch = guardedFetch;
console.log(`${GUARD_MARKER}: enabled — Hook→Fact→Explanation→Context→Meaning→Conclusion fact narration active.`);
module.exports = { enabled: true, marker: GUARD_MARKER };
