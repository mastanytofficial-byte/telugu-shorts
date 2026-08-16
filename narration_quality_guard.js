// Stable narration-quality guard V11.
// ONE authoritative target for final narration:
// Hook -> Fact -> Explanation -> Important Context -> Meaning -> Conclusion.
// Verified fact is the only factual source. No repair/retry Groq call.

const ORIGINAL_FETCH = global.fetch;
const GUARD_MARKER = 'NARRATION_QUALITY_GUARD_V11';

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
  if (kind === 'narration') return 1800;
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
  return String(text || '').replace(/^```(?:text|telugu)?\s*/i, '').replace(/```$/i, '').replace(/^SCRIPT:\s*/i, '').replace(/^NARRATION:\s*/i, '').replace(/\n{3,}/g, '\n\n').trim();
}
function extractBlock(text, startMarker, endMarker) {
  const source = String(text || '');
  const start = source.indexOf(startMarker);
  if (start < 0) return '';
  const from = start + startMarker.length;
  const end = endMarker ? source.indexOf(endMarker, from) : -1;
  return source.slice(from, end >= 0 ? end : source.length).trim();
}
function qualityReasons(text) {
  const s = String(text || '');
  const sentences = s.split(/[.!?।]+/).map(x => x.trim()).filter(Boolean);
  const reasons = [];
  if (!s) reasons.push('empty narration');
  if (sentences.length < 5 || sentences.length > 8) reasons.push(`sentence count ${sentences.length} (target about 6)`);
  if ((s.match(/\?/g) || []).length > 2) reasons.push('too many questions');
  if (/అసలు విషయం ఏంటంటే|ఇంకా షాక్ ఏంటంటే|ఇది వింటే షాక్/gi.test(s)) reasons.push('forced suspense wording');
  return [...new Set(reasons)];
}
function buildTargetNarrationPrompt(original) {
  const fact = extractBlock(original, 'VERIFIED FACT — ACCURACY GROUNDING:', 'నీ ROLE:');
  return `కింద ఉన్న VERIFIED FACT ని ఆధారంగా తీసుకుని Telugu YouTube Short కోసం ఒక connected fact script రాయి.

VERIFIED FACT — ఇదొక్కటే factual source:
${fact || original}

ఇది FINAL SCRIPT కి ఒక్కటే authoritative structure. Story beats, old storyteller instructions, twist rules, word-count targets లేదా ఇతర narration structures ని ignore చేయి.

TARGET SCRIPT FORMATION — EXACTLY THIS LOGIC:
1. HOOK — topic గురించి ఒక natural curiosity question లేదా curiosity statement.
2. FACT — hook కి direct answer గా core verified fact చెప్పు.
3. EXPLANATION — ఆ fact లోని main concept/term/value ఏంటో viewer కి సులభంగా explain చేయి.
4. IMPORTANT CONTEXT — verified fact లో ఉన్న అత్యంత relevant background/date/detail మాత్రమే చెప్పు.
5. MEANING — ముందు చెప్పిన fact + context కలిపితే దాని significance ఏమిటో connect చేయి. VERIFIED FACT support చేయని significance invent చేయకు.
6. CONCLUSION — “అంటే...” వంటి natural bridge తో fact-specific takeaway ఇవ్వు. Generic moral వద్దు.

REFERENCE FOR FORMATION ONLY — facts/content copy చేయవద్దు:
Hook: “వెలుతురు ఎంత వేగంగా ప్రయాణిస్తుందో తెలుసా?”
Fact: “శూన్యంలో వెలుతురు సెకనుకు సుమారు రెండు లక్షల తొంభై తొమ్మిది వేల కిలోమీటర్ల వేగంతో ప్రయాణిస్తుంది.”
Explanation: “ఈ వేగాన్ని శాస్త్రవేత్తలు ‘c’ అనే గుర్తుతో సూచిస్తారు.”
Important context: “1983లో మీటర్‌ను నిర్వచించే విధానాన్ని మార్చినప్పుడు, ఈ వేగాన్ని ఖచ్చితమైన విలువగా ఉపయోగించారు.”
Meaning: “అందుకే ఇప్పుడు మీటర్ నిర్వచనం కూడా వెలుతురు వేగంతో నేరుగా సంబంధం కలిగి ఉంది.”
Conclusion: “అంటే వెలుతురు వేగం కేవలం ఒక శాస్త్రీయ సంఖ్య కాదు; మన పొడవు కొలతకు కూడా అది ప్రాథమిక ఆధారం.”

CRITICAL FORMATION RULES:
- Final output లో Hook:, Fact:, Explanation:, Context:, Meaning:, Conclusion: labels రాయకూడదు. Six connected spoken sentences/ideas మాత్రమే ఇవ్వు.
- సాధ్యమైనంత వరకు 6 sentences. Clarity కోసం అవసరమైతే 5-8 sentences okay; random extra facts add చేయకు.
- Sentence 2 sentence 1 కి answer; sentence 3 sentence 2 ని explain; sentence 4 relevant context; sentence 5 వాటిని connect; final sentence takeaway.
- Random fact list వద్దు. ఒకే core fact ని beginning నుంచి ending వరకు develop చేయి.
- Artificial suspense, reveal, twist, cliffhanger, dramatic storytelling వద్దు.
- Textbook definition dump, documentary narration, news-reader tone వద్దు. Natural spoken Telugu లో knowledgeable person fact explain చేస్తున్నట్టు ఉండాలి.
- Complete natural sentences వాడు. Short-line effect కోసం grammar break చేయకు.
- అదే information ని rephrase చేసి repeat చేయకు.
- filler transitions, forced personal scenarios, generic morals, opinions, CTA వద్దు.

FACT SAFETY:
- VERIFIED FACT బయట new fact, number, date, name, cause, mechanism, example, comparison, effect లేదా consequence invent చేయకు.
- Fact specific condition/object/location గురించి ఉంటే scope broaden చేయకు.
- may/can/some/certain వంటి qualifiers meaning preserve చేయి.
- Important context VERIFIED FACT లో లేకపోతే fake context invent చేయకు; directly supported clarification ని context slot గా వాడు.
- Meaning/significance VERIFIED FACT నుంచి directly supported అయితేనే చెప్పు.
- English technical terms, names, brands, acronyms natural Telugu sentence లో అవసరమైతే వాడొచ్చు. Pure Telugu compulsory కాదు.
- Numbers/dates fact కి essential అయితే ఉంచు. TTS-readable spoken form prefer చేయి; scientific notation dump చేయకు.

OUTPUT:
- Final narration మాత్రమే.
- No labels, JSON, markdown, title, keywords, CTA, emoji.
- Length ని force చేయకు. Six-step fact explanation complete అయిన వెంటనే stop చేయి.`;
}
function patchPrompt(prompt) {
  const original = String(prompt || '');
  const kind = classify(original);
  if (original.includes(GUARD_MARKER)) return { prompt: original, kind };
  if (kind === 'narration') return { prompt: buildTargetNarrationPrompt(original), kind };
  return { prompt: original, kind };
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
  body = { ...body, messages: body.messages.map(m => ({ ...m })), temperature: patched.kind === 'narration' ? 0.08 : 0.05, reasoning_effort: 'low', include_reasoning: false, max_completion_tokens: tokenBudget(patched.kind) };
  delete body.max_tokens;
  body.messages[body.messages.length - 1].content = patched.prompt;
  const response = await ORIGINAL_FETCH(url, { ...options, body: JSON.stringify(body) });
  if (patched.kind !== 'narration' || !response || typeof response.clone !== 'function') return response;
  try {
    const data = await response.clone().json();
    const content = clean(getContent(data));
    if (!content) {
      console.log(`${GUARD_MARKER}: empty narration response; preserving primary response. No repair request.`);
      return response;
    }
    const reasons = qualityReasons(content);
    if (reasons.length) console.log(`${GUARD_MARKER}: target-formation warnings — ${reasons.join(' | ')}; preserving generated response.`);
    else console.log(`${GUARD_MARKER}: SIX-STEP TARGET FACT SCRIPT accepted.`);
    data.choices[0].message.content = content;
    return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (e) {
    console.log(`${GUARD_MARKER}: response parsing failed (${e.message}); preserving primary response.`);
    return response;
  }
}
guardedFetch.__NARRATION_QUALITY_GUARD__ = true;
global.fetch = guardedFetch;
console.log(`${GUARD_MARKER}: enabled — authoritative Hook→Fact→Explanation→Context→Meaning→Conclusion script formation active.`);
module.exports = { enabled: true, marker: GUARD_MARKER };
