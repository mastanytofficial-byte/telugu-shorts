// Telugu Daily News Shorts — fully automated, runs on GitHub Actions
// News -> Script (Groq) -> Voice (Google TTS) -> Video (FFmpeg) -> YouTube

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { google } = require('googleapis');

const NEWSAPI_KEY = process.env.NEWSAPI_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY;
const YT_CLIENT_ID = process.env.YT_CLIENT_ID;
const YT_CLIENT_SECRET = process.env.YT_CLIENT_SECRET;
const YT_REFRESH_TOKEN = process.env.YT_REFRESH_TOKEN;

const STATE_FILE = path.join(__dirname, 'last-article.json');
const WORK_DIR = path.join(__dirname, 'work');

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function fetchNews() {
  log('Fetching news from NewsAPI...');
  // pageSize raised 10 -> 20 to give the dedup check more room to find a fresh article
  const url = `https://newsapi.org/v2/everything?q=India&language=en&sortBy=publishedAt&pageSize=20&apiKey=${NEWSAPI_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.articles || data.articles.length === 0) {
    throw new Error('No articles found from NewsAPI');
  }

  // Load history of previously used article URLs (last 50 runs), not just the last one.
  // A single "lastUrl" check misses articles that stay in NewsAPI's top results for
  // multiple days and resurface after being pushed down temporarily.
  let usedUrls = [];
  if (fs.existsSync(STATE_FILE)) {
    try {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      // supports both the old single-url format and the new history format
      usedUrls = state.usedUrls || (state.url ? [state.url] : []);
    } catch (e) {}
  }

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

async function generateScript(article) {
  log('Generating script via Groq...');
  const prompt = `ఈ వార్త మీద YouTube Short video కోసం రెండు వేర్వేరు విషయాలు తెలుగులో తయారు చేయి: "${article.title}". ${article.description || ''}

1. headline: ఈ వార్త యొక్క ప్రధాన అంశం (core theme) ఏమిటో ఒక్క చూపులో అర్థమయ్యేలా, 5 నుండి 8 తెలుగు పదాల్లో ఒక స్పష్టమైన, పూర్తి అర్థం వచ్చే headline. ఇది స్వతంత్రమైన headline గా ఉండాలి — script లో నుండి ముందు కొన్ని పదాలు కత్తిరించినట్టు కాకుండా, వార్త మొత్తం సారాంశాన్ని ప్రతిబింబించాలి.
2. script: 20 సెకన్ల వాయిస్-ఓవర్ కోసం పూర్తి వివరణాత్మక script — వార్త యొక్క నేపథ్యం, ఏమి జరిగింది, ఎందుకు ముఖ్యమో అన్నీ ఇందులో ఉండాలి. సులభమైన భాషలో, ఆకర్షణీయంగా రాయి. ఇది 4-6 చిన్న వాక్యాలుగా ఉండాలి, ప్రతి వాక్యం తర్వాత తప్పకుండా పూర్ణవిరామం (.) పెట్టాలి — ఏ ఒక్క వాక్యం కూడా చాలా పొడవుగా (commas తో కలిపి ఒకే వాక్యంగా) ఉండకూడదు, ఎందుకంటే అలా ఉంటే వాయిస్ జనరేషన్ fail అవుతుంది. Line breaks మాత్రం వాడకు, అన్నీ ఒకే paragraph లో ఉండాలి, కానీ వాక్యాల మధ్య పూర్ణవిరామం మాత్రం ఖచ్చితంగా ఉండాలి. తప్పకుండా కనీసం 85 తెలుగు పదాలు వాడి 95 పదాలు మీరకూడదు. చివర్లో ఖచ్చితంగా ఈ వాక్యం జోడించు (ఇది కూడా ఒక పూర్తి వాక్యంగా, ముందు పూర్ణవిరామం తర్వాత): మరిన్ని ఇలాంటి వార్తల కోసం తెలుగు ఎకో ఛానెల్‌ని లైక్ చేయండి, షేర్ మరియు సబ్‌స్క్రైబ్ చేయండి.

జవాబును ఖచ్చితంగా ఈ JSON ఫార్మాట్‌లో మాత్రమే ఇవ్వు, మరేమీ ముందు/వెనుక రాయకు: {"headline": "...", "script": "..."}`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    })
  });
  const data = await res.json();
  if (!data.choices || !data.choices[0]) {
    throw new Error('Groq did not return a script: ' + JSON.stringify(data));
  }
  const raw = data.choices[0].message.content.trim();

  let headline, script;
  try {
    const parsed = JSON.parse(raw);
    headline = (parsed.headline || '').trim();
    script = (parsed.script || '').trim().replace(/\n+/g, ' ');
    if (!headline || !script) throw new Error('missing headline or script field');
  } catch (e) {
    // Fallback so one malformed JSON response doesn't fail the whole run:
    // treat the raw reply as the script and derive an old-style headline
    // (first few words) from it.
    log('WARNING: Groq did not return valid JSON, falling back to plain-text parsing.');
    script = raw.replace(/\n+/g, ' ');
    headline = deriveHeadline(script);
  }

  script = ensureSentenceBreaks(script);

  log(`Headline: ${headline}`);
  log(`Script (${script.length} chars): ${script}`);
  return { headline, script };
}

async function generateAudio(script) {
  log('Generating audio via Google Cloud TTS...');
  // te-IN-Chirp3-HD-Achird: male, Chirp 3: HD tier — Google's newest, most
  // natural/human-sounding voice family (vs. the old Standard tier, which
  // sounds noticeably robotic). Chirp 3: HD has its own free quota of
  // 1,000,000 characters/month, completely separate from the Standard
  // voices' 4,000,000/month quota — at ~15,000 chars/month this pipeline
  // stays comfortably inside the free tier either way.
  // Other male options in the same tier if you want to compare:
  // te-IN-Chirp3-HD-Algenib, te-IN-Chirp3-HD-Algieba, te-IN-Chirp3-HD-Alnilam
  // Note: Chirp 3: HD voices don't support SSML, pitch, or speakingRate —
  // fine here since we only ever send plain text.
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text: script },
      voice: { languageCode: 'te-IN', name: 'te-IN-Chirp3-HD-Achird' },
      audioConfig: { audioEncoding: 'LINEAR16' }
    })
  });
  const data = await res.json();
  if (!data.audioContent) {
    throw new Error('Google TTS did not return audio: ' + JSON.stringify(data));
  }
  const audioPath = path.join(WORK_DIR, 'audio.wav');
  fs.writeFileSync(audioPath, Buffer.from(data.audioContent, 'base64'));
  log(`Audio saved to ${audioPath}`);
  return audioPath;
}

function escapeForFfmpeg(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, '\u2019')
    .replace(/%/g, '\\%');
}

function getAudioDuration(audioPath) {
  const out = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}"`).toString().trim();
  return parseFloat(out);
}

// Breaks a headline into multiple lines so it never runs wider than the 720px frame.
// maxCharsPerLine is tuned for Telugu glyphs at fontsize ~38-42 on a 720px-wide video.
function wrapText(text, maxCharsPerLine = 20) {
  const words = text.split(' ');
  let lines = [];
  let current = '';
  for (const w of words) {
    const candidate = (current + ' ' + w).trim();
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current.trim());
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current.trim());
  return lines.join('\n');
}

// Writes a minimal .ass subtitle file containing the headline as a single,
// screen-long event. Rendered via the 'subtitles' filter (libass) instead of
// drawtext so Telugu conjuncts/vowel-signs shape correctly.
// ASS colours are &HAABBGGRR (alpha first, then BGR — reverse of usual RGB).
function writeHeadlineAss(wrappedText, fontsize, filePath, fontFamily) {
  // Sanitize each line's OWN content first, then join with the ASS forced
  // line-break marker \N. Doing it in the other order (join first, strip
  // backslashes after) destroys our own \N marker, leaving a stray "N" in
  // the middle of the text — exactly the bug that showed up on screen.
  const sanitizedLines = wrappedText.split('\n').map(line => line.replace(/[{}\\]/g, ''));
  const assText = sanitizedLines.join('\\N');
  const ass = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 720',
    'PlayResY: 1280',
    'WrapStyle: 2',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Headline,${fontFamily},${fontsize},&H00FFFFFF,&H000000FF,&H00000000,&H8C0A0A14,0,0,0,0,100,100,0,0,3,0,2,5,60,60,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    `Dialogue: 0,0:00:00.00,0:59:59.00,Headline,,0,0,0,,${assText}`,
    ''
  ].join('\n');
  fs.writeFileSync(filePath, ass, 'utf8');
}

// libass (the 'subtitles' filter) looks fonts up by the family name embedded
// INSIDE the font file, not by the filename — "NotoSansTelugu-Regular.ttf"
// does not guarantee the font's internal family name is "NotoSansTelugu".
// If the name in our .ass Style doesn't match exactly, libass silently
// falls back to a default font with no Telugu glyphs, rendering every
// Telugu character as an empty box (□) — which is exactly what showed up
// on screen. Detecting the real name via fontconfig avoids guessing.
function getFontFamilyName(fontPath, fallback) {
  try {
    const out = execSync(`fc-scan --format "%{family}\n" "${fontPath}"`).toString().trim().split('\n')[0];
    return out || fallback;
  } catch (e) {
    log(`WARNING: could not detect font family name for ${fontPath}, falling back to "${fallback}"`);
    return fallback;
  }
}

function buildVideo(headline, audioPath) {
  log('Building video with FFmpeg...');
  const outPath = path.join(WORK_DIR, 'output.mp4');
  const fontsDir = path.join(__dirname, 'fonts');
  const fontPath = path.join(fontsDir, 'NotoSansTelugu-Regular.ttf');
  // Bold weight for the badge/branding/CTA — falls back to the regular font
  // if a bold Telugu file isn't present in the repo.
  const fontPathBoldCandidate = path.join(fontsDir, 'NotoSansTelugu-Bold.ttf');
  const fontPathBold = fs.existsSync(fontPathBoldCandidate) ? fontPathBoldCandidate : fontPath;

  const ACCENT = '0xFFC107'; // gold/amber - brand accent (badge, channel name)
  const CTA = '0xE62117';    // YouTube red - subscribe button, instantly recognizable
  const BG1 = '0x0f1024';
  const BG2 = '0x1b2a4a';

  // Match the video length to the ACTUAL narration length instead of a hardcoded 30s.
  const duration = getAudioDuration(audioPath) + 0.3;
  const fd = duration.toFixed(2);
  log(`Audio duration: ${fd}s — video length set to match`);

  // Wider lines + bigger font so the headline fills the frame instead of
  // looking like a small paragraph floating in empty space.
  const wrapped = wrapText(headline, 24);
  const lineCount = wrapped.split('\n').length;
  const fontsize = lineCount <= 2 ? 56 : lineCount <= 4 ? 46 : 36;

  // IMPORTANT: the Telugu headline is rendered via libass (the 'subtitles'
  // filter), NOT drawtext. ffmpeg's drawtext filter has no complex-script
  // shaping engine — it draws each Unicode codepoint's base glyph one after
  // another with no reordering or conjunct/vowel-sign shaping. For Telugu
  // (and other Indic scripts) that produces visibly scrambled text on
  // screen even though the underlying string is 100% correct — this is
  // exactly what showed up in the last render. libass uses HarfBuzz
  // internally and shapes Telugu correctly.
  const assPath = path.join(WORK_DIR, 'headline.ass');
  const teluguFontFamily = getFontFamilyName(fontPath, 'NotoSansTelugu');
  log(`Detected Telugu font family name: ${teluguFontFamily}`);
  writeHeadlineAss(wrapped, fontsize, assPath, teluguFontFamily);

  // NOTE on drawbox positioning: inside drawbox, 'w' and 'h' in x/y expressions
  // refer to the box's OWN width/height option (not the frame) — using them
  // there silently pushes the box off-screen. Always use 'iw'/'ih' (input
  // width/height) for x/y math in drawbox. drawtext does not have this
  // problem — its 'w'/'h' correctly mean the frame's width/height.
  const filters = [
    'vignette',
    // "NEWS" badge, top-left
    `drawbox=x=40:y=60:w=120:h=44:color=${ACCENT}@0.95:t=fill`,
    `drawtext=fontfile='${fontPathBold}':text='NEWS':fontcolor=${BG1}:fontsize=24:x=40+(120-text_w)/2:y=60+(44-text_h)/2`,
    // Channel branding, top-center, with a thin accent underline
    `drawtext=fontfile='${fontPathBold}':text='TELUGU ECHO':fontcolor=${ACCENT}:fontsize=32:x=(w-text_w)/2:y=140`,
    `drawbox=x=(iw-160)/2:y=192:w=160:h=4:color=${ACCENT}@0.85:t=fill`,
    // Headline card, rendered through libass for correct Telugu shaping
    `subtitles='${assPath}':fontsdir='${fontsDir}'`,
    // Subscribe CTA styled as a real button (YouTube red), with a small tagline
    `drawbox=x=(iw-560)/2:y=ih-190:w=560:h=76:color=${CTA}@0.95:t=fill`,
    `drawtext=fontfile='${fontPathBold}':text='LIKE   SHARE   SUBSCRIBE':fontcolor=white:fontsize=27:x=(w-text_w)/2:y=h-190+(76-text_h)/2`,
    `drawtext=fontfile='${fontPath}':text='for daily Telugu news updates':fontcolor=white@0.75:fontsize=18:x=(w-text_w)/2:y=h-100`,
    // Smooth fade in/out
    `fade=t=in:st=0:d=0.5`,
    `fade=t=out:st=${(duration - 0.5).toFixed(2)}:d=0.5`
  ].join(',');

  const cmd = [
    'ffmpeg -y',
    `-f lavfi -i "gradients=s=720x1280:c0=${BG1}:c1=${BG2}:x0=0:y0=0:x1=0:y1=1280:speed=0.00001:d=${fd}"`,
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

function saveState(article) {
  let usedUrls = [];
  if (fs.existsSync(STATE_FILE)) {
    try {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      usedUrls = state.usedUrls || [];
    } catch (e) {}
  }
  usedUrls.push(article.url);
  // keep only the most recent 50 so the file doesn't grow forever
  if (usedUrls.length > 50) usedUrls = usedUrls.slice(-50);
  fs.writeFileSync(STATE_FILE, JSON.stringify({ usedUrls, lastTitle: article.title, lastDate: new Date().toISOString() }, null, 2));
}

// FALLBACK ONLY: used if Groq ever fails to return valid JSON (see
// generateScript). Normally the headline comes from Groq itself, written to
// actually summarize the news — not just the script's opening words, which
// used to cut off mid-thought and not convey the story.
function deriveHeadline(script, maxWords = 12) {
  const words = script.split(' ').filter(Boolean);
  let headline = words.slice(0, maxWords).join(' ');
  if (words.length > maxWords) headline += '...';
  return headline;
}

async function main() {
  if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });

  const article = await fetchNews();
  const { headline, script } = await generateScript(article);
  const audioPath = await generateAudio(script);
  const videoPath = buildVideo(headline, audioPath);
  await uploadToYouTube(videoPath, article.title, script + '\n\n#TeluguEcho #TeluguNews #Shorts');
  saveState(article);
  log('Done!');
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
