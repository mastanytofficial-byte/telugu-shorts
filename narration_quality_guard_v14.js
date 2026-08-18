// Narration quality guard V14 — final implementation.
// Kept at V14 deliberately: no more version-by-version patching.
// The root bug was that index.js still sent a storyteller prompt to the model
// and the old guard only repaired sentence count after generation.
// This guard replaces that request at the actual Groq generation boundary.
// Target: one connected factual explanation:
// Hook -> Fact -> Explanation -> Important Context -> Meaning -> Conclusion.

const PREVIOUS = global.fetch;
const GUARD_MARKER = 'NARRATION_QUALITY_GUARD_V14';

if (!PREVIOUS || PREVIOUS.__NARRATION_QUALITY_GUARD_V14__) {
  module.exports = { enabled: true, marker: GUARD_MARKER };
  return;
}

function isGroq(url, options) {
  return String(url).includes('api.groq.com/openai/v1/chat/completions') && options && String(options.method || 'GET').toUpperCase() === 'POST';
}

function isNarrationPrompt(prompt) {
  const p = String(prompt || '');
  return /VERIFIED FACT — ACCURACY GROUNDING:/i.test(p)
    && /STORY BEATS:/i.test(p)
    && /TARGET RHYTHM/i.test(p)
    && /final narration text only/i.test(p);
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

function cleanSentence(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^["“”'`]+|["“”'`]+$/g, '')
    .replace(/[.!?।]+$/g, '')
    .trim();
}

function countWords(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

function hasExactlyOneSentence(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  return !/[.!?।]/.test(s);
}

function parseStructuredContent(data) {
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) return null;
  let obj;
  try {
    obj = JSON.parse(String(raw).replace(/^```json\s*/i, '').replace(/```$/i, '').trim());
  } catch (_) {
    return null;
  }

  const keys = ['hook', 'fact', 'explanation', 'context', 'meaning', 'conclusion'];
  if (!keys.every(k => typeof obj[k] === 'string' && obj[k].trim())) return null;
  if (!keys.every(k => hasExactlyOneSentence(cleanSentence(obj[k])))) return null;

  const parts = keys.map((k, i) => {
    const s = cleanSentence(obj[k]);
    return i === 0 ? `${s}?` : `${s}.`;
  });
  const script = parts.join(' ');
  const wordCount = countWords(script);

  // Match the project's real 45–60 second target range. If this fails, the
  // guard performs one clean retry; it never falls back to the legacy prompt.
  if (wordCount < 85 || wordCount > 115) return null;
  if ((script.match(/\?/g) || []).length !== 1) return null;
  if (/అసలు విషయం ఏంటంటే|ఇంకా షాక్ ఏంటంటే|ఇది వింటే షాక్|కానీ\.\.\.|అయితే\.\.\./i.test(script)) return null;

  return script;
}

function buildFactNarrationPrompt(originalPrompt, retry = false) {
  const source = extractVerifiedSource(originalPrompt);
  return `నువ్వు ఒక VERIFIED FACT ని Telugu YouTube Shorts కోసం ఒక సహజమైన FACT-EXPLAINER narration గా మార్చాలి.

VERIFIED SOURCE:
${source}

పై source మాత్రమే factual authority. Source లో లేని కొత్త fact, number, date, name, cause, effect, example, comparison, background లేదా conclusion ని నీ స్వంత జ్ఞానంతో జోడించకూడదు.

ఇది STORY కాదు. Viral storytelling కాదు. Twist, cliffhanger, dramatic reveal కాదు. ఒక knowledgeable person ఒక interesting verified fact ని viewer కి స్పష్టంగా explain చేస్తున్నట్టు ఉండాలి.

TARGET LOGIC — ఖచ్చితంగా ఈ క్రమం:
1) HOOK — topic పై సహజమైన curiosity question లేదా statement.
2) FACT — hook కి నేరుగా సమాధానం ఇచ్చే core verified fact.
3) EXPLANATION — ఆ fact లోని ముఖ్యమైన concept/term/mechanism/value ని సులభంగా explain చేయాలి.
4) IMPORTANT CONTEXT — source లో ఉన్న relevant date, background, condition లేదా directly-supported detail మాత్రమే.
5) MEANING — fact + explanation + context కలిపి ఏమి అర్థమవుతుందో logically connect చేయాలి; unsupported opinion వద్దు.
6) CONCLUSION — అదే verified fact నుంచి వచ్చే clear, fact-specific takeaway.

REFERENCE — formation/logic మాత్రమే. Facts లేదా wording copy చేయకూడదు:
“వెలుతురు ఎంత వేగంగా ప్రయాణిస్తుందో తెలుసా?”
“శూన్యంలో వెలుతురు సెకనుకు సుమారు రెండు లక్షల తొంభై తొమ్మిది వేల కిలోమీటర్ల వేగంతో ప్రయాణిస్తుంది.”
“ఈ వేగాన్ని శాస్త్రవేత్తలు ‘c’ అనే గుర్తుతో సూచిస్తారు.”
“1983లో మీటర్‌ను నిర్వచించే విధానాన్ని మార్చినప్పుడు, ఈ వేగాన్ని ఖచ్చితమైన విలువగా ఉపయోగించారు.”
“అందుకే ఇప్పుడు మీటర్ నిర్వచనం కూడా వెలుతురు వేగంతో నేరుగా సంబంధం కలిగి ఉంది.”
“అంటే వెలుతురు వేగం కేవలం ఒక శాస్త్రీయ సంఖ్య కాదు; మన పొడవు కొలతకు కూడా అది ప్రాథమిక ఆధారం.”

STRICT RULES:
- EXACTLY 6 complete sentences.
- Sentence 1 = Hook; sentence 2 = direct fact; sentence 3 = explanation; sentence 4 = important context; sentence 5 = meaning; sentence 6 = conclusion.
- ప్రతి sentence ముందు sentence నుంచి naturally continue కావాలి. ఆరు unrelated facts లాగా ఉండకూడదు.
- Hook తర్వాత fact ని దాచవద్దు; sentence 2 లో core fact స్పష్టంగా చెప్పు.
- “అసలు విషయం ఏంటంటే”, “ఇంకా షాక్ ఏంటంటే”, “ఇది వింటే షాక్”, “కానీ...”, “అయితే...” వంటి viral-template transitions వద్దు.
- “నమ్మగలరా?”, “ఊహించండి” వంటి forced engagement వద్దు.
- Unsupported hype, superlatives, generic moral, life lesson, personal example, CTA, title, keywords, emoji, labels వద్దు.
- “కేవలం... కాదు” వంటి dramatic framing అవసరం లేకపోతే వాడవద్దు.
- Technical English term source లో అవసరమైతే natural Telugu sentence లో ఉంచవచ్చు; random English వద్దు.
- Numbers/dates ఉంటే TTS-friendly Telugu words లో రాయి; ASCII digits వద్దు.
- Source qualifiers preserve చేయాలి; overclaim చేయవద్దు.
- Same information ని rephrase చేసి repeat చేయవద్దు.
- Pure Telugu compulsory కాదు; natural Telugu is the priority.
- మొత్తం 85-115 తెలుగు పదాల మధ్య ఉండాలి. Filler కోసం sentence పెంచవద్దు.
${retry ? '\nమునుపటి ప్రయత్నం target formation/length కి సరిపోలలేదు. ఈసారి పై six-step logic ని ఖచ్చితంగా follow చేయి.\n' : ''}

OUTPUT:
Strict JSON object మాత్రమే. Exactly these six keys:
{"hook":"one complete sentence","fact":"one complete sentence","explanation":"one complete sentence","context":"one complete sentence","meaning":"one complete sentence","conclusion":"one complete sentence"}
ప్రతి field లో exactly ONE complete sentence మాత్రమే ఉండాలి. JSON బయట ఏ text రాయకూడదు.`;
}

async function requestStructuredNarration(url, options, prompt, retry = false) {
  let body;
  try { body = JSON.parse(String(options.body || '{}')); } catch (_) { throw new Error('Could not parse original Groq request body.'); }

  body.messages = [{ role: 'user', content: buildFactNarrationPrompt(prompt, retry) }];
  body.temperature = 0.05;
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

  let response = await requestStructuredNarration(url, options, originalPrompt, false);

  try {
    let data = await response.clone().json();
    let script = parseStructuredContent(data);

    if (!script) {
      console.log(`${GUARD_MARKER}: first fact narration failed validation — one bounded clean retry.`);
      response = await requestStructuredNarration(url, options, originalPrompt, true);
      data = await response.clone().json();
      script = parseStructuredContent(data);
    }

    if (!script) throw new Error('Clean fact narration failed six-part validation after one bounded retry — refusing to publish it.');

    data.choices[0].message.content = script;
    console.log(`${GUARD_MARKER}: FINAL FACT NARRATION accepted — exactly 6 connected sentences, ${countWords(script)} words.`);
    return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (e) {
    console.log(`${GUARD_MARKER}: ${e.message}`);
    throw e;
  }
}

guardedFetch.__NARRATION_QUALITY_GUARD_V14__ = true;
global.fetch = guardedFetch;
console.log(`${GUARD_MARKER}: enabled — legacy storyteller narration replaced at generation boundary.`);
module.exports = { enabled: true, marker: GUARD_MARKER };
