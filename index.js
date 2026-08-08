// Telugu Romantic Quotes Shorts — fully automated, runs on GitHub Actions
// Tenglish romantic quote (Groq) -> Telugu voice (Google TTS) -> Visuals (Pexels/AI)
// -> Text overlay + Video (FFmpeg) -> YouTube

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { google } = require('googleapis');

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

const CATEGORY = 'romantic_quote';

function pickCategory(runCount) {
  log(`Today's category: ${CATEGORY} (run #${runCount})`);
  return CATEGORY;
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
  romantic_quote: 'romantic couple sunset',
};

const WORD_COUNT_TARGETS = {
  romantic_quote: { min: 16, max: 36 }
};

// Romantic themes rotate deterministically so consecutive Shorts stay varied.
const ROMANTIC_THEMES = [
  'true love',
  'missing someone',
  'one-sided love',
  'long distance love',
  'silent love',
  'old memories',
  'waiting for someone',
  'first love',
  'deep love',
  'heartbreak',
  'rain and love',
  'night memories',
  'unspoken feelings',
  'love after distance',
  'someone who changed your life'
];

function pickRomanticTheme(runCount) {
  const theme = ROMANTIC_THEMES[runCount % ROMANTIC_THEMES.length];
  log(`Romantic theme for run #${runCount}: ${theme}`);
  return theme;
}

function buildPrompt(category, article, recentTitles, runCount) {
  const theme = pickRomanticTheme(runCount);
  const avoidLine = recentTitles.length
    ? `\n\nఇటీవల ఉపయోగించిన శీర్షికలు ఇవి. వీటి భావాన్ని లేదా వాక్య నిర్మాణాన్ని పునరావృతం చేయకు: ${recentTitles.slice(-8).join(' | ')}`
    : '';

  return `Create one completely original romantic Telugu quote for a 20–30 second YouTube Short.

Write the ON-SCREEN quote in Telugu using English alphabet only (Tenglish).

Theme: ${theme}

Requirements for SCREEN:
- Exactly 16 to 36 words.
- Emotional and poetic.
- Natural, fluent Telugu written in Tenglish.
- Sounds like a beautiful original lyric-style thought, not a song lyric.
- Easy to read on a mobile screen.
- Strong emotional feeling with a memorable final line.
- Completely original.
- Do not copy movie lyrics.
- Do not imitate existing songs.
- Do not use famous quotes.
- Do not reproduce or closely resemble copyrighted text.
- No English sentences.
- No hashtags.
- Do not use quotation marks around the quote.
- Do not mention movies, singers, actors, songs, or famous people.

VOICE must express the same exact idea as SCREEN in natural Telugu script so Google Telugu TTS pronounces it correctly.
- Do not add a new idea.
- Do not remove the emotional ending.
- Do not include English sentences.
- No hashtags.
- No CTA.
- Use natural Telugu punctuation and end complete sentences with periods.

TITLE:
- 3 to 8 natural Telugu words.
- Romantic and relevant to the quote.
- Do not copy a famous lyric or quote.

KEYWORDS:
- Give 3 to 5 concrete English visual search keywords separated by commas.
- Romantic, cinematic, realistic scenes only.
- Prefer things that can actually be shown: rainy window, couple walking, empty street at night, sunset silhouette, handwritten letter, etc.
- No abstract words such as "love", "emotion", or "happiness" by themselves.

Return exactly these four lines and nothing else:
TITLE: ...
SCREEN: ...
VOICE: ...
KEYWORDS: ...${avoidLine}`;
}
function parseLabeledContent(raw) {
  const titleMatch = raw.match(/TITLE:\s*(.+)/i);
  const screenMatch = raw.match(/SCREEN:\s*([\s\S]*?)(?=\nVOICE:|\nKEYWORDS:|$)/i);
  const voiceMatch = raw.match(/VOICE:\s*([\s\S]*?)(?=\nKEYWORDS:|$)/i);
  const keywordsMatch = raw.match(/KEYWORDS:\s*(.+)/i);

  return {
    title: titleMatch ? titleMatch[1].trim() : null,
    screenText: screenMatch ? screenMatch[1].trim().replace(/\n+/g, ' ') : null,
    voiceScript: voiceMatch ? voiceMatch[1].trim().replace(/\n+/g, ' ') : null,
    keywords: keywordsMatch ? keywordsMatch[1].trim() : null
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
  let { title, screenText, voiceScript, keywords } = parseLabeledContent(raw);

  if (!screenText || !voiceScript) {
    log('WARNING: Groq did not follow TITLE/SCREEN/VOICE/KEYWORDS format — retrying once.');
    raw = await callGroq(prompt + `\n\nIMPORTANT: Return all four labels exactly: TITLE:, SCREEN:, VOICE:, KEYWORDS:. Do not add any other text.`);
    const retry = parseLabeledContent(raw);
    title = retry.title || title;
    screenText = retry.screenText || screenText;
    voiceScript = retry.voiceScript || voiceScript;
    keywords = retry.keywords || keywords;
  }

  if (!screenText || !voiceScript) {
    throw new Error('Groq did not return both SCREEN and VOICE text.');
  }

  const target = WORD_COUNT_TARGETS[category];
  let wordCount = screenText.split(/\s+/).filter(Boolean).length;

  // One targeted retry if the on-screen quote falls outside the required range.
  if (wordCount < target.min || wordCount > target.max) {
    log(`WARNING: SCREEN quote has ${wordCount} words; required ${target.min}-${target.max}. Retrying.`);
    const retryPrompt = prompt + `\n\nYour previous SCREEN had ${wordCount} words. Rewrite SCREEN so it contains exactly ${target.min}-${target.max} words. Keep it one coherent emotional quote and keep VOICE semantically identical.`;
    raw = await callGroq(retryPrompt);
    const retry = parseLabeledContent(raw);
    if (retry.screenText && retry.voiceScript) {
      const retryCount = retry.screenText.split(/\s+/).filter(Boolean).length;
      log(`Retry SCREEN word count: ${retryCount}`);
      if (retryCount >= target.min && retryCount <= target.max) {
        title = retry.title || title;
        screenText = retry.screenText;
        voiceScript = retry.voiceScript;
        keywords = retry.keywords || keywords;
        wordCount = retryCount;
      }
    }
  }

  if (!title) title = deriveHeadline(screenText);
  if (!keywords) keywords = FALLBACK_KEYWORDS[category];

  // Final defensive cleanup: no hashtags or accidental labels in the actual quote.
  screenText = screenText
    .replace(/^(SCREEN|QUOTE)\s*:\s*/i, '')
    .replace(/#\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  voiceScript = ensureSentenceBreaks(
    voiceScript
      .replace(/^(VOICE|SCRIPT)\s*:\s*/i, '')
      .replace(/#\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );

  log(`Title: ${title}`);
  log(`Screen quote (${screenText.split(/\s+/).filter(Boolean).length} words): ${screenText}`);
  log(`Voice text: ${voiceScript}`);
  log(`Keywords: ${keywords}`);

  return { title, screenText, voiceScript, keywords };
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

// Wraps the Tenglish quote into readable lines for a 9:16 mobile screen.
function wrapTenglishQuote(text, maxChars = 29) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.join('\n');
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

function buildVideo(mediaItems, audioPath, customDurations, screenText) {
  log('Building video with FFmpeg...');
  const outPath = path.join(WORK_DIR, 'output.mp4');
  const fontsDir = path.join(__dirname, 'fonts');
  const fontPath = path.join(fontsDir, 'NotoSansTelugu-Regular.ttf');
  const fontPathBoldCandidate = path.join(fontsDir, 'NotoSansTelugu-Bold.ttf');
  const fontPathBold = fs.existsSync(fontPathBoldCandidate) ? fontPathBoldCandidate : fontPath;

  const quoteTextPath = path.join(WORK_DIR, 'quote_screen.txt');
  fs.writeFileSync(quoteTextPath, wrapTenglishQuote(screenText || ''), 'utf8');

  const ACCENT = '0xF7C948'; // warm romantic gold

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

    // Small romantic badge.
    `drawbox=x=40:y=58:w=150:h=42:color=black@0.35:t=fill`,
    `drawbox=x=37:y=55:w=150:h=42:color=${ACCENT}@0.96:t=fill`,
    `drawtext=fontfile='${fontPathBold}':text='LOVE QUOTE':fontcolor=0x17120a:fontsize=18:x=37+(150-text_w)/2:y=55+(42-text_h)/2`,

    // Channel branding.
    `drawtext=fontfile='${fontPathBold}':text='TELUGU ECHO':fontcolor=${ACCENT}:fontsize=30:x=(w-text_w)/2:y=132:shadowcolor=black@0.65:shadowx=2:shadowy=2`,
    `drawbox=x=(iw-150)/2:y=180:w=150:h=3:color=${ACCENT}@0.9:t=fill`,

    // The actual Tenglish quote — centered and readable on mobile.
    `drawbox=x=50:y=ih/2-240:w=iw-100:h=480:color=black@0.30:t=fill`,
    `drawtext=fontfile='${fontPathBold}':textfile='${quoteTextPath}':fontcolor=white:fontsize=38:line_spacing=12:x=(w-text_w)/2:y=(h-text_h)/2:shadowcolor=black@0.85:shadowx=2:shadowy=3`,

    // Minimal footer — no forced CTA or hashtags in the quote video.
    `drawtext=fontfile='${fontPath}':text='తెలుగు ఎకో':fontcolor=white@0.70:fontsize=18:x=(w-text_w)/2:y=h-72`,

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
        tags: ['telugu quotes', 'telugu love quotes', 'telugu romantic quotes', 'tenglish quotes', 'telugu shorts', 'love quotes', 'romantic shorts'],
        categoryId: '22'
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

  checkSecret('GROQ_API_KEY', GROQ_API_KEY);
  checkSecret('GOOGLE_TTS_API_KEY', GOOGLE_TTS_API_KEY);
  checkSecret('PEXELS_API_KEY', PEXELS_API_KEY);
  checkSecret('YT_CLIENT_ID', YT_CLIENT_ID);
  checkSecret('YT_CLIENT_SECRET', YT_CLIENT_SECRET);
  checkSecret('YT_REFRESH_TOKEN', YT_REFRESH_TOKEN);

  const { usedTitles, runCount } = loadState();
  const category = pickCategory(runCount);
  const article = null;

  const { title, screenText, voiceScript, keywords } = await generateContent(category, article, usedTitles, runCount);
  const allSentences = splitIntoSentences(voiceScript);
  const { audioPath, sentenceDurations, silenceGap } = await generateAudioForScript(allSentences);

  // Fold the gap that follows each sentence (except the last) into that
  // sentence's own on-screen time, so the image holds through the pause
  // before the next line — durations still sum exactly to the full audio.
  let imageDurations = sentenceDurations.map((d, i) => i < sentenceDurations.length - 1 ? d + silenceGap : d);
  let imageSentences = allSentences.slice();

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

  const videoPath = buildVideo(imagePaths, audioPath, keptDurations, screenText);

  const ytTitle = article ? article.title : title;
  await uploadToYouTube(
    videoPath,
    ytTitle,
    `${voiceScript}\n\nOriginal romantic quote created for Telugu Echo. Visuals may use Pexels or AI-generated imagery.`
  );
  saveState(null, title);
  log('Done!');
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
