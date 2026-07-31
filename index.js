// Telugu Daily Shorts — fully automated, runs on GitHub Actions
// Rotates through 4 content types daily: news, moral stories, facts, parenting tips
// Topic/Script (Groq) -> Voice (Google TTS) -> Images (Pexels) -> Video (FFmpeg) -> YouTube

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { google } = require('googleapis');

const NEWSAPI_KEY = process.env.NEWSAPI_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY;
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const YT_CLIENT_ID = process.env.YT_CLIENT_ID;
const YT_CLIENT_SECRET = process.env.YT_CLIENT_SECRET;
const YT_REFRESH_TOKEN = process.env.YT_REFRESH_TOKEN;

const STATE_FILE = path.join(__dirname, 'last-article.json');
const WORK_DIR = path.join(__dirname, 'work');

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// A stalled connection to any external API (NewsAPI, Groq, Google TTS,
// Pexels) could otherwise hang until GitHub Actions' 15-minute job timeout
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

const CATEGORIES = ['news', 'moral_story', 'fact', 'parenting'];

// Niching down to a single content type consistently outperforms mixing
// several for subscriber growth — viewers subscribe for "more of the thing
// they just watched," not a grab-bag. Fixed to moral_story: strong cultural
// fit for Telugu audiences, no factual-accuracy risk (unlike 'fact'), and
// its natural length (130-150 words) matches YouTube's 50-60s Shorts
// retention sweet spot better than a stretched-out short fact would.
// To bring back daily variety later, just restore the day-of-year rotation
// through CATEGORIES.
function pickCategory() {
  const category = 'moral_story';
  log(`Today's category: ${category}`);
  return category;
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      return {
        usedUrls: state.usedUrls || (state.url ? [state.url] : []),
        usedTitles: state.usedTitles || [],
        runCount: state.runCount || 0
      };
    } catch (e) {}
  }
  return { usedUrls: [], usedTitles: [], runCount: 0 };
}

async function fetchNews() {
  log('Fetching news from NewsAPI...');
  // pageSize raised 10 -> 20 to give the dedup check more room to find a fresh article
  const url = `https://newsapi.org/v2/everything?q=India&language=en&sortBy=publishedAt&pageSize=20&apiKey=${NEWSAPI_KEY}`;
  const res = await fetchWithTimeout(url);
  const data = await res.json();
  if (!data.articles || data.articles.length === 0) {
    throw new Error('No articles found from NewsAPI');
  }

  // Load history of previously used article URLs (last 50 runs), not just the last one.
  const { usedUrls } = loadState();

  const article = data.articles.find(a => !usedUrls.includes(a.url)) || data.articles[0];
  if (usedUrls.includes(article.url)) {
    log('WARNING: every fetched article was already used in the last 50 runs — reusing the newest one so the run does not fail.');
  }
  log(`Selected article: ${article.title}`);
  return article;
}

// Safety net: Google's Chirp 3: HD voice rejects any single "sentence" (text
// between periods) that's too long. Groq is prompted to add periods between
// sentences, but LLMs don't always follow formatting instructions exactly —
// this guarantees no run of text exceeds maxLen without a period, by forcing
// one in at the nearest comma if needed.
function ensureSentenceBreaks(text, maxLen = 140) {
  const parts = text.split(/(?<=\.)\s*/);
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
  return fixed.join(' ').replace(/\s+/g, ' ').trim();
}

const FALLBACK_KEYWORDS = {
  news: 'India news',
  moral_story: 'Indian village traditional life',
  fact: 'India knowledge curious facts',
  parenting: 'Indian family parenting'
};

// news/moral_story need more room to actually tell a story (~40-45s);
// fact/parenting work better short and punchy (~20-30s) per YouTube Shorts
// retention data — longer isn't better for a single quick tip or fact.
const WORD_COUNT_TARGETS = {
  news: { min: 130, max: 150 },
  moral_story: { min: 130, max: 150 },
  fact: { min: 85, max: 95 },
  parenting: { min: 85, max: 95 }
};

// Shared formatting/voice rules appended to every category's prompt.
// Appended programmatically after generation — never left to the model to
// retype, since it occasionally introduced typos into this fixed sentence
// (e.g. "సబ్‌స్రైబ్" missing a syllable) when asked to reproduce it itself.
const CTA_SENTENCE = 'మరిన్ని ఇలాంటి వీడియోల కోసం తెలుగు ఎకో ఛానెల్‌ని లైక్ చేయండి, షేర్ మరియు సబ్‌స్క్రైబ్ చేయండి.';

function getCommonRules(category) {
  const { min, max } = WORD_COUNT_TARGETS[category];
  return `
నియమాలు:
- తప్పకుండా ${min}-${max} తెలుగు పదాలు (తక్కువ వద్దు).
- సహజంగా, మాట్లాడేటట్టు రాయి. ప్రతి పూర్తి వాక్యం తర్వాత పూర్ణవిరామం (.).
- ప్రతి వాక్యం పూర్తి క్రియతో ముగియాలి ("...చేసి," వంటి అసంపూర్ణం వద్దు).
- గౌరవ స్థాయి (అన్నాడు/అన్నారు) స్క్రిప్ట్ అంతటా ఒకేలా ఉంచు.
- సరైన క్రియా రూపాలు వాడు ("కొట్టుతూ" కాదు "కొడుతూ").
- సంఖ్యలు ఎప్పుడూ తెలుగు మాటల్లోనే (2000 → "రెండు వేలు"), అంకెల్లో వద్దు.
- Brand/వ్యక్తుల పేర్లు ఆంగ్ల స్పెల్లింగ్‌లోనే ఉంచు.
- చివర్లో "లైక్/షేర్/సబ్‌స్క్రైబ్" వాక్యం రాయకు — అది మేమే జోడిస్తాం.`;
}

// The model kept defaulting to "help/kindness" regardless of the 6 options
// listed, because that's its own bias when given a free choice. Rotating
// deterministically and TELLING it exactly which value to use (instead of
// leaving it to choose) guarantees real variety across videos.
const MORAL_VALUES = [
  'నిజాయితీ (honesty)', 'ఓర్పు (patience)', 'కృషి/పట్టుదల (hard work and persistence)',
  'క్షమ (forgiveness)', 'ధైర్యం (courage)', 'కృతజ్ఞత (gratitude)',
  'వినయం (humility)', 'దయ (kindness)', 'సహాయం చేయడం (helping others)', 'నిబద్ధత (commitment/keeping one\'s word)'
];

// Curated plot outlines — one per value above, same index. Asking Groq to
// "recall a famous story from memory and retell it" repeatedly produced
// structurally broken narratives (e.g. a cat that starts speaking with no
// explanation, stating a moral with no connection to what actually happens
// in the story). Giving it the ACTUAL plot to expand into vivid Telugu
// prose is a far more reliable task than recall + invent combined.
const STORY_OUTLINES = [
  // నిజాయితీ — The Honest Woodcutter
  'ఒక పేద కట్టెలు కొట్టేవాడు నదీ ఒడ్డున చెట్టు కొడుతూ ఉండగా, పొరపాటున తన ఇనుప గొడ్డలి నీళ్లలో పడిపోతుంది. అతను జీవనాధారం పోయిందని బాధపడి ఏడుస్తుంటాడు. అప్పుడు నదిలో నుండి ఒక దేవత ప్రత్యక్షమవుతుంది. ఆమె ముందు బంగారు గొడ్డలిని తెచ్చి "ఇది నీదేనా?" అని అడిగితే, అతను "కాదు, ఇది నాది కాదు" అని నిజాయితీగా చెప్తాడు. మళ్ళీ వెండి గొడ్డలిని తెచ్చి అడిగినా, "కాదు" అనే చెప్తాడు. చివరికి తన పాత ఇనుప గొడ్డలిని చూపిస్తే, "అవును, ఇదే నాది" అని సంతోషంగా చెప్తాడు. అతని నిజాయితీకి మెచ్చిన దేవత మూడు గొడ్డళ్లనూ అతనికి బహుమతిగా ఇస్తుంది.',
  // ఓర్పు — The Crow and the Pitcher
  'ఒక వేసవిలో ఒక కాకికి విపరీతమైన దాహం వేస్తుంది. చాలాసేపు వెతికాక ఒక కుండలో కొద్దిగా నీళ్లు కనిపిస్తాయి, కానీ నీటి మట్టం చాలా కిందగా ఉండి కాకి ముక్కు అందదు. కుండని పడగొట్టాలని ప్రయత్నించినా అది చాలా బరువుగా ఉంటుంది. నిరాశ చెందకుండా, కాకి చుట్టూ ఉన్న చిన్న రాళ్లను ఒక్కొక్కటిగా కుండలో వేయడం మొదలుపెడుతుంది. ఓపిగ్గా చాలాసేపు రాళ్లు వేసిన తర్వాత, నీటి మట్టం నెమ్మదిగా పైకి వచ్చి, కాకి హాయిగా దాహం తీర్చుకుంటుంది.',
  // కృషి/పట్టుదల — Tortoise and Hare
  'ఒక కుందేలు, ఒక తాబేలు తమలో ఎవరు వేగంగా పరుగెత్తగలరో పందెం కడతారు. కుందేలు తనకి తానే నమ్మకంగా "నేను చాలా వేగం, తాబేలు చాలా నెమ్మది" అనుకుని, పందెం మధ్యలో ఒక చెట్టు కింద నిద్రపోతుంది. తాబేలు మాత్రం ఆగకుండా నెమ్మదిగానైనా స్థిరంగా ముందుకు సాగుతూనే ఉంటుంది. కుందేలు మేల్కొనేసరికి తాబేలు గమ్యానికి చేరువలో ఉంటుంది. కుందేలు గాభరాగా పరుగెత్తినా ఆలస్యమైపోతుంది — తాబేలే ముందుగా గెలుస్తుంది.',
  // క్షమ — Write in Sand, Carve in Stone
  'ఇద్దరు మంచి స్నేహితులు ఎడారి గుండా ప్రయాణం చేస్తుంటారు. దారిలో ఒక చిన్న విషయం మీద గొడవ పడి, ఒకడు కోపంతో రెండోవాడిని కొడతాడు. కొట్టబడినవాడు ఏమీ మాట్లాడకుండా, దగ్గర్లో ఇసుకలో "ఈరోజు నా స్నేహితుడు నన్ను కొట్టాడు" అని రాస్తాడు. కొన్ని రోజుల తర్వాత వాళ్లు ఒక నదీ ఒడ్డుకు చేరుకుంటారు, స్నానం చేస్తుండగా కొట్టబడినవాడు నీళ్లలో మునిగిపోబోతాడు. మొదటివాడు వెంటనే దూకి అతని ప్రాణాన్ని కాపాడతాడు. దీనికి కృతజ్ఞతగా, రెండోవాడు ఈసారి దగ్గర్లో ఉన్న రాతిపై "ఈరోజు నా స్నేహితుడు నా ప్రాణాన్ని కాపాడాడు" అని చెక్కుతాడు. మొదటివాడు ఆశ్చర్యపోయి అడిగితే, రెండోవాడు బదులిస్తాడు: "బాధ కలిగించే మాటలను ఇసుకలో రాయాలి, అవి గాలికి తుడిచిపెట్టుకుపోవాలి. మేలు చేసిన సంగతులను రాతిలో చెక్కాలి, అవి ఎప్పటికీ గుర్తుండాలి."',
  // ధైర్యం — Mouse Frees the Lion
  'ఒక సింహం నిద్రపోతుండగా, ఒక చిన్న ఎలుక పొరపాటున దాని మీద నుండి పరిగెత్తుతుంది. సింహం మేల్కొని కోపంగా ఎలుకను పట్టుకుని చంపబోతుంది. ఎలుక భయపడి "నన్ను క్షమించు, ఏదో ఒకరోజు నీకు నేను సహాయం చేస్తాను" అని వేడుకుంటుంది. సింహం నవ్వి, చిన్న ఎలుక తనకేం సహాయం చేయగలదని అనుకుని దాన్ని వదిలేస్తుంది. కొన్ని రోజుల తర్వాత, సింహం వేటగాళ్ళు వేసిన బలమైన వలలో చిక్కుకుంటుంది. అదే ఎలుక ఆ శబ్దం విని పరిగెత్తుకుంటూ వస్తుంది, ధైర్యంగా వలలోని తాళ్లను తన పదునైన పళ్లతో కొరికి సింహాన్ని విడిపిస్తుంది.',
  // కృతజ్ఞత — Ant and the Dove
  'ఒక చీమ నదీ ఒడ్డున నీళ్లు తాగుతుండగా కాలు జారి నీళ్లలో పడిపోతుంది, కొట్టుకుపోతూ ఉంటుంది. చెట్టు మీద కూర్చున్న ఒక పావురం ఇది చూసి వెంటనే ఒక ఆకుని కోసి నీళ్లలో వేస్తుంది. చీమ ఆ ఆకు మీద ఎక్కి ప్రాణాలు దక్కించుకుంటుంది. కొన్ని రోజుల తర్వాత, ఒక వేటగాడు అదే పావురాన్ని పట్టుకోవడానికి గురిపెడతాడు. చీమ ఇది చూసి వెంటనే వేటగాడి కాలిని గట్టిగా కుడుతుంది. వేటగాడు నొప్పితో గురి తప్పుతాడు, పావురం భయపడి ఎగిరిపోయి ప్రాణాలు దక్కించుకుంటుంది.',
  // వినయం — The Proud Scholar and the Boatman
  'ఒక గొప్ప పండితుడు పడవలో నదిని దాటుతుంటాడు. పడవ నడిపేవాడితో మాట్లాడుతూ "నీకు వ్యాకరణం తెలుసా?" అని అడుగుతాడు. పడవవాడు "లేదు అయ్యా" అంటే, పండితుడు గర్వంగా "అయితే నీ జీవితంలో సగం వృధా అయిపోయింది" అంటాడు. కొంతసేపటికి పెద్ద తుఫాను వచ్చి పడవ మునిగిపోవడం మొదలవుతుంది. పడవవాడు పండితుడితో "అయ్యా, మీకు ఈత వచ్చా?" అని అడుగుతాడు. పండితుడు భయంతో "లేదు" అంటే, పడవవాడు అంటాడు: "అయితే అయ్యా, మీ జీవితం మొత్తం వృధా అయిపోబోతోంది." పండితుడికి తన అహంకారం తప్పని, నిజమైన జ్ఞానం అంటే అందరి నైపుణ్యాలనూ గౌరవించడమని అర్థమవుతుంది.',
  // దయ — The King Who Shared His Bread
  'ఒక రాజ్యంలో తీవ్రమైన కరువు వచ్చి ప్రజలు ఆకలితో అలమటిస్తుంటారు. రాజు తన రాజ్యం తిరిగి పరిస్థితి చూస్తుండగా, దారిలో ఆకలితో సొమ్మసిల్లిపోయిన ఒక వృద్ధుడిని చూస్తాడు. రాజు దగ్గర తనకోసం తెచ్చుకున్న ఒక్క రొట్టె ముక్క మాత్రమే ఉంటుంది. ఆలోచించకుండా, రాజు ఆ రొట్టెను వృద్ధుడికి ఇచ్చేస్తాడు, తాను ఆకలితోనే ఉంటాడు. ఇది చూసిన మంత్రులు ఆశ్చర్యపోతే, రాజు వారితో చెప్తాడు: "ఒక రాజుకు అసలైన సంపద కిరీటంలో కాదు, తన ప్రజల పట్ల చూపే దయలో ఉంటుంది."',
  // సహాయం చేయడం — Boy and the Injured Lion
  'ఒక అబ్బాయి అడవిలో నడుస్తుండగా ఒక సింహం బాధగా అరుస్తూ కనిపిస్తుంది. దగ్గరికి వెళ్లి చూస్తే సింహం కాలిలో పెద్ద ముల్లు గుచ్చుకుని ఉంటుంది. సింహం భయంకరంగా కనిపించినా, అబ్బాయి ధైర్యం చేసి మెల్లగా దగ్గరికి వెళ్లి ఆ ముల్లుని తీసేస్తాడు. సింహం నొప్పి తగ్గి కృతజ్ఞతగా అతన్ని చూసి, అడవిలోకి వెళ్లిపోతుంది. సంవత్సరాల తర్వాత ఆ అబ్బాయి పెద్దయ్యాక, రాజు సైనికులు అతన్ని పట్టుకుని శిక్షగా ఆకలిగొన్న సింహం ఉన్న బోనులో వేస్తారు. సింహం అతని దగ్గరికి వచ్చి, దాడి చేయకుండా అతని కాళ్ల దగ్గర ప్రేమగా కూర్చుంటుంది — అదే పాత సింహం, తనకు సహాయం చేసిన అబ్బాయిని గుర్తుపట్టింది.',
  // నిబద్ధత — The King Who Kept His Promise
  'ఒక రాజు తాను ఇచ్చిన మాటను ఎప్పుడూ తప్పనని ప్రతిజ్ఞ చేస్తాడు. ఒక సాధువుకు తన రాజ్యం మొత్తాన్నీ దానం ఇస్తానని మాట ఇస్తాడు. మాట ఇచ్చిన వెంటనే, రాజు కిరీటాన్ని, రాజ్యాన్ని, సంపదనూ వదిలేసి సాధారణ బట్టలతో అడవిలోకి వెళ్లిపోతాడు. ఎన్ని కష్టాలు వచ్చినా, చివరికి తన భార్యాబిడ్డలను కూడా అమ్మాల్సిన పరిస్థితి వచ్చినా, రాజు తన మాటను వెనక్కి తీసుకోడు. చివరికి అతని మాట నిలబెట్టుకునే స్వభావాన్ని పరీక్షించిన దేవతలు ప్రత్యక్షమై, అతని రాజ్యాన్నీ కుటుంబాన్నీ మళ్ళీ అతనికి ఇచ్చేస్తారు.'
];

function pickMoralValue(runCount) {
  const idx = runCount % MORAL_VALUES.length;
  const value = MORAL_VALUES[idx];
  const outline = STORY_OUTLINES[idx];
  log(`Moral value for run #${runCount}: ${value}`);
  return { value, outline };
}

function buildPrompt(category, article, recentTitles, runCount) {
  const avoidLine = recentTitles.length
    ? `\n\nఇటీవల ఈ అంశాలు వాడాము, వీటిని పునరావృతం చేయకు, పూర్తిగా కొత్త కోణం/విషయం ఎంచుకో: ${recentTitles.slice(-5).join(' | ')}`
    : '';

  let topicInstruction;
  if (category === 'news') {
    topicInstruction = `ఈ వార్తను తీసుకుని, కేవలం పొడి facts లా కాకుండా, అందులో ఉన్న మనుషుల కోణం నుండి, భావోద్వేగంగా, రిలేటబుల్‌గా చెప్పు — వార్త: "${article.title}". ${article.description || ''}\nవార్త నేపథ్యం, ఏమి జరిగింది, ఇది సామాన్య ప్రజలను ఎలా ప్రభావితం చేస్తుందో చెప్పు.`;
  } else if (category === 'moral_story') {
    const { value: moralValue, outline } = pickMoralValue(runCount);
    topicInstruction = `కింద ఇచ్చిన కథను తెలుగులో వివరణాత్మకంగా, ఆసక్తికరంగా చెప్పు. ఇది పూర్తి కథ — మార్చకు, కొత్తగా కల్పించకు, కేవలం విస్తరించి అందంగా చెప్పు:

కథ: ${outline}

నియమాలు:
1. పాత్రలు/సంఘటనలు/క్రమం పైన ఉన్నట్టే ఉంచు (పేర్లు తెలుగులో అనుకూలంగా పెట్టొచ్చు).
2. **కొత్తగా ఏమీ కల్పించకు:** పైన లేని అంశాలు (వాతావరణం, గాయాలు, కొత్త పాత్రలు/సంఘటనలు) జోడించకు. వివరణ ఇవ్వొచ్చు (ఎలా అనిపించింది), కొత్త ఘటనలు వద్దు.
3. జంతువులను ఎప్పుడూ "అది" అని సూచించు (అతను/ఆమె వద్దు), మధ్యలో మార్చకు.
4. Listing లా కాకుండా కథలా రాయి — dialogue వాడు, ఇప్పటికే ఉన్న అంశాలకే వివరణ ఇవ్వు.
5. సాధారణ ఆరంభం ("ఒకప్పుడు ఒక ఊళ్ళో...") వద్దు — ఉద్విగ్న క్షణం/ప్రశ్నతో మొదలుపెట్టు. ఫలితం ముందే చెప్పకు.
6. చివర్లో ప్రత్యేక వాక్యంగా: "ఈ కథ నుండి మనం నేర్చుకునేది ఏమిటంటే..." — **${moralValue}** గురించే ఉండాలి. ఆ తర్వాత మరే వాక్యం వద్దు.
7. Conditional వాక్యం ("ఒకవేళ...అయితే") మొదలుపెడితే పూర్తి చేయి, మధ్యలో ఆపకు.
8. రాశాక మళ్ళీ చదివి సరైన పదాలు/క్రియారూపాలు వాడావో నిర్ధారించుకో (ఉదా. "దూకాడు"ని "దూచాడు" అనొద్దు; "చెక్కాడు"ని "చెక్కించాడు"తో కలపొద్దు).${avoidLine}`;
  } else if (category === 'fact') {
    topicInstruction = `ఒక నిజమైన, ఆసక్తికరమైన విషయం (fact) గురించి "మీకు తెలుసా?" స్టైల్‌లో తెలుగులో రాయి. చాలా ముఖ్యం: సాధారణంగా అందరికీ ఇప్పటికే తెలిసిన, ఇంటర్నెట్‌లో ఎక్కడ చూసినా కనిపించే overused facts (ఉదా. "ఆక్టోపస్‌కి మూడు గుండెలు ఉంటాయి" లాంటివి) వాడకు — తక్కువ మందికి తెలిసిన, నిజంగా ఆశ్చర్యపరిచే fact ఎంచుకో. తప్పుడు సమాచారం ఇవ్వకు, నిజమైన, verifiable fact మాత్రమే వాడు.${avoidLine}`;
  } else {
    topicInstruction = `పిల్లల పెంపకం, కుటుంబ సంబంధాలు, తల్లిదండ్రుల-పిల్లల బంధం గురించి ఒక చిన్న, ఆచరణాత్మకమైన, హృదయాన్ని తాకే సలహా లేదా పాఠం తెలుగులో రాయి. సాధారణంగా అందరూ చెప్పే generic సలహాలు (ఉదా. "పిల్లలతో ఎక్కువ సమయం గడపండి") కాకుండా, ఒక నిర్దిష్టమైన సన్నివేశం/ఉదాహరణతో చెప్పు.${avoidLine}`;
  }

  return `${topicInstruction}
${getCommonRules(category)}

జవాబును ఖచ్చితంగా ఈ మూడు లైన్ల ఫార్మాట్‌లోనే ఇవ్వు, ఇదే క్రమంలో, మరేమీ ముందు/వెనుక రాయకు:
TITLE: (5-8 తెలుగు పదాల్లో ఒక చిన్న శీర్షిక)
KEYWORDS: (ఈ కంటెంట్‌కి సరిపోయే 3 నిర్దిష్టమైన, దృశ్యమానమైన ఆంగ్ల keywords — abstract పదాలు కాకుండా (ఉదా. "wisdom", "life" వద్దు), కళ్ళకి కనిపించే నిర్దిష్ట scene/object/action పదాలు వాడు, ఉదా: "elderly woman smiling", "children playing park", "mother holding baby", "sunrise mountains road". Content కి నేరుగా సంబంధం ఉండాలి, generic వద్దు.)
SCRIPT: (పైన చెప్పిన నియమాల ప్రకారం పూర్తి వాయిస్-ఓవర్ టెక్స్ట్)`;
}

function parseLabeledContent(raw) {
  const titleMatch = raw.match(/TITLE:\s*(.+)/i);
  const keywordsMatch = raw.match(/KEYWORDS:\s*(.+)/i);
  const scriptMatch = raw.match(/SCRIPT:\s*([\s\S]+)/i);
  return {
    title: titleMatch ? titleMatch[1].trim() : null,
    keywords: keywordsMatch ? keywordsMatch[1].trim() : null,
    script: scriptMatch ? scriptMatch[1].trim().replace(/\n+/g, ' ') : null
  };
}

async function callGroq(prompt) {
  const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({
      // Back to llama-3.3-70b-versatile. Deprecated by Groq (2026-06-17) but
      // still serving. Rationale: its known weakness was story LOGIC, which
      // the STORY_OUTLINES approach now handles for it — and that combination
      // was never actually tested together, since outlines and the model
      // switch landed at the same time. Its replacements each brought worse
      // problems no prompt could fix: gpt-oss-120b leaked reasoning text and
      // hallucinated plot details; qwen3.6-27b emitted corrupted Telugu
      // (English fragments spliced mid-word, e.g. "భయంతremover").
      // If Groq fully removes this model, revisit — gpt-oss-120b is the
      // documented replacement.
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  if (!data.choices || !data.choices[0]) {
    throw new Error('Groq did not return content: ' + JSON.stringify(data));
  }
  // Defensive safety net: strip any <think>...</think> block, in case a
  // future model swap brings back a reasoning model whose planning text
  // would otherwise leak straight into the script.
  let content = data.choices[0].message.content.trim();
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  return content;
}

async function generateContent(category, article, recentTitles, runCount) {
  log(`Generating ${category} content via Groq...`);
  const prompt = buildPrompt(category, article, recentTitles, runCount);

  let raw = await callGroq(prompt);
  let { title, keywords, script } = parseLabeledContent(raw);

  if (!script) {
    // Labeled format wasn't followed — fall back to treating the whole
    // reply as the script so one malformed response doesn't fail the run.
    log('WARNING: Groq did not follow the TITLE/KEYWORDS/SCRIPT format, falling back to plain-text parsing.');
    script = raw.replace(/\n+/g, ' ');
  }

  // The many formatting/punctuation rules can sometimes cause the model to
  // under-shoot the word count badly (seen once: ~16s of audio instead of
  // ~25-30s). One retry with the word count called out more forcefully
  // fixes this far more often than not — cheap insurance against a
  // noticeably-too-short video.
  const target = WORD_COUNT_TARGETS[category];
  let wordCount = script.split(/\s+/).filter(Boolean).length;
  if (wordCount < target.min - 15) {
    log(`WARNING: script came back too short (${wordCount} words, need ${target.min}-${target.max}) — retrying with a stronger word-count reminder.`);
    const retryPrompt = prompt + `\n\nచాలా ముఖ్యం: మీ మునుపటి ప్రయత్నం చాలా చిన్నగా (${wordCount} పదాలు మాత్రమే) వచ్చింది. ఈసారి ఖచ్చితంగా ${target.min}-${target.max} తెలుగు పదాలు ఉండేలా SCRIPT రాయి — అవసరమైతే మరిన్ని వివరాలు/ఉదాహరణలు జోడించి పొడిగించు.`;
    raw = await callGroq(retryPrompt);
    const retryParsed = parseLabeledContent(raw);
    if (retryParsed.script) {
      const retryWordCount = retryParsed.script.split(/\s+/).filter(Boolean).length;
      log(`Retry produced ${retryWordCount} words.`);
      if (retryWordCount > wordCount) {
        title = retryParsed.title;
        keywords = retryParsed.keywords;
        script = retryParsed.script;
      }
    }
  }
  if (!title) title = deriveHeadline(script);
  if (!keywords) keywords = FALLBACK_KEYWORDS[category];

  // moral_story specifically requires an explicit, clearly-stated moral —
  // this is what's missing when a story ends on an incoherent or
  // inappropriate note with no real lesson attached. If the required marker
  // phrase isn't present, retry once with a pointed reminder rather than
  // silently publishing a story with no coherent takeaway.
  if (category === 'moral_story' && !script.includes('నేర్చుకునేది')) {
    log('WARNING: script is missing the required explicit moral statement — retrying with a pointed reminder.');
    const retryPrompt = prompt + `\n\nచాలా ముఖ్యం: మీ మునుపటి ప్రయత్నంలో "ఈ కథ నుండి మనం నేర్చుకునేది ఏమిటంటే..." అనే స్పష్టమైన నీతి వాక్యం లేదు. ఈసారి తప్పకుండా ఆ వాక్యంతో కథను ముగించు, మరియు కథ మొత్తం ఆ నీతికి తార్కికంగా సరిపోవాలి (ఎవరినీ దోపిడీ చేయకుండా, మంచి విలువలే గెలిచేలా).`;
    raw = await callGroq(retryPrompt);
    const retryParsed = parseLabeledContent(raw);
    if (retryParsed.script && retryParsed.script.includes('నేర్చుకునేది')) {
      title = retryParsed.title || title;
      keywords = retryParsed.keywords || keywords;
      script = retryParsed.script;
      log('Retry produced a script with the explicit moral statement.');
    } else {
      log('WARNING: retry still missing the moral statement — publishing as-is; please spot-check this video before/after upload.');
    }
  }

  // Defensive: for moral_story, drop anything the model wrote AFTER the
  // required moral statement — it was told not to add more, but
  // occasionally tacked on an extra (sometimes nonsensical) closing line.
  if (category === 'moral_story') {
    const sentencesForTrim = splitIntoSentences(script);
    const moralIdx = sentencesForTrim.findIndex(s => s.includes('నేర్చుకునేది'));
    if (moralIdx !== -1) {
      // If the model put a period right after "ఏమిటంటే", the ACTUAL moral is
      // in the following sentence — keeping only up to moralIdx would chop
      // the moral off entirely (this happened: "...నేర్చుకునేది ఏమిటంటే."
      // with nothing after it). So keep one extra sentence in that case.
      const moralSentence = sentencesForTrim[moralIdx];
      const afterMarker = moralSentence.split('ఏమిటంటే').slice(1).join('ఏమిటంటే').replace(/[.,\s]/g, '');
      const keepUpTo = afterMarker.length < 5 ? moralIdx + 1 : moralIdx;
      if (keepUpTo < sentencesForTrim.length - 1) {
        log(`WARNING: model wrote ${sentencesForTrim.length - 1 - keepUpTo} extra sentence(s) after the moral statement — trimming them off.`);
        script = sentencesForTrim.slice(0, keepUpTo + 1).join(' ');
      }
    }
  }

  // Defensive: strip any CTA-like ending the model wrote anyway, despite
  // being told not to — avoids ending up with two CTA lines back to back.
  const existingSentences = splitIntoSentences(script);
  if (existingSentences.length > 0 && existingSentences[existingSentences.length - 1].includes('ఛానెల్')) {
    existingSentences.pop();
    script = existingSentences.join(' ');
  }

  script = ensureSentenceBreaks(script);
  script = (script.trim() + ' ' + CTA_SENTENCE).trim();
  log(`Title: ${title}`);
  log(`Keywords: ${keywords}`);
  log(`Script (${script.length} chars): ${script}`);
  return { title, keywords, script };
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
  let res = await fetchWithTimeout(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { ssml },
      voice: { languageCode: 'te-IN', name: 'te-IN-Chirp3-HD-Achird' },
      audioConfig: { audioEncoding: 'LINEAR16' }
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
        audioConfig: { audioEncoding: 'LINEAR16' }
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
async function generateAudioForScript(sentences) {
  const commaGap = 0.08;  // shorter pause within a sentence, at a comma
  const periodGap = 0.35; // longer pause between sentences
  log(`Generating audio via Google Cloud TTS (${sentences.length} sentences, further split at commas for reliable pausing)...`);

  const clipEntries = []; // { path, gap: 0 | commaGap | periodGap }
  const sentenceDurations = [];

  for (let si = 0; si < sentences.length; si++) {
    const clauses = sentences[si].split(/,\s*/).map(c => c.trim()).filter(Boolean);
    let sentenceDur = 0;
    for (let ci = 0; ci < clauses.length; ci++) {
      const buf = await synthesizeOneSentence(clauses[ci]);
      const p = path.join(WORK_DIR, `clip_${si}_${ci}.wav`);
      fs.writeFileSync(p, buf);
      const dur = getAudioDuration(p);
      sentenceDur += dur;
      const isLastClauseInSentence = ci === clauses.length - 1;
      const isLastSentence = si === sentences.length - 1;
      let gap = 0;
      if (!isLastClauseInSentence) {
        gap = commaGap;
        sentenceDur += commaGap; // internal comma gaps count toward this sentence's own screen time
      } else if (!isLastSentence) {
        gap = periodGap; // the gap between sentences is folded in by the caller, same as before
      }
      log(`  sentence ${si} clause ${ci}: "${clauses[ci].slice(0, 30)}..." ${dur.toFixed(2)}s, gap after: ${gap}s`);
      clipEntries.push({ path: p, gap });
    }
    sentenceDurations.push(sentenceDur);
  }

  // Match the silence clips' sample rate/channels to the TTS output so the
  // concat demuxer can stitch everything with -c copy (no re-encode needed).
  const fmt = getAudioFormat(clipEntries[0].path);
  const channelLayout = fmt.channels === 1 ? 'mono' : 'stereo';
  const commaSilencePath = path.join(WORK_DIR, 'silence_comma.wav');
  const periodSilencePath = path.join(WORK_DIR, 'silence_period.wav');
  execSync(`ffmpeg -y -f lavfi -i anullsrc=r=${fmt.sampleRate}:cl=${channelLayout} -t ${commaGap} -c:a pcm_s16le "${commaSilencePath}"`, { stdio: 'pipe' });
  execSync(`ffmpeg -y -f lavfi -i anullsrc=r=${fmt.sampleRate}:cl=${channelLayout} -t ${periodGap} -c:a pcm_s16le "${periodSilencePath}"`, { stdio: 'pipe' });

  const listLines = [];
  for (const entry of clipEntries) {
    listLines.push(`file '${path.resolve(entry.path)}'`);
    if (entry.gap === commaGap) listLines.push(`file '${path.resolve(commaSilencePath)}'`);
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
    const files = (video.video_files || [])
      .filter(f => f.file_type === 'video/mp4' && f.height > f.width) // portrait only
      .sort((a, b) => Math.abs(a.width - 720) - Math.abs(b.width - 720));
    if (files.length === 0) continue; // this result has no usable portrait file, try next
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
  return script.split(/(?<=\.)\s*/).map(s => s.trim()).filter(Boolean);
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
async function getSentenceKeywords(sentences) {
  const numbered = sentences.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const prompt = `ఈ కథ కోసం మూడు విభాగాలు ఇవ్వు.

CHARACTER: ప్రధాన పాత్ర రూపం, ఒక లైన్‌లో (వయసు, దుస్తులు, ప్రత్యేకతలు — 15-20 పదాలు, ఆంగ్లంలో). ఇదే వర్ణన ప్రతి scene లోనూ వాడతాం, పాత్ర consistent గా కనిపించడానికి. ఉదా: "elderly Indian man, thin build, white beard, traditional cream dhoti, kind eyes".

KEYWORDS: ప్రతి వాక్యానికి 3-5 పదాల Pexels-సెర్చ్ keyword.

SCENES: ప్రతి వాక్యానికి 15-25 పదాల దృశ్య వర్ణన (ఆంగ్లంలో) — action, expression, స్థలం. పాత్ర ప్రస్తావిస్తే CHARACTER లోని అదే పదాలు వాడు.

నియమాలు:
- పదాలు direct గా అనువదించకు, నిజమైన దృశ్యం రాయి (ఉదా. వైద్య "గుండె" కి "heart" వద్దు — romance ఫోటోలు వస్తాయి — "doctor checking heart with stethoscope" రాయి). భావోద్వేగాలను (courage, wisdom) మాటలుగా వాడకు, దృశ్యంగా చూపించు.
- దేశం చెప్పకపోతే ఎప్పుడూ "Indian"/"South Indian" నేపథ్యం వాడు, Western look వద్దు.

వాక్యాలు:
${numbered}

ఖచ్చితంగా ఈ ఫార్మాట్‌లో, ఇదే క్రమంలో ఇవ్వు:

CHARACTER:
1. character description

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
  const character = parseNumberedSection(raw, 'CHARACTER:', 1)[0];
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
async function generateAIImage(prompt, savePath, seed) {
  const styledPrompt = `${prompt}, cinematic photo, high quality, realistic, vertical portrait composition`;
  const finalSeed = seed !== undefined ? seed : Math.floor(Math.random() * 100000);
  const url = `${POLLINATIONS_BASE}${encodeURIComponent(styledPrompt)}?width=768&height=1365&nologo=true&seed=${finalSeed}`;
  const res = await fetchWithTimeout(url, {}, 15000);
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

// Fetches one clip per sentence: Pexels VIDEO first (real motion — closest
// to how professionally-edited reference videos look), then AI-generated
// image (using a rich, sentence-exact scene description), then Pexels
// photo, in that order. Returns {path, type: 'video'|'image'} per sentence
// (or null on total failure) so buildVideo knows whether to loop/trim a
// real clip or apply a Ken-Burns pan/zoom to a still.
async function fetchImagesPerSentence(sentences, category) {
  let character, keywords, scenes;
  try {
    const result = await getSentenceKeywords(sentences);
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

  const clips = [];
  const usedVideoIds = new Set();
  const usedPexelsIds = new Set(); // avoid repeating the same stock photo within this video
  for (let i = 0; i < sentences.length; i++) {
    const keyword = keywords[i] || FALLBACK_KEYWORDS[category];
    const sceneBase = scenes[i] || keyword;
    const scene = character ? `${character}. ${sceneBase}` : sceneBase;
    log(`Sentence ${i} ("${sentences[i].slice(0, 40)}...") -> keyword: "${keyword}" | AI scene: "${scene.slice(0, 60)}..."`);

    // 1) Real stock video footage — tried first.
    try {
      const result = await fetchPexelsVideo(keyword, i, usedVideoIds);
      usedVideoIds.add(result.id);
      log(`  -> Pexels video succeeded for sentence ${i}.`);
      clips.push({ path: result.path, type: 'video' });
      continue;
    } catch (e) {
      log(`  WARNING: Pexels video search failed for sentence ${i} (${e.message}), falling back to AI image.`);
    }

    // 2) AI-generated image (exact-scene prompt, character-consistent).
    const aiPath = path.join(WORK_DIR, `ai_image_${i}.jpg`);
    try {
      await generateAIImage(scene, aiPath, characterSeed);
      log(`  -> AI-generated image succeeded for sentence ${i}.`);
      clips.push({ path: aiPath, type: 'image' });
      continue;
    } catch (e) {
      log(`  WARNING: AI image generation failed for sentence ${i} (${e.message}), falling back to Pexels photo.`);
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

function buildVideo(mediaItems, audioPath, customDurations) {
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

    // "STORY" badge, top-left, with a soft drop shadow behind the box
    `drawbox=x=43:y=63:w=120:h=44:color=black@0.35:t=fill`,
    `drawbox=x=40:y=60:w=120:h=44:color=${ACCENT}@0.97:t=fill`,
    `drawtext=fontfile='${fontPathBold}':text='STORY':fontcolor=0x0f1024:fontsize=24:x=40+(120-text_w)/2:y=60+(44-text_h)/2`,

    // Channel branding, top-center, with text shadow + a thin accent underline
    `drawtext=fontfile='${fontPathBold}':text='TELUGU ECHO':fontcolor=${ACCENT}:fontsize=32:x=(w-text_w)/2:y=140:shadowcolor=black@0.6:shadowx=2:shadowy=2`,
    `drawbox=x=(iw-160)/2:y=192:w=160:h=4:color=${ACCENT}@0.9:t=fill`,

    // Subscribe CTA styled as a real elevated button: soft glow border behind,
    // drop shadow, bold white text with shadow, small tagline underneath.
    `drawbox=x=(iw-572)/2:y=ih-196:w=572:h=88:color=${ACCENT}@0.35:t=fill`,
    `drawbox=x=(iw-566)/2:y=ih-193+6:w=566:h=82:color=black@0.30:t=fill`,
    `drawbox=x=(iw-560)/2:y=ih-190:w=560:h=76:color=${CTA}@0.97:t=fill`,
    `drawtext=fontfile='${fontPathBold}':text='LIKE   SHARE   SUBSCRIBE':fontcolor=white:fontsize=27:x=(w-text_w)/2:y=h-190+(76-text_h)/2:shadowcolor=black@0.5:shadowx=1:shadowy=1`,
    `drawtext=fontfile='${fontPath}':text='for daily Telugu life stories':fontcolor=white@0.8:fontsize=18:x=(w-text_w)/2:y=h-100`,

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

async function uploadToYouTube(videoPath, title, description) {
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
        tags: ['telugu', 'news', 'shorts', 'telugu news'],
        categoryId: '25'
      },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false }
    },
    media: { body: fs.createReadStream(videoPath) }
  });
  log(`Uploaded! Video ID: ${res.data.id}`);
  return res.data.id;
}

function saveState(article, title) {
  const { usedUrls, usedTitles, runCount } = loadState();
  let newUrls = usedUrls;
  if (article) {
    newUrls = [...usedUrls, article.url];
    if (newUrls.length > 50) newUrls = newUrls.slice(-50);
  }
  let newTitles = [...usedTitles, title];
  if (newTitles.length > 50) newTitles = newTitles.slice(-50);
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    usedUrls: newUrls,
    usedTitles: newTitles,
    runCount: runCount + 1,
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

  checkSecret('NEWSAPI_KEY', NEWSAPI_KEY);
  checkSecret('GROQ_API_KEY', GROQ_API_KEY);
  checkSecret('GOOGLE_TTS_API_KEY', GOOGLE_TTS_API_KEY);
  checkSecret('PEXELS_API_KEY', PEXELS_API_KEY);
  checkSecret('YT_CLIENT_ID', YT_CLIENT_ID);
  checkSecret('YT_CLIENT_SECRET', YT_CLIENT_SECRET);
  checkSecret('YT_REFRESH_TOKEN', YT_REFRESH_TOKEN);

  const category = pickCategory();
  const article = category === 'news' ? await fetchNews() : null;
  const { usedTitles, runCount } = loadState();

  const { title, script } = await generateContent(category, article, usedTitles, runCount);
  const allSentences = splitIntoSentences(script);
  const { audioPath, sentenceDurations, silenceGap } = await generateAudioForScript(allSentences);

  // Fold the gap that follows each sentence (except the last) into that
  // sentence's own on-screen time, so the image holds through the pause
  // before the next line — durations still sum exactly to the full audio.
  let imageDurations = sentenceDurations.map((d, i) => i < sentenceDurations.length - 1 ? d + silenceGap : d);
  let imageSentences = allSentences.slice();

  // Pull the closing CTA sentence out — a stock/AI photo search for "like
  // share subscribe" wouldn't mean anything, so its time is folded into the
  // last content sentence's slide instead.
  const ctaIndex = imageSentences.findIndex(s => s.includes('తెలుగు ఎకో ఛానెల్'));
  if (ctaIndex !== -1) {
    const ctaDur = imageDurations[ctaIndex] || 0;
    imageSentences.splice(ctaIndex, 1);
    imageDurations.splice(ctaIndex, 1);
    if (imageDurations.length > 0) {
      imageDurations[imageDurations.length - 1] += ctaDur;
    } else {
      imageSentences = [allSentences[ctaIndex]];
      imageDurations = [ctaDur];
    }
  }

  // Cap distinct images at 6 (Pexels/Pollinations call budget + render
  // time) — merge any extra trailing sentences' screen time into the last
  // kept slide. Each sentence's own audio was still generated naturally.
  const MAX_SLIDES = 6;
  if (imageSentences.length > MAX_SLIDES) {
    const extraDuration = imageDurations.slice(MAX_SLIDES - 1).reduce((a, b) => a + b, 0);
    imageSentences = imageSentences.slice(0, MAX_SLIDES - 1).concat([imageSentences[imageSentences.length - 1]]);
    imageDurations = imageDurations.slice(0, MAX_SLIDES - 1).concat([extraDuration]);
  }

  log(`Fetching one content-matched image per sentence (${imageSentences.length} sentences)...`);
  const rawImagePaths = await fetchImagesPerSentence(imageSentences, category);

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

  const videoPath = buildVideo(imagePaths, audioPath, keptDurations);

  const ytTitle = article ? article.title : title;
  await uploadToYouTube(
    videoPath,
    ytTitle,
    script + '\n\nPhotos via Pexels (pexels.com).\n\n#TeluguEcho #TeluguStories #Shorts'
  );
  saveState(article, title);
  log('Done!');
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
