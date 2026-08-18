// Narration quality guard V14 — final implementation.
// Stable final-narration boundary: replace legacy storyteller instructions,
// request one structured six-part fact explanation, validate it, and return
// plain narration text to index.js.
const PREVIOUS = global.fetch;
const GUARD_MARKER = 'NARRATION_QUALITY_GUARD_V14';
if (!PREVIOUS || PREVIOUS.__NARRATION_QUALITY_GUARD_V14__) {
  module.exports = { enabled: true, marker: GUARD_MARKER };
  return;
}
function isGroq(url, options) { return String(url).includes('api.groq.com/openai/v1/chat/completions') && options && String(options.method || 'GET').toUpperCase() === 'POST'; }
function isNarrationPrompt(prompt) {
  const p = String(prompt || '');
  return /VERIFIED FACT\s*[—-]\s*ACCURACY GROUNDING:/i.test(p) && (/STORY BEATS/i.test(p) || /high-retention storyteller/i.test(p) || /final narration/i.test(p));
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
function cleanSentence(text) { return String(text || '').replace(/\s+/g, ' ').replace(/^["“”'`]+|["“”'`]+$/g, '').replace(/[.!?।]+$/g, '').trim(); }
function countWords(text) { return String(text || '').split(/\s+/).filter(Boolean).length; }
function oneSentence(text) { const s = String(text || '').trim(); return !!s && !/[.!?।]/.test(s); }
function parseContent(data) {
  const choice = data?.choices?.[0];
  const message = choice?.message;
  const raw = message?.content;
  if (!raw) {
    return { reason: `model returned empty content (finish_reason=${choice?.finish_reason || 'unknown'}, refusal=${message?.refusal || 'none'}, reasoning_present=${Boolean(message?.reasoning)})` };
  }
  let obj;
  try { obj = JSON.parse(String(raw).replace(/^```json\s*/i, '').replace(/```$/i, '').trim()); }
  catch (_) { return { reason: 'model returned non-JSON content' }; }
  const keys = ['hook','fact','explanation','context','meaning','conclusion'];
  if (!keys.every(k => typeof obj[k] === 'string' && obj[k].trim())) return { reason: 'one or more six-part fields were missing/empty' };
  if (!keys.every(k => oneSentence(cleanSentence(obj[k])))) return { reason: 'one or more fields contained multiple sentences' };
  const parts = keys.map((k, i) => { const s = cleanSentence(obj[k]); return i === 0 ? `${s}?` : `${s}.`; });
  const script = parts.join(' ');
  const words = countWords(script);
  if (words < 75 || words > 125) return { reason: `word count ${words} outside safety band 75-125` };
  if ((script.match(/\?/g) || []).length !== 1) return { reason: 'hook question count is not exactly one' };
  if (/అసలు విషయం ఏంటంటే|ఇంకా షాక్ ఏంటంటే|ఇది వింటే షాక్|కానీ\.\.\.|అయితే\.\.\./i.test(script)) return { reason: 'storyteller filler detected' };
  if (/\b(?:hook|fact|explanation|context|meaning|conclusion)\s*:/i.test(script) || /(?:హుక్|ఫ్యాక్ట్|వివరణ|సందర్భం|అర్థం|ముగింపు)\s*[:：-]/i.test(script)) return { reason: 'structural labels leaked into narration' };
  return { script };
}
function buildFactNarrationPrompt(originalPrompt, attempt) {
  const source = extractVerifiedSource(originalPrompt);
  const retry = attempt > 0 ? '\nమునుపటి ప్రయత్నం output constraints కి సరిపోలలేదు. ఈసారి concise, complete, natural six-sentence narration ఇవ్వు.\n' : '';
  return `నువ్వు ఒక VERIFIED FACT ని Telugu YouTube Shorts కోసం ఒక సహజమైన FACT-EXPLAINER narration గా మార్చాలి.

VERIFIED SOURCE:
${source}

ఈ source మాత్రమే factual authority. Source లో లేని కొత్త fact, number, date, name, cause, effect, example, comparison, background లేదా conclusion జోడించకూడదు.

ఇది STORY కాదు. Twist, cliffhanger, dramatic reveal, artificial suspense, viral-template narration వద్దు. ఒక knowledgeable person ఒక interesting verified fact ని viewer కి స్పష్టంగా explain చేస్తున్నట్టు ఉండాలి.

TARGET LOGIC:
1) Hook — topic పై సహజమైన curiosity question/statement.
2) Fact — hook కి నేరుగా సమాధానం ఇచ్చే core verified fact.
3) Explanation — ఆ fact లోని ముఖ్యమైన concept/term/mechanism/value ని సులభంగా explain చేయాలి.
4) Important Context — source లో ఉన్న relevant date/background/condition/detail మాత్రమే.
5) Meaning — ముందు చెప్పిన information ఎందుకు significantో source ఆధారంగా logically connect చేయాలి.
6) Conclusion — అదే verified fact నుంచి వచ్చే clear fact-specific takeaway.

REFERENCE FOR FORMATION ONLY:
“వెలుతురు ఎంత వేగంగా ప్రయాణిస్తుందో తెలుసా?”
“శూన్యంలో వెలుతురు సెకనుకు సుమారు రెండు లక్షల తొంభై తొమ్మిది వేల కిలోమీటర్ల వేగంతో ప్రయాణిస్తుంది.”
“ఈ వేగాన్ని శాస్త్రవేత్తలు ‘c’ అనే గుర్తుతో సూచిస్తారు.”
“1983లో మీటర్‌ను నిర్వచించే విధానాన్ని మార్చినప్పుడు, ఈ వేగాన్ని ఖచ్చితమైన విలువగా ఉపయోగించారు.”
“అందుకే ఇప్పుడు మీటర్ నిర్వచనం కూడా వెలుతురు వేగంతో నేరుగా సంబంధం కలిగి ఉంది.”
“అంటే వెలుతురు వేగం కేవలం ఒక శాస్త్రీయ సంఖ్య కాదు; మన పొడవు కొలతకు కూడా అది ప్రాథమిక ఆధారం.”

STRICT RULES:
- EXACTLY 6 complete sentences.
- Sentence 1=Hook, 2=Fact, 3=Explanation, 4=Context, 5=Meaning, 6=Conclusion.
- Sentences must connect naturally; do not make six unrelated facts.
- Sentence 2 must answer the hook directly.
- Each JSON field must contain exactly ONE sentence and no sentence-ending punctuation inside the field.
- No labels, JSON outside the schema, CTA, title, keywords, emoji, generic moral, personal example, forced engagement, twist or cliffhanger.
- No unsupported hype or new information.
- Preserve source qualifiers and scope.
- Technical English terms may remain when needed for accuracy; do not translate technical notation into awkward Telugu.
- Keep terms such as 3D in their normal technical form; do not write “మూడు D” or “మూడు డీ”.
- Target roughly 85-115 Telugu words, but clarity and completeness are more important than filler.
${retry}

OUTPUT: Strict JSON object only with exactly these six keys:
{"hook":"one complete sentence","fact":"one complete sentence","explanation":"one complete sentence","context":"one complete sentence","meaning":"one complete sentence","conclusion":"one complete sentence"}`;
}
async function requestStructuredNarration(url, options, prompt, attempt) {
  let body;
  try { body = JSON.parse(String(options.body || '{}')); } catch (_) { throw new Error('Could not parse original Groq request body.'); }
  body.messages = [{ role: 'user', content: buildFactNarrationPrompt(prompt, attempt) }];
  body.temperature = attempt === 0 ? 0.05 : 0.0;
  body.reasoning_effort = 'low';
  body.include_reasoning = false;
  // GPT-OSS reasoning tokens count against completion budget. 1800 was too
  // tight and repeatedly produced an empty message. 4000 leaves safe headroom
  // while staying below the known 8000 TPM request ceiling for this workflow.
  body.max_completion_tokens = 4000;
  delete body.max_tokens;
  body.response_format = { type: 'json_schema', json_schema: { name: 'telugu_fact_narration', strict: true, schema: {
    type: 'object', properties: {
      hook: { type: 'string' }, fact: { type: 'string' }, explanation: { type: 'string' },
      context: { type: 'string' }, meaning: { type: 'string' }, conclusion: { type: 'string' }
    }, required: ['hook','fact','explanation','context','meaning','conclusion'], additionalProperties: false
  } } };
  return PREVIOUS(url, { ...options, body: JSON.stringify(body) });
}
async function guardedFetch(url, options = {}) {
  if (!isGroq(url, options)) return PREVIOUS(url, options);
  let body; try { body = JSON.parse(String(options.body || '{}')); } catch (_) { return PREVIOUS(url, options); }
  const last = Array.isArray(body.messages) && body.messages[body.messages.length - 1];
  const originalPrompt = last?.content || '';
  if (!isNarrationPrompt(originalPrompt)) return PREVIOUS(url, options);
  console.log(`${GUARD_MARKER}: intercepted final narration request at generation boundary.`);
  let lastReason = 'unknown validation failure';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await requestStructuredNarration(url, options, originalPrompt, attempt);
    try {
      const data = await response.clone().json();
      const result = parseContent(data);
      if (result.script) {
        data.choices[0].message.content = result.script;
        data.choices[0].finish_reason = 'stop';
        console.log(`${GUARD_MARKER}: FINAL FACT NARRATION accepted — ${countWords(result.script)} words, 6 connected sentences.`);
        return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers: response.headers });
      }
      lastReason = result.reason;
      console.log(`${GUARD_MARKER}: validation attempt ${attempt + 1}/2 rejected — ${lastReason}`);
    } catch (e) {
      lastReason = `response processing error: ${e.message}`;
      console.log(`${GUARD_MARKER}: attempt ${attempt + 1}/2 failed — ${lastReason}`);
    }
  }
  throw new Error(`Clean fact narration failed after 2 bounded attempts — ${lastReason}`);
}
guardedFetch.__NARRATION_QUALITY_GUARD_V14__ = true;
global.fetch = guardedFetch;
console.log(`${GUARD_MARKER}: enabled — final narration boundary loaded with GPT-OSS completion headroom.`);
module.exports = { enabled: true, marker: GUARD_MARKER };
