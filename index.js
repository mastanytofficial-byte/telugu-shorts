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

async function generateScript(article) {
  log('Generating script via Groq...');
  const prompt = `ఈ వార్త మీద 20 సెకన్ల YouTube Short video script Telugu లో రాయి, సులభమైన భాషలో, ఆకర్షణీయంగా: ${article.title}. ${article.description || ''}, మరియు దాన్ని ఒకే paragraph గా, ఎటువంటి line breaks లేకుండా, తప్పకుండా కనీసం 85 తెలుగు పదాలు వాడి 95 పదాలు మీరకూడదు రాయండి. చివర్లో ఖచ్చితంగా ఈ వాక్యం జోడించు: మరిన్ని ఇలాంటి వార్తల కోసం తెలుగు ఎకో ఛానెల్‌ని లైక్ చేయండి, షేర్ మరియు సబ్‌స్క్రైబ్ చేయండి.`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
    throw new Error('Groq did not return a script: ' + JSON.stringify(data));
  }
  const script = data.choices[0].message.content.trim().replace(/\n+/g, ' ');
  log(`Script (${script.length} chars): ${script}`);
  return script;
}

async function generateAudio(script) {
  log('Generating audio via Google Cloud TTS...');
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text: script },
      voice: { languageCode: 'te-IN', name: 'te-IN-Standard-A' },
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

function buildVideo(headline, audioPath) {
  log('Building video with FFmpeg...');
  const outPath = path.join(WORK_DIR, 'output.mp4');
  const fontPath = path.join(__dirname, 'fonts', 'NotoSansTelugu-Regular.ttf');
  // Bold weight for the badge/branding/CTA — falls back to the regular font
  // if a bold Telugu file isn't present in the repo.
  const fontPathBoldCandidate = path.join(__dirname, 'fonts', 'NotoSansTelugu-Bold.ttf');
  const fontPathBold = fs.existsSync(fontPathBoldCandidate) ? fontPathBoldCandidate : fontPath;

  const ACCENT = '0xFFC107'; // gold/amber - brand accent (badge, channel name, progress bar)
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

  const textFilePath = path.join(WORK_DIR, 'headline.txt');
  fs.writeFileSync(textFilePath, wrapped, 'utf8');

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
    // Headline card: shadowed text on a semi-transparent panel so it reads as
    // a designed card, not text floating on a flat background
    `drawtext=fontfile='${fontPath}':textfile='${textFilePath}':fontcolor=white:fontsize=${fontsize}:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=18:box=1:boxcolor=black@0.45:boxborderw=30:shadowcolor=black@0.6:shadowx=2:shadowy=2`,
    // Subscribe CTA styled as a real button (YouTube red), with a small tagline
    `drawbox=x=(iw-560)/2:y=ih-190:w=560:h=76:color=${CTA}@0.95:t=fill`,
    `drawtext=fontfile='${fontPathBold}':text='LIKE   SHARE   SUBSCRIBE':fontcolor=white:fontsize=27:x=(w-text_w)/2:y=h-190+(76-text_h)/2`,
    `drawtext=fontfile='${fontPath}':text='for daily Telugu news updates':fontcolor=white@0.75:fontsize=18:x=(w-text_w)/2:y=h-100`,
    // Progress bar along the very bottom edge
    `drawbox=x=0:y=ih-8:w='iw*min(t/${fd}\,1)':h=8:color=${ACCENT}@0.9:t=fill`,
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

// Uses the opening words of the Telugu script as the on-screen headline instead
// of NewsAPI's English title — keeps the video fully in Telugu (voice + text).
function deriveHeadline(script, maxWords = 12) {
  const words = script.split(' ').filter(Boolean);
  let headline = words.slice(0, maxWords).join(' ');
  if (words.length > maxWords) headline += '...';
  return headline;
}

async function main() {
  if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });

  const article = await fetchNews();
  const script = await generateScript(article);
  const audioPath = await generateAudio(script);
  const onScreenHeadline = deriveHeadline(script);
  const videoPath = buildVideo(onScreenHeadline, audioPath);
  await uploadToYouTube(videoPath, article.title, script + '\n\n#TeluguEcho #TeluguNews #Shorts');
  saveState(article);
  log('Done!');
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
