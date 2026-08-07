// Telugu Amazing Facts Shorts — fully automated, runs on GitHub Actions
// Rotates through 10 fact sub-niches: mindblowing, psychology, earth_space, animal, money, history, human_body, technology, food, ocean
// Topic/Script (Groq) -> Voice (Google TTS) -> Images/Video (Pexels/AI) -> Music (Jamendo) -> Video (FFmpeg) -> YouTube

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { google } = require('googleapis');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY;
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const JAMENDO_CLIENT_ID = process.env.JAMENDO_CLIENT_ID;
const YT_CLIENT_ID = process.env.YT_CLIENT_ID;
const YT_CLIENT_SECRET = process.env.YT_CLIENT_SECRET;
const YT_REFRESH_TOKEN = process.env.YT_REFRESH_TOKEN;

const STATE_FILE = path.join(__dirname, 'state.json');
const WORK_DIR = path.join(__dirname, 'work');

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// A stalled connection to any external API (Groq, Google TTS, Pexels,
// Jamendo) could otherwise hang until GitHub Actions' 15-minute job timeout
// kills the whole run with no useful error message. Every external fetch in
// this file goes through this wrapper so a hang fails fast and loud instead.
async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// "Amazing Facts" niche — 7 specific sub-topics rotating evenly, avoiding
// the "boring generic facts channel" trap by staying hyper-specific per
// video. Accuracy risk was explicitly discussed and accepted (facts,
// unlike fiction, carry hallucination/misinformation risk that can't be
// 100% guaranteed away). 1 video/day — a 10/day scale-up would need real
// infrastructure changes (YouTube upload quota, GH Actions runtime budget).
const FACT_SUBNICHES = ['mindblowing', 'psychology', 'earth_space', 'animal', 'money', 'history', 'human_body', 'technology', 'food', 'ocean'];

function pickCategory(runCount) {
  const category = FACT_SUBNICHES[runCount % FACT_SUBNICHES.length];
  log(`Today's category: ${category} (run #${runCount})`);
  return category;
}

// Asks Groq for one new, high-confidence fact outline in the given
// category — called for every single video now (no curated bank fallback
// anymore, per user decision). Returns
// null if the model itself signals uncertainty (explicitly told to do so
// rather than guess), so nothing shaky ever gets persisted.
async function generateNewFactOutline(category, existingOutlines) {
  const existingSummaries = existingOutlines.map(o => o.split('.')[0]).join(' | ');
  const prompt = `${category} విభాగంలో ఒక rare, ఆశ్చర్యపరిచే fact తెలుగులో ఇవ్వు — YouTube/Instagram లో వందల సార్లు repeat అయిన fact కాదు.

వాడకు: ఆక్టోపస్ గుండెలు, తేనె expire అవ్వదు, అరటిపండు berry, సొరచేపలు నిద్రపోవు, చంద్రుడు ఒకే వైపు, జిరాఫీ మెడ, ఈఫిల్ టవర్. ఇప్పటికే వాడినవి: ${existingSummaries}

నీకు నిజంగా ఖచ్చితంగా తెలిసిన fact మాత్రమే ఇవ్వు. స్పష్టమైన సందేహం ఉంటేనే "UNSURE" అని రాయి (చిన్న uncertainty కి కాదు, genuinely గుర్తు లేకపోతేనే).

ఫార్మాట్ (వేరే ఏమీ రాయకు):
హుక్: (ఆసక్తికరమైన ప్రశ్న)
వివరణ: (సమాధానం, 2-3 వాక్యాలు)
Twist: (అదనపు వివరం, 1-2 వాక్యాలు)`;

  const raw = await callGroq(prompt);
  const trimmed = raw.trim();
  if (trimmed.toUpperCase().includes('UNSURE') || !trimmed.includes('హుక్') || !trimmed.includes('వివరణ')) {
    log(`  New-fact generation for ${category}: model signaled uncertainty or gave malformed output, skipping.`);
    return null;
  }
  return trimmed;
}

// Independent second pass: asks Groq to specifically critique the
// candidate for accuracy, as a lightweight self-verification safety net
// before anything gets permanently saved to the growing fact bank.
async function verifyFactOutline(outline) {
  const prompt = `కింద ఇచ్చిన fact ని రెండు కోణాల్లో అంచనా వేయి.

Fact: ${outline}

1) ACCURACY: ఇందులో స్పష్టంగా తప్పు కావొచ్చు అని గుర్తించదగ్గ నిర్దిష్ట సంఖ్య/పేరు/వాదన ఉందా?

2) VIRAL APPEAL (0-100): Scroll-stopping power, curiosity, shock value, emotional reaction, shareability, comment potential, తెలుగు audience relevance, visual potential, retention potential, originality — వీటన్నింటినీ కలిపి ఆలోచించి ఒక మొత్తం స్కోరు ఇవ్వు.

ఖచ్చితంగా ఈ 2-లైన్ల ఫార్మాట్‌లో మాత్రమే జవాబు ఇవ్వు:
ACCURACY: VERIFIED (సాధారణంగా నమ్మదగినదైతే — చిన్న అనిశ్చితి ఉన్నా ఫర్వాలేదు) లేదా REJECTED (ఏదైనా స్పష్టమైన, నిర్దిష్టమైన తప్పు కారణం ఉంటేనే)
SCORE: (0-100 మధ్య ఒక మొత్తం సంఖ్య మాత్రమే)`;

  const raw = await callGroq(prompt);
  const verified = /ACCURACY:\s*VERIFIED/i.test(raw);
  const scoreMatch = raw.match(/SCORE:\s*(\d+)/i);
  const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;
  log(`  Fact self-verification: ${verified ? 'VERIFIED ✅' : 'REJECTED ❌'} | Viral score: ${score}/100`);
  return { verified, score };
}

// Resolves the outline to use for this run: tries a FRESH, self-verified
// fact from Groq, retrying up to 5 times if a candidate is rejected or
// generation fails. Per explicit user decision, there is NO fallback to
// the curated FACT_OUTLINES bank anymore — they want every video's fact
// sourced fresh, not from a fixed pre-written list, and accept that this
// means a run can fail outright if 5 attempts all come up empty (rare,
// but a real possibility with this trade-off). Verified facts are still
// persisted to discoveredFacts, both as a growing record and as the
// "don't repeat these" context for future attempts.
// Checks how many existing YouTube videos already cover a similar topic —
// this is a REAL, verifiable check against actual YouTube search results,
// not just hoping the LLM's own sense of "this is rare" is accurate (it
// can't know how saturated a topic is on YouTube). Reuses the same OAuth
// credentials as uploadToYouTube — no new API key needed. Fails OPEN (lets
// the fact through) on any API error, since a broken saturation check
// should never block an otherwise-good, verified fact.
async function checkFactSaturation(outline) {
  const hookMatch = outline.match(/హుక్:\s*(.+?)(?:వివరణ:|$)/);
  const query = hookMatch ? hookMatch[1].trim() : outline.slice(0, 60);
  try {
    const oauth2Client = new google.auth.OAuth2(YT_CLIENT_ID, YT_CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: YT_REFRESH_TOKEN });
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const res = await youtube.search.list({
      part: 'snippet',
      q: query,
      type: 'video',
      maxResults: 5,
      relevanceLanguage: 'te'
    });
    const totalResults = (res.data.pageInfo && res.data.pageInfo.totalResults) || 0;
    log(`  YouTube saturation check for "${query.slice(0, 40)}...": ~${totalResults} existing results.`);
    return totalResults;
  } catch (e) {
    log(`  WARNING: YouTube saturation check failed (${e.message}) — proceeding without this check (failing open).`);
    return 0;
  }
}

async function getOrGrowFactOutline(category, categoryRunCounts, discoveredFacts) {
  const previouslyDiscovered = (discoveredFacts && discoveredFacts[category]) || [];
  // Reduced from 5 — real run logs showed little benefit from attempts
  // past the first few, mostly just multiplying Groq calls and rate-limit
  // hits within a single run.
  const maxAttempts = 6;
  // A topic with more existing YouTube results than this is considered
  // saturated and skipped in favor of trying again — bounded within the
  // same maxAttempts loop, never an unbounded "keep trying until perfect"
  // search (that risks looping indefinitely if the threshold is too strict
  // for the model to ever satisfy).
  const SATURATION_THRESHOLD = 50;
  // Lowered from 85 — real run logs showed this model's self-scores
  // cluster around 80, so an 85 bar almost never triggered an early exit,
  // meaning every run silently burned through all attempts (and their
  // Groq calls / rate-limit risk) for no real quality gain.
  const HIGH_SCORE_THRESHOLD = 75;

  let bestCandidate = null;
  let bestScore = -1;
  // Track candidates generated WITHIN this run so far — without this, the
  // model has no way of knowing what it just suggested moments ago and can
  // (and did, per a real run log) repeat the exact same fact across
  // several attempts in a row. previouslyDiscovered only covers past runs.
  const thisRunsCandidates = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log(`Attempting a fresh, self-verified fact for "${category}" (attempt ${attempt}/${maxAttempts})...`);
    try {
      const candidate = await generateNewFactOutline(category, [...previouslyDiscovered, ...thisRunsCandidates]);
      if (candidate) {
        thisRunsCandidates.push(candidate);
        const { verified, score } = await verifyFactOutline(candidate);
        if (verified) {
          const existingResults = await checkFactSaturation(candidate);
          if (existingResults > SATURATION_THRESHOLD) {
            log(`  Fact is already well-covered on YouTube (~${existingResults} results > ${SATURATION_THRESHOLD} threshold) — trying a different fact.`);
            continue;
          }
          if (score > bestScore) {
            bestCandidate = candidate;
            bestScore = score;
          }
          if (score >= HIGH_SCORE_THRESHOLD) {
            log(`  Fresh fact VERIFIED, not oversaturated, and high viral score (${score}/100) on attempt ${attempt} — using it for this video.`);
            return { outline: candidate, newlyDiscovered: candidate };
          }
          log(`  Fact verified but viral score (${score}/100) below ${HIGH_SCORE_THRESHOLD} — keeping as best-so-far, trying for something stronger.`);
        }
      }
    } catch (e) {
      log(`  WARNING: attempt ${attempt} failed (${e.message}).`);
    }
  }

  if (bestCandidate) {
    log(`  No candidate reached the ${HIGH_SCORE_THRESHOLD}+ bar after ${maxAttempts} attempts — using the best one found (score ${bestScore}/100) rather than failing the run.`);
    return { outline: bestCandidate, newlyDiscovered: bestCandidate };
  }

  throw new Error(`Could not generate a verified fresh fact for "${category}" after ${maxAttempts} attempts — no curated fallback bank (per user decision to only use freshly-sourced facts). This run cannot continue today.`);
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      return {
        usedTitles: state.usedTitles || [],
        runCount: state.runCount || 0,
        categoryRunCounts: state.categoryRunCounts || {},
        discoveredFacts: state.discoveredFacts || {}
      };
    } catch (e) {}
  }
  return { usedTitles: [], runCount: 0, categoryRunCounts: {}, discoveredFacts: {} };
}

// Safety net: Google's Chirp 3: HD voice rejects any single "sentence" (text
// between periods) that's too long. Groq is prompted to add periods between
// sentences, but LLMs don't always follow formatting instructions exactly —
// this guarantees no run of text exceeds maxLen without a period, by forcing
// one in at the nearest comma if needed.
function ensureSentenceBreaks(text, maxLen = 140) {
  const ELLIPSIS_PLACEHOLDER = '\u0001E\u0001';
  const protectedText = text.replace(/\.\.\./g, ELLIPSIS_PLACEHOLDER);
  const parts = protectedText.split(/(?<=\.)\s*/);
  const fixed = [];
  for (let part of parts) {
    while (part.length > maxLen) {
      let cut = part.lastIndexOf(',', maxLen);
      if (cut === -1) cut = part.lastIndexOf(' ', maxLen); // fall back to nearest word boundary
      if (cut === -1) cut = maxLen; // last resort: hard cut, never leave a chunk over maxLen
      const before = part.slice(0, cut).replace(/,\s*$/, '').trim();
      fixed.push(before + '.');
      part = part.slice(cut + 1).trim();
    }
    if (part) fixed.push(part);
  }
  return fixed.join(' ').replace(/\s+/g, ' ').trim().split(ELLIPSIS_PLACEHOLDER).join('...');
}

// Fixed, guaranteed-correct emoji per category — the model was asked to
// freely choose a "contextually fitting" emoji before, but even with a
// corrective example already in the prompt (explicitly: bacteria fact ->
// 🦠, not 🐟), it still picked wrong ones. A model apparently can't be
// prompted into reliable word-to-emoji matching for Telugu content, so
// this is deterministic instead — category-level relevance, zero risk of
// a wrong pick.
const CATEGORY_EMOJI = {
  mindblowing: '🤯',
  psychology: '🧠',
  earth_space: '🌌',
  animal: '🐾',
  money: '💰',
  history: '🏛️',
  human_body: '🩺',
  technology: '💻',
  food: '🍽️',
  ocean: '🌊'
};

const FALLBACK_KEYWORDS = {
  mindblowing: 'science mystery curious object closeup',
  psychology: 'human brain mind thinking illustration',
  earth_space: 'planet earth space stars galaxy',
  animal: 'wild animal closeup nature',
  money: 'currency coins finance closeup',
  history: 'ancient historical artifact ruins',
  human_body: 'human anatomy body science illustration',
  technology: 'computer technology gadget closeup',
  food: 'food closeup delicious kitchen',
  ocean: 'ocean underwater sea waves'
};

// 110-130 words targets a fuller, more complete Amazing Facts Shorts format
// (short scripts were leaving facts feeling incomplete/rushed).
// 85-115 words targets 45-60s (primary target) — 80s (MAX_SAFE_WORDS=155
// in generateContent) remains available as an exceptional ceiling only for
// facts that genuinely need more room, not the normal case. Per explicit
// user decision: consistently-strong 45-60s Shorts outperform consistently
// 80s ones for this niche.
const WORD_COUNT_TARGETS = {
  mindblowing: { min: 85, max: 115 },
  psychology: { min: 85, max: 115 },
  earth_space: { min: 85, max: 115 },
  animal: { min: 85, max: 115 },
  money: { min: 85, max: 115 },
  history: { min: 85, max: 115 },
  human_body: { min: 85, max: 115 },
  technology: { min: 85, max: 115 },
  food: { min: 85, max: 115 },
  ocean: { min: 85, max: 115 }
};

// Rotating, warmer CTA variations — a single fixed robotic "follow, like,
// share, subscribe" checklist repeated identically on every video starts
// to feel templated to a returning viewer. These read more like a genuine,
// appreciative invitation than a command list, while still covering
// like/share/subscribe (matching the on-screen LIKE/SHARE/SUBSCRIBE
// button). Each still contains 'సబ్‌స్క్రైబ్' (Telugu script) so the
// existing CTA-detection/trim logic (which checks for that substring)
// keeps working across all variants.
const CTA_VARIATIONS = [
  'ఇలాంటి Amazing Facts కోసం సబ్‌స్క్రైబ్ చేయండి.'
];

function pickCTA(runCount) {
  return CTA_VARIATIONS[runCount % CTA_VARIATIONS.length];
}

function buildPrompt(category, recentTitles, outline, beats) {
  const avoidLine = recentTitles.length
    ? `\n\nఇటీవల ఈ అంశాలు వాడాము — ఇవే facts ని వేరే మాటల్లో మళ్ళీ చెప్పకు కూడా, పూర్తిగా కొత్త fact/విషయం ఎంచుకో: ${recentTitles.slice(-10).join(' | ')}`
    : '';

  const { min, max } = WORD_COUNT_TARGETS[category];

  const topicInstruction = `నువ్వు ఒక science teacher కాదు. ఒక Wikipedia article రాసేవాడివి కాదు. **నువ్వు ఒక professional YouTube Shorts storyteller వి** — నీ job viewers ని scroll ఆపి, చివరి వరకూ చూసేలా చేయడం.

ఈ story beats (ఇప్పటికే నిర్ణయించినవి, ఇదే క్రమంలో) ని — ఒక ఉత్కంఠభరితమైన రహస్యం మీ best friend కి చెప్తున్నట్టు, natural తెలుగు narration గా విస్తరించు, ఆ friend 5 సెకన్లలో బోర్ అయిపోయే వ్యక్తి అనుకో:

${beats}

(గ్రౌండింగ్ కోసం, అసలైన verify చేయబడిన fact: ${outline})

**ఇలా రాయకు (jargon-dump, teacher style):**
"వెనస్ ఫ్లవర్ బాస్కెట్ అనేది గ్లాస్ స్పాంజ్. ఇది Hexactinellida కుటుంబానికి చెందినది. ఇది సిలికా క్రిస్టల్స్‌తో తయారైంది."

**ఇలా రాయి (storyteller style):**
"🤯 10,000 సంవత్సరాలు బ్రతికే జీవి...
ఇప్పటికీ సముద్రంలో ఉందని తెలుసా?

కానీ...
ఇది చేప కాదు...
తిమింగలం కూడా కాదు...
ఒక స్పాంజ్!

ఇంకా షాక్ ఏంటంటే...
దీని శరీరం...
గాజులా ఉంటుంది!"

తేడా గమనించావా? రెండోది ప్రతి 2-3 వాక్యాలకూ కొత్త curiosity పుట్టిస్తుంది, సమాధానం వెంటనే ఇవ్వదు — దాన్ని stretch చేస్తుంది. ప్రతి వాక్యంలో **ఒక్క కొత్త విషయం మాత్రమే** ఉండాలి — ఒకే వాక్యంలో 2-3 ideas కలిపి పెట్టకు, viewer overload అవుతుంది. ఏ వాక్యమైనా కేవలం information ఇస్తే (వినేవారికి "అమ్మో నిజంగానా!" అనిపించకపోతే), దాన్ని ఈ స్టైల్‌లో తిరిగి రాయి — beats క్రమాన్ని మాత్రం మార్చకు.

నియమాలు (తప్పనిసరి):
- ${min}-${max} తెలుగు పదాలు.
- **పూర్ణవిరామం (.) ఎప్పుడూ పూర్తి ఆలోచన ముగిసిన చోటే — వాక్యం మధ్యలో, క్రియకి ముందు వద్దు.** తప్పు: "అది తేలిపోవడం నుంచి. రక్షిస్తుంది..." సరైనది: "అది తేలిపోవడం నుంచి రక్షిస్తుంది..." ("..." pause కి, period వాక్యాంతానికి మాత్రమే).
- సంఖ్యలు **1000+ ఉంటే తెలుగు మాటల్లోనే** (10000 → "పది వేలు") — అంకెల్లో వద్దు (TTS digit-by-digit చదివేస్తుంది). 1000 కన్నా తక్కువ (300, 206) అంకెల్లో వాడొచ్చు.
- Brand/పేర్లు ఆంగ్ల స్పెల్లింగ్‌లో. తెలుగు లిపిలోనే — Romanized వద్దు. చివర్లో CTA రాయకు.${avoidLine}

---
3 అతి ముఖ్యమైన రిమైండర్లు:
1. FORMAT: జవాబు "TITLE:" తోనే మొదలవ్వాలి.
2. STYLE: పైన చూపిన "ఇలా రాయి" ఉదాహరణ style లోనే — jargon-dump వద్దు, ఒక్కో వాక్యంలో ఒక్కటే idea.
3. LENGTH: ${min}-${max} తెలుగు పదాలు.
---`;

  return `${topicInstruction}

జవాబును ఖచ్చితంగా ఈ నాలుగు లైన్ల ఫార్మాట్‌లోనే ఇవ్వు, ఇదే క్రమంలో, మరేమీ ముందు/వెనుక రాయకు:
TITLE: (5-8 తెలుగు పదాల్లో ఒక చిన్న శీర్షిక — ఇందులో emoji వాడకు, మేమే జోడిస్తాం)
KEYWORDS: (ఈ కంటెంట్‌కి సరిపోయే 3 నిర్దిష్టమైన, దృశ్యమానమైన ఆంగ్ల keywords — abstract పదాలు కాకుండా (ఉదా. "wisdom", "life" వద్దు), కళ్ళకి కనిపించే నిర్దిష్ట scene/object/action పదాలు వాడు, ఉదా: "elderly woman smiling", "children playing park", "mother holding baby", "sunrise mountains road". Content కి నేరుగా సంబంధం ఉండాలి, generic వద్దు.)
HOOK: (పైన ఉన్న Hook ప్రశ్ననే, 15 తెలుగు పదాల లోపు తిరిగి రాయి — video description లో వాడతాం. ఇందులో emoji వాడకు, మేమే జోడిస్తాం.)
SCRIPT: (పైన చెప్పిన నియమాల ప్రకారం పూర్తి వాయిస్-ఓవర్ టెక్స్ట్ — ఇందులో emoji లు వాడకు. అదనంగా, స్క్రిప్ట్‌లో ఈ structural markers ని సంబంధిత భాగం ముందు పెట్టు: [HOOK] ముందు hook వాక్యానికి, [VISUAL] ప్రధాన fact వివరణ మొదలయ్యే చోట, [TWIST] twist భాగం మొదలయ్యే చోట. ఇవి మేము స్క్రిప్ట్ ని విభాగాలుగా గుర్తించడానికి వాడతాం, TTS కి పంపేముందు తీసేస్తాం.)`;
}

function parseLabeledContent(raw) {
  const titleMatch = raw.match(/TITLE:\s*(.+)/i);
  const keywordsMatch = raw.match(/KEYWORDS:\s*(.+)/i);
  const hookEmojiMatch = raw.match(/HOOK:\s*(.+)/i);
  const scriptMatch = raw.match(/SCRIPT:\s*([\s\S]+)/i);
  return {
    title: titleMatch ? titleMatch[1].trim() : null,
    keywords: keywordsMatch ? keywordsMatch[1].trim() : null,
    hookEmoji: hookEmojiMatch ? hookEmojiMatch[1].trim() : null,
    script: scriptMatch ? scriptMatch[1].trim().replace(/\n+/g, ' ') : null
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const PRIMARY_MODEL = 'llama-3.3-70b-versatile';
// Free-tier daily quotas are tracked SEPARATELY per model under the same
// API key (verified June 2026: llama-3.3-70b-versatile=100K TPD,
// gpt-oss-120b=200K TPD) — falling back to a different model when the
// primary's daily limit is hit gets us a genuinely separate free budget,
// no payment needed. gpt-oss-120b's known reasoning-leak issue is already
// covered by the <think> tag stripping below.
const FALLBACK_MODEL = 'openai/gpt-oss-120b';
// Persists across SEPARATE top-level callGroq() calls within the same run
// (generateNewFactOutline, verifyFactOutline, script generation, keywords,
// etc. are all independent invocations, each defaulting to PRIMARY_MODEL).
// Without this, every one of them would redundantly re-try the
// already-known-exhausted primary model before falling back again —
// verified this happening 3 times in a single real run, each a wasted
// failed round-trip.
let primaryModelExhaustedThisRun = false;

async function callGroq(prompt, attempt = 1, model = (primaryModelExhaustedThisRun ? FALLBACK_MODEL : PRIMARY_MODEL)) {
  const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      // Explicit max_tokens — no limit was set before (relying on Groq's
      // own default), which is a plausible cause of an observed anomaly
      // (a retry that produced only 6 words instead of the requested
      // 85-115). 2000 comfortably covers our largest possible response.
      max_tokens: 2000
    })
  });
  const data = await res.json();
  if (!data.choices || !data.choices[0]) {
    const errorMessage = (data.error && data.error.message) || '';
    const isDailyLimit = /tokens per day|TPD/i.test(errorMessage);
    const isRateLimit = data.error && data.error.code === 'rate_limit_exceeded';

    if (isRateLimit && isDailyLimit) {
      if (model === PRIMARY_MODEL) {
        // Primary model's daily budget is exhausted — try the fallback
        // model instead, which has its own separate daily quota. Remember
        // this for the rest of the run so future independent calls skip
        // straight to the fallback instead of re-discovering the same
        // exhaustion each time.
        primaryModelExhaustedThisRun = true;
        log(`WARNING: "${PRIMARY_MODEL}" daily token limit reached — switching to fallback model "${FALLBACK_MODEL}" for the rest of this run (it has a separate free daily quota).`);
        return callGroq(prompt, 1, FALLBACK_MODEL);
      }
      // Fallback model's daily budget is ALSO exhausted — genuinely out of
      // free capacity today. The reset window can be hours away, so
      // retrying here would just waste time before failing anyway.
      throw new Error(`Groq DAILY token limit reached on both "${PRIMARY_MODEL}" and fallback "${FALLBACK_MODEL}" — this run cannot continue today. ${errorMessage}`);
    }

    // Groq's per-minute token limit (TPM) is a short-lived, transient
    // limit that resets within seconds — the auto-growth fact system
    // (extra generate+verify calls) can occasionally push a run over it.
    // A brief wait and retry succeeds almost every time, versus failing
    // the whole run over a limit that's already gone by the next request.
    if (isRateLimit && attempt <= 3) {
      const waitMs = 15000 * attempt; // 15s, 30s, 45s — long enough to reliably cross a full TPM reset window, even with several of our own calls firing in the same run
      log(`WARNING: Groq rate limit hit (attempt ${attempt}/3) — waiting ${waitMs / 1000}s before retrying.`);
      await sleep(waitMs);
      return callGroq(prompt, attempt + 1, model);
    }
    throw new Error('Groq did not return content: ' + JSON.stringify(data));
  }
  // Defensive safety net: strip any <think>...</think> block — gpt-oss-120b
  // (the fallback model) is known to leak its reasoning/planning text into
  // the response without this.
  let content = data.choices[0].message.content.trim();
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // Small proactive spacing after every call — a single run can make up to
  // ~6 Groq calls (script + retries + keywords + auto-growth generate and
  // verify) in quick succession; this naturally throttles our own request
  // rate so we're less likely to burst past the TPM limit in the first
  // place, not just react to it after the fact.
  await sleep(1500);
  return content;
}

// Stage 1 of a two-stage script process: converts the verified outline into
// short STORY BEATS (a few words each, not full sentences) before any prose
// gets written. Real generated scripts kept reverting to flat "explanation
// paragraph" mode partway through despite strong single-call style
// instructions — the model naturally treats an outline as something to
// summarize into connected sentences. Forcing a beat-structure commitment
// FIRST, in a separate minimal-output call, fixes this at a lower total
// token cost than one might expect: this call's output is intentionally
// tiny (a handful of words per beat), so it doesn't add much on top of the
// simplified Stage 2 prompt it enables (which no longer needs to explain
// structure from scratch, only delivery style).
async function generateStoryBeats(outline) {
  const prompt = `కింద ఇచ్చిన fact ని story beats గా విడగొట్టు — ప్రతి beat కి 1-2 అతి చిన్న తెలుగు పదబంధాలు మాత్రమే (పూర్తి వాక్యాలు కాదు, పూర్తి script అస్సలు కాదు):

${outline}

ఫార్మాట్ (ఇదే క్రమంలో, వేరే ఏమీ రాయకు):
HOOK: (హుక్ ప్రశ్న యొక్క సారాంశం, 3-5 పదాలు)
QUESTION: (దాని నుండి పుట్టే మరో ప్రశ్న, 3-5 పదాలు)
REVEAL: (వివరణ యొక్క సారాంశం, 4-6 పదాలు)
TWIST: (twist యొక్క సారాంశం, 4-6 పదాలు)
ENDING: (ఒక ముగింపు భావన, 3-5 పదాలు)`;

  const raw = await callGroq(prompt);
  return raw.trim();
}

async function generateContent(category, recentTitles, outline, ctaSentence) {
  log(`Generating ${category} content via Groq...`);
  const beats = await generateStoryBeats(outline);
  log(`Story beats: ${beats.replace(/\n/g, ' | ')}`);
  const prompt = buildPrompt(category, recentTitles, outline, beats);

  let raw = await callGroq(prompt);
  let { title, keywords, hookEmoji, script } = parseLabeledContent(raw);

  if (!script) {
    // Labeled format wasn't followed — fall back to treating the whole
    // reply as the script so one malformed response doesn't fail the run.
    log('WARNING: Groq did not follow the TITLE/KEYWORDS/SCRIPT format, falling back to plain-text parsing.');
    script = raw.replace(/\n+/g, ' ');
  }

  // The many formatting/punctuation rules can sometimes cause the model to
  // under-shoot the word count badly (seen once: ~16s of audio instead of
  // ~25-30s). Retry (up to 2 extra attempts) with the word count called out
  // more forcefully — and critically, keep retrying until the target is
  // actually met, not just "longer than the previous attempt" (a bug: a
  // 40-word retry over a 20-word original passed the old "improved" check
  // while still being far short of a 110-130 word target).
  const target = WORD_COUNT_TARGETS[category];
  let wordCount = script.split(/\s+/).filter(Boolean).length;
  let bestScript = script, bestTitle = title, bestKeywords = keywords, bestHookEmoji = hookEmoji, bestWordCount = wordCount;

  // User-requested hard duration cap: 80 seconds max. Computed using the
  // SLOWER end of our observed TTS speaking rate (2.3 words/sec, from real
  // measured video data) to stay conservative, minus CTA speech time (~13
  // words) and typical gap/buffer overhead (~7.3s) — this is a WORD-COUNT
  // ceiling that heads off an overlong script before TTS/rendering, rather
  // than trimming finished audio afterward (which would cut off content
  // mid-sentence — a worse outcome than a retry).
  const MAX_SAFE_WORDS = 155;

  for (let retryAttempt = 1; retryAttempt <= 2 && (wordCount < target.min - 15 || bestWordCount > MAX_SAFE_WORDS); retryAttempt++) {
    const tooLong = bestWordCount > MAX_SAFE_WORDS;
    log(tooLong
      ? `WARNING: script came back too long (${bestWordCount} words, ~80s cap needs under ${MAX_SAFE_WORDS}) — retry ${retryAttempt}/2 asking for a more concise version.`
      : `WARNING: script came back too short (${wordCount} words, need ${target.min}-${target.max}) — retry ${retryAttempt}/2 with a stronger word-count reminder.`);
    // Compact, purpose-built retry prompt — NOT the full original prompt
    // (~1000 tokens with all rules/instructions embedded). Resending that
    // in full on every retry was multiplying token cost up to ~5x on a
    // short script (original + 2 retries, each duplicating the whole
    // thing) — a real contributor to hitting Groq's daily token limit.
    // This keeps only what retry genuinely needs: the outline (grounding)
    // and the essential format/accuracy rules.
    const retryPrompt = tooLong
      ? `కింద ఇచ్చిన story beats ని తెలుగులో చెప్పు — ఖచ్చితంగా ${target.min}-${target.max} తెలుగు పదాలు ఉండాలి (మీ మునుపటి ప్రయత్నం ${bestWordCount} పదాలు వచ్చింది, ఇది చాలా ఎక్కువ — వీడియో 80 సెకన్ల లోపు ఉండాలి). ముఖ్యమైన భాగాలనే ఉంచి, సంక్షిప్తంగా చెప్పు:\n\n${beats}\n\nనియమాలు: ఇచ్చిన beats క్రమాన్నే వాడు, కొత్త కల్పితం జోడించకు. ఖచ్చితంగా తెలుగు లిపిలోనే రాయి. "..." తో dramatic pause ఇస్తూ, 8 పదాల లోపు చిన్న వాక్యఖండాలతో రాయి. CTA/emoji వద్దు.\n\nజవాబు ఫార్మాట్:\nTITLE: (5-8 పదాల శీర్షిక, emoji వద్దు)\nKEYWORDS: (3 నిర్దిష్ట ఆంగ్ల keywords)\nHOOK: (hook ప్రశ్న, 15 పదాల లోపు, emoji వద్దు)\nSCRIPT: (సంక్షిప్త వాయిస్-ఓవర్ టెక్స్ట్, emoji/CTA వద్దు)`
      : `కింద ఇచ్చిన story beats ని తెలుగులో వివరణాత్మకంగా చెప్పు — ఖచ్చితంగా ${target.min}-${target.max} తెలుగు పదాలు ఉండాలి (మీ మునుపటి ప్రయత్నం కేవలం ${wordCount} పదాలు మాత్రమే వచ్చింది, ఇది చాలా తక్కువ, padding చేయకుండా ఈ beats ని పూర్తిగా వివరించి ఈ నిడివికి చేరుకో):

${beats}

నియమాలు: ఇచ్చిన beats క్రమాన్నే విస్తరించి చెప్పు, కొత్త కల్పితం/సంఖ్యలు జోడించకు. ఖచ్చితంగా తెలుగు లిపిలోనే రాయి (Romanized వద్దు). "..." తో dramatic pause ఇస్తూ, 8 పదాల లోపు చిన్న వాక్యఖండాలతో, న్యూలైన్‌లతో రాయి (ఉదా: "కానీ...\nఅది నిజం కాదు!") — flat, పొడవైన వాక్యాలు వద్దు. **Period (.) ఎప్పుడూ క్రియకి ముందు/వాక్యం మధ్యలో పెట్టకు — పూర్తి ఆలోచన ముగిసిన చోటే.** CTA/emoji వద్దు.

జవాబు ఫార్మాట్:
TITLE: (5-8 పదాల శీర్షిక, emoji వద్దు)
KEYWORDS: (3 నిర్దిష్ట, దృశ్యమానమైన ఆంగ్ల keywords)
HOOK: (hook ప్రశ్న, 15 పదాల లోపు, emoji వద్దు)
SCRIPT: (పూర్తి వాయిస్-ఓవర్ టెక్స్ట్, emoji/CTA వద్దు)`;
    raw = await callGroq(retryPrompt);
    const retryParsed = parseLabeledContent(raw);
    if (retryParsed.script) {
      const retryWordCount = retryParsed.script.split(/\s+/).filter(Boolean).length;
      log(`  Retry ${retryAttempt} produced ${retryWordCount} words.`);
      wordCount = retryWordCount;
      script = retryParsed.script;
      // Prefer whichever attempt is CLOSEST to the target range, not just
      // "longer than before" — the old check only compared lengths, so a
      // retry that overshot to e.g. 180 words (the model over-correcting
      // on "add more detail") would still replace a 40-word original
      // simply for being longer, producing a video noticeably longer than
      // intended (measured: 80s instead of the expected ~55-63s).
      const distance = (wc) => wc < target.min ? target.min - wc : (wc > target.max ? wc - target.max : 0);
      if (distance(retryWordCount) < distance(bestWordCount)) {
        bestScript = retryParsed.script;
        bestTitle = retryParsed.title;
        bestKeywords = retryParsed.keywords;
        bestHookEmoji = retryParsed.hookEmoji;
        bestWordCount = retryWordCount;
      }
    }
  }
  if (bestWordCount < target.min - 15) {
    log(`⚠️ WARNING: after all retries, script is still short (${bestWordCount} words, target ${target.min}-${target.max}) — using the best attempt available. Video will be shorter than intended this time.`);
  } else if (bestWordCount > MAX_SAFE_WORDS) {
    log(`⚠️ WARNING: after all retries, script is still long (${bestWordCount} words, ~80s cap needs under ${MAX_SAFE_WORDS}) — video may run slightly over 80s this time.`);
  }
  title = bestTitle; keywords = bestKeywords; hookEmoji = bestHookEmoji; script = bestScript;

  // Safety-net detection: numbers 1000+ written as digits get mispronounced
  // digit-by-digit by TTS ("10,000" → "సున్నా సున్నా సున్నా సున్నా" instead
  // of "పది వేలు") — verified this happening in a real generated script
  // despite the prompt rule against it. Prompt compliance isn't 100%
  // reliable, so this at least surfaces the problem in logs even though it
  // doesn't auto-fix it (a full Telugu numeral-to-words converter would be
  // needed for that, and risks its own bugs).
  const largeNumberMatch = script.match(/\b\d{4,}\b|\b\d{1,3}(?:,\d{3})+\b/);
  if (largeNumberMatch) {
    log(`⚠️ WARNING: script contains a large number as digits ("${largeNumberMatch[0]}") — TTS will likely mispronounce this digit-by-digit instead of as a proper number. This should have been written in Telugu words.`);
  }

  // Strip structural markers ([HOOK], [VISUAL], [TWIST] etc.) — these are
  // for our own reference on how the model structured the script, never
  // meant to reach TTS or be spoken aloud. Stripped here, before any
  // sentence-splitting, so they also can't interfere with that.
  script = script.replace(/\[[A-Z]+\]/g, '').replace(/\s+/g, ' ').trim();
  if (!title) title = deriveHeadline(script);
  if (!keywords) keywords = FALLBACK_KEYWORDS[category];
  if (!hookEmoji) hookEmoji = title; // fallback: reuse title text (emoji still added below)

  const categoryEmoji = CATEGORY_EMOJI[category] || '';
  title = `${title} ${categoryEmoji}`.trim();
  hookEmoji = `${hookEmoji} ${categoryEmoji}`.trim();

  // Defensive: strip any CTA-like ending the model wrote anyway, despite
  // being told not to — avoids ending up with two CTA lines back to back.
  const existingSentences = splitIntoSentences(script);
  if (existingSentences.length > 0 && existingSentences[existingSentences.length - 1].includes('సబ్‌స్క్రైబ్')) {
    existingSentences.pop();
    script = existingSentences.join(' ');
  }

  script = ensureSentenceBreaks(script);
  script = (script.trim() + ' ' + ctaSentence).trim();
  log(`Title: ${title}`);
  log(`Keywords: ${keywords}`);
  log(`Hook emoji line: ${hookEmoji}`);
  log(`Script (${script.length} chars): ${script}`);
  return { title, keywords, hookEmoji, script };
}

// FALLBACK ONLY: used if Groq ever fails to return a usable TITLE line.
function deriveHeadline(script, maxWords = 8) {
  const words = script.split(' ').filter(Boolean);
  let headline = words.slice(0, maxWords).join(' ');
  if (words.length > maxWords) headline += '...';
  return headline;
}

function escapeSSML(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function synthesizeOneSentence(sentence) {
  const ssml = `<speak><s>${escapeSSML(sentence)}</s></speak>`;
  // speakingRate is an officially documented, standard Cloud TTS parameter
  // for Chirp/Journey voices (0.25x-2.0x) — NOT experimental SSML. Set
  // slightly above default (1.0) per real-video feedback that narration
  // pacing felt slow/flat.
  const SPEAKING_RATE = 1.08;
  let res = await fetchWithTimeout(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { ssml },
      voice: { languageCode: 'te-IN', name: 'te-IN-Chirp3-HD-Achird' },
      audioConfig: { audioEncoding: 'LINEAR16', speakingRate: SPEAKING_RATE }
    })
  });
  let data = await res.json();
  if (!data.audioContent) {
    log('WARNING: SSML request failed for a sentence (' + JSON.stringify(data.error || data) + '), falling back to plain text.');
    res = await fetchWithTimeout(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: sentence },
        voice: { languageCode: 'te-IN', name: 'te-IN-Chirp3-HD-Achird' },
        audioConfig: { audioEncoding: 'LINEAR16', speakingRate: SPEAKING_RATE }
      })
    });
    data = await res.json();
  }
  if (!data.audioContent) {
    throw new Error('Google TTS did not return audio for sentence: ' + JSON.stringify(data));
  }
  return Buffer.from(data.audioContent, 'base64');
}

function getAudioFormat(audioPath) {
  const out = execSync(`ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate,channels -of csv=p=0 "${audioPath}"`).toString().trim();
  const [sampleRate, channels] = out.split(',').map(Number);
  return { sampleRate, channels };
}

// Generates audio for the whole script by synthesizing each COMMA-SEPARATED
// CLAUSE separately (not just each sentence) and physically splicing in a
// real silence clip between every one — a short gap after commas, a longer
// gap after sentence-ending periods. This guarantees an audible pause at
// EVERY comma and EVERY sentence boundary — it doesn't depend on the TTS
// engine's own judgment about plain-text punctuation, which occasionally
// still ran words together with no perceptible pause at some commas even
// after sentence boundaries were fixed the same way. Returns the same
// {audioPath, sentenceDurations, silenceGap} shape as before (durations
// aggregated back up to one number per original sentence, including its
// own internal comma gaps) so nothing downstream needs to change.
// Google TTS adds its own small leading/trailing silence to short
// utterances (more noticeable the shorter the clause) — left untrimmed,
// this compounds with our own explicitly-inserted gap and produces pauses
// far longer than designed (measured up to ~1s instead of 0.35s in a real
// video). Strips it down to a small natural buffer before we add our own
// exact gap on top.
function trimSilence(clipPath) {
  const trimmedPath = clipPath.replace('.wav', '_trimmed.wav');
  const filter = 'silenceremove=start_periods=1:start_duration=0:start_threshold=-35dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_duration=0:start_threshold=-35dB:start_silence=0.05,areverse';
  execSync(`ffmpeg -y -i "${clipPath}" -af "${filter}" -c:a pcm_s16le "${trimmedPath}"`, { stdio: 'pipe' });
  fs.renameSync(trimmedPath, clipPath);
}

// Splits one sentence into clauses at commas AND ellipses ("..."), tracking
// which delimiter followed each piece so the caller can apply the right
// pause length. "..." gets a distinct, longer-than-comma "dramatic pause"
// gap — matching a TTS-friendly delivery style with short punchy phrases
// and deliberate suspense beats, rather than long flowing sentences.
function splitIntoClauses(text) {
  const result = [];
  const regex = /(.+?)(,|\.\.\.)|(.+)$/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[3] !== undefined) {
      const t = match[3].trim();
      if (t) result.push({ text: t, delimiter: null });
    } else {
      const t = match[1].trim();
      if (t) result.push({ text: t, delimiter: match[2] });
    }
  }
  return result;
}

async function generateAudioForScript(sentences) {
  const commaGap = 0.06;    // shortest pause, at a comma (tightened from 0.08 per real-video feedback: pauses felt stacked/slow)
  const ellipsisGap = 0.17; // medium "dramatic pause", at "..." (tightened from 0.22)
  const periodGap = 0.26;   // longest pause, between sentences (tightened from 0.35)
  log(`Generating audio via Google Cloud TTS (${sentences.length} sentences, further split at commas/ellipses for reliable, TTS-friendly pausing)...`);

  const clipEntries = []; // { path, gap: 0 | commaGap | ellipsisGap | periodGap }
  const sentenceDurations = [];

  for (let si = 0; si < sentences.length; si++) {
    const clauses = splitIntoClauses(sentences[si]);
    let sentenceDur = 0;
    for (let ci = 0; ci < clauses.length; ci++) {
      const buf = await synthesizeOneSentence(clauses[ci].text);
      const p = path.join(WORK_DIR, `clip_${si}_${ci}.wav`);
      fs.writeFileSync(p, buf);
      try {
        trimSilence(p);
      } catch (e) {
        log(`  WARNING: silence-trim failed for clip ${si}_${ci} (${e.message}) — using untrimmed clip.`);
      }
      const dur = getAudioDuration(p);
      sentenceDur += dur;
      const isLastClauseInSentence = ci === clauses.length - 1;
      const isLastSentence = si === sentences.length - 1;
      let gap = 0;
      if (!isLastClauseInSentence) {
        gap = clauses[ci].delimiter === '...' ? ellipsisGap : commaGap;
        sentenceDur += gap; // internal gaps count toward this sentence's own screen time
      } else if (!isLastSentence) {
        gap = periodGap; // the gap between sentences is folded in by the caller, same as before
      }
      log(`  sentence ${si} clause ${ci}: "${clauses[ci].text.slice(0, 30)}..." ${dur.toFixed(2)}s, gap after: ${gap}s`);
      clipEntries.push({ path: p, gap });
    }
    sentenceDurations.push(sentenceDur);
  }

  // Match the silence clips' sample rate/channels to the TTS output so the
  // concat demuxer can stitch everything with -c copy (no re-encode needed).
  const fmt = getAudioFormat(clipEntries[0].path);
  const channelLayout = fmt.channels === 1 ? 'mono' : 'stereo';
  const commaSilencePath = path.join(WORK_DIR, 'silence_comma.wav');
  const ellipsisSilencePath = path.join(WORK_DIR, 'silence_ellipsis.wav');
  const periodSilencePath = path.join(WORK_DIR, 'silence_period.wav');
  execSync(`ffmpeg -y -f lavfi -i anullsrc=r=${fmt.sampleRate}:cl=${channelLayout} -t ${commaGap} -c:a pcm_s16le "${commaSilencePath}"`, { stdio: 'pipe' });
  execSync(`ffmpeg -y -f lavfi -i anullsrc=r=${fmt.sampleRate}:cl=${channelLayout} -t ${ellipsisGap} -c:a pcm_s16le "${ellipsisSilencePath}"`, { stdio: 'pipe' });
  execSync(`ffmpeg -y -f lavfi -i anullsrc=r=${fmt.sampleRate}:cl=${channelLayout} -t ${periodGap} -c:a pcm_s16le "${periodSilencePath}"`, { stdio: 'pipe' });

  const listLines = [];
  for (const entry of clipEntries) {
    listLines.push(`file '${path.resolve(entry.path)}'`);
    if (entry.gap === commaGap) listLines.push(`file '${path.resolve(commaSilencePath)}'`);
    else if (entry.gap === ellipsisGap) listLines.push(`file '${path.resolve(ellipsisSilencePath)}'`);
    else if (entry.gap === periodGap) listLines.push(`file '${path.resolve(periodSilencePath)}'`);
  }
  const listPath = path.join(WORK_DIR, 'audio_concat_list.txt');
  fs.writeFileSync(listPath, listLines.join('\n'), 'utf8');
  const audioPath = path.join(WORK_DIR, 'audio.wav');
  execSync(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${audioPath}"`, { stdio: 'inherit' });

  const silenceGap = periodGap;
  log(`Combined audio saved to ${audioPath} (${getAudioDuration(audioPath).toFixed(2)}s total)`);
  return { audioPath, sentenceDurations, silenceGap };
}

function getAudioDuration(audioPath) {
  const out = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}"`).toString().trim();
  return parseFloat(out);
}

const BGM_MOOD_TAGS = {
  mindblowing: 'curious,upbeat',
  psychology: 'mysterious,curious',
  earth_space: 'ambient,cinematic',
  animal: 'playful,curious',
  money: 'corporate,upbeat',
  history: 'mysterious,cinematic',
  human_body: 'curious,upbeat',
  technology: 'modern,upbeat',
  food: 'playful,upbeat',
  ocean: 'ambient,calm'
};

// Searches Jamendo's free Creative Commons catalog for an INSTRUMENTAL
// track matching the category's mood (instrumental so it never competes
// with our own narration vocals) and downloads it. The license URL is
// logged for spot-checking — Jamendo tracks vary in exact CC terms
// (attribution / commercial-use permissions), and this project can't
// verify that automatically, so it's worth an occasional manual look.
async function fetchBackgroundMusic(category) {
  const tags = BGM_MOOD_TAGS[category] || 'inspiring,uplifting';
  const clientId = (JAMENDO_CLIENT_ID || '').trim();
  const url = `https://api.jamendo.com/v3.0/tracks/?client_id=${clientId}&format=json&limit=10&tags=${encodeURIComponent(tags)}&vocalinstrumental=instrumental&include=musicinfo&order=popularity_total`;
  log(`Fetching background music from Jamendo for mood: "${tags}"...`);
  const res = await fetchWithTimeout(url, {}, 15000);
  const data = await res.json();
  if (!data.results || data.results.length === 0) {
    throw new Error(`Jamendo returned no tracks for tags "${tags}": ` + JSON.stringify(data).slice(0, 200));
  }
  const track = data.results[Math.floor(Math.random() * data.results.length)];
  const audioUrl = track.audiodownload || track.audio;
  if (!audioUrl) throw new Error('Jamendo track has no downloadable audio URL');
  const audioRes = await fetchWithTimeout(audioUrl, {}, 20000);
  if (!audioRes.ok) throw new Error(`Jamendo audio download failed HTTP ${audioRes.status}`);
  const buf = Buffer.from(await audioRes.arrayBuffer());
  if (buf.length < 10000) throw new Error(`Jamendo audio file suspiciously small (${buf.length} bytes)`);
  const musicPath = path.join(WORK_DIR, 'bgm.mp3');
  fs.writeFileSync(musicPath, buf);
  log(`Downloaded BGM: "${track.name}" by ${track.artist_name} (license: ${track.license_ccurl || 'unknown — spot-check before relying on this'})`);
  return musicPath;
}

// Mixes background music, looped to cover the narration, MUCH quieter
// (volume=0.12) than the voice track — this is meant to be felt, not heard
// as a competing sound. Output stays uncompressed (pcm) since buildVideo's
// final mux re-encodes to AAC once anyway; no need to lossy-encode twice.
function mixBackgroundMusic(narrationPath, musicPath, outPath) {
  const narrationDur = getAudioDuration(narrationPath);
  const cmd = [
    'ffmpeg -y',
    `-i "${narrationPath}"`,
    `-stream_loop -1 -i "${musicPath}"`,
    `-filter_complex "[1:a]volume=0.12[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]"`,
    `-map "[aout]"`,
    `-t ${narrationDur.toFixed(2)}`,
    '-c:a pcm_s16le',
    `"${outPath}"`
  ].join(' ');
  execSync(cmd, { stdio: 'inherit' });
}

async function fetchImages(query, count, startIndex = 0, excludeIds = new Set()) {
  const poolSize = Math.max(count, 8); // always search a decent-sized pool for variety
  const page = 1 + Math.floor(Math.random() * 3); // random page too, for variety across runs
  log(`Fetching images from Pexels for: "${query}" (pool ${poolSize}, page ${page})...`);
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${poolSize}&page=${page}&orientation=portrait`;
  const res = await fetchWithTimeout(url, { headers: { Authorization: (PEXELS_API_KEY || '').trim() } });
  const data = await res.json();
  if (!data.photos || data.photos.length === 0) {
    throw new Error(`Pexels returned no photos for "${query}": ` + JSON.stringify(data));
  }

  // Shuffle and prefer photos not already used earlier in this same video —
  // with only a handful of fixed story outlines cycling, the same "top
  // match" stock photo for a given query was showing up over and over.
  const shuffled = [...data.photos].sort(() => Math.random() - 0.5);
  const preferred = shuffled.filter(p => !excludeIds.has(p.id));
  const orderedCandidates = preferred.length > 0 ? preferred : shuffled;

  const imagePaths = [];
  const usedIds = [];
  for (const photo of orderedCandidates) {
    if (imagePaths.length >= count) break;
    const src = photo.src || {};
    const imgUrl = src.large2x || src.large || src.original;
    try {
      const imgRes = await fetchWithTimeout(imgUrl);
      if (!imgRes.ok) {
        log(`WARNING: image download failed (HTTP ${imgRes.status}), trying next candidate.`);
        continue;
      }
      const buf = Buffer.from(await imgRes.arrayBuffer());
      if (buf.length < 5000) {
        // A real photo is essentially never this small — this is almost
        // certainly an error page/placeholder that slipped through, not a
        // usable image.
        log(`WARNING: image suspiciously small (${buf.length} bytes), trying next candidate.`);
        continue;
      }
      const imgPath = path.join(WORK_DIR, `image_${startIndex}_${imagePaths.length}.jpg`);
      fs.writeFileSync(imgPath, buf);
      imagePaths.push(imgPath);
      usedIds.push(photo.id);
    } catch (e) {
      log(`WARNING: image download threw an error (${e.message}), trying next candidate.`);
    }
  }
  if (imagePaths.length === 0) {
    throw new Error(`All image candidates failed to download for "${query}"`);
  }
  log(`Downloaded ${imagePaths.length} image(s) from Pexels for "${query}" (ids: ${usedIds.join(', ')}).`);
  return { paths: imagePaths, ids: usedIds };
}

// If the specific keyword search comes up empty, fall back to a
// category-appropriate generic query so the run doesn't fail outright.
async function fetchImagesWithFallback(query, count, category, startIndex = 0, excludeIds = new Set()) {
  try {
    return await fetchImages(query, count, startIndex, excludeIds);
  } catch (e) {
    log('WARNING: image search failed for the specific keywords, falling back to a generic query. ' + e.message);
    return await fetchImages(FALLBACK_KEYWORDS[category] || 'India', count, startIndex, excludeIds);
  }
}

// Searches Pexels' free stock VIDEO library (not photos) for a clip
// matching the query. Real footage with real motion (hands, steam, walking,
// water flowing) reads as far more "professional/accurate" than a Ken-Burns
// pan/zoom on a still photo — this is the first thing tried for every
// sentence now, with the AI-image/Pexels-photo chain as fallback.
async function fetchPexelsVideo(query, startIndex = 0, excludeIds = new Set()) {
  const poolSize = 8;
  const page = 1 + Math.floor(Math.random() * 3);
  log(`Fetching video from Pexels for: "${query}" (pool ${poolSize}, page ${page})...`);
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${poolSize}&page=${page}&orientation=portrait`;
  const res = await fetchWithTimeout(url, { headers: { Authorization: (PEXELS_API_KEY || '').trim() } });
  const data = await res.json();
  if (!data.videos || data.videos.length === 0) {
    throw new Error(`Pexels returned no videos for "${query}": ` + JSON.stringify(data));
  }

  const shuffled = [...data.videos].sort(() => Math.random() - 0.5);
  const preferred = shuffled.filter(v => !excludeIds.has(v.id));
  const orderedCandidates = preferred.length > 0 ? preferred : shuffled;

  for (const video of orderedCandidates) {
    // Prefer a portrait file around 720-1080px wide — big enough to look
    // sharp after our scale/crop, small enough to download quickly.
    // Pexels' video library is predominantly LANDSCAPE (standard stock
    // footage convention) — demanding a native portrait file here was
    // rejecting nearly every candidate, which is why Pexels Video never
    // actually won over the AI-image fallback in practice. Our own
    // buildRealVideoClip already scale+crops any source to 720x1280 (the
    // same center-crop technique real Shorts editors use on landscape
    // footage), so any orientation works — just prefer a moderate
    // resolution for a fast download and decent post-crop sharpness.
    const files = (video.video_files || [])
      .filter(f => f.file_type === 'video/mp4' && f.width && f.height)
      .sort((a, b) => {
        // Prefer portrait/square (less content lost to cropping) over
        // landscape, then within each group prefer resolution near 1080px.
        const aPortrait = a.height >= a.width ? 0 : 1;
        const bPortrait = b.height >= b.width ? 0 : 1;
        if (aPortrait !== bPortrait) return aPortrait - bPortrait;
        return Math.abs(a.width - 1080) - Math.abs(b.width - 1080);
      });
    if (files.length === 0) continue; // this result has no usable mp4 file, try next
    const file = files[0];
    try {
      const videoRes = await fetchWithTimeout(file.link, {}, 30000);
      if (!videoRes.ok) {
        log(`WARNING: video download failed (HTTP ${videoRes.status}), trying next candidate.`);
        continue;
      }
      const buf = Buffer.from(await videoRes.arrayBuffer());
      if (buf.length < 20000) {
        log(`WARNING: video file suspiciously small (${buf.length} bytes), trying next candidate.`);
        continue;
      }
      const videoPath = path.join(WORK_DIR, `pexels_video_${startIndex}.mp4`);
      fs.writeFileSync(videoPath, buf);

      // Validate it's actually a usable video file now, not later inside
      // ffmpeg with a cryptic exit code — corrupted/incomplete downloads
      // can pass the byte-size check above but still not be real video.
      try {
        const probe = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=codec_type -of csv=p=0 "${videoPath}"`).toString().trim();
        if (probe !== 'video') throw new Error('no video stream found');
      } catch (e) {
        log(`WARNING: downloaded file failed ffprobe validation (${e.message}), trying next candidate.`);
        continue;
      }

      log(`Downloaded video (Pexels id ${video.id}, ${video.duration}s, ${file.width}x${file.height}) for "${query}".`);
      return { path: videoPath, id: video.id };
    } catch (e) {
      log(`WARNING: video download threw an error (${e.message}), trying next candidate.`);
    }
  }
  throw new Error(`No usable portrait video file found among candidates for "${query}"`);
}

// Splits a script into its individual sentences (by period) — used to fetch
// one image per sentence instead of a handful of generic images for the
// whole script, so what's on screen actually matches what's being said at
// that moment.
function splitIntoSentences(script) {
  // Protect "..." from being shattered by the period-based split below —
  // verified this was a real bug: "..." split into three separate "."
  // fragments, breaking per-sentence image matching whenever a script
  // used ellipsis for dramatic pacing.
  const ELLIPSIS_PLACEHOLDER = '\u0001E\u0001';
  const protectedText = script.replace(/\.\.\./g, ELLIPSIS_PLACEHOLDER);
  const parts = protectedText.split(/(?<=\.)\s*/).map(s => s.trim()).filter(Boolean);
  return parts.map(s => s.split(ELLIPSIS_PLACEHOLDER).join('...'));
}

// Generic parser: pulls a numbered list out from under a section header
// (e.g. everything after "KEYWORDS:" up to the next blank/unrelated line).
// Lenient about numbering style (1. / 1) / **1.**) since Groq varies this.
function parseNumberedSection(text, sectionHeader, n) {
  const startIdx = text.indexOf(sectionHeader);
  const sectionText = startIdx === -1 ? text : text.slice(startIdx + sectionHeader.length);
  const lines = sectionText.split('\n').map(l => l.trim()).filter(Boolean);
  const results = [];
  for (let i = 0; i < n; i++) {
    const re = new RegExp(`^[\\*\\-\\s]*${i + 1}\\s*[.):]\\s*(.+)`);
    const line = lines.map(l => l.match(re)).find(Boolean);
    results.push(line ? line[1].replace(/\*\*/g, '').trim() : null);
  }
  return results;
}

// Returns, per sentence: a short Pexels search keyword AND a much richer,
// sentence-specific AI-image scene description. AI generation isn't limited
// to photos that already exist (unlike Pexels search), so a detailed,
// exact-scene prompt gets meaningfully closer to a true "matches the script
// exactly" image than a generic 3-5 word keyword ever can.
async function getSentenceKeywords(sentences, outline) {
  const numbered = sentences.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const outlineContext = outline ? `\n\nమూలం (అసలైన, verify చేయబడిన fact — దీనిలోని నిర్దిష్ట పేర్లు/వస్తువులు/ప్రదేశాలనే image keywords లో వాడు, స్క్రిప్ట్ వాక్యాలు దీన్నే paraphrase చేసినవి): ${outline}` : '';
  const prompt = `ఈ fact video కోసం మూడు విభాగాలు ఇవ్వు.

SUBJECT: ఈ fact యొక్క ప్రధాన విషయం ఏమిటో ఒక లైన్‌లో ఇవ్వు (ఒక జంతువు/వస్తువు/ప్రదేశం/వ్యక్తి — ఏదైతే అది, నిర్దిష్టంగా, ఆంగ్లంలో). ఇదే వర్ణన ప్రతి scene లోనూ వాడతాం, visual consistency కోసం. ఉదా: "Greenland shark, dark grey skin, slow-moving, deep ocean" లేదా "Great Pyramid of Giza, limestone blocks, desert".

KEYWORDS: ప్రతి వాక్యానికి 3-5 పదాల Pexels-సెర్చ్ keyword — ఇది ఒక **real video/photo footage లో ఉండే అవకాశం ఉన్న**, నిర్దిష్ట, documentary-style దృశ్యం కావాలి.

SCENES: ప్రతి వాక్యానికి 15-25 పదాల దృశ్య వర్ణన (ఆంగ్లంలో) — AI image generation కోసం, scientific/documentary/educational style లో, realistic గా. SUBJECT ప్రస్తావిస్తే అదే వర్ణన వాడు.

నియమాలు:
- పైన ఇచ్చిన **మూలం fact లోని నిర్దిష్ట పేర్లు/వస్తువులు/సంఖ్యలనే** వాడు — స్క్రిప్ట్ వాక్యం అస్పష్టంగా ఉన్నా, మూలం fact లో ఉన్న నిర్దిష్ట విషయాన్నే keyword/scene లో పెట్టు (ఉదా. మూలంలో "గ్రీన్‌ల్యాండ్ సొరచేప" అని ఉంటే, కేవలం "shark" అని కాకుండా "Greenland shark" అనే వాడు).
- పదాలు direct గా అనువదించకు, నిజమైన దృశ్యం రాయి (ఉదా. వైద్య "గుండె" కి "heart" వద్దు — romance ఫోటోలు వస్తాయి — "doctor checking heart with stethoscope" రాయి). భావోద్వేగాలను/నైరూప్య భావనలను (mystery, importance) మాటలుగా వాడకు, దృశ్యంగా చూపించు.
- మనుషులు కనిపించే scene అయితే, దేశం చెప్పకపోతే ఎప్పుడూ "Indian"/"South Indian" నేపథ్యం వాడు, Western look వద్దు. (జంతువులు/వస్తువులు/ప్రదేశాలకి ఇది వర్తించదు — అవి ఎక్కడివైతే అక్కడివే చూపించు.)${outlineContext}

వాక్యాలు:
${numbered}

ఖచ్చితంగా ఈ ఫార్మాట్‌లో, ఇదే క్రమంలో ఇవ్వు:

SUBJECT:
1. subject description

KEYWORDS:
1. keyword phrase
2. keyword phrase
...

SCENES:
1. detailed scene description
2. detailed scene description
...`;

  const raw = await callGroq(prompt);
  log(`Raw sentence-keywords/scenes response from Groq:\n${raw}`);
  const character = parseNumberedSection(raw, 'SUBJECT:', 1)[0];
  const keywords = parseNumberedSection(raw, 'KEYWORDS:', sentences.length);
  const scenes = parseNumberedSection(raw, 'SCENES:', sentences.length);
  log(`  main character: ${character || '(none parsed)'}`);
  sentences.forEach((_, i) => {
    log(`  sentence ${i} keyword: ${keywords[i] || '(none — fallback)'} | scene: ${scenes[i] ? scenes[i].slice(0, 50) + '...' : '(none — will use keyword)'}`);
  });
  return { character, keywords, scenes };
}

const POLLINATIONS_BASE = 'https://image.pollinations.ai/prompt/';

// Generates one AI image matching the sentence's content via Pollinations.ai
// (free, no API key required). This has NO reliability guarantee (can be
// slow or down), so every call here is immediately backed by a Pexels
// fallback in fetchImagesPerSentence — never the only path to an image.
// `seed`, when provided, is reused across all scenes featuring the same
// character — same starting noise pattern nudges the diffusion model
// toward a more visually similar result each time (not a true character
// lock, but the closest free lever available).
async function generateAIImage(prompt, savePath, seed, style = 'photo') {
  const styleModifier = style === 'illustration'
    ? 'scientific illustration, concept visualization, glowing highlights, detailed digital art, vertical portrait composition'
    : 'cinematic photo, high quality, realistic, vertical portrait composition';
  const styledPrompt = `${prompt}, ${styleModifier}`;
  const finalSeed = seed !== undefined ? seed : Math.floor(Math.random() * 100000);
  // enhance=true lets Pollinations improve/expand our prompt internally
  // before generation — aimed at getting closer to the concept-specific,
  // well-composed images seen in reference/competitor videos, instead of a
  // literal-but-flat rendering of our exact prompt text.
  const url = `${POLLINATIONS_BASE}${encodeURIComponent(styledPrompt)}?width=768&height=1365&nologo=true&enhance=true&seed=${finalSeed}`;
  const res = await fetchWithTimeout(url, {}, 20000); // enhance adds a processing pass, so a bit more time than before
  if (!res.ok) {
    throw new Error(`Pollinations returned HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5000) {
    throw new Error(`Pollinations image suspiciously small (${buf.length} bytes) — likely an error response, not a real image`);
  }
  fs.writeFileSync(savePath, buf);
  return savePath;
}

// EXPERIMENTAL, best-effort: generates real (if brief) AI video via a
// community/vendor-hosted Hugging Face Space (see hf_video_gen.py), for
// scenes Pexels Video couldn't match with real footage — fantastical/
// mythological moments that will never exist in a stock library. No SLA,
// no verified API signature (untestable without live access), bounded
// timeout so a slow/queued Space can't eat the run's time budget. Any
// failure here is expected and normal — it just means this one sentence
// falls through to the AI-image tier instead, same as always.
function generateHFSpaceVideo(prompt, savePath, timeoutMs = 40000) {
  const scriptPath = path.join(__dirname, 'hf_video_gen.py');
  const cmd = `python3 "${scriptPath}" ${JSON.stringify(prompt)} "${savePath}"`;
  const output = execSync(cmd, { timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  if (!output || !fs.existsSync(savePath)) {
    throw new Error(`hf_video_gen.py did not produce a usable output file (stdout: ${output})`);
  }
  return savePath;
}

// Fetches one clip per sentence: Pexels VIDEO first (real motion — closest
// to how professionally-edited reference videos look), then AI-generated
// image (using a rich, sentence-exact scene description), then Pexels
// photo, in that order. Returns {path, type: 'video'|'image'} per sentence
// (or null on total failure) so buildVideo knows whether to loop/trim a
// real clip or apply a Ken-Burns pan/zoom to a still.
async function fetchImagesPerSentence(sentences, category, outline) {
  let character, keywords, scenes;
  try {
    const result = await getSentenceKeywords(sentences, outline);
    character = result.character;
    keywords = result.keywords;
    scenes = result.scenes;
  } catch (e) {
    log('WARNING: per-sentence keyword generation failed, all slides will use the generic category query. ' + e.message);
    character = null;
    keywords = sentences.map(() => null);
    scenes = sentences.map(() => null);
  }

  // A simple deterministic hash of the character description, used as the
  // Pollinations seed for every scene — same starting noise pattern nudges
  // the model toward a more visually consistent character across scenes.
  let characterSeed;
  if (character) {
    let hash = 0;
    for (let c = 0; c < character.length; c++) hash = (hash * 31 + character.charCodeAt(c)) >>> 0;
    characterSeed = hash % 100000;
    log(`  character seed: ${characterSeed} (for: "${character}")`);
  }

  // Categories whose facts are typically about abstract/conceptual/
  // molecular subjects (energy transfer, brain processes, space phenomena)
  // essentially never have matching real stock footage — Pexels Video
  // searches for these tend to return generic, mismatched results rather
  // than failing cleanly, which is worse than skipping straight to a
  // purpose-generated AI image. Concrete/filmable categories (animal,
  // ocean, food, money, history) keep real video as the first try since
  // actual footage often exists and looks more dynamic than a still.
  const ABSTRACT_CATEGORIES = new Set(['mindblowing', 'psychology', 'earth_space', 'human_body', 'technology']);
  const preferAIImageFirst = ABSTRACT_CATEGORIES.has(category);

  const clips = [];
  const usedVideoIds = new Set();
  const usedPexelsIds = new Set(); // avoid repeating the same stock photo within this video
  for (let i = 0; i < sentences.length; i++) {
    const keyword = keywords[i] || FALLBACK_KEYWORDS[category];
    const sceneBase = scenes[i] || keyword;
    const scene = character ? `${character}. ${sceneBase}` : sceneBase;
    log(`Sentence ${i} ("${sentences[i].slice(0, 40)}...") -> keyword: "${keyword}" | AI scene: "${scene.slice(0, 60)}..."`);

    const tryPexelsVideo = async () => {
      const result = await fetchPexelsVideo(keyword, i, usedVideoIds);
      usedVideoIds.add(result.id);
      log(`  -> Pexels video succeeded for sentence ${i}.`);
      clips.push({ path: result.path, type: 'video' });
    };
    const tryAIImage = async () => {
      const aiPath = path.join(WORK_DIR, `ai_image_${i}.jpg`);
      const style = preferAIImageFirst ? 'illustration' : 'photo';
      await generateAIImage(scene, aiPath, characterSeed, style);
      log(`  -> AI-generated image succeeded for sentence ${i}.`);
      clips.push({ path: aiPath, type: 'image' });
    };

    if (preferAIImageFirst) {
      // 1) AI-generated image first — abstract concept, real footage unlikely.
      try {
        await tryAIImage();
        continue;
      } catch (e) {
        log(`  WARNING: AI image generation failed for sentence ${i} (${e.message}), trying Pexels video instead.`);
      }
      // 1.5) Pexels video as fallback, in case a concrete visual works after all.
      try {
        await tryPexelsVideo();
        continue;
      } catch (e) {
        log(`  WARNING: Pexels video also failed for sentence ${i} (${e.message}), falling back to Pexels photo.`);
      }
    } else {
      // 1) Real stock video footage — tried first.
      try {
        await tryPexelsVideo();
        continue;
      } catch (e) {
        log(`  WARNING: Pexels video search failed for sentence ${i} (${e.message}), trying experimental AI video.`);
      }

      // 1.5) EXPERIMENTAL: AI-generated video via a Hugging Face Space — best
      // shot at real motion for scenes that no stock library will ever have
      // (mythological/fantastical moments). No SLA; expected to fail often.
      const hfVideoPath = path.join(WORK_DIR, `hf_video_${i}.mp4`);
      try {
        generateHFSpaceVideo(scene, hfVideoPath);
        const probe = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=codec_type -of csv=p=0 "${hfVideoPath}"`).toString().trim();
        if (probe !== 'video') throw new Error('no video stream in output file');
        log(`  -> Experimental HF Space video succeeded for sentence ${i}.`);
        clips.push({ path: hfVideoPath, type: 'video' });
        continue;
      } catch (e) {
        log(`  (expected, often fails) HF Space video generation failed for sentence ${i} (${e.message}), falling back to AI image.`);
      }

      // 2) AI-generated image (exact-scene prompt, character-consistent).
      try {
        await tryAIImage();
        continue;
      } catch (e) {
        log(`  WARNING: AI image generation failed for sentence ${i} (${e.message}), falling back to Pexels photo.`);
      }
    }

    // 3) Pexels stock photo — last resort.
    try {
      const result = await fetchImagesWithFallback(keyword, 1, category, i, usedPexelsIds);
      clips.push({ path: result.paths[0], type: 'image' });
      result.ids.forEach(id => usedPexelsIds.add(id));
    } catch (e) {
      log(`  WARNING: sentence ${i} media totally failed (${e.message}) — this sentence will be skipped visually.`);
      clips.push(null);
    }
  }
  return clips;
}

// Renders one still image as a short Ken-Burns (slow zoom) video clip.
// Pre-scaling to a canvas larger than the 720x1280 output gives zoompan room
// to move without upscaling artifacts partway through the zoom.
function buildImageClip(imagePath, duration, outPath, zoomIn) {
  const fps = 25;
  const totalFrames = Math.max(1, Math.round(duration * fps));
  const zoomExpr = zoomIn
    ? `min(zoom+0.0020,1.2)`
    : `if(eq(on,0),1.2,max(zoom-0.0020,1.0))`;
  const cmd = [
    'ffmpeg -y',
    `-loop 1 -i "${imagePath}"`,
    `-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='${zoomExpr}':d=${totalFrames}:s=720x1280:fps=${fps}"`,
    `-frames:v ${totalFrames}`,
    '-c:v libx264 -pix_fmt yuv420p',
    `"${outPath}"`
  ].join(' ');
  execSync(cmd, { stdio: 'inherit' });
}

// Takes a real downloaded video clip and produces an exact-duration segment:
// scaled/cropped to fill 720x1280, with its own audio stripped (we use our
// own narration track), looped with -stream_loop if the source clip is
// shorter than needed and cut to length either way — so a 4s source clip
// covering an 8s sentence just plays twice seamlessly instead of freezing.
function buildRealVideoClip(videoPath, duration, outPath) {
  const fps = 25;
  const cmd = [
    'ffmpeg -y',
    `-stream_loop -1 -i "${videoPath}"`,
    `-vf "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=${fps}"`,
    `-t ${duration.toFixed(2)}`,
    '-an',
    '-c:v libx264 -pix_fmt yuv420p',
    `"${outPath}"`
  ].join(' ');
  execSync(cmd, { stdio: 'inherit' });
}

// libass/drawtext look up fonts by their EMBEDDED family name, not the
// filename — detect it at runtime with fc-scan so text rendering works
// regardless of what the .ttf file happens to be named.
function getFontFamilyName(fontPath, fallback) {
  try {
    const name = execSync(`fc-scan --format "%{family}\n" "${fontPath}"`).toString().trim().split('\n')[0];
    return name || fallback;
  } catch (e) {
    log(`WARNING: fc-scan failed for ${fontPath} (${e.message}), using fallback family name "${fallback}".`);
    return fallback;
  }
}

// Wraps text at a max character count per line so thumbnail text fits the
// frame width at a large, readable size.
function wrapText(text, maxCharsPerLine) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? current + ' ' + word : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Builds a custom thumbnail: a frame from the video's own first slide
// (image or video) with bold, high-contrast hook-text overlaid — shown
// ONLY in YouTube's feed/search preview, never during playback (kept
// completely separate from the on-screen-text-free video itself).
//
// Uses the subtitles/libass rendering path, NOT drawtext — testing showed
// drawtext produces corrupted/overlapping glyphs for some Telugu conjuncts
// (e.g. "చంద్రుడు" rendering with a garbled ending), the same class of bug
// from this project's original on-screen-text era. libass (via harfbuzz)
// shapes Telugu conjuncts correctly, which is why the disabled subtitle
// feature used it too.
function buildThumbnail(mediaPath, mediaType, hookText, outPath) {
  const fontsDir = path.join(__dirname, 'fonts');
  const fontPathBoldCandidate = path.join(fontsDir, 'NotoSansTelugu-Bold.ttf');
  const fontPathBold = fs.existsSync(fontPathBoldCandidate) ? fontPathBoldCandidate : path.join(fontsDir, 'NotoSansTelugu-Regular.ttf');
  const fontFamily = getFontFamilyName(fontPathBold, 'Noto Sans Telugu');

  // Strip emoji before wrapping — libass can't render most emoji glyphs
  // reliably either, and they'd show as tofu boxes on the thumbnail.
  const cleanText = hookText.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim();
  const lines = wrapText(cleanText, 24);
  const assText = lines.join('\\N');

  const frameOut = path.join(WORK_DIR, 'thumb_frame.jpg');
  if (mediaType === 'video') {
    execSync(`ffmpeg -y -i "${mediaPath}" -ss 1 -vf "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280" -frames:v 1 "${frameOut}"`, { stdio: 'inherit' });
  } else {
    execSync(`ffmpeg -y -i "${mediaPath}" -vf "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280" -frames:v 1 "${frameOut}"`, { stdio: 'inherit' });
  }

  const assPath = path.join(WORK_DIR, 'thumbnail.ass');
  const assContent = `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Thumb,${fontFamily},54,&H00FFFFFF,&H000000FF,&H00000000,&HB0000000,-1,0,0,0,100,100,0,0,3,0,2,2,50,50,500,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:05.00,Thumb,,0,0,0,,${assText}
`;
  fs.writeFileSync(assPath, assContent, 'utf8');

  const filters = `eq=contrast=1.1:saturation=1.15,subtitles='${assPath}':fontsdir='${fontsDir}'`;
  execSync(`ffmpeg -y -i "${frameOut}" -vf "${filters}" -frames:v 1 -update 1 -q:v 2 "${outPath}"`, { stdio: 'inherit' });
  log(`Thumbnail built: ${outPath} (font family "${fontFamily}")`);
  return outPath;
}

async function uploadThumbnail(videoId, thumbnailPath) {
  try {
    const oauth2Client = new google.auth.OAuth2(YT_CLIENT_ID, YT_CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: YT_REFRESH_TOKEN });
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    await youtube.thumbnails.set({
      videoId,
      media: { body: fs.createReadStream(thumbnailPath) }
    });
    log('Custom thumbnail uploaded successfully.');
  } catch (e) {
    // Custom thumbnails require a phone-verified YouTube account — if that
    // isn't done yet, this fails but the video itself already uploaded
    // fine with YouTube's auto-selected thumbnail as a fallback.
    log(`WARNING: thumbnail upload failed (${e.message}) — video is still live with YouTube's auto-selected thumbnail. (Custom thumbnails require a phone-verified channel — verify at youtube.com/verify if this keeps failing.)`);
  }
}

function buildVideo(mediaItems, audioPath, customDurations, ctaDuration) {
  log('Building video with FFmpeg...');
  const outPath = path.join(WORK_DIR, 'output.mp4');
  const fontsDir = path.join(__dirname, 'fonts');
  const fontPath = path.join(fontsDir, 'NotoSansTelugu-Regular.ttf');
  const fontPathBoldCandidate = path.join(fontsDir, 'NotoSansTelugu-Bold.ttf');
  const fontPathBold = fs.existsSync(fontPathBoldCandidate) ? fontPathBoldCandidate : fontPath;

  const ACCENT = '0xFFC107'; // gold/amber - brand accent
  const CTA = '0xE62117';    // YouTube red - subscribe button

  const duration = getAudioDuration(audioPath) + 0.3;
  const fd = duration.toFixed(2);
  log(`Audio duration: ${fd}s — video length set to match`);

  // The CTA button only appears while the CTA line is actually being
  // spoken (the closing few seconds), not for the whole video — computed
  // from the CTA sentence's own measured audio duration.
  const ctaStartTime = ctaDuration ? Math.max(0, duration - ctaDuration) : duration; // fallback: never shown if unknown
  log(`CTA button will appear starting at ${ctaStartTime.toFixed(2)}s`);

  const n = mediaItems.length;
  if (n === 0) {
    throw new Error('buildVideo received zero media items — refusing to continue (would divide duration by zero).');
  }
  // customDurations lets each slide match how long its sentence actually
  // takes to say, instead of every slide getting an equal, arbitrary share
  // of the total — this is what keeps the image on screen in sync with
  // what's being narrated at that moment.
  let durations = customDurations;
  if (!durations || durations.length !== n) {
    const equal = duration / n;
    durations = mediaItems.map(() => equal);
  }
  // Last-line-of-defense validation: replace any NaN/invalid/non-positive
  // duration with a safe fallback before it can ever reach an ffmpeg
  // command as literal "-t NaN" text, which fails the whole run.
  const safeEqualShare = duration / n;
  durations = durations.map((d, i) => {
    if (typeof d !== 'number' || !isFinite(d) || d <= 0) {
      log(`WARNING: duration for slide ${i} was invalid (${d}) — using a safe fallback (${safeEqualShare.toFixed(2)}s) instead.`);
      return safeEqualShare;
    }
    return d;
  });
  log(`Building ${n}-clip slideshow, durations: ${durations.map(d => d.toFixed(2)).join('s, ')}s...`);

  // Renders a plain color placeholder clip — the last-resort fallback if a
  // specific slide's video/image processing fails for a reason the earlier
  // validation didn't catch. Keeps the run from crashing entirely over one
  // bad slide.
  function buildPlaceholderClip(duration, outPath) {
    const fps = 25;
    execSync(`ffmpeg -y -f lavfi -i "color=c=0x1a1a2e:s=720x1280:d=${duration.toFixed(2)}:r=${fps}" -c:v libx264 -pix_fmt yuv420p "${outPath}"`, { stdio: 'inherit' });
  }

  // Step 1: one clip per sentence — real video is looped/trimmed to length,
  // a still image gets a Ken-Burns pan/zoom (alternating in/out for variety).
  const clipPaths = [];
  for (let i = 0; i < n; i++) {
    const clipPath = path.join(WORK_DIR, `clip_${i}.mp4`);
    try {
      if (mediaItems[i].type === 'video') {
        buildRealVideoClip(mediaItems[i].path, durations[i], clipPath);
      } else {
        buildImageClip(mediaItems[i].path, durations[i], clipPath, i % 2 === 0);
      }
    } catch (e) {
      log(`WARNING: clip_${i} (${mediaItems[i].type}) failed to build (${e.message}) — using a plain placeholder for this slide instead of failing the whole video.`);
      buildPlaceholderClip(durations[i], clipPath);
    }
    const actualDur = getAudioDuration(clipPath); // works for video streams too via ffprobe format=duration
    log(`  clip_${i} (${mediaItems[i].type}): target ${durations[i].toFixed(2)}s, actual ${actualDur.toFixed(2)}s${Math.abs(actualDur - durations[i]) > 1 ? ' ⚠️ MISMATCH' : ''}`);
    clipPaths.push(clipPath);
  }

  // Step 2: concatenate the clips into one background video.
  const concatListPath = path.join(WORK_DIR, 'concat_list.txt');
  fs.writeFileSync(concatListPath, clipPaths.map(p => `file '${p}'`).join('\n'), 'utf8');
  const bgPath = path.join(WORK_DIR, 'background.mp4');
  execSync(`ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${bgPath}"`, { stdio: 'inherit' });
  log(`  background.mp4 total duration: ${getAudioDuration(bgPath).toFixed(2)}s (expected ~${fd}s)`);

  // Step 3: overlay branding/CTA + scrims (for legibility over photos), mux audio.
  // NOTE on drawbox positioning: inside drawbox, 'w'/'h' in x/y expressions mean
  // the box's OWN width/height (not the frame) — always use 'iw'/'ih' there.
  // drawtext does not have this problem — its 'w'/'h' correctly mean the frame.
  const filters = [
    // subtle cinematic color grade + vignette on the raw photos
    `eq=contrast=1.06:saturation=1.12`,
    `vignette=PI/6`,

    // 5-band gradient scrims (top & bottom) instead of a flat rectangle —
    // reads as a smooth fade like native Instagram/YouTube overlays rather
    // than a hard-edged bar.
    `drawbox=x=0:y=0:w=iw:h=56:color=black@0.70:t=fill`,
    `drawbox=x=0:y=56:w=iw:h=56:color=black@0.55:t=fill`,
    `drawbox=x=0:y=112:w=iw:h=56:color=black@0.40:t=fill`,
    `drawbox=x=0:y=168:w=iw:h=56:color=black@0.25:t=fill`,
    `drawbox=x=0:y=224:w=iw:h=56:color=black@0.12:t=fill`,
    `drawbox=x=0:y=ih-280:w=iw:h=56:color=black@0.12:t=fill`,
    `drawbox=x=0:y=ih-224:w=iw:h=56:color=black@0.25:t=fill`,
    `drawbox=x=0:y=ih-168:w=iw:h=56:color=black@0.40:t=fill`,
    `drawbox=x=0:y=ih-112:w=iw:h=56:color=black@0.55:t=fill`,
    `drawbox=x=0:y=ih-56:w=iw:h=56:color=black@0.70:t=fill`,

    // "FACTS" badge, top-left, with a soft drop shadow behind the box
    `drawbox=x=43:y=63:w=165:h=44:color=black@0.35:t=fill`,
    `drawbox=x=40:y=60:w=165:h=44:color=${ACCENT}@0.97:t=fill`,
    `drawtext=fontfile='${fontPathBold}':text='FACTS':fontcolor=0x0f1024:fontsize=22:x=40+(165-text_w)/2:y=60+(44-text_h)/2`,

    // Channel branding, top-center, with text shadow + a thin accent underline
    `drawtext=fontfile='${fontPathBold}':text='TELUGU ECHO':fontcolor=${ACCENT}:fontsize=32:x=(w-text_w)/2:y=140:shadowcolor=black@0.6:shadowx=2:shadowy=2`,
    `drawbox=x=(iw-160)/2:y=192:w=160:h=4:color=${ACCENT}@0.9:t=fill`,

    // Subscribe CTA styled as a real elevated button: soft glow border behind,
    // drop shadow, bold white text with shadow, small tagline underneath.
    `drawbox=x=(iw-572)/2:y=ih-196:w=572:h=88:color=${ACCENT}@0.35:t=fill:enable='gte(t,${ctaStartTime.toFixed(2)})'`,
    `drawbox=x=(iw-566)/2:y=ih-193+6:w=566:h=82:color=black@0.30:t=fill:enable='gte(t,${ctaStartTime.toFixed(2)})'`,
    `drawbox=x=(iw-560)/2:y=ih-190:w=560:h=76:color=${CTA}@0.97:t=fill:enable='gte(t,${ctaStartTime.toFixed(2)})'`,
    `drawtext=fontfile='${fontPathBold}':text='LIKE   SHARE   SUBSCRIBE':fontcolor=white:fontsize=27:x=(w-text_w)/2:y=h-190+(76-text_h)/2:shadowcolor=black@0.5:shadowx=1:shadowy=1:enable='gte(t,${ctaStartTime.toFixed(2)})'`,
    `drawtext=fontfile='${fontPath}':text='daily amazing Telugu facts':fontcolor=white@0.8:fontsize=17:x=(w-text_w)/2:y=h-100:enable='gte(t,${ctaStartTime.toFixed(2)})'`,

    // Smooth fade in/out
    `fade=t=in:st=0:d=0.5`,
    `fade=t=out:st=${(duration - 0.5).toFixed(2)}:d=0.5`
  ].join(',');

  const cmd = [
    'ffmpeg -y',
    `-i "${bgPath}"`,
    `-i "${audioPath}"`,
    `-vf "${filters}"`,
    '-c:v libx264 -pix_fmt yuv420p',
    '-c:a aac -b:a 128k',
    `-t ${fd}`,
    `"${outPath}"`
  ].join(' ');

  execSync(cmd, { stdio: 'inherit' });
  log(`Video saved to ${outPath}`);
  return outPath;
}

// 2026 research consensus: 3-5 highly relevant hashtags perform BEST —
// exceeding 5 can trigger spam-signal dilution in the recommendation
// engine, and only the first 3 in a description show as clickable links
// above the title anyway. #shorts first (Shorts-shelf categorization),
// #telugufacts second (language/niche targeting), then 3 specific tags.
const CATEGORY_HASHTAGS = {
  mindblowing: ['#amazingfacts', '#mindblowing', '#curiousfacts'],
  psychology: ['#psychologyfacts', '#mindfacts', '#humanmind'],
  earth_space: ['#spacefacts', '#astronomy', '#universe'],
  animal: ['#animalfacts', '#wildlifefacts', '#nature'],
  money: ['#moneyfacts', '#financefacts', '#economyfacts'],
  history: ['#historyfacts', '#historymysteries', '#ancienthistory'],
  human_body: ['#humanbodyfacts', '#sciencefacts', '#anatomy'],
  technology: ['#techfacts', '#technology', '#innovation'],
  food: ['#foodfacts', '#foodie', '#cookingfacts'],
  ocean: ['#oceanfacts', '#marinelife', '#underwater']
};
const BASE_HASHTAGS = ['#shorts', '#telugufacts'];

// Generic curiosity-building teasers — deliberately NOT about any specific
// fact's content (that would summarize/spoil the video), just build
// curiosity to watch. Rotates by run count for variety. Each already has
// its emoji placed next to the relevant word, not tacked on at the end.
const DESCRIPTION_TEASERS = [
  'ఈ వీడియో 🎬 చూశాక మీ ఆలోచన ఖచ్చితంగా మారిపోతుంది!',
  'చివరి వరకూ చూడండి, twist 😲 మిమ్మల్ని ఆశ్చర్యపరుస్తుంది!',
  'చాలా మందికి ఇది తెలియదు 🧐... మీకు తెలుసా?',
  'ఇది విన్నాక మీరు షాక్ ⚡ అవ్వడం ఖాయం!',
  'ఈ fact 🔥 మీ friends కి కూడా చెప్పాలనిపిస్తుంది!'
];

// Short, structured 3-line description (hook / curiosity teaser / CTA) plus
// 5 lowercase hashtags (2026 best-practice range), per spec. Built
// programmatically (fixed teaser bank + templated CTA) except the hook
// line, which needs to be content-aware for its emoji placement — that
// part comes from Groq's HOOK field, kept separate from the spoken SCRIPT.
function buildDescription(hookEmoji, category, runCount) {
  const line1 = hookEmoji;
  const line2 = DESCRIPTION_TEASERS[runCount % DESCRIPTION_TEASERS.length];
  const line3 = 'మరిన్ని facts కోసం Subscribe చేయండి! 🔔';
  const hashtags = [...BASE_HASHTAGS, ...(CATEGORY_HASHTAGS[category] || [])].slice(0, 5).join(' ');

  return `${line1}\n${line2}\n${line3}\n\n${hashtags}`;
}

// YouTube's upload validator is stricter than our own text handling — strip
// control characters and any unpaired UTF-16 surrogates (a sign of
// malformed Unicode that can slip out of an LLM) before sending title/
// description, and enforce YouTube's own length limits as a safety margin.
function sanitizeForYouTube(text, maxLen) {
  if (!text) return '';
  let cleaned = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
  cleaned = cleaned.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/g, '');
  return cleaned.slice(0, maxLen).trim();
}

async function uploadToYouTube(videoPath, title, description, category) {
  log('Uploading to YouTube...');
  const oauth2Client = new google.auth.OAuth2(YT_CLIENT_ID, YT_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: YT_REFRESH_TOKEN });

  const safeTitle = sanitizeForYouTube(title, 95);
  const safeDescription = sanitizeForYouTube(description, 4900); // YouTube's limit is 5000
  log(`Title (${safeTitle.length} chars): ${safeTitle}`);
  log(`Description (${safeDescription.length} chars, first 100): ${safeDescription.slice(0, 100)}...`);

  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: safeTitle,
        description: safeDescription,
        tags: ['telugu', 'shorts', 'amazing facts', 'telugu facts', ...(CATEGORY_HASHTAGS[category] || []).map(h => h.replace('#', ''))],
        categoryId: '27'
      },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false, containsSyntheticMedia: true }
    },
    media: { body: fs.createReadStream(videoPath) }
  });
  log(`Uploaded! Video ID: ${res.data.id}`);
  return res.data.id;
}

function saveState(title, category, newlyDiscovered) {
  const { usedTitles, runCount, categoryRunCounts, discoveredFacts } = loadState();
  let newTitles = [...usedTitles, title];
  if (newTitles.length > 50) newTitles = newTitles.slice(-50);
  const newCategoryRunCounts = { ...categoryRunCounts, [category]: (categoryRunCounts[category] || 0) + 1 };
  const newDiscoveredFacts = { ...discoveredFacts };
  if (newlyDiscovered) {
    newDiscoveredFacts[category] = [...(newDiscoveredFacts[category] || []), newlyDiscovered];
    log(`Persisting 1 newly discovered fact for "${category}" — bank is now permanently larger.`);
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    usedTitles: newTitles,
    runCount: runCount + 1,
    categoryRunCounts: newCategoryRunCounts,
    discoveredFacts: newDiscoveredFacts,
    lastDate: new Date().toISOString()
  }, null, 2));
}

// Logs only whether each required secret is present and its character
// length — never the value itself. This makes copy-paste mistakes (stray
// whitespace/newlines, wrong secret name, empty value) immediately visible
// in the run log instead of showing up as a confusing downstream API error.
function checkSecret(name, value) {
  if (!value) {
    log(`WARNING: ${name} is missing or empty — check it's set in GitHub Secrets with this exact name.`);
  } else {
    const trimmedLen = value.trim().length;
    const hasWhitespace = trimmedLen !== value.length;
    log(`${name}: present, length=${value.length}${hasWhitespace ? ' (WARNING: has leading/trailing whitespace — re-paste it without extra spaces/newlines)' : ''}`);
  }
}

async function main() {
  if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });

  checkSecret('GROQ_API_KEY', GROQ_API_KEY);
  checkSecret('GOOGLE_TTS_API_KEY', GOOGLE_TTS_API_KEY);
  checkSecret('PEXELS_API_KEY', PEXELS_API_KEY);
  checkSecret('JAMENDO_CLIENT_ID', JAMENDO_CLIENT_ID);
  checkSecret('YT_CLIENT_ID', YT_CLIENT_ID);
  checkSecret('YT_CLIENT_SECRET', YT_CLIENT_SECRET);
  checkSecret('YT_REFRESH_TOKEN', YT_REFRESH_TOKEN);

  const { usedTitles, runCount, categoryRunCounts, discoveredFacts } = loadState();
  let category = pickCategory(runCount);
  let outline, newlyDiscovered;

  // If the scheduled category can't produce a verified fact after all
  // attempts (observed: "history" failing self-verification 6/6 times in
  // one run), try a couple of DIFFERENT categories before giving up
  // entirely — still fresh-generated and fully verified, just a different
  // topic area. This is the difference between "no video today" and
  // "today's video is about something else" — a much better failure mode
  // for a daily-upload channel.
  const triedCategories = [category];
  for (let categorySwitch = 0; categorySwitch <= 2; categorySwitch++) {
    try {
      const result = await getOrGrowFactOutline(category, categoryRunCounts, discoveredFacts);
      outline = result.outline;
      newlyDiscovered = result.newlyDiscovered;
      break;
    } catch (e) {
      if (categorySwitch === 2) throw e; // out of switches, let the run genuinely fail
      const nextCategory = FACT_SUBNICHES.find(c => !triedCategories.includes(c)) || FACT_SUBNICHES[(FACT_SUBNICHES.indexOf(category) + 1) % FACT_SUBNICHES.length];
      log(`WARNING: "${category}" could not produce a verified fact (${e.message}) — switching to "${nextCategory}" for today's video instead.`);
      category = nextCategory;
      triedCategories.push(category);
    }
  }

  const ctaSentence = pickCTA(runCount);
  const { title, hookEmoji, script } = await generateContent(category, usedTitles, outline, ctaSentence);
  const allSentences = splitIntoSentences(script);
  let { audioPath, sentenceDurations, silenceGap } = await generateAudioForScript(allSentences);

  // Background music is a nice-to-have, not critical — any failure here
  // (missing/invalid client ID, network, no matching tracks) just means the
  // video plays with narration only, same as before this feature existed.
  try {
    const musicPath = await fetchBackgroundMusic(category);
    const mixedPath = path.join(WORK_DIR, 'audio_with_bgm.wav');
    mixBackgroundMusic(audioPath, musicPath, mixedPath);
    audioPath = mixedPath;
    log('Background music mixed in successfully.');
  } catch (e) {
    log('WARNING: background music failed (' + e.message + ') — continuing with narration-only audio.');
  }

  // Fold the gap that follows each sentence (except the last) into that
  // sentence's own on-screen time, so the image holds through the pause
  // before the next line — durations still sum exactly to the full audio.
  let imageDurations = sentenceDurations.map((d, i) => i < sentenceDurations.length - 1 ? d + silenceGap : d);
  let imageSentences = allSentences.slice();

  // Pull the closing CTA sentence out — a stock/AI photo search for "like
  // share subscribe" wouldn't mean anything, so its time is folded into the
  // last content sentence's slide instead. The CTA is always the actual
  // LAST sentence (appended programmatically in generateContent) — check
  // that specific position first, rather than findIndex's first-match,
  // which could misfire if the model ever mentions "సబ్‌స్క్రైబ్" earlier
  // in the script despite being told not to.
  let ctaAudioDuration = 0; // used later to time-gate the on-screen CTA button
  const lastIdx = imageSentences.length - 1;
  const ctaIndex = (lastIdx >= 0 && imageSentences[lastIdx].includes('సబ్‌స్క్రైబ్'))
    ? lastIdx
    : imageSentences.findIndex(s => s.includes('సబ్‌స్క్రైబ్'));
  if (ctaIndex !== -1) {
    const ctaDur = imageDurations[ctaIndex] || 0;
    ctaAudioDuration = ctaDur;
    imageSentences.splice(ctaIndex, 1);
    imageDurations.splice(ctaIndex, 1);
    if (imageDurations.length > 0) {
      imageDurations[imageDurations.length - 1] += ctaDur;
    } else {
      imageSentences = [allSentences[ctaIndex]];
      imageDurations = [ctaDur];
    }
  }

  // Cap distinct images at 10 (Pexels/Pollinations call budget + render
  // time) — merge any extra trailing sentences' screen time into the last
  // kept slide. Each sentence's own audio was still generated naturally.
  // Raised from 6 (set when videos ran ~25-30s) now that videos run
  // ~55-63s with typically 8-10 sentences — the old cap forced ~9-10s per
  // scene, well past the 2-3s pacing that retention research favors for
  // Shorts. 10 lets a typical script's sentences each get their own visual.
  const MAX_SLIDES = 10;
  if (imageSentences.length > MAX_SLIDES) {
    const extraDuration = imageDurations.slice(MAX_SLIDES - 1).reduce((a, b) => a + b, 0);
    imageSentences = imageSentences.slice(0, MAX_SLIDES - 1).concat([imageSentences[imageSentences.length - 1]]);
    imageDurations = imageDurations.slice(0, MAX_SLIDES - 1).concat([extraDuration]);
  }

  log(`Fetching one content-matched image per sentence (${imageSentences.length} sentences)...`);
  const rawImagePaths = await fetchImagesPerSentence(imageSentences, category, outline);

  // Drop any sentence whose image totally failed, redistributing its share
  // of time to the remaining successful slides so there's no dead/black gap.
  const imagePaths = [];
  const keptDurations = [];
  for (let i = 0; i < rawImagePaths.length; i++) {
    if (rawImagePaths[i]) {
      imagePaths.push(rawImagePaths[i]);
      keptDurations.push(imageDurations[i]);
    }
  }
  if (imagePaths.length === 0) {
    log('WARNING: every per-sentence image failed — falling back to one generic image for the whole video.');
    const fallbackResult = await fetchImagesWithFallback(FALLBACK_KEYWORDS[category], 1, category, 999);
    imagePaths.push({ path: fallbackResult.paths[0], type: 'image' });
    keptDurations.push(imageDurations.reduce((a, b) => a + b, 0));
  } else {
    // Redistribute any dropped sentences' time proportionally across the survivors.
    const totalKept = keptDurations.reduce((a, b) => a + b, 0);
    const totalIntended = imageDurations.reduce((a, b) => a + b, 0);
    if (totalKept > 0 && totalKept < totalIntended) {
      const scale = totalIntended / totalKept;
      for (let i = 0; i < keptDurations.length; i++) keptDurations[i] *= scale;
    }
  }
  // buildVideo internally targets getAudioDuration(audioPath) + 0.3 as the
  // total video length — add that same small buffer to the last slide so
  // the sum of our durations matches exactly.
  keptDurations[keptDurations.length - 1] += 0.3;

  const videoPath = buildVideo(imagePaths, audioPath, keptDurations, ctaAudioDuration);

  const videoId = await uploadToYouTube(
    videoPath,
    title,
    buildDescription(hookEmoji, category, runCount),
    category
  );

  // Custom thumbnail is a nice-to-have on top of an already-successful
  // upload — any failure here (build error, unverified channel, etc.)
  // must never be treated as the run failing.
  try {
    const thumbnailPath = path.join(WORK_DIR, 'thumbnail.jpg');
    buildThumbnail(imagePaths[0].path, imagePaths[0].type, hookEmoji, thumbnailPath);
    await uploadThumbnail(videoId, thumbnailPath);
  } catch (e) {
    log(`WARNING: thumbnail generation failed (${e.message}) — video is live with YouTube's auto-selected thumbnail instead.`);
  }

  saveState(title, category, newlyDiscovered);
  log('Done!');
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
