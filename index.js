// Telugu Amazing Facts Shorts — fully automated, runs on GitHub Actions
// Rotates through 10 fact sub-niches: mindblowing, psychology, earth_space, animal, money, history, human_body, technology, food, ocean
// Topic/Script (Groq) -> Voice (Google TTS) -> Images/Video (Pexels/AI) -> Music (Jamendo) -> Video (FFmpeg) -> YouTube

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { google } = require('googleapis');
const puppeteer = require('puppeteer');

// .trim() defends against a real, confirmed symptom: the key worked when
// tested directly in Groq's Playground, but failed with "Invalid API Key"
// specifically when read from this GitHub Secret — classic sign of a
// stray leading/trailing space or newline getting included when the
// secret value was pasted, silently making it different from the real key.
const GROQ_API_KEY_RAW = process.env.GROQ_API_KEY || '';
// .trim() defends against a real, confirmed symptom: the key worked when
// tested directly in Groq's Playground, but failed with "Invalid API Key"
// specifically when read from this GitHub Secret — classic sign of a
// stray leading/trailing space or newline getting included when the
// secret value was pasted, silently making it different from the real key.
const GROQ_API_KEY = GROQ_API_KEY_RAW.trim();
const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY;
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const YT_CLIENT_ID = process.env.YT_CLIENT_ID;
const YT_CLIENT_SECRET = process.env.YT_CLIENT_SECRET;
const YT_REFRESH_TOKEN = process.env.YT_REFRESH_TOKEN;

// Reuses the SAME TTS-notation safety check (fraction glyphs, math/currency/
// percent symbols, superscript exponents, wrong terminology, second-person
// address) that the narration guard runs on the initial generation. Without
// this, a later text-mutating stage — e.g. the punctuation optimizer below,
// which is only checked for word/line/question-count preservation — could
// silently reintroduce exactly the notation the guard was written to keep
// out, since count-preservation alone doesn't guarantee TTS-safe content.
const { styleErrors, hasBareDigits } = require('./narration_quality_guard_v14.js');

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

// Specific, evergreen topics (not breaking news) — anchors fact generation
// to a NAMED topic instead of asking the model to invent a "rare fact"
// from an entire category. Real run logs showed the "find something rare"
// framing pushing the model toward less-established knowledge (exactly
// where hallucination risk is highest), causing frequent self-rejection
// and retries. "What's the most surprising verified fact about Neutron
// Stars?" is a far more constrained, reliably-answerable task than "find
// a rare space fact nobody's heard of."
const TOPIC_BANK = {
  mindblowing: ['Quantum Entanglement', 'Placebo Effect', 'Butterfly Effect', 'Mandela Effect', 'Deja Vu', 'Optical Illusions', 'Fibonacci Sequence', 'Speed of Light', 'Human Consciousness', 'Parallel Universes', 'Time Dilation', 'Chaos Theory', 'Synesthesia', 'Photographic Memory', 'Sleep Paralysis'],
  psychology: ['Confirmation Bias', 'Stockholm Syndrome', 'Bystander Effect', 'Cognitive Dissonance', 'Dunning-Kruger Effect', 'False Memories', 'Groupthink', 'Halo Effect', 'Imposter Syndrome', 'Peer Pressure', 'Selective Attention', 'Social Proof', 'Zeigarnik Effect', 'Anchoring Bias', 'Mirror Neurons'],
  earth_space: ['Neutron Stars', 'Black Holes', 'Pulsars', 'Magnetars', 'Europa', 'Titan', "Saturn's Rings", 'Solar Flares', 'Aurora Borealis', 'Tectonic Plates', 'Volcanic Eruptions', 'Ocean Currents', "Earth's Magnetic Field", 'Meteor Showers', 'Comets'],
  animal: ['Octopus Camouflage', 'Elephant Memory', 'Dolphin Communication', 'Bee Waggle Dance', 'Migratory Birds', 'Chameleon Vision', 'Tardigrades', 'Mimic Octopus', 'Electric Eels', 'Bioluminescence', 'Ant Colonies', 'Wolf Pack Hierarchy', 'Cuttlefish Intelligence', 'Platypus Biology', 'Axolotl Regeneration'],
  money: ['Compound Interest', 'Cryptocurrency Origins', 'Stock Market Crashes', 'Hyperinflation', 'Gold Standard History', 'Barter System', 'Central Banks', 'Credit Score System', 'Ponzi Schemes', 'Tax Havens', "World's Oldest Currency", 'Bitcoin Mining', 'Interest Rate History', 'Economic Bubbles', 'Black Market Economics'],
  history: ['Roman Aqueducts', 'Egyptian Pyramids', 'Great Wall of China', 'Silk Road', 'Viking Exploration', 'Library of Alexandria', 'Terracotta Army', 'Mayan Calendar', 'Ottoman Empire', 'Byzantine Empire', "Cleopatra's Reign", 'Genghis Khan Conquests', 'Industrial Revolution', 'WWII Code Breaking', 'Ancient Trade Routes'],
  human_body: ['Human Microbiome', 'Brain Plasticity', 'Immune System Memory', 'Bone Regeneration', "Heart's Electrical System", 'Kidney Filtration', 'Liver Regeneration', 'Skin Cell Renewal', 'Muscle Memory', 'Nervous System Speed', 'Blood Types', 'Human Genome', 'Circadian Rhythm', 'Taste Buds', 'Vestigial Organs'],
  technology: ['Artificial Intelligence History', 'Internet Origins', 'GPS Technology', 'Quantum Computing', 'Blockchain Technology', 'Facial Recognition', 'Wireless Charging', '3D Printing', 'Virtual Reality', 'Robotics Evolution', 'Semiconductor Chips', 'Fiber Optic Cables', 'Satellite Communication', 'Machine Learning', 'Cybersecurity Encryption'],
  food: ['Fermentation Science', 'Chocolate History', 'Coffee Origins', 'Spice Trade Routes', 'Ancient Food Preservation', 'Umami Taste', 'Food Coloring History', 'Honey Properties', 'Wine Fermentation', 'Bread Making History', 'Salt Trade History', 'Tea Ceremony Origins', 'Sugar Refining History', 'Cheese Aging Process', 'Ancient Grain Cultivation'],
  ocean: ['Deep Sea Creatures', 'Coral Reef Ecosystems', 'Ocean Currents', 'Bioluminescent Organisms', 'Giant Squid', 'Whale Songs', 'Mariana Trench', 'Sea Turtle Navigation', 'Kelp Forests', 'Ocean Acidification', 'Tidal Patterns', 'Shipwreck Discoveries', 'Marine Migration Patterns', 'Hydrothermal Vents', 'Plankton Ecosystem']
};

// Picks a topic for the category, avoiding ones used recently (tracked in
// state). Cycles through the full 15-topic list before any repeat.
function pickTopic(category, usedTopicsForCategory) {
  const topics = TOPIC_BANK[category];
  const unused = topics.filter(t => !usedTopicsForCategory.includes(t));
  const pool = unused.length > 0 ? unused : topics; // all used at least once — cycle again
  const topic = pool[Math.floor(Math.random() * pool.length)];
  log(`Picked topic for ${category}: "${topic}"`);
  return topic;
}

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
async function generateNewFactOutline(category, topic, existingOutlines) {
  const existingSummaries = existingOutlines.map(o => o.split('.')[0]).join(' | ');
  const prompt = `"${topic}" గురించి అత్యంత ఆశ్చర్యపరిచే, verified fact ఒకటి తెలుగులో ఇవ్వు — ఇది widely-established, నిజమైన సమాచారం అయ్యుండాలి (కల్పితం కాదు).

ఇప్పటికే వాడినవి (వేరేది ఎంచుకో): ${existingSummaries}

నీకు నిజంగా ఖచ్చితంగా తెలిసిన fact మాత్రమే ఇవ్వు. స్పష్టమైన సందేహం ఉంటేనే "UNSURE" అని రాయి (చిన్న uncertainty కి కాదు, genuinely గుర్తు లేకపోతేనే).

ఫార్మాట్ (వేరే ఏమీ రాయకు):
హుక్: (ఆసక్తికరమైన ప్రశ్న)
వివరణ: (సమాధానం, 2-3 వాక్యాలు)
Twist: (అదనపు వివరం, 1-2 వాక్యాలు)`;

  const raw = await callLLM(prompt);
  const trimmed = raw.trim();
  if (trimmed.toUpperCase().includes('UNSURE') || !trimmed.includes('హుక్') || !trimmed.includes('వివరణ')) {
    log(`  New-fact generation for ${category}/"${topic}": model signaled uncertainty or gave malformed output, skipping.`);
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

  const raw = await callLLM(prompt);
  const verified = /ACCURACY:\s*VERIFIED/i.test(raw);
  const scoreMatch = raw.match(/SCORE:\s*(\d+)/i);
  const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;
  log(`  Fact self-verification: ${verified ? 'VERIFIED ✅' : 'REJECTED ❌'} | Viral score: ${score}/100`);
  return { verified, score };
}

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

// Local, YouTube-API-independent duplicate-SUBJECT guard. checkFactSaturation
// above (searching real YouTube results) is the more authoritative check,
// but it has been silently failing on EVERY real run with "Insufficient
// Permission" — the upload-only OAuth token has no search scope — meaning
// it has provided zero actual protection since it was added, failing open
// every single time. This is a defense-in-depth check using our OWN stored
// history instead, which needs no external permission at all: a real
// duplicate slipped through exactly this gap — "Marine Migration Patterns"
// and "Whale Songs" are different TOPIC_BANK labels (so the topic-level
// dedup didn't catch it), but both generated facts ended up being about
// whales specifically. An LLM comparison (not naive keyword matching) is
// used because the overlap is conceptual ("వలస" vs "గీతలు" share no words
// but both are about the same animal), not textual.
async function checkSubjectRepeat(candidate, category, discoveredFacts) {
  const recent = ((discoveredFacts && discoveredFacts[category]) || []).slice(-8);
  if (recent.length === 0) return { repeat: false, subject: '' };
  const recentList = recent.map((f, i) => `${i + 1}. ${f.slice(0, 200).replace(/\s+/g, ' ')}`).join('\n');
  const prompt = `కింద ఇచ్చిన కొత్త fact candidate యొక్క ప్రధాన విషయం (subject — ఏ జంతువు/వస్తువు/దృగ్విషయం గురించి చెప్తుందో) ఇటీవల ఇదే category లో వాడిన fact ల ప్రధాన విషయాలలో దేనితోనైనా సరిపోతుందో లేదో చెప్పు. Angle/topic వేరైనా (ఉదా. ఒకటి వలస గురించి, ఇంకోటి శబ్దాల గురించి), ప్రధాన subject (జంతువు/వస్తువు) ఒకటే అయితే repeat గా లెక్కించు.

**ముఖ్యం — SUBJECT ఎప్పుడూ ఒక నిర్దిష్ట, పేరున్న దృగ్విషయం/జంతువు/వస్తువు అయి ఉండాలి** (ఉదా. "Dunning-Kruger Effect", "Bystander Effect", "Greenland shark", "AES-256 encryption") — "humans", "psychology", "the brain", "the mind" లాంటి విస్తృత, category-level పదాలు ఎప్పుడూ SUBJECT గా వాడకు, ఎందుకంటే ఇవి ఆ category లోని దాదాపు ప్రతి fact కీ వర్తించి, తప్పుగా prati fact నీ repeat గా ఫ్లాగ్ చేస్తాయి. ఉదా: "Dunning-Kruger Effect" మరియు "Bystander Effect" రెండూ మనుషుల ప్రవర్తన గురించే అయినా repeat **కాదు** — ఇవి వేర్వేరు నిర్దిష్ట దృగ్విషయాలు; కానీ "తిమింగల వలస" మరియు "తిమింగల గీతలు" repeat **అవుతుంది** — రెండూ ఒకే నిర్దిష్ట జంతువు (whale) గురించే.

కొత్త candidate:
${candidate.slice(0, 400)}

ఇటీవలి facts (ఇదే category లో):
${recentList}

ఖచ్చితంగా ఈ ఫార్మాట్‌లో మాత్రమే ఇవ్వు, వేరే ఏమీ రాయకు:
REPEAT: (YES లేదా NO)
SUBJECT: (repeat అయితే ఏ నిర్దిష్ట subject overlap అయ్యిందో ఒక్క పదం/పదబంధంలో ఆంగ్లంలో రాయి — ఎప్పుడూ broad category పేరు కాదు; repeat కాకపోతే ఖాళీగా వదిలేయి)`;
  try {
    const raw = await callLLM(prompt);
    const repeatMatch = raw.match(/REPEAT:\s*(YES|NO)/i);
    const subjectMatch = raw.match(/SUBJECT:\s*(.+)/i);
    return {
      repeat: repeatMatch ? repeatMatch[1].toUpperCase() === 'YES' : false,
      subject: subjectMatch ? subjectMatch[1].trim() : ''
    };
  } catch (e) {
    log(`  WARNING: subject-repeat check failed (${e.message}) — proceeding without this check (failing open).`);
    return { repeat: false, subject: '' };
  }
}

// Resolves the outline to use for this run: picks a specific TOPIC (not
// just a broad category — see TOPIC_BANK) and tries a fresh, self-verified
// fact about it from Groq, retrying up to 6 times (a new topic each
// attempt) if a candidate is rejected, oversaturated on YouTube, or
// generation fails outright. Per explicit user decision, there is no
// fallback to a curated pre-written bank — every video's fact is sourced
// fresh. If every attempt fails for this category, main() tries up to 2
// other categories before a run is allowed to genuinely fail — a true
// total failure is now rare. Verified facts are persisted to
// discoveredFacts as a growing record and "don't repeat" context.
async function getOrGrowFactOutline(category, discoveredFacts, usedTopics) {
  const previouslyDiscovered = (discoveredFacts && discoveredFacts[category]) || [];
  const previouslyUsedTopics = (usedTopics && usedTopics[category]) || [];
  // Reduced from 5 — real run logs showed little benefit from attempts
  // past the first few, mostly just multiplying Groq calls and rate-limit
  // hits within a single run. Kept as a safety margin even though
  // topic-anchoring (below) should make most attempts succeed on the
  // first try.
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
  let bestTopic = null;
  // Track candidates generated WITHIN this run so far — without this, the
  // model has no way of knowing what it just suggested moments ago and can
  // (and did, per a real run log) repeat the exact same fact across
  // several attempts in a row. previouslyDiscovered only covers past runs.
  const thisRunsCandidates = [];
  const thisRunsTopics = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // A NEW topic each attempt too — if one topic's generation gets
    // rejected, trying a DIFFERENT topic next is more productive than
    // re-asking about the same one and hoping for a different answer.
    const topic = pickTopic(category, [...previouslyUsedTopics, ...thisRunsTopics]);
    thisRunsTopics.push(topic);
    log(`Attempting a fresh, self-verified fact for "${category}" / "${topic}" (attempt ${attempt}/${maxAttempts})...`);
    try {
      const candidate = await generateNewFactOutline(category, topic, [...previouslyDiscovered, ...thisRunsCandidates]);
      if (candidate) {
        thisRunsCandidates.push(candidate);
        const { verified, score } = await verifyFactOutline(candidate);
        if (verified) {
          const existingResults = await checkFactSaturation(candidate);
          if (existingResults > SATURATION_THRESHOLD) {
            log(`  Fact is already well-covered on YouTube (~${existingResults} results > ${SATURATION_THRESHOLD} threshold) — trying a different fact.`);
            continue;
          }
          const { repeat, subject } = await checkSubjectRepeat(candidate, category, discoveredFacts);
          if (repeat) {
            log(`  Fact's subject ("${subject}") repeats a recently covered subject in "${category}" — trying a different fact.`);
            continue;
          }
          if (score > bestScore) {
            bestCandidate = candidate;
            bestScore = score;
            bestTopic = topic;
          }
          if (score >= HIGH_SCORE_THRESHOLD) {
            log(`  Fresh fact VERIFIED, not oversaturated, and high viral score (${score}/100) on attempt ${attempt} — using it for this video.`);
            return { outline: candidate, newlyDiscovered: candidate, topic };
          }
          log(`  Fact verified but viral score (${score}/100) below ${HIGH_SCORE_THRESHOLD} — keeping as best-so-far, trying for something stronger.`);
        }
      }
    } catch (e) {
      log(`  WARNING: attempt ${attempt} failed (${e.message}).`);
    }
  }

  if (bestCandidate) {
    log(`  No candidate reached the ${HIGH_SCORE_THRESHOLD}+ bar after ${maxAttempts} attempts — using the best one found (score ${bestScore}/100, topic "${bestTopic}") rather than failing the run.`);
    return { outline: bestCandidate, newlyDiscovered: bestCandidate, topic: bestTopic };
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
        discoveredFacts: state.discoveredFacts || {},
        usedTopics: state.usedTopics || {}
      };
    } catch (e) {}
  }
  return { usedTitles: [], runCount: 0, discoveredFacts: {}, usedTopics: {} };
}

// Safety net: Google's Chirp 3: HD voice rejects any single "sentence" (text
// between periods) that's too long. Groq is prompted to add periods between
// sentences, but LLMs don't always follow formatting instructions exactly —
// this guarantees no run of text exceeds maxLen without a period, by forcing
// one in at the nearest comma if needed.
function ensureSentenceBreaks(text, maxLen = 140) {
  const ELLIPSIS_PLACEHOLDER = '\u0001E\u0001';
  const protectedText = text.replace(/\.\.\./g, ELLIPSIS_PLACEHOLDER);
  const parts = protectedText.split(/(?<=\.)\s*|\n+/);
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
  return fixed.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().split(ELLIPSIS_PLACEHOLDER).join('...');
}

// Fixed, guaranteed-correct emoji per category — the model was asked to
// freely choose a "contextually fitting" emoji before, but even with a
// corrective example already in the prompt (explicitly: bacteria fact ->
// 🦠, not 🐟), it still picked wrong ones. A model apparently can't be
// prompted into reliable word-to-emoji matching for Telugu content, so
// this is deterministic instead — category-level relevance, zero risk of
// a wrong pick.
// Re-enabled spoken CTA, appended AFTER metadata extraction (so it never
// pollutes title/hook generation) and AFTER the punctuation optimizer (so
// it can't be rewritten/mangled by that pass). Uses "ఫాలో" not
// "సబ్‌స్క్రైబ్" deliberately — main()'s CTA-detection logic keys off the
// literal substring "సబ్‌స్క్రైబ్" to fold a CTA sentence's time into the
// last slide with no image of its own; using a different word here lets
// this sentence flow through the normal per-sentence pipeline instead, so
// it gets its own TTS clause AND its own matching image, per request.
const SPOKEN_CTA_SENTENCE = 'ఇలాంటి మరిన్ని amazing facts కోసం మన ఛానల్ ని ఫాలో చేయండి!';

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

// Strips the "హుక్:/వివరణ:/Twist:" labels and flattens the outline into one
// compact line — used ONLY as Stage-2 grounding text. The JSON beats already
// carry the hook/question/reveal/twist/ending structure, so Stage-2 doesn't
// need the outline's own labels repeated a second time; it only needs the
// underlying facts (names/numbers) available to stay accurate while
// expanding. Other callers (verifyFactOutline, checkFactSaturation, image
// keyword lookup) still receive the full labeled outline — they parse or
// display those labels directly.
function compactOutlineForGrounding(outline) {
  return outline
    .replace(/హుక్:\s*/g, '')
    .replace(/వివరణ:\s*/g, ' ')
    .replace(/Twist:\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// CALL A of Stage 2: narration ONLY — no title, no keywords, no hook, no
// labels, no structural markers. A real debug run proved beats/JSON/
// parsing were all correct, but the OLD combined prompt (asking for
// narration + title + keywords + hook + markers + formatting all at once)
// caused the model to barely expand the beats at all (27 words instead of
// 85-115) — isolating just the narration task fixes the actual diagnosed
// problem instead of guessing at more prompt wording.
function buildNarrationPrompt(category, recentTitles, outline, beats) {
  const avoidLine = recentTitles.length
    ? `\n\nఇటీవల వాడిన వీడియోల title/hook patterns ఇవి — వాటి sentence pattern, opening, comparison, twist లేదా ending ని copy చేయకు: ${recentTitles.slice(-10).join(' | ')}`
    : '';
  const { min, max } = WORD_COUNT_TARGETS[category];
  const beatsJSON = JSON.stringify(beats);

  return `కింద ఇచ్చిన VERIFIED FACT మరియు STORY BEATS ఆధారంగా ఒక original Telugu YouTube Shorts narration రాయి.

STORY BEATS:
${beatsJSON}

VERIFIED FACT — ACCURACY GROUNDING:
${compactOutlineForGrounding(outline)}

నీ ROLE:
నువ్వు Telugu YouTube Shorts కోసం high-retention storyteller. Fact ని textbook, documentary లేదా news-reader లాగా explain చేయకూడదు. Viewer ఒక friend దగ్గర unbelievable fact వింటున్నట్టు natural spoken Telugu లో చెప్పాలి.

TARGET RHYTHM — THIS IS IMPORTANT:
- Narration ఒక paragraph లాగా ఉండకూడదు. ఖచ్చితంగా 12-18 short spoken lines గా రాయి.
- ప్రతి line ఒక ప్రత్యేకమైన, సహజమైన spoken beat కావాలి; సాధారణంగా 2-10 తెలుగు పదాలు.
- Line break ను punctuation కంటే ముఖ్యమైన pacing signal గా భావించు. ప్రతి line ను కొత్త visual/voice beat లాగా రాయి.
- ఒక line లో ఒక్క grammatical thought మాత్రమే ఉండాలి. Commaలతో 3-4 clauses ని ఒకే sentence లో కలపవద్దు.
- Fragment కావాల్సిన suspense lines మాత్రమే fragment గా ఉండొచ్చు; మిగతా lines సహజమైన పూర్తి తెలుగు వాక్యాలుగా ఉండాలి.
- ప్రతి 1-2 lines తర్వాత కొత్త information/reveal/curiosity ఇవ్వాలి.
- Hook → curiosity → reveal → surprising detail → twist → memorable ending.
- Viewer కి "తర్వాత ఏమిటి?" అనిపించేలా information ని step-by-step reveal చేయి.

STYLE EXAMPLES — words/facts copy చేయకూడదు. Rhythm, pacing, suspense pattern మాత్రమే follow చేయాలి.

Example A:
🤯 మీరు అమెరికాకు WhatsApp మెసేజ్ పంపితే...
అది నిజంగా...
శాటిలైట్ ద్వారా వెళ్తుందని అనుకుంటున్నారా?
కాదు...
అసలు విషయం ఏంటంటే...
ప్రపంచంలోని దాదాపు 95% అంతర్జాతీయ ఇంటర్నెట్ ట్రాఫిక్...
సముద్రం అడుగున ఉన్న కేబుల్స్ ద్వారానే వెళ్తుంది!
ఇంకా షాక్ ఏంటంటే...
ఈ కేబుల్స్ మొత్తం పొడవు...
12 లక్షల కిలోమీటర్లకు పైగా ఉంటుంది!
అంటే...
భూమిని దాదాపు 30 సార్లు చుట్టేయగలంత!

Example B:
🤯 మూడు వేల ఏళ్ల నాటి ఆహారం...
ఇప్పటికీ చెడిపోకుండా ఉంటే నమ్ముతారా?
కానీ...
ఇది కల్పిత కథ కాదు.
అసలు విషయం ఏంటంటే...
అది తేనె.
ఇంకా ఆశ్చర్యం ఏంటంటే...
దాన్ని నిలబెట్టేది...
దాని సహజ లక్షణాలే!
అందుకే...
తేనె ఇతర ఆహారాల్లా సులభంగా చెడిపోదు.

IMPORTANT:
- పై examples లోని exact wording, facts, numbers లేదా sentence sequence copy చేయకు.
- Personal scenario తప్పనిసరి కాదు. Fact కి సహజంగా సరిపోతే మాత్రమే వాడు. Forced food/drink/family/daily-life examples పూర్తిగా వద్దు.
- ప్రతి script లో "అనుకుంటున్నారా? కాదు..." వాడాల్సిన అవసరం లేదు. Natural గా సరిపోతే మాత్రమే వాడు.
- "కానీ...", "అసలు విషయం ఏంటంటే...", "ఇంకా షాక్ ఏంటంటే...", "అయితే..." వంటి transitions ని variety తో, అవసరమైనప్పుడు మాత్రమే వాడు. ప్రతి line కి కాదు.
- Number ఉంటే మాత్రమే, viewer కి imagine చేయడం కష్టంగా ఉన్నప్పుడు comparison ఇవ్వు. ప్రతి సంఖ్యకీ comparison వద్దు.
- Fact కి natural consequence లేకపోతే consequence కల్పించవద్దు.
- కొత్త fact, number, example, location, person, comparison లేదా claim కల్పించకూడదు. VERIFIED FACT మరియు beats లో ఉన్న information మాత్రమే expand చేయి.
- Fact ని మొదటి 1-2 lines లో పూర్తిగా reveal చేయవద్దు.
- Filler explanation, generic moral, textbook wording వద్దు.
- "గణనీయంగా", "సామర్థ్యం", "ఇది సూచిస్తుంది", "అందువల్ల", "దీనివల్ల" వంటి formal wording అవసరం లేకపోతే వాడవద్దు.
- Same sentence pattern ని వరుసగా repeat చేయవద్దు.
- Source fact లో ఉన్న terminology ని తప్పుగా simplify చేయవద్దు.
- Technical term అవసరమైతే మాత్రమే English/technical word వాడు; Telugu sentence లో random English words కలపవద్దు.
- Fact యొక్క core claim ని మార్చవద్దు: ఉదాహరణకు refining/filtering process ని 'ఆ పదార్థంతో తయారవుతుంది' అని చెప్పవద్దు.
- ASCII digits అసలు వాడవద్దు. అన్ని సంఖ్యలను సహజమైన తెలుగు మాటల్లోనే రాయి. ఉదా: 2000 → రెండు వేల, 19వ శతాబ్దం → పంతొమ్మిదో శతాబ్దం, 3,000 → మూడు వేల.
- Source లో 'some', 'certain', 'may', 'can' వంటి పరిమితి ఉంటే narration లో దాన్ని 'అన్నీ', 'ఎప్పుడూ', 'ఖచ్చితంగా' అని overclaim చేయవద్దు.

RETENTION RULE:
ప్రతి line తర్వాత వచ్చే line కి curiosity ఉండాలి. ఒక sentence ని తీసేసినా story మీద ప్రభావం లేకపోతే ఆ sentence ని rewrite చేయి.

PUNCTUATION:
- "." = పూర్తి thought ముగిసినప్పుడు మాత్రమే.
- "," = చిన్న natural breath.
- "..." = suspense, reveal లేదా emotional pause కోసం మాత్రమే.
- "..." ని ప్రతి line కి పెట్టవద్దు; సాధారణంగా 2-3 sentences కి ఒకసారి కంటే ఎక్కువ కాదు.
- Line breaks ని spoken rhythm కోసం ఉపయోగించవచ్చు.

LENGTH:
- ఖచ్చితంగా ${min}-${max} తెలుగు పదాలు.
- 85-115 words target range లో content complete గా, rushed కాకుండా ఉండాలి.
- 8 పదాల fragments మాత్రమే అని force చేయవద్దు; natural short sentences వాడు.

LANGUAGE:
- సహజమైన మాట్లాడే తెలుగు.
- Telugu script మాత్రమే; Romanized Telugu వద్దు.
- CTA, title, labels, emoji, markdown వద్దు.
- Final answer పంపే ముందు silently grammar, natural spoken Telugu, factual scope, number formatting, మరియు line-by-line pacing check చేయి.
- Script చివరి line fact-specific memorable takeaway కావాలి; generic moral లేదా subscribe request వద్దు.
${avoidLine}

కేవలం final narration text మాత్రమే ఇవ్వు.`;
}

// CALL B of Stage 2: metadata extraction from the ALREADY-FINISHED
// narration — a much simpler task (summarize existing text) than
// generating everything simultaneously.
// Speech Punctuation Optimizer — a focused, separate call that ONLY
// adjusts punctuation (period/comma/ellipsis placement) on an
// already-finished script, without changing any words. Writing good
// content and pacing it for natural speech are different skills (like a
// screenwriter vs. a dialogue coach) — real scripts kept showing
// punctuation bugs (periods splitting compound words, ellipsis overused
// or underused) even with detailed in-prompt rules, so isolating this as
// its own task should be more reliable than asking one call to do both.
function buildPunctuationOptimizerPrompt(script) {
  return `కింద ఇచ్చిన తెలుగు స్క్రిప్ట్ లో **పదాలు ఏమీ మార్చకుండా, కేవలం punctuation మాత్రమే** సరిచేయి — ఇది ఒక human narrator సహజంగా మాట్లాడేటట్టు వినిపించాలి:

${script}

నియమాలు:
- **"." (period):** ఒక పూర్తి ఆలోచన ముగిసిన చోటే. ఎప్పుడూ వాక్యం మధ్యలో, ఒక పదబంధం మధ్యలో, లేదా క్రియకి ముందు వద్దు.
- **"," (comma):** ఒక వాక్యంలో రెండు సంబంధిత భావాలు ఉన్నప్పుడు, చిన్న breath కోసం.
- **"..." (ellipsis):** suspense/surprise/emotional pause కోసం మాత్రమే — reveal కి ముందు వాడు. **ప్రతి 2-3 వాక్యాలకు ఒకసారి కన్నా ఎక్కువ వాడకు** — overuse చేస్తే artificial గా వినిపిస్తుంది. **"మీకు తెలుసా", "మీరు నమ్మగలరా" వంటి opening interjection తర్వాత ఎప్పుడూ "," బదులు "..." వాడు** — ఉదా. "మీకు తెలుసా, వైకింగ్స్‌లు..." అనేది వ్యాసం చదివినట్టు వినిపిస్తుంది; "మీకు తెలుసా... వైకింగ్స్‌లు..." అనేది storyteller ఆగి చెప్తున్నట్టు వినిపిస్తుంది — ఇదే target.
- **ఏ line merge చేయకు, ఏ line split చేయకు. Original line breaks సంఖ్య మరియు క్రమం తప్పనిసరిగా అలాగే ఉంచు.**\n- **కొత్త \'?\' (question mark) ఎప్పుడూ జోడించకు, తీసేయకు. Script లో ఇప్పటికే ఎన్ని \'?\' ఉన్నాయో అన్నే ఉండాలి — ఒక పొడవైన వాక్యాన్ని రెండు ప్రశ్నలుగా విడగొట్టడానికి కూడా కొత్త \'?\' పెట్టకు; అలాంటప్పుడు \'.\' లేదా \',\' తోనే విడగొట్టు.**
- పదాలు ఒక్కటి కూడా జోడించకు, తీసేయకు, మార్చకు — కేవలం punctuation మాత్రమే మార్చు..

కేవలం సరిచేసిన స్క్రిప్ట్ టెక్స్ట్ మాత్రమే ఇవ్వు — వేరే ఏమీ ముందు/వెనుక రాయకు, వివరణ వద్దు.`;
}

// Defensive check: the optimizer should ONLY touch punctuation, but LLMs
// occasionally rewrite more than asked. Compares word content (punctuation
// stripped) between original and optimized — if they differ beyond a small
// tolerance, the optimization is rejected in favor of the original
// (unoptimized-but-correct is safer than a silently corrupted rewrite).
function wordsPreserved(original, optimized) {
  const stripPunct = (s) => s.replace(/[.,…!?"']/g, '').replace(/\.\.\./g, '').split(/\s+/).filter(Boolean);
  const originalWords = stripPunct(original);
  const optimizedWords = stripPunct(optimized);
  const diff = Math.abs(originalWords.length - optimizedWords.length);
  return diff <= Math.max(3, Math.ceil(originalWords.length * 0.05)); // allow small tolerance (~5%, min 3 words)
}

function buildNumberOptimizerPrompt(script) {
  return `కింద ఇచ్చిన తెలుగు స్క్రిప్ట్ లో ఆంగ్ల అంకెలుగా (0-9 digits) రాసిన ప్రతి సంఖ్యను తెలుగు మాటల్లోకి మార్చు — వేరే ఏమీ మార్చకు:

${script}

నియమాలు:
- ప్రతి అంకెల సంఖ్యను (సంవత్సరాలు, లెక్కలు, శాతం, కొలతలు సహా) తెలుగు మాటల్లోకి మార్చు — **సాధారణ నియమం (తెలుగు లక్ష/కోటి పద్ధతిలో — ఆంగ్ల million పద్ధతిలో కాదు):** పెద్ద భాగం నుండి చిన్న భాగం వరకు వరుసగా చెప్పు, ప్రతి భాగం 0 అయితే పూర్తిగా వదిలేయి — కోట్ల భాగం (సరిగ్గా 1 కోటి అయితే 'కోటి', ఎక్కువైతే 'X కోట్లు'), లక్షల భాగం (సరిగ్గా 1 లక్ష అయితే 'లక్ష', ఎక్కువైతే 'X లక్షలు'), వేల భాగం (సరిగ్గా 1000 అయితే ఎప్పుడూ 'వెయ్యి' — 'ఒక్కటి వేల' అని ఎప్పుడూ రాయకు, ఎక్కువైతే 'X వేల'), వందల భాగం (0 కాకుండా ఉంటేనే 'Y వందల'), చివరగా పదులు+units భాగం (0 కాకుండా ఉంటేనే) — మధ్యలో ఉన్న సున్నా భాగాలను ఎప్పుడూ 'సున్నా' అని పలకవద్దు లేదా అంకెలవారీగా చదవకు. 'వంద వేల' అని ఎప్పుడూ రాయకు — అది 'లక్ష'. ఉదా: 1920 → వెయ్యి తొమ్మిది వందల ఇరవై, 24 → ఇరవై నాలుగు, 1000 → వెయ్యి, 1009 → వెయ్యి తొమ్మిది, 1500 → వెయ్యి ఐదు వందల, 2000 → రెండు వేల, 10000 → పది వేల, 100000 → లక్ష, 150000 → లక్ష యాభై వేల, 500000 → ఐదు లక్షలు, 10000000 → కోటి.
- మినహాయింపు: మోడల్/వెర్షన్ పేర్లలో భాగమైన సంఖ్యలు మాత్రమే అలాగే ఉంచు (ఉదా. 'AES 256', 'iOS 15' — ఇవి పేర్లు, పరిమాణాలు కావు; మధ్యలో హైఫన్ మాత్రం వద్దు — 'AES-256' కాదు, 'AES 256' — హైఫన్ సంఖ్యకి ఆనుకుని ఉంటే TTS దాన్ని 'మైనస్' అని చదువుతుంది).
- సంఖ్యలు తప్ప వేరే ఏ పదం జోడించకు, తీసేయకు, మార్చకు. Punctuation, line breaks, sentence structure — అన్నీ ఖచ్చితంగా అలాగే ఉంచు.

కేవలం సరిచేసిన స్క్రిప్ట్ టెక్స్ట్ మాత్రమే ఇవ్వు — వేరే ఏమీ ముందు/వెనుక రాయకు, వివరణ వద్దు.`;
}

// The punctuation optimizer's wordsPreserved() assumes a punctuation-only
// edit, but spelling a number out in Telugu genuinely adds words (1920 -> 4
// words, and a lakh/crore-scale number like 1234567 -> up to 9 words:
// "పన్నెండు లక్షల ముప్పై నాలుగు వేల ఐదు వందల అరవై ఏడు") — a flat 5%
// tolerance would reject legitimate conversions on a script with more than
// one or two numbers. Budgets extra room per actual digit-run found, on top
// of the same baseline tolerance, so the check stays tight for anything else
// the model might try to sneak in.
function numbersPreserved(original, optimized, digitMatchCount) {
  const stripPunct = (s) => s.replace(/[.,…!?"']/g, '').replace(/\.\.\./g, '').split(/\s+/).filter(Boolean);
  const diff = Math.abs(stripPunct(original).length - stripPunct(optimized).length);
  const budget = Math.max(3, Math.ceil(stripPunct(original).length * 0.05)) + digitMatchCount * 9;
  return diff <= budget;
}

function buildTenglishOptimizerPrompt(script) {
  return `కింద ఇచ్చిన తెలుగు స్క్రిప్ట్ ప్రస్తుతం పూర్తిగా అచ్చ (శుద్ధ) తెలుగులో ఉంది — ఇది కొన్నిసార్లు వ్యాసం చదివినట్టు, textbook లా వినిపిస్తుంది. నిజమైన తెలుగు YouTube content మాట్లాడేటట్టు, **కింద చెప్పిన 2 రకాల పదాలను మాత్రమే** ఆంగ్లంలోకి మార్చు:

${script}

మార్చవలసినవి — ఇవి మాత్రమే:
1. reaction/intensifier పదాలు — ఉదా. "ఆసక్తికరమైన/ఆసక్తికరంగా" → "interesting", "ఆశ్చర్యకరమైన" → "shocking" లేదా "surprising", "అద్భుతమైన" → "amazing".
2. రోజువారీ తెలుగు పదం లేని modern/technical/scientific పదాలు (ఉదా. quantum, encryption, AI, electron) — ఇవి ఇప్పటికే ఆంగ్లంలో ఉంటే మార్చకుండా అలాగే ఉంచు.

ఖచ్చితమైన నియమాలు:
- పైన చెప్పిన 2 రకాలు తప్ప వేరే ఏ పదం మార్చకు — సూర్యుడు, నీళ్లు, పెద్ద, చిన్న లాంటి రోజువారీ తెలుగు పదాలను ఎప్పుడూ ఆంగ్లంలోకి మార్చకు.
- ఏ వాక్యాన్ని పూర్తిగా ఆంగ్లంలోకి మార్చకు — grammar, verbs, sentence structure ఖచ్చితంగా తెలుగులోనే ఉండాలి. ఆంగ్ల పదం వాక్యం మధ్యలో ఒక్కటే వాడు (ఉదా. "ఇది చాలా interesting విషయం" — ఇలా), పూర్తి వాక్యం ఆంగ్లంలో వద్దు.
- స్క్రిప్ట్‌లో పైన చెప్పిన 2 రకాల పదాలు అసలు లేకపోతే, ఏమీ మార్చకుండా స్క్రిప్ట్‌ని అలాగే యథాతథంగా తిరిగి ఇవ్వు — బలవంతంగా ఏదైనా ఆంగ్లం జొప్పించకు.
- పదాలు జోడించకు, తీసేయకు — కేవలం పైన చెప్పిన 2 రకాల పదాలను మాత్రమే replace చేయి. Punctuation, line breaks, sentence count, question mark count అన్నీ ఖచ్చితంగా అలాగే ఉంచు.

కేవలం సరిచేసిన స్క్రిప్ట్ టెక్స్ట్ మాత్రమే ఇవ్వు — వేరే ఏమీ ముందు/వెనుక రాయకు, వివరణ వద్దు.`;
}

// Catches a runaway full-English rewrite: the Tenglish pass should swap a
// handful of individual words, not translate whole sentences. If the
// proportion of Telugu-script characters drops sharply, something went much
// further than asked — reject regardless of what the other checks say.
function teluguRatioPreserved(original, optimized) {
  const teluguChars = (s) => (s.match(/[ఀ-౿]/g) || []).length;
  const totalChars = (s) => s.replace(/\s/g, '').length;
  const originalRatio = teluguChars(original) / Math.max(1, totalChars(original));
  const optimizedRatio = teluguChars(optimized) / Math.max(1, totalChars(optimized));
  return optimizedRatio >= originalRatio * 0.75;
}

// A real shipped script (run #292) contained "సముద్రపు వర్షాభి" — "వర్షాభి"
// is not a real Telugu word at all (likely a garbled/truncated attempt at
// "వర్షారణ్యాలు", the "rainforests of the sea" metaphor for coral reefs) —
// and, separately, "జీవ వైవిధ్యం ఎలా పేలుతుంది" used "పేలుతుంది" (lit.
// "explodes/bursts", normally for bombs/tires/anger) on biodiversity, which
// no existing check caught since it's grammatically well-formed, just
// semantically wrong. None of grounded()/styleErrors() (notation/number
// rules) or the digit/Tenglish passes above check whether a word is a real,
// correctly-used Telugu word at all — that gap is what this pass targets.
//
// A follow-up real shipped script (run #293) then slipped past the first
// version of this check entirely: its hook asked "ఒకే చిత్రాన్ని చూసి మన
// మెదడు సజీవం లేదా చల్లటి అనిపించగలదా?" — "సజీవం" ("alive") is a perfectly
// real, plausible Telugu word taken alone, so a word-by-word isolated check
// passed it. Only reading the REST of the script reveals the fact is
// specifically about warm-vs-cool color perception ("వెచ్చని ఎరుపు... చల్లని
// నీలం" appears two sentences later, and the separately-generated Title even
// correctly says "ఉష్ణత" i.e. temperature) — "సజీవం" should have been
// "వెచ్చగా/వేడిగా" (warm). This is a distinct, harder failure mode: a word
// that is individually fine but contradicts the theme/claim the rest of the
// SAME script establishes. Category 3 below targets this specifically by
// requiring the whole script be read first, before judging any one sentence.
// Same non-blocking architecture as the digit/Tenglish passes: a narrow,
// single-purpose review call with a tight preservation check, falling back
// to the original script on any doubt.
function buildWordValidityOptimizerPrompt(script) {
  return `కింద ఇచ్చిన తెలుగు స్క్రిప్ట్ ని మొదట పూర్తిగా చదివి, ఇది దేని గురించో (అసలు fact/theme ఏంటో) అర్థం చేసుకో. తర్వాత మళ్ళీ పదం పదం గా చదివి, ప్రతి పదం (a) నిజంగా ఉన్న తెలుగు పదమేనా, (b) ఆ ఒక్క వాక్యం context లో సరైన అర్థంతో వాడబడిందా, మరియు (c) స్క్రిప్ట్ మొత్తం ఏర్పరిచే theme/claim కి విరుద్ధంగా లేదా అని verify చేయి:

${script}

వెతకవలసిన 3 రకాల తప్పులు:
1. నిజంగా లేని/విరిగిపోయిన/అర్థం లేని పదం (garbled లేదా invented word) — ఉదా. గతంలో ఒక script లో "సముద్రపు వర్షాభి" అని వచ్చింది, కానీ "వర్షాభి" తెలుగులో నిజమైన పదమే కాదు (బహుశా "వర్షారణ్యాలు" అనే పదం అసంపూర్తిగా వచ్చింది) — సరైనది: "సముద్రపు వర్షారణ్యాలు" (rainforests of the sea).
2. నిజమైన తెలుగు పదమే, కానీ ఆ ఒక్క వాక్యం context కి సరిపోని/అసహజమైన అర్థంలో వాడబడింది — ఉదా. గతంలో "జీవ వైవిధ్యం ఎలా పేలుతుంది?" అని వచ్చింది — "పేలడం" అంటే బాంబు/టైర్ పేలడం లాంటి అర్థం, జీవవైవిధ్యానికి సరిపోదు — సరైనది: "జీవ వైవిధ్యం ఎలా పొంగిపొర్లుతుంది?" (thrives/overflows అనే సహజమైన అర్థం).
3. ఆ వాక్యంలో ఒంటరిగా చూస్తే సరైనట్టు అనిపించే నిజమైన పదమే, కానీ స్క్రిప్ట్‌లో మిగతా చోట్ల ఏర్పడే అసలు theme/fact కి విరుద్ధంగా ఉంది — ఉదా. గతంలో ఒక script హుక్ లో "ఒకే చిత్రాన్ని చూసి మన మెదడు సజీవం లేదా చల్లటి అనిపించగలదా?" అని వచ్చింది — "సజీవం" (alive) అనేది నిజమైన పదమే, ఆ వాక్యం ఒంటరిగా చదివితే తప్పు అనిపించదు, కానీ ఆ స్క్రిప్ట్ మొత్తం "వెచ్చని (warm) vs చల్లని (cool) రంగు perception" గురించి — తర్వాతి వాక్యాల్లో "వెచ్చని ఎరుపు", "చల్లని నీలం" అని స్పష్టంగా ఉంది — కాబట్టి "సజీవం" కి బదులు "వెచ్చగా" లేదా "వేడిగా" రావాలి, ఎందుకంటే "చల్లటి" కి సహజ వ్యతిరేక పదం అదే, "సజీవం" కాదు. ఇలాంటి తప్పుని పట్టుకోవాలంటే స్క్రిప్ట్ మొత్తం చదివిన తర్వాతే ఏ ఒక్క వాక్యాన్ని judge చేయాలి, వాక్యాన్ని ఒంటరిగా చూసి కాదు.

ఖచ్చితమైన నియమాలు:
- పైన చెప్పిన 3 రకాల తప్పులు ఉన్న చోట మాత్రమే, ఆ ఒక్క పదం/పదబంధాన్ని మాత్రమే సరైన, సహజమైన, స్క్రిప్ట్ యొక్క నిజమైన theme కి సరిపోయే తెలుగు పదం/పదబంధంతో replace చేయి — వాక్యంలో మిగతా భాగం ఖచ్చితంగా అలాగే ఉంచు.
- స్క్రిప్ట్‌లో ఇలాంటి తప్పు ఏమీ లేకపోతే, ఏమీ మార్చకుండా స్క్రిప్ట్‌ని అలాగే యథాతథంగా తిరిగి ఇవ్వు — అనవసరంగా ఏదైనా మార్చకు, రీ-రైట్ చేయకు.
- సంఖ్యలు, పేర్లు, ఆంగ్ల technical పదాలు, English loanwords (అవి ఇప్పటికే సరైనవే అయితే) వీటిని ముట్టుకోకు.
- పదాలు మొత్తం సంఖ్య పెద్దగా మారకూడదు — వాక్య నిర్మాణం, పదాల క్రమం, sentence/line count, '?' సంఖ్య అన్నీ ఖచ్చితంగా అలాగే ఉంచు.

కేవలం సరిచేసిన స్క్రిప్ట్ టెక్స్ట్ మాత్రమే ఇవ్వు — వేరే ఏమీ ముందు/వెనుక రాయకు, వివరణ వద్దు.`;
}

function buildMetadataPrompt(script) {
  return `కింద ఇచ్చిన తెలుగు narration ని చదివి, దాని metadata ఇవ్వు:

${script}

**ముఖ్యం — Title మరియు Hook connected గా ఉండాలి:** ముందు HOOK ని ఈ narration యొక్క **మొదటి 1-2 వాక్యాల్లో ఉన్న అసలైన ఆలోచననే** (కొత్తది కల్పించకుండా) తీసుకుని రాయి. తర్వాత TITLE ని **అదే HOOK యొక్క సంక్షిప్త వెర్షన్‌గా** రాయి — TITLE వేరే కోణం (ఉదా. మధ్యలో వచ్చే ఒక వివరం) ఎంచుకోకూడదు, HOOK కి కొనసాగింపుగానే అనిపించాలి.

ఖచ్చితంగా ఈ 4-లైన్ల ఫార్మాట్‌లో మాత్రమే ఇవ్వు, ఇదే క్రమంలో, మరేమీ రాయకు:
HOOK: (ఈ narration మొదటి వాక్యాల్లోని అసలైన ఆలోచననే, 15 తెలుగు పదాల లోపు ప్రశ్నగా రాయి, emoji వద్దు)
TITLE: (పైన రాసిన HOOK యొక్క 5-8 పదాల సంక్షిప్త వెర్షన్, అదే విషయం మీదే, emoji వద్దు)
KEYWORDS: (ఈ కంటెంట్‌కి సరిపోయే 3 నిర్దిష్టమైన, దృశ్యమానమైన ఆంగ్ల keywords — abstract పదాలు కాకుండా (ఉదా. "wisdom", "life" వద్దు), కళ్ళకి కనిపించే నిర్దిష్ట scene/object/action పదాలు వాడు, ఉదా: "elderly woman smiling", "children playing park", "mother holding baby". Content కి నేరుగా సంబంధం ఉండాలి.)
TEASER: (video description లో పెట్టడానికి, ఈ నిర్దిష్ట fact గురించి curiosity పెంచే 1 తెలుగు వాక్యం, 12 పదాల లోపు, చివర్లో ఒక సంబంధిత emoji — fact ని reveal/spoil చేయకూడదు, ఈ video యొక్క నిర్దిష్ట విషయాన్ని (పైన TITLE లో ఉన్నదే) ప్రస్తావించాలి, వేరే వీడియోలకి కూడా వర్తించే generic వాక్యం రాయకూడదు)`;
}

function parseMetadata(raw) {
  const titleMatch = raw.match(/TITLE:\s*(.+)/i);
  const keywordsMatch = raw.match(/KEYWORDS:\s*(.+)/i);
  const hookMatch = raw.match(/HOOK:\s*(.+)/i);
  const teaserMatch = raw.match(/TEASER:\s*(.+)/i);
  return {
    title: titleMatch ? titleMatch[1].trim() : null,
    keywords: keywordsMatch ? keywordsMatch[1].trim() : null,
    hookEmoji: hookMatch ? hookMatch[1].trim() : null,
    teaser: teaserMatch ? teaserMatch[1].trim() : null
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// gpt-oss-120b (not llama-3.3-70b, which has a reported Aug 16, 2026
// deprecation date on Groq) — we have direct prior experience with
// gpt-oss-120b successfully producing valid output, even though it needs
// the <think>-stripping below. Our narration prompt already carries the
// specific storytelling techniques (fact-specific curiosity,
// reveal pacing, natural spoken Telugu, and no forced scenarios)
// that actually drive output style — switching providers doesn't change
// this prompt, which is intentional per explicit user discussion.
const GROQ_MODEL = 'openai/gpt-oss-120b';
// Fallback: openai/gpt-oss-20b — Groq's own official docs list this as a
// currently-supported, actively-recommended model. Deliberately NOT
// qwen/qwen3.6-27b (explicitly marked "preview, not production" by Groq's
// own docs, AND confirmed via this project's own earlier testing to
// produce corrupted Telugu — English fragments spliced mid-word). Same
// gpt-oss family as primary, so likely shares similar language handling.
const GROQ_FALLBACK_MODEL = 'openai/gpt-oss-20b';
// Only the primary's DAILY limit triggers a switch (remembered for the
// rest of the run) — kept to this one clear condition rather than the
// multi-condition trigger logic (rate-limit + payment-required + ...) that
// caused real bugs during the Cerebras attempt.
let primaryModelExhaustedThisRun = false;

async function callLLM(prompt, attempt = 1, model = (primaryModelExhaustedThisRun ? GROQ_FALLBACK_MODEL : GROQ_MODEL)) {
  const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 6000
    })
  });
  const data = await res.json();

  if (!data.choices || !data.choices[0]) {
    const errorMessage = (data.error && data.error.message) || '';
    const isRateLimit = data.error && data.error.code === 'rate_limit_exceeded';
    const isDailyLimit = /tokens per day|TPD/i.test(errorMessage);

    if (isRateLimit && isDailyLimit) {
      if (model === GROQ_MODEL) {
        primaryModelExhaustedThisRun = true;
        log(`WARNING: "${GROQ_MODEL}" daily limit reached — switching to fallback model "${GROQ_FALLBACK_MODEL}" for the rest of this run.`);
        return callLLM(prompt, 1, GROQ_FALLBACK_MODEL);
      }
      // Fallback's daily budget is ALSO exhausted — the reset window can
      // be hours away, so retrying here would just waste time before
      // failing anyway. Fail fast with a clear message instead.
      throw new Error(`Groq DAILY token limit reached on both "${GROQ_MODEL}" and fallback "${GROQ_FALLBACK_MODEL}" — this run cannot continue today. ${errorMessage}`);
    }

    // Per-minute rate limit is short-lived — a brief wait and retry
    // succeeds almost every time.
    if (isRateLimit && attempt <= 3) {
      const waitMs = 15000 * attempt; // 15s, 30s, 45s
      log(`WARNING: Groq rate limit hit (attempt ${attempt}/3) — waiting ${waitMs / 1000}s before retrying.`);
      await sleep(waitMs);
      return callLLM(prompt, attempt + 1, model);
    }
    throw new Error(`Groq did not return content (model: ${model}): ` + JSON.stringify(data));
  }

  let content = (data.choices[0].message.content || '').trim();
  // Defensive safety net: strip any stray <think>...</think> block —
  // gpt-oss models are known to leak their reasoning/planning text without
  // this.
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!content) {
    throw new Error('Groq returned an empty response (finish_reason: ' + (data.choices[0].finish_reason || 'unknown') + ')');
  }
  // Small proactive spacing after every call, throttling our own request
  // rate across a run's multiple calls.
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
  const prompt = `కింద ఇచ్చిన VERIFIED FACT నుండి Telugu YouTube Shorts కోసం STORY BEATS తయారు చేయి.

VERIFIED FACT:
${outline}

ఇది fact summary కాదు. ఒక viewer మొదటి line నుంచి చివరి line వరకు వినేలా curiosity-driven story skeleton తయారు చేయాలి.

5 beats మాత్రమే:
- hook: మొదటి 1-2 seconds లో attention ఆపే surprising idea. Fact ని పూర్తిగా reveal చేయకు.
- question: viewer కి సహజంగా వచ్చే "ఎందుకు? ఎలా? నిజమేనా?" అనే curiosity.
- reveal: అసలు verified fact యొక్క core answer.
- twist: అదే fact లో అత్యంత unexpected, genuinely interesting detail.
- ending: strongest memorable takeaway. Artificial consequence లేదా generic moral వద్దు.

RULES:
- ప్రతి value 3-8 చిన్న తెలుగు పదాల phrase మాత్రమే; పూర్తి sentence/script కాదు.
- ప్రతి beat తర్వాత వచ్చే beat వినాలనే curiosity ఉండాలి.
- Personal scenario అవసరం లేదు; fact కి సహజంగా సరిపోతే మాత్రమే సూచించు.
- ప్రతి number కి comparison అవసరం లేదు.
- కొత్త facts, numbers, examples, names లేదా claims కల్పించకు.
- hook లోనే answer మొత్తం చెప్పవద్దు.
- generic phrases เช่น "ఇది మనల్ని ఆశ్చర్యపరుస్తుంది", "ఇది చాలా ఆసక్తికరం" వద్దు.
- textbook explanation వద్దు.

ఖచ్చితంగా ఈ JSON object మాత్రమే ఇవ్వు — ముందు/వెనుక ఏమీ రాయకు:
{"hook":"...","question":"...","reveal":"...","twist":"...","ending":"..."}`;

  let raw = await callLLM(prompt);
  let beats = tryParseStoryBeatsJSON(raw);

  if (!beats) {
    log('WARNING: story beats response was not valid JSON — retrying once with a stricter reminder.');
    const retryPrompt = `${prompt}\n\nనీ మునుపటి జవాబు valid JSON కాదు. ఖచ్చితంగా 5 keys ఉన్న ఒక్క JSON object మాత్రమే ఇవ్వు: {"hook":"...","question":"...","reveal":"...","twist":"...","ending":"..."}`;
    raw = await callLLM(retryPrompt);
    beats = tryParseStoryBeatsJSON(raw);
  }

  if (!beats) {
    log('WARNING: story beats still not valid JSON after retry — falling back to raw text as a single beat.');
    return { hook: raw.trim(), question: '', reveal: '', twist: '', ending: '' };
  }
  return beats;
}

// Extracts and parses the JSON object from the model's reply — tolerant of
// stray text or ```json fences around it, since Groq models don't always
// follow the "JSON only" instruction to the letter. Returns null (never a
// fallback object) on any failure — the caller decides whether to retry or
// degrade, this function's only job is "did we get valid JSON or not".
function tryParseStoryBeatsJSON(raw) {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      hook: (parsed.hook || '').toString().trim(),
      question: (parsed.question || '').toString().trim(),
      reveal: (parsed.reveal || '').toString().trim(),
      twist: (parsed.twist || '').toString().trim(),
      ending: (parsed.ending || '').toString().trim()
    };
  } catch (e) {
    return null;
  }
}

async function generateContent(category, recentTitles, outline) {
  log(`Generating ${category} content via Groq...`);
  const beats = await generateStoryBeats(outline);
  const beatsJSON = JSON.stringify(beats);
  log(`Story beats: ${beatsJSON}`);

  // CALL A: narration only (see buildNarrationPrompt for why this is now
  // separate from title/keywords/hook generation).
  const narrationPrompt = buildNarrationPrompt(category, recentTitles, outline, beats);
  let script = (await callLLM(narrationPrompt)).trim();

  // The many formatting/punctuation rules can sometimes cause the model to
  // under-shoot the word count badly. Retry (up to 2 extra attempts) with
  // the word count called out more forcefully — and critically, keep
  // retrying until the target is actually met, not just "longer than the
  // previous attempt" (a bug: a 40-word retry over a 20-word original
  // passed the old "improved" check while still being far short of
  // target).
  const target = WORD_COUNT_TARGETS[category];
  let wordCount = script.split(/\s+/).filter(Boolean).length;
  let bestScript = script, bestWordCount = wordCount;

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
    const retryPrompt = tooLong
      ? `కింద ఇచ్చిన JSON story beats నుండి తెలుగు narration రాయి — ఖచ్చితంగా ${target.min}-${target.max} తెలుగు పదాలు ఉండాలి (మీ మునుపటి ప్రయత్నం ${bestWordCount} పదాలు వచ్చింది, ఇది చాలా ఎక్కువ — వీడియో 80 సెకన్ల లోపు ఉండాలి). ముఖ్యమైన భాగాలనే ఉంచి, సంక్షిప్తంగా చెప్పు:\n\n${beatsJSON}\n\nనియమాలు: JSON లోని beats క్రమాన్నే వాడు, కొత్త కల్పితం జోడించకు. ఖచ్చితంగా తెలుగు లిపిలోనే రాయి. "..." తో dramatic pause ఇస్తూ, 8 పదాల లోపు చిన్న వాక్యఖండాలతో రాయి. CTA/emoji/టైటిల్/లేబుల్స్ వద్దు — కేవలం narration టెక్స్ట్ మాత్రమే.`
      : `కింద ఇచ్చిన JSON story beats నుండి తెలుగులో వివరణాత్మకమైన narration రాయి — ఖచ్చితంగా ${target.min}-${target.max} తెలుగు పదాలు ఉండాలి (మీ మునుపటి ప్రయత్నం కేవలం ${wordCount} పదాలు మాత్రమే వచ్చింది, ఇది చాలా తక్కువ — beats లోని చిన్న పదబంధాలని అలాగే తిరిగి రాయకు, వాటిని పూర్తిగా విస్తరించి, వివరించి ఈ నిడివికి చేరుకో):

${beatsJSON}

నియమాలు: JSON beats క్రమాన్నే విస్తరించి చెప్పు, కానీ వాటిని verbatim గా repeat చేయకు. కొత్త కల్పితం/సంఖ్యలు/examples జోడించకు. Personal scenario fact కి సహజంగా సరిపోతే మాత్రమే వాడు; forced examples వద్దు. Assumption→correction, number comparison, consequence — అవసరమైనప్పుడు మాత్రమే. ప్రతి line తర్వాత curiosity ఉండాలి. Natural spoken Telugu లో short, punchy sentences వాడు. "..." suspense/reveal కోసం మాత్రమే; ప్రతి line కి వద్దు. Period పూర్తి thought ముగిసిన చోటే. CTA/emoji/టైటిల్/లేబుల్స్ వద్దు — కేవలం narration text మాత్రమే ఇవ్వు.`;
    const retryScript = (await callLLM(retryPrompt)).trim();
    const retryWordCount = retryScript.split(/\s+/).filter(Boolean).length;
    log(`  Retry ${retryAttempt} produced ${retryWordCount} words.`);
    wordCount = retryWordCount;
    script = retryScript;
    // Prefer whichever attempt is CLOSEST to the target range, not just
    // "longer than before".
    const distance = (wc) => wc < target.min ? target.min - wc : (wc > target.max ? wc - target.max : 0);
    if (distance(retryWordCount) < distance(bestWordCount)) {
      bestScript = retryScript;
      bestWordCount = retryWordCount;
    }
  }

  // CRITICAL: if the script is essentially empty even after all retries,
  // do NOT proceed — a real run did exactly this (0 words after 2 retries)
  // and still built + uploaded a broken video because this was only ever
  // a warning before. 20 words is well below our normal 85-115 target —
  // this catches "fundamentally broken", not "a bit short".
  const MIN_VIABLE_WORDS = 20;
  if (bestWordCount < MIN_VIABLE_WORDS) {
    throw new Error(`Script generation produced essentially no content after all retries (${bestWordCount} words, need at least ${MIN_VIABLE_WORDS} to be viable) — refusing to build/upload a broken video. Best attempt was: "${bestScript.slice(0, 100)}"`);
  }
  if (bestWordCount < target.min - 15) {
    log(`⚠️ WARNING: after all retries, script is still short (${bestWordCount} words, target ${target.min}-${target.max}) — using the best attempt available. Video will be shorter than intended this time.`);
  } else if (bestWordCount > MAX_SAFE_WORDS) {
    log(`⚠️ WARNING: after all retries, script is still long (${bestWordCount} words, ~80s cap needs under ${MAX_SAFE_WORDS}) — video may run slightly over 80s this time.`);
  }
  script = bestScript;

  // Safety-net correction: numbers written as digits get mispronounced
  // digit-by-digit by TTS ("1920" → "1-9-2-0" instead of "వెయ్యి తొమ్మిది
  // వందల ఇరవై") — verified happening in real generated scripts (e.g. run
  // #284: "1920లో", "24 శాతం") despite the prompt rule against it. A
  // hard-reject-in-the-generation-loop attempt at this (run #285) proved
  // unsafe — under real Groq rate-limit pressure it burned the whole retry
  // budget and failed the run outright when a fact's number resisted
  // rewriting. This is a dedicated, non-blocking correction pass instead
  // (same pattern as the punctuation optimizer above): on any doubt it
  // falls back to the original digit-bearing script with a warning, same
  // as the previous warn-only behavior — never worse, often better.
  if (hasBareDigits(script)) {
    const digitMatchCount = (script.match(/\d{2,}/g) || []).length;
    try {
      const numberPrompt = buildNumberOptimizerPrompt(script);
      const corrected = (await callLLM(numberPrompt)).trim();
      const correctedLineCount = corrected.split(/\n+/).filter(Boolean).length;
      const originalLineCount = script.split(/\n+/).filter(Boolean).length;
      const correctedQuestionCount = (corrected.match(/\?/g) || []).length;
      const originalQuestionCount = (script.match(/\?/g) || []).length;
      const notationError = corrected ? styleErrors(corrected) : '';
      if (corrected && !hasBareDigits(corrected) && numbersPreserved(script, corrected, digitMatchCount) && correctedLineCount === originalLineCount && correctedQuestionCount === originalQuestionCount && !notationError) {
        log(`  Auto-corrected ASCII-digit numbers to Telugu words.`);
        script = corrected;
      } else {
        const reasons = [];
        if (!corrected) reasons.push('empty output');
        if (corrected && hasBareDigits(corrected)) reasons.push('still contains bare digits after correction');
        if (corrected && !numbersPreserved(script, corrected, digitMatchCount)) reasons.push('word count drifted beyond the expected number-expansion budget');
        if (correctedLineCount !== originalLineCount) reasons.push(`line count changed (${originalLineCount} -> ${correctedLineCount})`);
        if (correctedQuestionCount !== originalQuestionCount) reasons.push(`question mark count changed (${originalQuestionCount} -> ${correctedQuestionCount})`);
        if (notationError) reasons.push(`introduced TTS-unsafe notation (${notationError})`);
        log(`⚠️ WARNING: number auto-correction rejected (${reasons.join('; ')}) — keeping the original script with ASCII-digit numbers (TTS will likely mispronounce them digit-by-digit). Rejected output was: ${(corrected || '').slice(0, 300)}`);
      }
    } catch (e) {
      log(`⚠️ WARNING: number auto-correction call failed (${e.message}) — keeping the original script with ASCII-digit numbers (TTS will likely mispronounce them digit-by-digit).`);
    }
  }

  // Optional style pass: natural Tenglish (English) code-mixing for reaction/
  // intensifier words and modern/technical terms with no common Telugu
  // equivalent — user feedback that pure "shuddha Telugu" can sound stiff/
  // textbook for this audience. Two earlier attempts folded this into the
  // giant one-shot generation prompt above (which already juggles 20+
  // competing constraints — word count, grounding, notation, terminology)
  // and it had ZERO measurable effect across two real test runs (#281,
  // #284) — the model never prioritized it there. This is a dedicated,
  // single-purpose pass instead, same architecture as the punctuation and
  // number optimizers above, so it isn't competing with anything else.
  // Purely cosmetic and optional: on any doubt it falls back to the
  // original all-Telugu script — never blocks or fails the run.
  try {
    const tenglishPrompt = buildTenglishOptimizerPrompt(script);
    const styled = (await callLLM(tenglishPrompt)).trim();
    const styledLineCount = styled.split(/\n+/).filter(Boolean).length;
    const scriptLineCount = script.split(/\n+/).filter(Boolean).length;
    const styledQuestionCount = (styled.match(/\?/g) || []).length;
    const scriptQuestionCount = (script.match(/\?/g) || []).length;
    const tenglishNotationError = styled ? styleErrors(styled) : '';
    if (styled && wordsPreserved(script, styled) && teluguRatioPreserved(script, styled) && styledLineCount === scriptLineCount && styledQuestionCount === scriptQuestionCount && !tenglishNotationError) {
      script = styled;
    } else {
      const reasons = [];
      if (!styled) reasons.push('empty output');
      if (styled && !wordsPreserved(script, styled)) reasons.push('word count drifted');
      if (styled && !teluguRatioPreserved(script, styled)) reasons.push('Telugu-character ratio dropped too far (likely rewrote whole sentences into English)');
      if (styledLineCount !== scriptLineCount) reasons.push(`line count changed (${scriptLineCount} -> ${styledLineCount})`);
      if (styledQuestionCount !== scriptQuestionCount) reasons.push(`question mark count changed (${scriptQuestionCount} -> ${styledQuestionCount})`);
      if (tenglishNotationError) reasons.push(`introduced TTS-unsafe notation (${tenglishNotationError})`);
      log(`  Tenglish style pass skipped (${reasons.join('; ')}) — keeping the all-Telugu script (not a defect, just no natural code-mixing this time). Rejected output was: ${(styled || '').slice(0, 400)}`);
    }
  } catch (e) {
    log(`  Tenglish style pass call failed (${e.message}) — keeping the all-Telugu script.`);
  }

  // Word-validity/naturalness pass: catches garbled/non-existent Telugu
  // words and real words used with a semantically wrong meaning for the
  // context — a real shipped script (run #292) had both ("వర్షాభి", a
  // non-word, and "పేలుతుంది"/"explodes" misapplied to biodiversity), and
  // no other check here verifies actual word validity/meaning. Same
  // non-blocking pattern as the digit/Tenglish passes: on any doubt, fall
  // back to the pre-pass script rather than risk a bad rewrite.
  try {
    const validityPrompt = buildWordValidityOptimizerPrompt(script);
    const corrected = (await callLLM(validityPrompt)).trim();
    const correctedLineCount = corrected.split(/\n+/).filter(Boolean).length;
    const scriptLineCount = script.split(/\n+/).filter(Boolean).length;
    const correctedQuestionCount = (corrected.match(/\?/g) || []).length;
    const scriptQuestionCount = (script.match(/\?/g) || []).length;
    const validityNotationError = corrected ? styleErrors(corrected) : '';
    if (corrected && wordsPreserved(script, corrected) && teluguRatioPreserved(script, corrected) && correctedLineCount === scriptLineCount && correctedQuestionCount === scriptQuestionCount && !validityNotationError) {
      if (corrected !== script) log(`  Word-validity pass corrected a garbled/misused word.`);
      script = corrected;
    } else {
      const reasons = [];
      if (!corrected) reasons.push('empty output');
      if (corrected && !wordsPreserved(script, corrected)) reasons.push('word count drifted');
      if (corrected && !teluguRatioPreserved(script, corrected)) reasons.push('Telugu-character ratio dropped too far');
      if (correctedLineCount !== scriptLineCount) reasons.push(`line count changed (${scriptLineCount} -> ${correctedLineCount})`);
      if (correctedQuestionCount !== scriptQuestionCount) reasons.push(`question mark count changed (${scriptQuestionCount} -> ${correctedQuestionCount})`);
      if (validityNotationError) reasons.push(`introduced TTS-unsafe notation (${validityNotationError})`);
      log(`  Word-validity pass skipped (${reasons.join('; ')}) — keeping the script as-is. Rejected output was: ${(corrected || '').slice(0, 400)}`);
    }
  } catch (e) {
    log(`  Word-validity pass call failed (${e.message}) — keeping the script as-is.`);
  }

  // Defensive: strip any stray markers/CTA-like ending the model wrote
  // anyway, despite being told not to.
  script = script.replace(/\[[A-Z]+\]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const existingSentences = splitIntoSentences(script);
  if (existingSentences.length > 0 && existingSentences[existingSentences.length - 1].includes('సబ్‌స్క్రైబ్')) {
    existingSentences.pop();
    script = existingSentences.join(' ');
  }
  script = ensureSentenceBreaks(script);

  // Defensive: if the narration doesn't end with proper sentence-ending
  // punctuation, it was likely truncated — a real example produced
  // "...సురక్షితంగా తిన" (incomplete word). Trim back to the last complete
  // sentence rather than optimizing/uploading a mid-word cutoff. Moved to
  // run BEFORE metadata extraction so hook/title reflect the properly-
  // ended script.
  const trimmedForCheck = script.trim();
  if (!/[.!?]$/.test(trimmedForCheck)) {
    const lastPunctIdx = Math.max(trimmedForCheck.lastIndexOf('.'), trimmedForCheck.lastIndexOf('!'), trimmedForCheck.lastIndexOf('?'));
    if (lastPunctIdx > 0) {
      log(`⚠️ WARNING: narration did not end with proper punctuation (likely truncated: "...${trimmedForCheck.slice(-30)}") — trimming back to the last complete sentence.`);
      script = trimmedForCheck.slice(0, lastPunctIdx + 1);
    }
  }

  // CALL B.5: Speech Punctuation Optimizer — a focused pass to fix
  // period/comma/ellipsis placement without touching words. Verified with
  // a word-preservation check before accepting the result.
  try {
    const punctPrompt = buildPunctuationOptimizerPrompt(script);
    const optimized = (await callLLM(punctPrompt)).trim();
    const originalLineCount = script.split(/\n+/).filter(Boolean).length;
    const optimizedLineCount = optimized.split(/\n+/).filter(Boolean).length;
    const originalQuestionCount = (script.match(/\?/g) || []).length;
    const optimizedQuestionCount = (optimized.match(/\?/g) || []).length;
    const notationError = optimized ? styleErrors(optimized) : '';
    if (optimized && wordsPreserved(script, optimized) && optimizedLineCount === originalLineCount && optimizedQuestionCount === originalQuestionCount && !notationError) {
      script = optimized;
    } else {
      // Diagnostic detail per check, plus the raw rejected output — without
      // this, a rejection here silently falls back to the unoptimized
      // (comma-sparse, run-on-sounding) script with no way to tell WHY the
      // optimizer's attempt was rejected on a given run.
      const reasons = [];
      if (!optimized) reasons.push('empty output');
      const wc = (s) => s.split(/\s+/).filter(Boolean).length;
      if (optimized && !wordsPreserved(script, optimized)) reasons.push(`word count drifted (original ${wc(script)}, optimized ${wc(optimized)})`);
      if (optimizedLineCount !== originalLineCount) reasons.push(`line count changed (${originalLineCount} -> ${optimizedLineCount})`);
      if (optimizedQuestionCount !== originalQuestionCount) reasons.push(`question mark count changed (${originalQuestionCount} -> ${optimizedQuestionCount})`);
      if (notationError) reasons.push(`introduced TTS-unsafe notation (${notationError})`);
      log(`⚠️ WARNING: punctuation optimizer output rejected (${reasons.join('; ')}) — keeping the original script. Rejected output was: ${(optimized || '').slice(0, 300)}`);
    }
  } catch (e) {
    log(`WARNING: punctuation optimizer call failed (${e.message}) — continuing with the unoptimized script.`);
  }

  // CALL C: metadata (title/keywords/hook) extracted from the FINISHED,
  // optimized narration — a much simpler task than generating everything
  // at once.
  const metadataPrompt = buildMetadataPrompt(script);
  const metaRaw = await callLLM(metadataPrompt);
  let { title, keywords, hookEmoji, teaser } = parseMetadata(metaRaw);
  if (!title) title = deriveHeadline(script);
  if (!keywords) keywords = FALLBACK_KEYWORDS[category];
  if (!hookEmoji) hookEmoji = title;

  const categoryEmoji = CATEGORY_EMOJI[category] || '';
  title = `${title} ${categoryEmoji}`.trim();
  hookEmoji = `${hookEmoji} ${categoryEmoji}`.trim();

  script = `${script.trim()} ${SPOKEN_CTA_SENTENCE}`;
  log(`Title: ${title}`);
  log(`Keywords: ${keywords}`);
  log(`Hook emoji line: ${hookEmoji}`);
  log(`Teaser: ${teaser || '(none — description will fall back to the rotating generic bank)'}`);
  log(`Script (${script.length} chars): ${script}`);
  return { title, keywords, hookEmoji, teaser, script };
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

// Splits a script into its individual sentences (by ., !, or ?) — used to
// fetch one image per sentence instead of a handful of generic images for
// the whole script, so what's on screen actually matches what's being said
// at that moment.
//
// CONFIRMED REAL BUG (found via production log analysis, run #274): this
// only split on "." for years — but beat 1 (the hook) always ends in "?"
// per the guard's own schema, and "?"/"!" were never in the boundary set.
// Every video's hook therefore silently fused with beat 2 (buildup) into
// one oversized "sentence": one run logged that merged unit alone running
// 21s of a 59s video (vs. 7-12s for the other four, correctly-split
// sentences) — nearly a third of the video parked on a single static
// image. It also meant the natural pause after the hook's question mark
// was never inserted: generateAudioForScript() only places its longest,
// sentence-boundary silence gap BETWEEN separate sentences from this
// function, so the hook ran straight into the buildup with no breath —
// the exact "reading a paragraph, not telling a fact" symptom reported
// earlier, at the one place (the hook) it would be most noticeable.
function splitIntoSentences(script) {
  // Protect "..." from being shattered by the period-based split below —
  // verified this was a real bug: "..." split into three separate "."
  // fragments, breaking per-sentence image matching whenever a script
  // used ellipsis for dramatic pacing.
  const ELLIPSIS_PLACEHOLDER = '\u0001E\u0001';
  // Protect decimal numbers (e.g. "1.2") too — verified this was a real
  // bug: "1.2 టెరాబిట్స్" split into "1." and "2 టెరాబిట్స్" as separate
  // "sentences", causing TTS to synthesize them separately and read the
  // number as two disconnected digits ("ఒకటి రెండు") instead of "1.2".
  const DECIMAL_PLACEHOLDER = '\u0001D\u0001';
  const protectedText = script
    .replace(/\.\.\./g, ELLIPSIS_PLACEHOLDER)
    .replace(/(\d)\.(\d)/g, `$1${DECIMAL_PLACEHOLDER}$2`);
  const parts = protectedText.split(/(?<=[.!?।])\s*|\n+/).map(s => s.trim()).filter(Boolean);
  return parts.map(s => s.split(ELLIPSIS_PLACEHOLDER).join('...').split(DECIMAL_PLACEHOLDER).join('.'));
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

KEYWORDS: ప్రతి వాక్యానికి 2-4 పదాల Pexels-సెర్చ్ keyword — ఇది ఒక **real video/photo footage లో ఉండే అవకాశం ఉన్న**, నిర్దిష్ట, documentary-style దృశ్యం కావాలి. ఒకే ఒక్క concrete visual idea మాత్రమే ఉండాలి — రెండు మూడు వేర్వేరు నిర్దిష్ట విషయాలని ఒకే keyword లో కలపొద్దు, ఎందుకంటే stock libraries కి అంత specific compound footage దొరకదు, దాంతో సంబంధం లేని video వస్తుంది. ఉదా: తప్పు: "open-air Viking longhouse stone hearth tools" (నాలుగు వేర్వేరు specific concepts కలిపేసింది — ఇది real video లో "hearth"/fire మాత్రమే match అయ్యి, పూర్తిగా సంబంధం లేని fire-pit footage వచ్చింది) | సరైనది: "ancient stone hearth" లేదా "medieval stone dwelling" (ఏదో ఒక్కటే core idea). Compound/multi-concept వర్ణన కావాలంటే అది SCENES లో పెట్టు, KEYWORDS లో కాదు.

SCENES: ప్రతి వాక్యానికి 15-25 పదాల దృశ్య వర్ణన (ఆంగ్లంలో) — AI image generation కోసం, scientific/documentary/educational style లో, realistic గా. SUBJECT ప్రస్తావిస్తే అదే వర్ణన వాడు.

నియమాలు:
- పైన ఇచ్చిన **మూలం fact లోని నిర్దిష్ట పేర్లు/వస్తువులు/సంఖ్యలనే** వాడు — స్క్రిప్ట్ వాక్యం అస్పష్టంగా ఉన్నా, మూలం fact లో ఉన్న నిర్దిష్ట విషయాన్నే keyword/scene లో పెట్టు (ఉదా. మూలంలో "గ్రీన్‌ల్యాండ్ సొరచేప" అని ఉంటే, కేవలం "shark" అని కాకుండా "Greenland shark" అనే వాడు).
- పదాలు direct గా అనువదించకు, నిజమైన దృశ్యం రాయి (ఉదా. వైద్య "గుండె" కి "heart" వద్దు — romance ఫోటోలు వస్తాయి — "doctor checking heart with stethoscope" రాయి). భావోద్వేగాలను/నైరూప్య భావనలను (mystery, importance) మాటలుగా వాడకు, దృశ్యంగా చూపించు.
- మనుషులు కనిపించే scene అయితే, దేశం చెప్పకపోతే ఎప్పుడూ "Indian"/"South Indian" నేపథ్యం వాడు, Western look వద్దు. (జంతువులు/వస్తువులు/ప్రదేశాలకి ఇది వర్తించదు — అవి ఎక్కడివైతే అక్కడివే చూపించు.)
- **చివరి వాక్యం ఎప్పుడూ "ఫాలో చేయండి" అనే channel CTA** (fact లో భాగం కాదు) — దీనికి fact subject తో సంబంధం లేని generic "social media follow/notification" దృశ్యం వాడు (ఉదా. "phone screen notification bell", "hand tapping follow button on smartphone", "social media app icons glowing") — fact యొక్క literal keyword వాడకు.${outlineContext}

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

  const raw = await callLLM(prompt);
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
  // Pollinations is free/unauthenticated and enforces a tight rate limit —
  // real runs showed it 429 on literally every request after the first
  // (back-to-back sentence calls with no spacing), silently degrading
  // every abstract-category video to generic Pexels stock footage instead
  // of the purpose-generated images this whole tier exists for. One retry
  // after a backoff recovers most of these instead of giving up immediately.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetchWithTimeout(url, {}, 20000); // enhance adds a processing pass, so a bit more time than before
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 5000) {
        throw new Error(`Pollinations image suspiciously small (${buf.length} bytes) — likely an error response, not a real image`);
      }
      fs.writeFileSync(savePath, buf);
      return savePath;
    }
    if (res.status === 429 && attempt < 2) {
      const retryAfter = Number(res.headers.get('retry-after')) || 8;
      log(`  Pollinations rate-limited (429) — waiting ${retryAfter}s before one retry.`);
      await sleep(retryAfter * 1000);
      continue;
    }
    throw new Error(`Pollinations returned HTTP ${res.status}`);
  }
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
  // Tracked so the caller can decide what to do about it — previously this
  // only ever showed up as a per-sentence log line nobody watches in an
  // automated cron run, indistinguishable from a correct match in the final
  // video.
  let fallbackKeywordCount = 0;
  for (let i = 0; i < sentences.length; i++) {
    const usedFallbackKeyword = !keywords[i];
    if (usedFallbackKeyword) fallbackKeywordCount++;
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
      // Space out back-to-back Pollinations calls — firing one per sentence
      // with zero delay is what triggered its rate limit on real runs
      // (every call after the first came back 429). A short proactive gap
      // costs a couple seconds total but avoids that almost entirely.
      if (i > 0) await sleep(3000);
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
  return { clips, fallbackKeywordCount };
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

// Renders the wrapped Telugu text to a transparent 720x1280 PNG using
// headless Chromium (already a project dependency via puppeteer), then
// composites that PNG onto the frame with a plain ffmpeg overlay — no text
// shaping happens inside ffmpeg at all.
//
// CONFIRMED REAL BUG (found via a user-shared screenshot of a live
// thumbnail): the previous approach rendered text through ffmpeg's
// subtitles/libass filter specifically to avoid a known drawtext glyph-
// corruption issue — but libass's own Indic-script shaping turned out to
// be broken too, for the same underlying reason (Telugu needs matras/
// conjuncts reordered and combined, which libass doesn't reliably do):
// "ఉప్పు" (a geminated conjunct) rendered as "ఉపవు", "వెల్‌స్ఫ్రై" broke
// apart, and a vowel sign appeared as a floating stray glyph. This is the
// same root class of bug that was worked around by disabling on-screen
// captions entirely — but unlike an ffmpeg text filter, Chromium's text
// stack (Skia + HarfBuzz + ICU) is the same one every Android phone and
// Chrome browser renders Telugu with correctly, verified here against the
// exact garbled sentence from the screenshot before shipping.
async function renderTeluguTextPNG(text, outPngPath) {
  const fontPath = path.join(__dirname, 'fonts', 'NotoSansTelugu-Bold.ttf');
  const fontData = fs.readFileSync(fontPath).toString('base64');
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<!DOCTYPE html><html><head><style>
@font-face { font-family: 'NotoTelugu'; src: url(data:font/ttf;base64,${fontData}) format('truetype'); font-weight: bold; }
html, body { margin: 0; padding: 0; width: 720px; height: 1280px; background: transparent; overflow: hidden; }
.wrap { position: absolute; left: 0; right: 0; bottom: 500px; display: flex; justify-content: center; }
.box {
  font-family: 'NotoTelugu'; font-weight: bold; font-size: 52px; color: #ffffff;
  -webkit-text-stroke: 3px #000000; paint-order: stroke fill;
  background: rgba(0,0,0,0.69); border-radius: 12px;
  max-width: 620px; padding: 24px 32px; box-sizing: border-box;
  line-height: 1.32; text-align: center; white-space: pre-wrap;
}
</style></head><body><div class="wrap"><div class="box">${escaped}</div></div></body></html>`;

  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 720, height: 1280, deviceScaleFactor: 1 });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: outPngPath, omitBackground: true });
  } finally {
    await browser.close();
  }
}

// Builds a custom thumbnail: a frame from the video's own first slide
// (image or video) with bold, high-contrast hook-text overlaid — shown
// ONLY in YouTube's feed/search preview, never during playback (kept
// completely separate from the on-screen-text-free video itself).
async function buildThumbnail(mediaPath, mediaType, hookText, outPath) {
  // Strip emoji before wrapping — Chromium CAN render most emoji, but the
  // font here doesn't cover them, so they'd show as tofu boxes.
  const cleanText = hookText.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim();
  const lines = wrapText(cleanText, 24);
  const wrappedText = lines.join('\n');

  const frameOut = path.join(WORK_DIR, 'thumb_frame.jpg');
  if (mediaType === 'video') {
    execSync(`ffmpeg -y -i "${mediaPath}" -ss 1 -vf "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280" -frames:v 1 "${frameOut}"`, { stdio: 'inherit' });
  } else {
    execSync(`ffmpeg -y -i "${mediaPath}" -vf "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280" -frames:v 1 "${frameOut}"`, { stdio: 'inherit' });
  }

  const textPngPath = path.join(WORK_DIR, 'thumb_text.png');
  await renderTeluguTextPNG(wrappedText, textPngPath);

  const filters = `eq=contrast=1.1:saturation=1.15[bg];[bg][1:v]overlay=0:0`;
  execSync(`ffmpeg -y -i "${frameOut}" -i "${textPngPath}" -filter_complex "${filters}" -frames:v 1 -update 1 -q:v 2 "${outPath}"`, { stdio: 'inherit' });
  log(`Thumbnail built: ${outPath} (Chromium-rendered Telugu text overlay)`);
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

  // buildImageClip/buildRealVideoClip/buildPlaceholderClip all target their
  // requested duration precisely under normal conditions (exact frame count,
  // -t cutoff, lavfi d= respectively) — but an unusual source video (odd
  // framerate, a decode hiccup) can still drift. Before this, a drift over 1s
  // only produced a "⚠️ MISMATCH" log line that nothing acted on: the clip
  // went into the concat list exactly as built, silently desyncing that one
  // sentence's visual from its narration by however much it was off, with no
  // signal beyond a log line nobody watches in an automated cron run. This
  // corrects the clip file itself — trims if too long, freeze-frame-pads if
  // too short — so what actually reaches concat always matches its intended
  // slot. Wrapped defensively: if the correction pass itself fails for any
  // reason, fall back to the original (already-logged) clip rather than
  // letting a correction bug break a run that would otherwise have shipped
  // with just a minor, pre-existing drift.
  function enforceClipDuration(clipPath, targetDuration, actualDuration) {
    const drift = actualDuration - targetDuration;
    if (Math.abs(drift) <= 0.15) return actualDuration; // within normal encoding rounding
    const fixedPath = clipPath + '.fixed.mp4';
    try {
      if (drift > 0) {
        execSync(`ffmpeg -y -i "${clipPath}" -t ${targetDuration.toFixed(2)} -c copy "${fixedPath}"`, { stdio: 'inherit' });
      } else {
        execSync(`ffmpeg -y -i "${clipPath}" -vf "tpad=stop_mode=clone:stop_duration=${(-drift).toFixed(2)}" -c:v libx264 -pix_fmt yuv420p -t ${targetDuration.toFixed(2)} "${fixedPath}"`, { stdio: 'inherit' });
      }
      fs.renameSync(fixedPath, clipPath);
      const correctedDur = getAudioDuration(clipPath);
      log(`  clip duration corrected: was ${actualDuration.toFixed(2)}s (target ${targetDuration.toFixed(2)}s), now ${correctedDur.toFixed(2)}s.`);
      return correctedDur;
    } catch (e) {
      log(`WARNING: clip duration correction failed (${e.message}) — leaving the clip at its original ${actualDuration.toFixed(2)}s.`);
      try { fs.unlinkSync(fixedPath); } catch {}
      return actualDuration;
    }
  }

  // Step 1: one clip per sentence — real video is looped/trimmed to length,
  // a still image gets a Ken-Burns pan/zoom (alternating in/out for variety).
  const clipPaths = [];
  let placeholderCount = 0; // tracked so the caller can gate on it instead of this being a silent visual failure
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
      placeholderCount++;
    }
    let actualDur = getAudioDuration(clipPath); // works for video streams too via ffprobe format=duration
    log(`  clip_${i} (${mediaItems[i].type}): target ${durations[i].toFixed(2)}s, actual ${actualDur.toFixed(2)}s${Math.abs(actualDur - durations[i]) > 1 ? ' ⚠️ MISMATCH — correcting' : ''}`);
    actualDur = enforceClipDuration(clipPath, durations[i], actualDur);
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
  return { outPath, placeholderCount };
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
// 5 lowercase hashtags (2026 best-practice range), per spec. The hook line
// comes from Groq's HOOK field, kept separate from the spoken SCRIPT.
//
// The teaser line is now ALSO Groq-generated per video (buildMetadataPrompt's
// TEASER field), content-aware to that specific fact — not picked from the
// small fixed DESCRIPTION_TEASERS bank below. With 2 uploads/day, a 5-line
// rotating bank repeats the exact same sentence verbatim every ~2.5 days
// across the whole public catalog — a literal, externally-checkable
// "templated/mass-produced content" signal that YouTube's monetization
// policy on repetitious/inauthentic content specifically looks for. The
// bank is kept only as a defensive fallback for the rare case Groq's
// TEASER field fails to parse.
function buildDescription(hookEmoji, category, runCount, teaser) {
  const line1 = hookEmoji;
  const line2 = teaser || DESCRIPTION_TEASERS[runCount % DESCRIPTION_TEASERS.length];
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

// Deterministic gate before upload. Everything upstream (buildVideo's zero-
// media-items guard, per-clip placeholder fallback, NaN-duration sanitizing)
// only guarantees that ffmpeg's mux command exited successfully — it does
// NOT guarantee the muxed output actually contains a real audio track, or
// that its length matches the narration it's supposed to be synced to. Until
// now nothing checked this: buildVideo's return value went straight into
// uploadToYouTube with zero verification in between, so a video with a
// missing/truncated audio stream or a badly wrong duration would still ship
// live and public with no warning anywhere in the logs. This never changes
// what a successful run produces — it only turns a silent bad upload into a
// loud, caught failure before anything goes public.
function validateFinalVideo(videoPath, audioPath) {
  if (!fs.existsSync(videoPath) || fs.statSync(videoPath).size === 0) {
    throw new Error(`Final video validation failed: "${videoPath}" is missing or empty — refusing to upload.`);
  }
  const streams = execSync(`ffprobe -v error -show_entries stream=codec_type -of csv=p=0 "${videoPath}"`).toString().trim().split('\n').map(s => s.trim()).filter(Boolean);
  if (!streams.includes('audio')) {
    throw new Error(`Final video validation failed: "${videoPath}" has no audio stream — refusing to upload a silent video.`);
  }
  if (!streams.includes('video')) {
    throw new Error(`Final video validation failed: "${videoPath}" has no video stream — refusing to upload.`);
  }
  const videoDuration = getAudioDuration(videoPath); // ffprobe format=duration works for any container, not just audio-only files
  if (!isFinite(videoDuration) || videoDuration <= 0) {
    throw new Error(`Final video validation failed: could not determine a valid duration for "${videoPath}" (got ${videoDuration}) — refusing to upload.`);
  }
  // Matches buildVideo's own internal `duration` computation exactly, so this
  // check catches any drift introduced between that computation and the
  // final muxed file, not just a hardcoded guess.
  const expectedDuration = getAudioDuration(audioPath) + 0.3;
  const drift = Math.abs(videoDuration - expectedDuration);
  if (drift > 2) {
    throw new Error(`Final video validation failed: video duration (${videoDuration.toFixed(2)}s) drifted from the expected narration-matched duration (${expectedDuration.toFixed(2)}s) by ${drift.toFixed(2)}s — refusing to upload a desynced video.`);
  }
  log(`Final video validated: audio+video streams present, duration ${videoDuration.toFixed(2)}s (expected ~${expectedDuration.toFixed(2)}s).`);
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

function saveState(title, category, newlyDiscovered, topic) {
  const { usedTitles, runCount, discoveredFacts, usedTopics } = loadState();
  let newTitles = [...usedTitles, title];
  if (newTitles.length > 50) newTitles = newTitles.slice(-50);
  const newDiscoveredFacts = { ...discoveredFacts };
  if (newlyDiscovered) {
    newDiscoveredFacts[category] = [...(newDiscoveredFacts[category] || []), newlyDiscovered];
    log(`Persisting 1 newly discovered fact for "${category}" — bank is now permanently larger.`);
  }
  const newUsedTopics = { ...usedTopics };
  if (topic) {
    let updatedTopics = [...(newUsedTopics[category] || []), topic];
    if (updatedTopics.length > 15) updatedTopics = updatedTopics.slice(-15); // matches TOPIC_BANK size per category — keeps just "recently used"
    newUsedTopics[category] = updatedTopics;
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    usedTitles: newTitles,
    runCount: runCount + 1,
    discoveredFacts: newDiscoveredFacts,
    usedTopics: newUsedTopics,
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

  checkSecret('GROQ_API_KEY', GROQ_API_KEY_RAW);
  checkSecret('GOOGLE_TTS_API_KEY', GOOGLE_TTS_API_KEY);
  checkSecret('PEXELS_API_KEY', PEXELS_API_KEY);
  checkSecret('YT_CLIENT_ID', YT_CLIENT_ID);
  checkSecret('YT_CLIENT_SECRET', YT_CLIENT_SECRET);
  checkSecret('YT_REFRESH_TOKEN', YT_REFRESH_TOKEN);

  const { usedTitles, runCount, discoveredFacts, usedTopics } = loadState();
  let category = pickCategory(runCount);
  let outline, newlyDiscovered, topic;

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
      const result = await getOrGrowFactOutline(category, discoveredFacts, usedTopics);
      outline = result.outline;
      newlyDiscovered = result.newlyDiscovered;
      topic = result.topic;
      break;
    } catch (e) {
      if (categorySwitch === 2) throw e; // out of switches, let the run genuinely fail
      const nextCategory = FACT_SUBNICHES.find(c => !triedCategories.includes(c)) || FACT_SUBNICHES[(FACT_SUBNICHES.indexOf(category) + 1) % FACT_SUBNICHES.length];
      log(`WARNING: "${category}" could not produce a verified fact (${e.message}) — switching to "${nextCategory}" for today's video instead.`);
      category = nextCategory;
      triedCategories.push(category);
    }
  }

  const { title, hookEmoji, teaser, script } = await generateContent(category, usedTitles, outline);
  const allSentences = splitIntoSentences(script);
  let { audioPath, sentenceDurations, silenceGap } = await generateAudioForScript(allSentences);

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
  const { clips: rawImagePaths, fallbackKeywordCount } = await fetchImagesPerSentence(imageSentences, category, outline);

  // Drop any sentence whose image totally failed, redistributing its share
  // of time to the remaining successful slides so there's no dead/black gap.
  // droppedSentenceCount is tracked for the visual-quality gate below — a
  // dropped sentence means that beat of the narration has NO matching
  // visual at all, previously invisible beyond a per-sentence log line.
  const imagePaths = [];
  const keptDurations = [];
  let droppedSentenceCount = 0;
  for (let i = 0; i < rawImagePaths.length; i++) {
    if (rawImagePaths[i]) {
      imagePaths.push(rawImagePaths[i]);
      keptDurations.push(imageDurations[i]);
    } else {
      droppedSentenceCount++;
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

  const { outPath: videoPath, placeholderCount } = buildVideo(imagePaths, audioPath, keptDurations, ctaAudioDuration);
  validateFinalVideo(videoPath, audioPath);

  // Visual-quality gate. Two severities, previously both silent beyond a log
  // line an automated cron run never surfaces:
  // - A placeholder clip (a flat color card standing in for a slide whose
  //   encoding failed) is unambiguously broken — the existing per-clip
  //   redistribution has no way to hide a card that's actually on screen —
  //   so this always fails the run. Rare by construction (only reached
  //   after a valid source file already passed size/ffprobe checks).
  // - Every sentence's image failing (the imagePaths.length===0 branch
  //   above, now recovered with ONE generic image stretched across the
  //   whole video) is a severe, system-level failure, not a per-sentence
  //   fluke — also always fails the run rather than shipping a single
  //   static image for 60-80 seconds.
  // - A PARTIAL drop (some sentences failed, most succeeded) is different:
  //   the redistribution above was specifically designed to make this
  //   imperceptible (durations rebalanced across survivors, no dead gap),
  //   so failing the whole run over one absorbed slide would be far more
  //   disruptive than the defect itself — this is downgraded to a visible
  //   warning instead, avoiding the kind of over-aggressive hard-reject
  //   that already caused a real regression once this session (run #285).
  const allSentencesDropped = droppedSentenceCount > 0 && droppedSentenceCount === rawImagePaths.length;
  if (allSentencesDropped || placeholderCount > 0) {
    throw new Error(`Visual quality gate failed: ${droppedSentenceCount} of ${rawImagePaths.length} sentence(s) had no usable image/video at all, and ${placeholderCount} slide(s) fell back to a blank placeholder card — refusing to upload a video with missing/broken visuals.`);
  }
  if (droppedSentenceCount > 0) {
    log(`⚠️ WARNING: ${droppedSentenceCount} of ${rawImagePaths.length} sentence(s) had no usable image/video and were dropped — their time was redistributed to neighboring slides, so the video has fewer distinct visuals than sentences.`);
  }
  // A fallback keyword (generic category search term instead of a sentence-
  // specific one) is a milder defect — the slide still has a real, on-topic-
  // ish image, just less precisely matched — so this is surfaced as a clear
  // warning rather than blocking the upload over it.
  if (fallbackKeywordCount > 0) {
    log(`⚠️ WARNING: ${fallbackKeywordCount} sentence(s) used a generic fallback image keyword instead of a sentence-specific one (per-sentence keyword parsing failed) — those slides' visuals may be less precisely matched to their narration.`);
  }

  const videoId = await uploadToYouTube(
    videoPath,
    title,
    buildDescription(hookEmoji, category, runCount, teaser),
    category
  );

  // Custom thumbnail is a nice-to-have on top of an already-successful
  // upload — any failure here (build error, unverified channel, etc.)
  // must never be treated as the run failing.
  try {
    const thumbnailPath = path.join(WORK_DIR, 'thumbnail.jpg');
    await buildThumbnail(imagePaths[0].path, imagePaths[0].type, hookEmoji, thumbnailPath);
    await uploadThumbnail(videoId, thumbnailPath);
  } catch (e) {
    log(`WARNING: thumbnail generation failed (${e.message}) — video is live with YouTube's auto-selected thumbnail instead.`);
  }

  saveState(title, category, newlyDiscovered, topic);
  log('Done!');
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
