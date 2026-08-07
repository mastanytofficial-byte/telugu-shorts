// DEBUG SCRIPT — isolates ONLY the text-generation pipeline:
// pick topic -> fact outline -> story beats -> Stage-2 prompt -> RAW Groq
// response -> parsed result. No TTS, no images, no video, no upload.
// Run with: node debug.js [category]
//
// This exists specifically to answer: is the "0 words" problem in the
// Stage-2 PROMPT (model produces empty/malformed raw output) or in the
// PARSER (raw output is fine, but parseLabeledContent extracts nothing)?
// Every function body below is copied VERBATIM from index.js — nothing
// here is a guess or a new prompt, per instruction not to modify the
// pipeline blindly.

const GROQ_API_KEY = process.env.GROQ_API_KEY;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

const WORD_COUNT_TARGETS = {
  mindblowing: { min: 85, max: 115 }, psychology: { min: 85, max: 115 }, earth_space: { min: 85, max: 115 },
  animal: { min: 85, max: 115 }, money: { min: 85, max: 115 }, history: { min: 85, max: 115 },
  human_body: { min: 85, max: 115 }, technology: { min: 85, max: 115 }, food: { min: 85, max: 115 }, ocean: { min: 85, max: 115 }
};

// --- copied verbatim from index.js ---

const PRIMARY_MODEL = 'llama-3.3-70b-versatile';
const FALLBACK_MODEL = 'openai/gpt-oss-120b';
let primaryModelExhaustedThisRun = false;

async function callGroq(prompt, attempt = 1, model = (primaryModelExhaustedThisRun ? FALLBACK_MODEL : PRIMARY_MODEL)) {
  const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 2000 })
  });
  const data = await res.json();
  if (!data.choices || !data.choices[0]) {
    const errorMessage = (data.error && data.error.message) || '';
    const isDailyLimit = /tokens per day|TPD/i.test(errorMessage);
    const isRateLimit = data.error && data.error.code === 'rate_limit_exceeded';
    if (isRateLimit && isDailyLimit) {
      if (model === PRIMARY_MODEL) {
        primaryModelExhaustedThisRun = true;
        log(`WARNING: "${PRIMARY_MODEL}" daily token limit reached — switching to fallback "${FALLBACK_MODEL}".`);
        return callGroq(prompt, 1, FALLBACK_MODEL);
      }
      throw new Error(`Groq DAILY token limit reached on both models. ${errorMessage}`);
    }
    if (isRateLimit && attempt <= 3) {
      const waitMs = 15000 * attempt;
      log(`WARNING: Groq rate limit hit (attempt ${attempt}/3) — waiting ${waitMs / 1000}s.`);
      await sleep(waitMs);
      return callGroq(prompt, attempt + 1, model);
    }
    throw new Error('Groq did not return content: ' + JSON.stringify(data));
  }
  let content = data.choices[0].message.content.trim();
  const hadThinkBlock = /<think>[\s\S]*?<\/think>/gi.test(content);
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (hadThinkBlock) log(`  NOTE: response contained a <think> block (stripped). Remaining length after strip: ${content.length} chars.`);
  await sleep(1500);
  return { content, modelUsed: model };
}

async function generateNewFactOutline(category, topic, existingOutlines) {
  const existingSummaries = existingOutlines.map(o => o.split('.')[0]).join(' | ');
  const prompt = `"${topic}" గురించి అత్యంత ఆశ్చర్యపరిచే, verified fact ఒకటి తెలుగులో ఇవ్వు — ఇది widely-established, నిజమైన సమాచారం అయ్యుండాలి (కల్పితం కాదు).

ఇప్పటికే వాడినవి (వేరేది ఎంచుకో): ${existingSummaries}

నీకు నిజంగా ఖచ్చితంగా తెలిసిన fact మాత్రమే ఇవ్వు. స్పష్టమైన సందేహం ఉంటేనే "UNSURE" అని రాయి (చిన్న uncertainty కి కాదు, genuinely గుర్తు లేకపోతేనే).

ఫార్మాట్ (వేరే ఏమీ రాయకు):
హుక్: (ఆసక్తికరమైన ప్రశ్న)
వివరణ: (సమాధానం, 2-3 వాక్యాలు)
Twist: (అదనపు వివరం, 1-2 వాక్యాలు)`;

  const { content: raw } = await callGroq(prompt);
  const trimmed = raw.trim();
  if (trimmed.toUpperCase().includes('UNSURE') || !trimmed.includes('హుక్') || !trimmed.includes('వివరణ')) {
    return null;
  }
  return trimmed;
}

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
  } catch (e) { return null; }
}

async function generateStoryBeats(outline) {
  const prompt = `కింద ఇచ్చిన fact నుండి story beats ని JSON గా ఇవ్వు. ప్రతి value 3-6 అతి చిన్న తెలుగు పదాల పదబంధం మాత్రమే (పూర్తి వాక్యం కాదు, script అస్సలు కాదు):

${outline}

ఖచ్చితంగా ఈ JSON object మాత్రమే ఇవ్వు — ముందు/వెనుక ఏమీ రాయకు, కోడ్ బ్లాక్ (\`\`\`) వద్దు, వివరణ వద్దు:
{"hook": "...", "question": "...", "reveal": "...", "twist": "...", "ending": "..."}`;

  console.log('\n========== STAGE 1 PROMPT (story beats) ==========');
  console.log(prompt);

  let { content: raw, modelUsed } = await callGroq(prompt);
  console.log('\n========== STAGE 1 RAW RESPONSE (model: ' + modelUsed + ') ==========');
  console.log(JSON.stringify(raw)); // JSON.stringify to reveal any invisible/empty content clearly

  let beats = tryParseStoryBeatsJSON(raw);
  if (!beats) {
    log('WARNING: story beats response was not valid JSON — retrying once.');
    const retryPrompt = `${prompt}\n\nనీ మునుపటి జవాబు valid JSON కాదు. ఖచ్చితంగా ఈ 5 keys తోనే ఒక్క JSON object ఇవ్వు, మరేమీ రాయకు: {"hook": "...", "question": "...", "reveal": "...", "twist": "...", "ending": "..."}`;
    const retryResult = await callGroq(retryPrompt);
    raw = retryResult.content;
    console.log('\n========== STAGE 1 RETRY RAW RESPONSE ==========');
    console.log(JSON.stringify(raw));
    beats = tryParseStoryBeatsJSON(raw);
  }
  if (!beats) {
    log('WARNING: story beats still not valid JSON — falling back to raw text as single beat.');
    return { hook: raw.trim(), question: '', reveal: '', twist: '', ending: '' };
  }
  return beats;
}

function compactOutlineForGrounding(outline) {
  return outline.replace(/హుక్:\s*/g, '').replace(/వివరణ:\s*/g, ' ').replace(/Twist:\s*/gi, ' ').replace(/\s+/g, ' ').trim();
}

function buildPrompt(category, recentTitles, outline, beats) {
  const { min, max } = WORD_COUNT_TARGETS[category];
  const beatsJSON = JSON.stringify(beats);
  const topicInstruction = `కింద ఇచ్చిన JSON లో story beats ఉన్నాయి (ఇదే క్రమంలో వాడు, కొత్తవి కల్పించకు):
${beatsJSON}

(గ్రౌండింగ్ కోసం అసలైన verify చేయబడిన fact: ${compactOutlineForGrounding(outline)})

నువ్వు ఒక professional YouTube Shorts storyteller వి — ఈ beats ని, ఒక ఉత్కంఠభరితమైన రహస్యం best friend కి చెప్తున్నట్టు తెలుగు narration గా విస్తరించు. ప్రతి beat ని 2-3 చిన్న suspense లైన్లుగా మార్చు. ప్రతి లైన్‌లో ఒక్క idea మాత్రమే ఉండాలి — ఒకే లైన్‌లో 2-3 ideas కలిపి పెట్టకు. ఏ ప్రశ్నకైనా వెంటనే సమాధానం ఇవ్వకు, "..." తో pause పెట్టి stretch చేయి.

నియమాలు (తప్పనిసరి):
- ${min}-${max} తెలుగు పదాలు.
- **పూర్ణవిరామం (.) ఎప్పుడూ పూర్తి ఆలోచన ముగిసిన చోటే — వాక్యం మధ్యలో, క్రియకి ముందు వద్దు.** ("..." pause కి, period వాక్యాంతానికి మాత్రమే).
- సంఖ్యలు **1000+ ఉంటే తెలుగు మాటల్లోనే** (10000 → "పది వేలు") — అంకెల్లో వద్దు. 1000 కన్నా తక్కువ (300, 206) అంకెల్లో వాడొచ్చు.
- Brand/పేర్లు ఆంగ్ల స్పెల్లింగ్‌లో. తెలుగు లిపిలోనే — Romanized వద్దు. చివర్లో CTA రాయకు.`;

  return `${topicInstruction}

జవాబును ఖచ్చితంగా ఈ నాలుగు లైన్ల ఫార్మాట్‌లోనే ఇవ్వు, ఇదే క్రమంలో, మరేమీ ముందు/వెనుక రాయకు:
TITLE: (5-8 తెలుగు పదాల్లో ఒక చిన్న శీర్షిక — ఇందులో emoji వాడకు, మేమే జోడిస్తాం)
KEYWORDS: (ఈ కంటెంట్‌కి సరిపోయే 3 నిర్దిష్టమైన, దృశ్యమానమైన ఆంగ్ల keywords)
HOOK: (JSON లోని hook భావననే, 15 తెలుగు పదాల లోపు ప్రశ్నగా రాయి)
SCRIPT: (పైన చెప్పిన నియమాల ప్రకారం పూర్తి వాయిస్-ఓవర్ టెక్స్ట్ — ఇందులో emoji లు వాడకు. అదనంగా, స్క్రిప్ట్‌లో ఈ structural markers ని సంబంధిత భాగం ముందు పెట్టు: [HOOK] hook వాక్యానికి, [VISUAL] reveal భాగం మొదలయ్యే చోట, [TWIST] twist భాగం మొదలయ్యే చోట.)`;
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

// --- debug driver ---

(async () => {
  const category = process.argv[2] || 'human_body';
  const topic = TOPIC_BANK[category][0]; // deterministic, so re-runs are comparable

  console.log('================================================');
  console.log('DEBUG RUN — category:', category, '| topic:', topic);
  console.log('================================================');

  const outline = await generateNewFactOutline(category, topic, []);
  console.log('\n========== FACT OUTLINE ==========');
  console.log(outline);

  if (!outline) {
    console.log('\n❌ STOPPED: fact generation itself failed (null/UNSURE). Problem is upstream of Stage 2.');
    return;
  }

  const beats = await generateStoryBeats(outline);
  console.log('\n========== PARSED STORY BEATS ==========');
  console.log(JSON.stringify(beats, null, 2));

  const prompt = buildPrompt(category, [], outline, beats);
  console.log('\n========== STAGE 2 PROMPT (full, exact text sent to Groq) ==========');
  console.log(prompt);

  const { content: raw, modelUsed } = await callGroq(prompt);
  console.log('\n========== STAGE 2 RAW RESPONSE (model: ' + modelUsed + ') ==========');
  console.log(JSON.stringify(raw)); // stringify reveals truly-empty vs whitespace-only vs short

  const parsed = parseLabeledContent(raw);
  console.log('\n========== PARSED RESULT ==========');
  console.log('Title:', parsed.title);
  console.log('Keywords:', parsed.keywords);
  console.log('Hook:', parsed.hookEmoji);
  console.log('Script:', parsed.script);
  const wordCount = parsed.script ? parsed.script.split(/\s+/).filter(Boolean).length : 0;
  console.log('Script word count:', wordCount);

  console.log('\n========== DIAGNOSIS ==========');
  if (raw.trim().length === 0) {
    console.log('❌ RAW response is completely EMPTY — problem is the MODEL/PROMPT (likely entirely consumed by a <think> block, or the model refused/failed silently). Parser is not the issue.');
  } else if (!parsed.script || wordCount < 5) {
    console.log('⚠️  RAW response has content, but PARSER extracted little/nothing. Raw response length: ' + raw.length + ' chars. Check if it follows the TITLE:/KEYWORDS:/HOOK:/SCRIPT: format above — if raw looks reasonable but parsed.script is empty, the problem IS the parser/format-matching.');
  } else if (wordCount < 50) {
    console.log('⚠️  Script parsed but is short (' + wordCount + ' words). Model produced SOMETHING but did not reach target length — likely a prompt-following issue, not a parser bug.');
  } else {
    console.log('✅ Script generation worked fine in isolation (' + wordCount + ' words). If production runs still fail, the issue may be intermittent (model variance) or specific to the retry-path prompts, not this main path.');
  }
})().catch(err => {
  console.error('DEBUG SCRIPT ERROR:', err);
  process.exit(1);
});
