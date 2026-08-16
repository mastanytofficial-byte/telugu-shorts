// Stable narration-quality guard V12.
// Final narration is generated as six explicit semantic fields:
// Hook -> Fact -> Explanation -> Important Context -> Meaning -> Conclusion.
// Verified fact is the only factual source.

const ORIGINAL_FETCH = global.fetch;
const GUARD_MARKER = 'NARRATION_QUALITY_GUARD_V12';

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
  if (kind === 'narration') return 1400;
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
  return String(text || '').replace(/^```(?:json|text|telugu)?\s*/i, '').replace(/```$/i, '').trim();
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

  return `నువ్వు ఒక verified fact ని Telugu YouTube Short కోసం natural fact-explainer script గా మార్చుతున్నావు.

VERIFIED FACT — ఇది మాత్రమే factual source. దీని బయట ఏ సమాచారం ఉపయోగించకూడదు:
${fact}

IMPORTANT: పైన ఉన్న VERIFIED FACT లో లేని విషయం నీకు తెలిసినా ఉపయోగించకూడదు. Story Beats, old prompt instructions, examples, imagination, general knowledge, memory, లేదా inference ని factual source గా ఉపయోగించవద్దు.

TARGET SCRIPT — EXACT SIX PARTS:
1) hook: viewer కి topic గురించి curiosity కలిగించే ఒక సహజమైన మొదటి వాక్యం. Question కావచ్చు.
2) fact: hook కి direct answer గా verified fact యొక్క core claim చెప్పు.
3) explanation: ఇప్పుడే చెప్పిన fact లోని ముఖ్యమైన concept/term/value ని సులభంగా explain చేయి.
4) context: VERIFIED FACT లో ఉన్న relevant date/background/detail మాత్రమే చెప్పు. Context source లో లేకపోతే, కొత్త context invent చేయకుండా fact ని clarify చేసే directly-supported detail వాడు.
5) meaning: fact + context కలిపి ఎందుకు relevant/important అనేది VERIFIED FACT నేరుగా support చేస్తే మాత్రమే connect చేయి. Unsupported interpretation వద్దు.
6) conclusion: మొత్తం fact యొక్క memorable, fact-specific takeaway. Generic moral లేదా motivational ending వద్దు.

THE SIX PARTS MUST BE CONNECTED:
- Part 2 must answer Part 1.
- Part 3 must explain Part 2.
- Part 4 must add relevant context to Part 2/3.
- Part 5 must connect the information already given.
- Part 6 must conclude from the same verified fact.
- Random fact list, unrelated detail, separate mini-facts, or topic jumping వద్దు.

REFERENCE FOR FORMATION ONLY — content/facts copy చేయవద్దు:
Hook: “వెలుతురు ఎంత వేగంగా ప్రయాణిస్తుందో తెలుసా?”
Fact: “శూన్యంలో వెలుతురు సెకనుకు సుమారు రెండు లక్షల తొంభై తొమ్మిది వేల కిలోమీటర్ల వేగంతో ప్రయాణిస్తుంది.”
Explanation: “ఈ వేగాన్ని శాస్త్రవేత్తలు ‘c’ అనే గుర్తుతో సూచిస్తారు.”
Important context: “1983లో మీటర్‌ను నిర్వచించే విధానాన్ని మార్చినప్పుడు, ఈ వేగాన్ని ఖచ్చితమైన విలువగా ఉపయోగించారు.”
Meaning: “అందుకే ఇప్పుడు మీటర్ నిర్వచనం కూడా వెలుతురు వేగంతో నేరుగా సంబంధం కలిగి ఉంది.”
Conclusion: “అంటే వెలుతురు వేగం కేవలం ఒక శాస్త్రీయ సంఖ్య కాదు; మన పొడవు కొలతకు కూడా అది ప్రాథమిక ఆధారం.”

STYLE:
- ఇది story కాదు. Artificial suspense, twist, cliffhanger, dramatic reveal వద్దు.
- ఇది textbook కూడా కాదు. Natural spoken Telugu లో knowledgeable person ఒక fact explain చేస్తున్నట్టు ఉండాలి.
- Pure Telugu compulsory కాదు. Natural గా అవసరమైన English technical term/name/acronym మాత్రమే వాడొచ్చు.
- Complete grammatical sentences వాడు. Fragments, broken grammar, filler lines వద్దు.
- Same fact ని rephrase చేసి repeat చేయొద్దు.
- “అసలు విషయం ఏంటంటే”, “ఇంకా షాక్ ఏంటంటే”, “అయితే...”, “కానీ...” వంటి template transitions ని forced గా వాడొద్దు.
- Personal scenarios, family examples, food examples, generic comparisons, opinions, morals, CTA, title, emoji వద్దు.
- Numbers/dates verified fact కి essential అయితే ఉంచు; TTS-readable spoken wording prefer చేయి. Scientific notation dump చేయొద్దు.
- Source fact లో qualifier ఉంటే preserve చేయి; overclaim చేయొద్దు.

LENGTH:
- Exact word count target వద్దు. Six parts complete గా convey అయిన వెంటనే stop.
- సాధారణంగా మొత్తం 6 spoken sentences, roughly 45-80 spoken words లో ఉండటం మంచిది, కానీ completeness మరియు naturalness first.

OUTPUT FORMAT — STRICT:
JSON object మాత్రమే ఇవ్వు. Exactly ఈ six string fields ఉండాలి, extra fields వద్దు:
{
  "hook": "...",
  "fact": "...",
  "explanation": "...",
  "context": "...",
  "meaning": "...",
  "conclusion": "..."
}

ప్రతి field లో exactly one complete spoken sentence/idea ఉండాలి. Labels ని field values లో repeat చేయొద్దు. JSON బయట ఏ text రాయకూడదు.`;
}

function patchPrompt(prompt) {
  const original = String(prompt || '');
  const kind = classify(original);
  if (original.includes(GUARD_MARKER)) return { prompt: original, kind };
  if (kind === 'narration') return { prompt: buildTargetNarrationPrompt(original), kind };
  return { prompt: original, kind };
}

function buildNarrationResponse(data) {
  const raw = clean(getContent(data));
  if (!raw) return null;
  let obj;
  try { obj = JSON.parse(raw); } catch (_) { return null; }
  const keys = ['hook', 'fact', 'explanation', 'context', 'meaning', 'conclusion'];
  if (!keys.every(k => typeof obj[k] === 'string' && obj[k].trim())) return null;
  return keys.map(k => obj[k].trim()).join('\n');
}

function qualityReasons(text) {
  const lines = String(text || '').split(/\n+/).map(x => x.trim()).filter(Boolean);
  const reasons = [];
  if (lines.length !== 6) reasons.push(`six-part line count ${lines.length}`);
  if (lines.some(x => x.length < 8)) reasons.push('very short semantic part');
  if ((String(text).match(/\?/g) || []).length > 2) reasons.push('too many questions');
  if (/అసలు విషయం ఏంటంటే|ఇంకా షాక్ ఏంటంటే|ఇది వింటే షాక్/gi.test(text)) reasons.push('forced suspense wording');
  return [...new Set(reasons)];
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
  const patched = patchPrompt(originalPrompt);

  if (patched.kind === 'narration') {
    // Remove any older narration/system prompt from this one generation call.
    // The verified fact and the six-part contract above are now the complete
    // instruction set, preventing legacy 12-18-line/storyteller instructions
    // from competing with the target structure.
    body.messages = [{ role: 'user', content: patched.prompt }];
    body.temperature = 0.08;
    body.reasoning_effort = 'low';
    body.include_reasoning = false;
    body.max_completion_tokens = tokenBudget('narration');

    // Use structured JSON when the active model supports it; JSON mode is the
    // compatibility fallback. This makes the six semantic parts machine-
    // parseable instead of trusting the model to remember six labels.
    if (/gpt-oss|kimi-k2|llama-4/i.test(String(body.model || ''))) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'telugu_fact_script',
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
    } else {
      body.response_format = { type: 'json_object' };
    }
    delete body.max_tokens;
  } else {
    body = { ...body, messages: body.messages.map(m => ({ ...m })), temperature: 0.05, reasoning_effort: 'low', include_reasoning: false, max_completion_tokens: tokenBudget(patched.kind) };
    delete body.max_tokens;
    body.messages[body.messages.length - 1].content = patched.prompt;
  }

  const response = await ORIGINAL_FETCH(url, { ...options, body: JSON.stringify(body) });
  if (patched.kind !== 'narration' || !response || typeof response.clone !== 'function') return response;

  try {
    const data = await response.clone().json();
    const content = buildNarrationResponse(data);
    if (!content) {
      console.log(`${GUARD_MARKER}: structured narration response invalid — preserving primary response.`);
      return response;
    }
    const reasons = qualityReasons(content);
    if (reasons.length) console.log(`${GUARD_MARKER}: six-part warnings — ${reasons.join(' | ')}; preserving structured response.`);
    else console.log(`${GUARD_MARKER}: EXACT SIX-PART TARGET FACT SCRIPT accepted.`);
    data.choices[0].message.content = content;
    return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (e) {
    console.log(`${GUARD_MARKER}: structured response parsing failed (${e.message}); preserving primary response.`);
    return response;
  }
}

guardedFetch.__NARRATION_QUALITY_GUARD__ = true;
global.fetch = guardedFetch;
console.log(`${GUARD_MARKER}: enabled — exact Hook→Fact→Explanation→Context→Meaning→Conclusion structured narration active.`);
module.exports = { enabled: true, marker: GUARD_MARKER };
