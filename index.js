// Telugu Daily News Shorts — fully automated, runs on GitHub Actions
// News -> Script (Groq) -> Voice (Google TTS) -> Images (Pexels) -> Video (FFmpeg) -> YouTube

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
const IMAGE_COUNT = 4;

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
  let usedUrls = [];
  if (fs.existsSync(STATE_FILE)) {
    try {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
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
  // No on-screen headline anymore (video is images + narration only), so this
  // just asks for the narration script — plain text, no JSON. Simpler and
  // avoids Groq's occasional JSON-mode validation failures entirely.
  const prompt = `ఈ వార్త మీద YouTube Short video కోసం 20 సెకన్ల వాయిస్-ఓవర్ script తెలుగులో రాయి: "${article.title}". ${article.description || ''}

వార్త యొక్క నేపథ్యం, ఏమి జరిగింది, ఎందుకు ముఖ్యమో అన్నీ ఇందులో ఉండాలి. సులభమైన భాషలో, ఆకర్షణీయంగా రాయి. ఇది 4-6 చిన్న వాక్యాలుగా ఉండాలి, ప్రతి వాక్యం తర్వాత తప్పకుండా పూర్ణవిరామం (.) పెట్టాలి — ఏ ఒక్క వాక్యం కూడా చాలా పొడవుగా (commas తో కలిపి ఒకే వాక్యంగా) ఉండకూడదు, ఎందుకంటే అలా ఉంటే వాయిస్ జనరేషన్ fail అవుతుంది. Line breaks మాత్రం వాడకు, అన్నీ ఒకే paragraph లో ఉండాలి, కానీ వాక్యాల మధ్య పూర్ణవిరామం మాత్రం ఖచ్చితంగా ఉండాలి. తప్పకుండా కనీసం 85 తెలుగు పదాలు వాడి 95 పదాలు మీరకూడదు. చివర్లో ఖచ్చితంగా ఈ వాక్యం జోడించు (ఇది కూడా ఒక పూర్తి వాక్యంగా, ముందు పూర్ణవిరామం తర్వాత): మరిన్ని ఇలాంటి వార్తల కోసం తెలుగు ఎకో ఛానెల్‌ని లైక్ చేయండి, షేర్ మరియు సబ్‌స్క్రైబ్ చేయండి.

కేవలం script టెక్స్ట్ మాత్రమే ఇవ్వు — JSON వద్దు, headers వద్దు, ముందు/వెనుక ఎలాంటి extra text వద్దు.`;

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
    throw new Error('Groq did not return a script: ' + JSON.stringify(data));
  }
  let script = data.choices[0].message.content.trim().replace(/\n+/g, ' ');
  script = ensureSentenceBreaks(script);
  log(`Script (${script.length} chars): ${script}`);
  return script;
}

async function generateAudio(script) {
  log('Generating audio via Google Cloud TTS...');
  // te-IN-Chirp3-HD-Achird: male, Chirp 3: HD tier — natural/human-sounding.
  // Free quota: 1,000,000 chars/month, separate from Standard's 4,000,000/month.
  const res = await fetchWithTimeout(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`, {
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

function getAudioDuration(audioPath) {
  const out = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}"`).toString().trim();
  return parseFloat(out);
}

// NewsAPI titles usually end with " - Source Name" (e.g. "... - CNBC").
// Strip that trailing segment so the Pexels search query is just the story
// itself, not polluted with a publisher name.
function cleanTitleForImageSearch(title) {
  const parts = title.split(' - ');
  if (parts.length > 1) return parts.slice(0, -1).join(' - ').trim();
  return title.trim();
}

async function fetchImages(query, count) {
  log(`Fetching ${count} images from Pexels for: "${query}"...`);
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&orientation=portrait`;
  const res = await fetchWithTimeout(url, { headers: { Authorization: PEXELS_API_KEY } });
  const data = await res.json();
  if (!data.photos || data.photos.length === 0) {
    throw new Error(`Pexels returned no photos for "${query}": ` + JSON.stringify(data));
  }
  const imagePaths = [];
  for (let i = 0; i < data.photos.length; i++) {
    const src = data.photos[i].src || {};
    const imgUrl = src.large2x || src.large || src.original;
    const imgRes = await fetchWithTimeout(imgUrl);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const imgPath = path.join(WORK_DIR, `image_${i}.jpg`);
    fs.writeFileSync(imgPath, buf);
    imagePaths.push(imgPath);
  }
  log(`Downloaded ${imagePaths.length} images from Pexels.`);
  return imagePaths;
}

// If the story-specific search comes up empty (can happen for very niche
// headlines), fall back to a generic query so the run doesn't fail outright.
async function fetchImagesWithFallback(query, count) {
  try {
    return await fetchImages(query, count);
  } catch (e) {
    log('WARNING: image search failed for the specific headline, falling back to a generic query. ' + e.message);
    return await fetchImages('India news', count);
  }
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

function buildVideo(imagePaths, audioPath) {
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
  const perImageDur = duration / n;
  log(`Building ${n}-image Ken Burns slideshow, ~${perImageDur.toFixed(2)}s per image...`);

  // Step 1: one Ken-Burns clip per image, alternating zoom-in/zoom-out for variety.
  const clipPaths = [];
  for (let i = 0; i < n; i++) {
    const clipPath = path.join(WORK_DIR, `clip_${i}.mp4`);
    buildImageClip(imagePaths[i], perImageDur, clipPath, i % 2 === 0);
    clipPaths.push(clipPath);
  }

  // Step 2: concatenate the clips into one background video.
  const concatListPath = path.join(WORK_DIR, 'concat_list.txt');
  fs.writeFileSync(concatListPath, clipPaths.map(p => `file '${p}'`).join('\n'), 'utf8');
  const bgPath = path.join(WORK_DIR, 'background.mp4');
  execSync(`ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${bgPath}"`, { stdio: 'inherit' });

  // Step 3: overlay branding/CTA + scrims (for legibility over photos), mux audio.
  // NOTE on drawbox positioning: inside drawbox, 'w'/'h' in x/y expressions mean
  // the box's OWN width/height (not the frame) — always use 'iw'/'ih' there.
  // drawtext does not have this problem — its 'w'/'h' correctly mean the frame.
  const filters = [
    // dark scrims top & bottom so branding/CTA text stays legible over any photo
    `drawbox=x=0:y=0:w=iw:h=260:color=black@0.55:t=fill`,
    `drawbox=x=0:y=ih-260:w=iw:h=260:color=black@0.55:t=fill`,
    // "NEWS" badge, top-left
    `drawbox=x=40:y=60:w=120:h=44:color=${ACCENT}@0.95:t=fill`,
    `drawtext=fontfile='${fontPathBold}':text='NEWS':fontcolor=0x0f1024:fontsize=24:x=40+(120-text_w)/2:y=60+(44-text_h)/2`,
    // Channel branding, top-center, with a thin accent underline
    `drawtext=fontfile='${fontPathBold}':text='TELUGU ECHO':fontcolor=${ACCENT}:fontsize=32:x=(w-text_w)/2:y=140`,
    `drawbox=x=(iw-160)/2:y=192:w=160:h=4:color=${ACCENT}@0.85:t=fill`,
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

function saveState(article) {
  let usedUrls = [];
  if (fs.existsSync(STATE_FILE)) {
    try {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      usedUrls = state.usedUrls || [];
    } catch (e) {}
  }
  usedUrls.push(article.url);
  if (usedUrls.length > 50) usedUrls = usedUrls.slice(-50);
  fs.writeFileSync(STATE_FILE, JSON.stringify({ usedUrls, lastTitle: article.title, lastDate: new Date().toISOString() }, null, 2));
}

async function main() {
  if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });

  const article = await fetchNews();
  const script = await generateScript(article);
  const audioPath = await generateAudio(script);
  const imageQuery = cleanTitleForImageSearch(article.title);
  const imagePaths = await fetchImagesWithFallback(imageQuery, IMAGE_COUNT);
  const videoPath = buildVideo(imagePaths, audioPath);
  await uploadToYouTube(
    videoPath,
    article.title,
    script + '\n\nPhotos via Pexels (pexels.com).\n\n#TeluguEcho #TeluguNews #Shorts'
  );
  saveState(article);
  log('Done!');
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
