// Narration quality guard V14 — final implementation.
// This is intentionally kept at V14: no more V15/V16 patch chain.
// The real bug was that index.js still asked the model for storyteller-style
// narration and the old V14 only merged sentences AFTER generation.
// This guard now replaces that narration request at the actual Groq boundary.
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
  // This identifies only the original Stage-2 narration request. Story-beat
  // generation, fact verification, metadata, and punctuation calls are left
  // completely untouched.
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
  // A field is one sentence only when it contains no internal sentence-ending
  // punctuation. The final punctuation is added by the normalizer.
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
  if (wordCount < 75 || wordCount > 125) return null;
  if ((script.match(/\?/g) || []).length !== 1) return null;
  if (/అసలు విషయం ఏంటంటే|ఇంకా షాక్ ఏంటంటే|ఇది వింటే షాక్|కానీ\.\.\.|అయితే\.\.\./i.test(script)) return null;

  return script;
}

function buildFactNarrationPrompt(originalPrompt, retry = false) {
  const source = extractVerifiedSource(originalPrompt);
  return `నువ్వు ఒక VERIFIED FACT ని Telugu YouTube Shorts కోసం ఒక సహజమైన FACT-EXPLAINER narration గా మార్చాలి.

VERIFIED SOURCE:
${source}

ఇది మాత్రమే factual source. పై source లో లేని కొత్త fact, number, date, name, cause, effect, example, comparison, background లేదా conclusion ని నీ స్వంత జ్ఞానంతో జోడించకూడదు.

ముఖ్యమైన విషయం:
ఇది STORY కాదు.
ఇది VIRAL STORYTELLING కాదు.
ఇది TWIST / REVEAL / CLIFFHANGER script కాదు.
ఇది ఒక knowledgeable person ఒక interesting verified fact ని viewer కి స్పష్టంగా explain చేస్తున్నట్టు ఉండాలి.

TARGET SCRIPT — ఈ exact logical progression కావాలి:

1) HOOK
Topic గురించి సహజమైన curiosity question లేదా curiosity statement.

2) FACT
Hook కి నేరుగా సమాధానం ఇచ్చే verified core fact. Viewer కి అసలు fact ఇక్కడ స్పష్టంగా తెలియాలి.

3) EXPLANATION
ఇప్పుడే చెప్పిన fact లోని ముఖ్యమైన concept, term, mechanism లేదా value ఏంటో సులభంగా explain చేయాలి.

4) IMPORTANT CONTEXT
Source లో ఉన్న relevant date, background, condition లేదా directly-supported detail మాత్రమే చెప్పాలి. Source లో context లేకపోతే fake context సృష్టించకూడదు; ఉన్న fact లోని మరో directly-supported clarification ఉపయోగించాలి.

5) MEANING
ముందు చెప్పిన fact + explanation + context కలిపి ఏమి అర్థమవుతుందో logically connect చేయాలి. Opinion, exaggeration లేదా unsupported consequence వద్దు.

6) CONCLUSION
అదే verified fact నుంచి వచ్చే clear, fact-specific takeaway. Generic moral, motivation లేదా CTA వద్దు.

నీకు reference గా ఈ formation మాత్రమే:

“వెలుతురు ఎంత వేగంగా ప్రయాణిస్తుందో తెలుసా?”
“శూన్యంలో వెలుతురు సెకనుకు సుమారు రెండు లక్షల తొంభై తొమ్మిది వేల కిలోమీటర్ల వేగంతో ప్రయాణిస్తుంది.”
“ఈ వేగాన్ని శాస్త్రవేత్తలు ‘c’ అనే గుర్తుతో సూచిస్తారు.”
“1983లో మీటర్‌ను నిర్వచించే విధానాన్ని మార్చినప్పుడు, ఈ వేగాన్ని ఖచ్చితమైన విలువగా ఉపయోగించారు.”
“అందుకే ఇప్పుడు మీటర్ నిర్వచనం కూడా వెలుతురు వేగంతో నేరుగా సంబంధం కలిగి ఉంది.”
“అంటే వెలుతురు వేగం కేవలం ఒక శాస్త్రీయ సంఖ్య కాదు; మన పొడవు కొలతకు కూడా అది ప్రాథమిక ఆధారం.”

పై example లోని facts లేదా wording copy చేయకూడదు. దాని LOGIC మాత్రమే follow చేయాలి.

STRICT WRITING RULES:
- EXACTLY 6 complete sentences.
- Sentence 1 = Hook.
- Sentence 2 = direct factual answer.
- Sentence 3 = explanation.
- Sentence 4 = important context.
- Sentence 5 = meaning/connection.
- Sentence 6 = conclusion/takeaway.
- ప్రతి sentence ముందు sentence నుంచి naturally continue కావాలి.
- మొత్తం script ఒకే విషయం గురించి connected explanation లాగా ఉండాలి; ఆరు unrelated facts లాగా ఉండకూడదు.
- Hook తర్వాత suspense కోసం fact ని దాచకూడదు; sentence 2 లో core fact స్పష్టంగా చెప్పాలి.
- “అసలు విషయం ఏంటంటే”, “ఇంకా షాక్ ఏంటంటే”, “ఇది వింటే షాక్”, “కానీ...”, “అయితే...” వంటి viral-template transitions వద్దు.
- “నమ్మగలరా?”, “ఊహించండి”, “మీరు ఊహించారా?” వంటి forced engagement వద్దు.
- “అత్యంత ఆశ్చర్యకరమైన”, “షాకింగ్”, “వింతైన” వంటి unsupported hype వద్దు.
- “కేవలం... కాదు” వంటి dramatic framing అవసరం లేకపోతే వాడవద్దు.
- Technical English term source లో అవసరమైతే natural Telugu sentence లో ఉంచవచ్చు; random English వద్దు.
- సంఖ్యలు/dates ఉంటే TTS-friendly Telugu words లో రాయి; ASCII digits వద్దు.
- Source లో ఉన్న qualifier ని preserve చేయాలి; “కొన్ని” ని “అన్నీ”, “సంభవించవచ్చు” ని “ఖచ్చితంగా జరుగుతుంది” గా మార్చకూడదు.
- Same fact ని different words తో repeatedly చెప్పవద్దు.
- Generic moral, life lesson, personal example, CTA, title, keywords, emoji, labels వద్దు.
- Pure Telugu compulsory కాదు; natural Telugu is the priority.
- Target approximately 85-110 Telugu words. కానీ word count కోసం filler sentences జోడించవద్దు.
${retry ? '\nమునుపటి narration target formation కి సరిపోలలేదు. ఈసారి పై six-step logic ని మరింత ఖచ్చితంగా follow చేయి.\n' : ''}

OUTPUT FORMAT:
Strict JSON object మాత్రమే. Exactly these six keys:
{
  "hook": "one complete sentence",
  "fact": "one complete sentence",
  "explanation": "one complete sentence",
  "context": "one complete sentence",
  "meaning": "one complete sentence",
  "conclusion": "one complete sentence"
}
ప్రతి field లో exactly ONE complete sentence మాత్రమే ఉండాలి. JSON బయట ఏ text రాయకూడదు.`;
}

async function requestStructuredNarration(originalUrl, originalOptions, prompt, retry = false) {
  let body;
  try {
    body = JSON.parse(String(originalOptions.body || '{}'));
  } catch (_) {
    return PREVIOUS(originalUrl, originalOptions);
  }

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

  return PREVIOUS(originalUrl, { ...originalOptions, body: JSON.stringify(body) });
}

async function guardedFetch(url, options = {}) {
  if (!isGroq(url, options)) return PREVIOUS(url, options);

  let body;
  try { body = JSON.parse(String(options.body || '{}')); } catch (_) { return PREVIOUS(url, options); }
  const last = Array.isArray(body.messages) && body.messages[body.messages.length - 1];
  const originalPrompt = last?.content || '';
  if (!isNarrationPrompt(originalPrompt)) return PREVIOUS(url, options);

  // Do not let the legacy storyteller prompt reach the model. Replace it at
  // the actual narration generation boundary with the clean fact-explainer
  // task above. Groq's GPT-OSS 120B supports strict JSON Schema outputs.
  let response = await requestStructuredNarration(url, options, originalPrompt, false);

  try {
    let data = await response.clone().json();
    let script = parseStructuredContent(data);

    // One bounded retry only. If the model's first structured answer does not
    // satisfy the semantic shape, ask the SAME clean task again. Never fall
    // back to the old storyteller prompt.
    if (!script) {
      console.log(`${GUARD_MARKER}: first fact narration failed target validation — one bounded clean retry.`);
      response = await requestStructuredNarration(url, options, originalPrompt, true);
      data = await response.clone().json();
      script = parseStructuredContent(data);
    }

    if (!script) {
      throw new Error('clean fact narration failed six-part validation after one bounded retry');
    }

    data.choices[0].message.content = script;
    console.log(`${GUARD_MARKER}: FINAL FACT NARRATION accepted — 6 connected sentences, ${countWords(script)} words.`);
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
