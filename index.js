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
  const url = `https://newsapi.org/v2/everything?q=India&language=en&sortBy=publishedAt&pageSize=10&apiKey=${NEWSAPI_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.articles || data.articles.length === 0) {
    throw new Error('No articles found from NewsAPI');
  }

  // Load last used article to avoid duplicates
  let lastUrl = null;
  if (fs.existsSync(STATE_FILE)) {
    try {
      lastUrl = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).url;
    } catch (e) {}
  }

  // Pick the first article whose URL differs from the last one used
  const article = data.articles.find(a => a.url !== lastUrl) || data.articles[0];
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

function buildVideo(headline, audioPath) {
  log('Building video with FFmpeg...');
  const outPath = path.join(WORK_DIR, 'output.mp4');
  const fontPath = path.join(__dirname, 'fonts', 'NotoSansTelugu-Regular.ttf');
  const safeHeadline = escapeForFfmpeg(headline);

  const cmd = [
    'ffmpeg -y',
    `-f lavfi -i color=c=0x1a1a2e:s=720x1280:d=30`,
    `-i "${audioPath}"`,
    `-vf "drawtext=fontfile='${fontPath}':text='${safeHeadline}':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=12:box=0"`,
    '-c:v libx264 -pix_fmt yuv420p',
    '-c:a aac -b:a 128k',
    '-shortest',
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
  fs.writeFileSync(STATE_FILE, JSON.stringify({ url: article.url, title: article.title, date: new Date().toISOString() }, null, 2));
}

async function main() {
  if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });

  const article = await fetchNews();
  const script = await generateScript(article);
  const audioPath = await generateAudio(script);
  const videoPath = buildVideo(article.title, audioPath);
  await uploadToYouTube(videoPath, article.title, script + '\n\n#TeluguEcho #TeluguNews #Shorts');
  saveState(article);
  log('Done!');
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
