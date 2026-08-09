// Stable, idempotent narration-quality guard.
// It strengthens only the LLM prompts used by the existing index.js pipeline.
// It does NOT generate a new runtime/index file and does NOT alter the video pipeline.

const ORIGINAL_FETCH = global.fetch;
const GUARD_MARKER = 'NARRATION_QUALITY_GUARD_V1';

if (!ORIGINAL_FETCH || ORIGINAL_FETCH.__NARRATION_QUALITY_GUARD__) {
  module.exports = { enabled: true, marker: GUARD_MARKER };
  return;
}

function isGroqChatRequest(url, options) {
  return String(url).includes('api.groq.com/openai/v1/chat/completions') &&
    options && String(options.method || 'GET').toUpperCase() === 'POST';
}

function classifyPrompt(prompt) {
  const p = String(prompt || '');
  if (/STORY BEATS:|VERIFIED FACT|కేవలం తెలుగు narration|professional YouTube Shorts storyteller/i.test(p)) return 'narration';
  if (/story beats ని JSON|"hook".*"question".*"reveal".*"twist".*"ending"/i.test(p)) return 'beats';
  return 'other';
}

function qualitySuffix(kind) {
  if (kind === 'beats') {
    return `\n\n${GUARD_MARKER}: FACT-LOCK RULES\n- VERIFIED FACT లో ఉన్న సంఖ్యలు, పేర్లు, ప్రదేశాలు, కాల పరిమితులు, శాస్త్రీయ పదాలు లేదా cause/effect claims ఏవీ మార్చవద్దు.\n- Fact లో లేని కొత్త సంఖ్య, percentage, year, person, place, comparison లేదా consequence జోడించవద్దు.\n- Hook sensational గా ఉండవచ్చు, కానీ verified claim కి మించి overclaim చేయవద్దు.\n- ప్రతి beat అదే verified fact కి నేరుగా సంబంధించినదే కావాలి.`;
  }
  if (kind === 'narration') {
    return `\n\n${GUARD_MARKER}: FINAL NARRATION QUALITY CONTRACT\n- ఇది natural spoken Telugu. పుస్తక తెలుగు, news-reader style, AI-sounding filler వద్దు.\n- Viewer కి friend ఒక surprising fact చెబుతున్నట్టు conversational గా రాయి.\n- Personal scenario, food example, family example లేదా daily-life comparison fact కి సహజంగా అవసరమైతే మాత్రమే వాడు; బలవంతంగా పెట్టవద్దు.\n- "అనుకుంటున్నారా? కాదు..." లేదా "అసలు విషయం ఏంటంటే..." వంటి templates ని repeated pattern గా వాడవద్దు.\n- Verified fact లో ఉన్న సంఖ్యలు/పేర్లు/స్థలాలు/కాలాలు/technical terms అచ్చంగా preserve చేయాలి. 92% ను 99%గా, ఒక సంఖ్యను మరో సంఖ్యగా మార్చకూడదు.\n- కొత్త fact, statistic, example, comparison, consequence లేదా claim invent చేయవద్దు.\n- ప్రతి line కి purpose ఉండాలి. అదే idea ని వేరే మాటల్లో మళ్లీ చెప్పవద్దు.\n- Artificial phrases เช่น "ఆన్‌లైన్ శాపం", "గణనీయంగా చాలా పెంచుతుంది" వంటి unnatural wording వద్దు; simple spoken Telugu వాడు.\n- Formal filler words తగ్గించు. "ఇది సూచిస్తుంది", "అందువల్ల", "గణనీయంగా" వంటి పదాలు నిజంగా అవసరమైతే మాత్రమే.\n- చివర్లో fact-specific memorable takeaway ఇవ్వు. Generic moral వద్దు.\n- CTA రాయకూడదు; existing pipeline చివర CTA ని స్వయంగా జోడిస్తుంది.`;
  }
  return '';
}

function patchPrompt(prompt) {
  const kind = classifyPrompt(prompt);
  const suffix = qualitySuffix(kind);
  if (!suffix || String(prompt).includes(GUARD_MARKER)) return { prompt: String(prompt), kind };
  return { prompt: String(prompt) + suffix, kind };
}

async function guardedFetch(url, options = {}) {
  if (!isGroqChatRequest(url, options)) return ORIGINAL_FETCH(url, options);

  let body = options.body;
  let parsed;
  try {
    parsed = JSON.parse(String(body || '{}'));
  } catch (_) {
    return ORIGINAL_FETCH(url, options);
  }

  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  const last = messages.length ? messages[messages.length - 1] : null;
  const originalPrompt = last && typeof last.content === 'string' ? last.content : '';
  const patched = patchPrompt(originalPrompt);

  if (patched.kind !== 'other') {
    parsed.temperature = patched.kind === 'narration' ? 0.22 : 0.18;
    if (last) last.content = patched.prompt;
    options = { ...options, body: JSON.stringify(parsed) };
  }

  const response = await ORIGINAL_FETCH(url, options);
  if (patched.kind !== 'narration' || !response || typeof response.clone !== 'function') return response;

  // Keep the normal Response contract intact while applying only a few
  // deterministic wording cleanups known to be unnatural in spoken Telugu.
  try {
    const cloned = response.clone();
    const data = await cloned.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof content === 'string') {
      let cleaned = content
        .replace(/ఆన్‌లైన్‌ శాపంలో/g, 'ఆన్‌లైన్‌ కొనుగోళ్లలో')
        .replace(/ఆన్‌లైన్ శాపంలో/g, 'ఆన్‌లైన్ కొనుగోళ్లలో')
        .replace(/గణనీయంగా చాలా పెంచుతుంది/g, 'గణనీయంగా పెంచుతుంది');
      if (cleaned !== content) {
        data.choices[0].message.content = cleaned;
        return new Response(JSON.stringify(data), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }
    }
  } catch (_) {
    // Never let the quality guard break the underlying LLM request.
  }
  return response;
}

guardedFetch.__NARRATION_QUALITY_GUARD__ = true;
global.fetch = guardedFetch;

console.log(`${GUARD_MARKER}: enabled — fact-locked Telugu narration quality rules active.`);
module.exports = { enabled: true, marker: GUARD_MARKER };
