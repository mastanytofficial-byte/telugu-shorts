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
  moral_story: 'wisdom life India',
  fact: 'knowledge curious facts',
  parenting: 'family parenting India'
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
function getCommonRules(category) {
  const { min, max } = WORD_COUNT_TARGETS[category];
  return `
ఇది చాలా ముఖ్యం: script తప్పకుండా కనీసం ${min} తెలుగు పదాలు ఉండాలి, ${max} పదాలు మీరకూడదు. దీని కన్నా తక్కువ రాయకు — తక్కువ రాస్తే వీడియో చాలా చిన్నదిగా అయిపోతుంది.

సహజంగా, మాట్లాడేటట్టు, ఆకర్షణీయంగా రాయి — ఒక వ్యక్తి మరొకరికి ఈ విషయం చెప్తున్నట్టు అనిపించాలి. సాధారణ వాక్యాల్లా రాయి, ప్రతి పూర్తి వాక్యం అయిపోయాక పూర్ణవిరామం (.) పెట్టు.

సంఖ్యలను ఎప్పుడూ అంకెలలో (2000) కాకుండా తెలుగు మాటల్లోనే రాయి (ఉదా. 2000 బదులు "రెండు వేలు" అని రాయి) — లేకపోతే వాయిస్ వాటిని తప్పుగా చదువుతుంది.

కంపెనీ/వ్యక్తుల/brand పేర్లను (ఉదా. Uber, Apple, Google) ఎప్పుడూ ఆంగ్ల స్పెల్లింగ్‌లోనే ఉంచు, తెలుగులోకి మార్చకు.

చివర్లో ఖచ్చితంగా ఈ వాక్యం జోడించు: మరిన్ని ఇలాంటి వీడియోల కోసం తెలుగు ఎకో ఛానెల్‌ని లైక్ చేయండి, షేర్ మరియు సబ్‌స్క్రైబ్ చేయండి.`;
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

function pickMoralValue(runCount) {
  const value = MORAL_VALUES[runCount % MORAL_VALUES.length];
  log(`Moral value for run #${runCount}: ${value}`);
  return value;
}

function buildPrompt(category, article, recentTitles, runCount) {
  const avoidLine = recentTitles.length
    ? `\n\nఇటీవల ఈ అంశాలు వాడాము, వీటిని పునరావృతం చేయకు, పూర్తిగా కొత్త కోణం/విషయం ఎంచుకో: ${recentTitles.slice(-5).join(' | ')}`
    : '';

  let topicInstruction;
  if (category === 'news') {
    topicInstruction = `ఈ వార్తను తీసుకుని, కేవలం పొడి facts లా కాకుండా, అందులో ఉన్న మనుషుల కోణం నుండి, భావోద్వేగంగా, రిలేటబుల్‌గా చెప్పు — వార్త: "${article.title}". ${article.description || ''}\nవార్త నేపథ్యం, ఏమి జరిగింది, ఇది సామాన్య ప్రజలను ఎలా ప్రభావితం చేస్తుందో చెప్పు.`;
  } else if (category === 'moral_story') {
    const moralValue = pickMoralValue(runCount);
    topicInstruction = `**${moralValue}** అనే విలువ ప్రధానంగా ఉండే ఒక ప్రసిద్ధ, పాత నీతి కథ ఎంచుకో — పంచతంత్రం, ఈసప్ కథలు, జాతక కథలు (బుద్ధుడి పూర్వజన్మ కథలు), అక్బర్-బీర్బల్, తెనాలి రామకృష్ణ, విక్రమార్క-బేతాళ కథలు వీటిలో దేని నుండైనా — మరియు దాన్ని తెలుగులో, ఈ కథ తెలియని వారికి కూడా ఆసక్తికరంగా ఉండేలా తిరిగి చెప్పు (సొంతంగా కొత్త కథ సృష్టించకు, ఇప్పటికే ఉన్న కథనే వాడు — ఇలా చేస్తే కథ స్పష్టంగా, అర్థవంతంగా ఉంటుంది).

ఇలా చేయి:
1. కథ యొక్క పాత్రలు, సంఘటనలు అసలు కథలో ఉన్నట్టే ఉంచు (పేర్లు తెలుగులో అనుకూలంగా మార్చొచ్చు, కానీ కథా క్రమం మార్చకు) — ఇది స్పష్టంగా, తార్కికంగా ఉండేలా చూసుకో.
2. కథ మొత్తం **${moralValue}** అనే విలువను ప్రతిబింబించేలా ఉండాలి.
3. కథ చివర్లో, ఒక ప్రత్యేక వాక్యంగా, ఖచ్చితంగా ఇలా మొదలుపెట్టి నీతిని స్పష్టంగా చెప్పాలి: "ఈ కథ నుండి మనం నేర్చుకునేది ఏమిటంటే..." — ఈ నీతి వాక్యం ${moralValue} గురించే ఉండాలి, ఈ నీతి వాక్యం లేకుండా కథ పూర్తి కాదు.

ఖచ్చితంగా వద్దు (very important): ఎవరినైనా exploit చేయడం, ఒక వ్యక్తిని బహుమతిలా ఇవ్వడం/మార్పిడి చేయడం, బలవంతపు లేదా లావాదేవీ పెళ్ళిళ్ళు, హింస — ఇలాంటి ఇతివృత్తాలు ఉన్న కథ ఎంచుకోకు, వేరే కథ ఎంచుకో.${avoidLine}`;
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
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  if (!data.choices || !data.choices[0]) {
    throw new Error('Groq did not return content: ' + JSON.stringify(data));
  }
  return data.choices[0].message.content.trim();
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

  script = ensureSentenceBreaks(script);
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
  const commaGap = 0.15;  // shorter pause within a sentence, at a comma
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

async function fetchImages(query, count, startIndex = 0) {
  log(`Fetching ${count} images from Pexels for: "${query}"...`);
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&orientation=portrait`;
  const res = await fetchWithTimeout(url, { headers: { Authorization: (PEXELS_API_KEY || '').trim() } });
  const data = await res.json();
  if (!data.photos || data.photos.length === 0) {
    throw new Error(`Pexels returned no photos for "${query}": ` + JSON.stringify(data));
  }
  const imagePaths = [];
  for (let i = 0; i < data.photos.length; i++) {
    const src = data.photos[i].src || {};
    const imgUrl = src.large2x || src.large || src.original;
    try {
      const imgRes = await fetchWithTimeout(imgUrl);
      if (!imgRes.ok) {
        log(`WARNING: image ${i} download failed (HTTP ${imgRes.status}), skipping it.`);
        continue;
      }
      const buf = Buffer.from(await imgRes.arrayBuffer());
      if (buf.length < 5000) {
        // A real photo is essentially never this small — this is almost
        // certainly an error page/placeholder that slipped through, not a
        // usable image. Including it would give that "slide" a broken or
        // wildly wrong-duration clip in the final video.
        log(`WARNING: image ${i} downloaded but is suspiciously small (${buf.length} bytes), skipping it.`);
        continue;
      }
      const imgPath = path.join(WORK_DIR, `image_${startIndex}_${imagePaths.length}.jpg`);
      fs.writeFileSync(imgPath, buf);
      imagePaths.push(imgPath);
    } catch (e) {
      log(`WARNING: image ${i} download threw an error (${e.message}), skipping it.`);
    }
  }
  if (imagePaths.length === 0) {
    throw new Error(`All ${data.photos.length} image downloads failed for "${query}"`);
  }
  if (imagePaths.length < count) {
    log(`WARNING: only ${imagePaths.length}/${count} images downloaded successfully — video will use fewer, evenly-longer slides instead of failing.`);
  } else {
    log(`Downloaded ${imagePaths.length} images from Pexels.`);
  }
  return imagePaths;
}

// If the specific keyword search comes up empty, fall back to a
// category-appropriate generic query so the run doesn't fail outright.
async function fetchImagesWithFallback(query, count, category, startIndex = 0) {
  try {
    return await fetchImages(query, count, startIndex);
  } catch (e) {
    log('WARNING: image search failed for the specific keywords, falling back to a generic query. ' + e.message);
    return await fetchImages(FALLBACK_KEYWORDS[category] || 'India', count, startIndex);
  }
}

// Splits a script into its individual sentences (by period) — used to fetch
// one image per sentence instead of a handful of generic images for the
// whole script, so what's on screen actually matches what's being said at
// that moment.
function splitIntoSentences(script) {
  return script.split(/(?<=\.)\s*/).map(s => s.trim()).filter(Boolean);
}

// Asks Groq for one concrete, visual English keyword phrase per sentence, in
// a single call (cheap) so each sentence can get its own matching photo.
async function getSentenceKeywords(sentences) {
  const numbered = sentences.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const prompt = `కింద ఇచ్చిన ప్రతి వాక్యానికి, ఒక stock-photo వెబ్‌సైట్ (Pexels) లో సెర్చ్ చేసేందుకు ఆంగ్ల keyword phrase (3-5 పదాలు) ఇవ్వు.

చాలా ముఖ్యమైన నియమం — వాక్యంలోని పదాలను నేరుగా అనువదించకు, బదులుగా ఆ వాక్యానికి సరిపోయే **నిజమైన దృశ్యం (scene)** ఏమిటో ఆలోచించి రాయి. కొన్ని పదాలను direct గా అనువదిస్తే stock photo sites లో పూర్తిగా వేరే అర్థం వచ్చే ఫోటోలు వస్తాయి:
- "గుండె" (heart) గురించి వైద్యపరంగా మాట్లాడితే "heart" అని రాస్తే stock sites లో romance/couple ఫోటోలు వస్తాయి — బదులుగా "doctor stethoscope checkup" లేదా "healthy heart medical" అని రాయి.
- భావోద్వేగాలు/నైరూప్య భావనలు (courage, wisdom, love అనే మాటలు మాత్రమే) వాడకు — ఆ భావన కళ్ళకి ఎలా కనిపిస్తుందో ఆ దృశ్యం రాయి (ఉదా. "courage" కి బదులు "person climbing mountain").
- ఒక దేశం/ప్రదేశం ప్రస్తావిస్తే, ఆ దేశం పేరుని కూడా keyword లో చేర్చు (ఉదా. చైనాలో ఒక క్రీడ గురించి అయితే "China [sport name] athletes" అని రాయి, కేవలం sport పేరు మాత్రమే కాదు).
- ఎప్పుడూ ఇలా ప్రశ్నించుకో: "ఈ కీవర్డ్ సెర్చ్ చేస్తే వచ్చే ఫోటో నిజంగా ఈ వాక్యం సందర్భానికి సరిపోతుందా?"

వాక్యాలు:
${numbered}

జవాబును ఇదే నంబరింగ్‌తో, ఒక్కో లైన్‌లో ఒకటి చొప్పున ఇవ్వు, మరేమీ ముందు/వెనుక రాయకు:
1. keyword phrase
2. keyword phrase
...`;

  const raw = await callGroq(prompt);
  log(`Raw sentence-keywords response from Groq:\n${raw}`);
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  return sentences.map((_, i) => {
    // Lenient match: allows leading markdown (*, -, **), then the number,
    // then '.', ')', or ':' as the separator — real Groq responses have
    // varied on this and a strict match silently nulled every keyword,
    // which is what was causing every sentence to fall back to the same
    // generic category image regardless of what it actually said.
    const re = new RegExp(`^[\\*\\-\\s]*${i + 1}\\s*[.):]\\s*(.+)`);
    const line = lines.map(l => l.match(re)).find(Boolean);
    const keyword = line ? line[1].replace(/\*\*/g, '').trim() : null;
    log(`  sentence ${i} keyword: ${keyword || '(none parsed — will use category fallback)'}`);
    return keyword;
  });
}

// Fetches one image per sentence (own Pexels search each), falling back to
const POLLINATIONS_BASE = 'https://image.pollinations.ai/prompt/';

// Generates one AI image matching the sentence's content via Pollinations.ai
// (free, no API key required). This has NO reliability guarantee (can be
// slow or down), so every call here is immediately backed by a Pexels
// fallback in fetchImagesPerSentence — never the only path to an image.
async function generateAIImage(prompt, savePath) {
  const styledPrompt = `${prompt}, cinematic photo, high quality, realistic, vertical portrait composition`;
  const seed = Math.floor(Math.random() * 100000);
  const url = `${POLLINATIONS_BASE}${encodeURIComponent(styledPrompt)}?width=768&height=1365&nologo=true&seed=${seed}`;
  const res = await fetchWithTimeout(url, {}, 30000);
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

// Fetches one image per sentence: AI-generated first (exact content match),
// Pexels as the fallback if generation fails, times out, or is rate-limited.
async function fetchImagesPerSentence(sentences, category) {
  let sentenceKeywords;
  try {
    sentenceKeywords = await getSentenceKeywords(sentences);
  } catch (e) {
    log('WARNING: per-sentence keyword generation failed, all slides will use the generic category query. ' + e.message);
    sentenceKeywords = sentences.map(() => null);
  }

  const imagePaths = [];
  for (let i = 0; i < sentences.length; i++) {
    const query = sentenceKeywords[i] || FALLBACK_KEYWORDS[category];
    log(`Sentence ${i} ("${sentences[i].slice(0, 40)}...") -> image prompt: "${query}"`);

    const aiPath = path.join(WORK_DIR, `ai_image_${i}.jpg`);
    try {
      await generateAIImage(query, aiPath);
      log(`  -> AI-generated image succeeded for sentence ${i}.`);
      imagePaths.push(aiPath);
      continue;
    } catch (e) {
      log(`  WARNING: AI image generation failed for sentence ${i} (${e.message}), falling back to Pexels.`);
    }

    try {
      const paths = await fetchImagesWithFallback(query, 1, category, i);
      imagePaths.push(paths[0]);
    } catch (e) {
      log(`  WARNING: sentence ${i} image totally failed (${e.message}) — this sentence will be skipped visually.`);
      imagePaths.push(null);
    }
  }
  return imagePaths;
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

function buildVideo(imagePaths, audioPath, customDurations) {
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

  const n = imagePaths.length;
  if (n === 0) {
    throw new Error('buildVideo received zero images — refusing to continue (would divide duration by zero).');
  }
  // customDurations lets each slide match how long its sentence actually
  // takes to say, instead of every slide getting an equal, arbitrary share
  // of the total — this is what keeps the image on screen in sync with
  // what's being narrated at that moment.
  let durations = customDurations;
  if (!durations || durations.length !== n) {
    const equal = duration / n;
    durations = imagePaths.map(() => equal);
  }
  log(`Building ${n}-image Ken Burns slideshow, durations: ${durations.map(d => d.toFixed(2)).join('s, ')}s...`);

  // Step 1: one Ken-Burns clip per image, alternating zoom-in/zoom-out for variety.
  const clipPaths = [];
  for (let i = 0; i < n; i++) {
    const clipPath = path.join(WORK_DIR, `clip_${i}.mp4`);
    buildImageClip(imagePaths[i], durations[i], clipPath, i % 2 === 0);
    const actualDur = getAudioDuration(clipPath); // works for video streams too via ffprobe format=duration
    log(`  clip_${i}: target ${durations[i].toFixed(2)}s, actual ${actualDur.toFixed(2)}s${Math.abs(actualDur - durations[i]) > 1 ? ' ⚠️ MISMATCH' : ''}`);
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

async function uploadToYouTube(videoPath, title, description) {
  log('Uploading to YouTube...');
  const oauth2Client = new google.auth.OAuth2(YT_CLIENT_ID, YT_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: YT_REFRESH_TOKEN });

  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: title.slice(0, 95),
        description: description,
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
    const ctaDur = imageDurations[ctaIndex];
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
    const fallbackPaths = await fetchImagesWithFallback(FALLBACK_KEYWORDS[category], 1, category, 999);
    imagePaths.push(fallbackPaths[0]);
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
