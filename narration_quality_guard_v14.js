// Narration quality guard V14.
// Strictly enforces one connected six-sentence fact explainer.
const PREVIOUS = global.fetch;
const GUARD_MARKER = 'NARRATION_QUALITY_GUARD_V14';
if (!PREVIOUS || PREVIOUS.__NARRATION_QUALITY_GUARD_V14__) {
  module.exports = { enabled: true, marker: GUARD_MARKER };
  return;
}
function isGroq(url, options) {
  return String(url).includes('api.groq.com/openai/v1/chat/completions') && options && String(options.method || 'GET').toUpperCase() === 'POST';
}
function isNarration(prompt) {
  const p = String(prompt || '');
  return /STORY BEATS/i.test(p) && /TARGET RHYTHM|high-retention storyteller|CALL A of Stage 2|final narration text only|12-18 short spoken lines/i.test(p);
}
function getContent(data) { return data?.choices?.[0]?.message?.content ?? null; }
function setContent(data, content) { data.choices[0].message.content = content; return data; }
function splitSentences(text) {
  return String(text || '').split(/(?<=[.!?।])\s+/).map(s => s.trim()).filter(Boolean);
}
function mergeToSix(text) {
  let parts = splitSentences(text);
  if (parts.length <= 6) return text;
  while (parts.length > 6) {
    let best = 1;
    let bestScore = Infinity;
    for (let i = 1; i < parts.length - 1; i++) {
      const s = parts[i];
      const score = s.length + (/^(అంటే|అందుకే|అందువల్ల)/.test(s) ? 250 : 0);
      if (score < bestScore) { bestScore = score; best = i; }
    }
    const left = parts[best - 1].replace(/[.!?।]+$/, '');
    const right = parts[best].replace(/^[\s]+/, '').replace(/[.!?।]+$/, '');
    parts.splice(best - 1, 2, `${left}, ${right}.`);
  }
  return parts.join(' ');
}
async function guardedFetch(url, options = {}) {
  if (!isGroq(url, options)) return PREVIOUS(url, options);
  let body;
  try { body = JSON.parse(String(options.body || '{}')); } catch (_) { return PREVIOUS(url, options); }
  const last = Array.isArray(body.messages) && body.messages[body.messages.length - 1];
  const prompt = last?.content || '';
  const response = await PREVIOUS(url, options);
  if (!isNarration(prompt) || !response || typeof response.clone !== 'function') return response;
  try {
    const data = await response.clone().json();
    const raw = getContent(data);
    if (!raw) return response;
    const repaired = mergeToSix(String(raw).replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim());
    const count = splitSentences(repaired).length;
    if (count !== 6) {
      console.log(`${GUARD_MARKER}: final sentence count ${count}; preserving primary response.`);
      return response;
    }
    console.log(`${GUARD_MARKER}: EXACT SIX-SENTENCE FACT SCRIPT enforced.`);
    return new Response(JSON.stringify(setContent(data, repaired)), { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (e) {
    console.log(`${GUARD_MARKER}: post-process failed (${e.message}); preserving response.`);
    return response;
  }
}
guardedFetch.__NARRATION_QUALITY_GUARD_V14__ = true;
global.fetch = guardedFetch;
console.log(`${GUARD_MARKER}: enabled — six-sentence final narration enforcement active.`);
module.exports = { enabled: true, marker: GUARD_MARKER };
