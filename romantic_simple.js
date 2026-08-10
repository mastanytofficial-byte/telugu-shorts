const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const { google } = require('googleapis');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const YT_CLIENT_ID = process.env.YT_CLIENT_ID;
const YT_CLIENT_SECRET = process.env.YT_CLIENT_SECRET;
const YT_REFRESH_TOKEN = process.env.YT_REFRESH_TOKEN;

const WORK_DIR = path.join(__dirname, 'work');
const STATE_FILE = path.join(__dirname, 'romantic-last-article.json');
const VIDEO_SECONDS = 20;

const OBVIOUS_ENGLISH = new Set(['the','and','with','from','this','that','your','you','my','me','love','heart','life','forever','beautiful','special','relationship','romantic','quote','memories','memory','happy','sad','sorry','first','feel','feeling','feelings','waiting','miss','missing']);

function log(x){ console.log(`[${new Date().toISOString()}] ${x}`); }
async function get(url, options={}, timeout=30000){ const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeout); try{return await fetch(url,{...options,signal:c.signal});}finally{clearTimeout(t);} }
function state(){try{return JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));}catch{return {runCount:0};}}
function saveState(title){const s=state();fs.writeFileSync(STATE_FILE,JSON.stringify({runCount:(s.runCount||0)+1,lastTitle:title,lastDate:new Date().toISOString()},null,2));}
function englishRatio(text){const words=String(text).toLowerCase().match(/[a-z]+/g)||[];return words.length?words.filter(w=>OBVIOUS_ENGLISH.has(w)).length/words.length:0;}
function parseJson(raw){const cleaned=String(raw).replace(/<think>[\s\S]*?<\/think>/gi,'').trim();const fenced=cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);const s=fenced?fenced[1].trim():cleaned;const a=s.indexOf('{'),b=s.lastIndexOf('}');if(a<0||b<=a)throw new Error('Model did not return JSON');return JSON.parse(s.slice(a,b+1));}
async function groq(prompt,temperature){const r=await get('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${GROQ_API_KEY}`},body:JSON.stringify({model:'llama-3.3-70b-versatile',temperature,messages:[{role:'user',content:prompt}]})});const d=await r.json();if(!d.choices?.[0]?.message?.content)throw new Error('Groq returned no content');return d.choices[0].message.content;}

async function generateCandidate(theme){
  const prompt=`You are the creative writer for a Telugu romantic YouTube Short.\nTheme: ${theme}\n\nCreate ONE completely original romantic thought in NATURAL TELUGU, written only in the English alphabet (Tenglish). Think in Telugu first; do not translate an English quote.\n\nThe QUOTE is the priority. It must have a clear complete meaning, one specific romantic situation or emotion, natural Telugu phrasing, emotional depth, poetic simplicity, and a memorable ending. It must feel like a real Telugu person's thought, not AI-generated filler. It must be suitable for a 20-second Short. DO NOT target or obey any word count. Short is good; medium is good; longer is okay if the thought needs it. Never use movie lyrics, song lyrics, famous quotes, recognizable lines, hashtags, or an English sentence.\n\nThen derive the situation, image and music from that exact quote. The image must show the specific situation, not a generic lake/sunset/couple. The BGM direction must express the same emotion.\n\nReturn ONLY valid JSON:\n{"title":"short title","quote":"final Tenglish quote","situation":"exact emotional situation","image_prompt":"detailed English prompt for one realistic vertical 9:16 cinematic photograph depicting that exact situation, including subject action, setting, time, lighting and emotion; no text, no collage, no watermark","music_mood":"2-5 English mood tags","music_direction":"exact cinematic BGM direction: tempo, instruments, intensity and emotional movement"}`;
  return parseJson(await groq(prompt,0.9));
}

async function reviewCandidate(c){
  const prompt=`Be a strict Telugu creative editor. Review this proposed romantic Short.\nQUOTE: ${c.quote}\nSITUATION: ${c.situation}\nIMAGE: ${c.image_prompt}\nMUSIC: ${c.music_direction}\n\nPass ONLY when: (1) the quote has a complete, meaningful thought; (2) it sounds natural when read as Telugu, despite Roman/Tenglish spelling; (3) it expresses a real specific romantic situation/emotion; (4) it is poetic and memorable, not random words; (5) it is original and does not resemble a movie/song lyric or famous quote; (6) the image prompt depicts the exact situation; (7) the music direction genuinely matches the quote's emotion; (8) the quote is concise enough for a 20-second Short. DO NOT reject or approve based on a word-count target.\n\nReturn ONLY JSON: {"pass":true,"reason":"...","rewrite":"","situation":"...","image_prompt":"...","music_mood":"...","music_direction":"..."}. If pass=false, rewrite the quote yourself and improve all dependent fields.`;
  return parseJson(await groq(prompt,0.2));
}

async function makeQuote(){
  const themes=['oka vyakthi dooram ayina tarvata kuda aayana gurthulatho jeevinchadam','cheppakunda ardham chesukunna prema','chaala rojula tarvata malli kalisina rendu manasulu','kalisi unna kshanam mugisipothundani telisina prema','oka vyakthi kosam mounanga eduruchoodadam','poyina sambandham gurthulu inka manasulo undadam','oka chinna kshanam jeevitham motham marchipoleni anubhoothiga maaradam'];
  const theme=themes[state().runCount%themes.length];
  for(let attempt=1;attempt<=6;attempt++){
    let c=await generateCandidate(theme);
    if(!c.quote||!c.image_prompt||!c.music_direction){log(`Creative attempt ${attempt}: missing fields`);continue;}
    let r=await reviewCandidate(c);
    if(!r.pass&&r.rewrite){c.quote=r.rewrite;c.situation=r.situation||c.situation;c.image_prompt=r.image_prompt||c.image_prompt;c.music_mood=r.music_mood||c.music_mood;c.music_direction=r.music_direction||c.music_direction;r=await reviewCandidate(c);}
    const er=englishRatio(c.quote);
    const usable=r.pass&&er<0.25&&!/#/.test(c.quote)&&c.quote.trim().length>=18;
    log(`Creative attempt ${attempt}: review=${r.pass}, english-ratio=${er.toFixed(2)}, usable=${usable}`);
    if(usable)return c;
  }
  throw new Error('Could not generate a meaningful, natural Telugu romantic quote after creative review.');
}

async function makeImage(prompt){
  fs.mkdirSync(WORK_DIR,{recursive:true});
  const enhanced=`${prompt}, vertical 9:16, cinematic still photograph, realistic natural human emotion, photorealistic, coherent anatomy, subtle film grain, no words, no letters, no logo, no watermark, no collage`;
  const url=`https://image.pollinations.ai/prompt/${encodeURIComponent(enhanced)}?width=1080&height=1920&nologo=true`;
  const r=await get(url,{},60000);if(!r.ok)throw new Error(`AI image failed HTTP ${r.status}`);const b=Buffer.from(await r.arrayBuffer());if(b.length<10000)throw new Error('AI image response too small');
  const p=path.join(WORK_DIR,'background.jpg');fs.writeFileSync(p,b);log('Created ONE exact-situation full-screen AI image.');return p;
}

function generateBgm(file,duration,mood,direction){
  fs.mkdirSync(WORK_DIR,{recursive:true});const script=path.join(__dirname,'romantic_bgm.py');if(!fs.existsSync(script))throw new Error('romantic_bgm.py is missing');
  execFileSync('python3',[script,'--output',file,'--seconds',String(duration),'--mood',`${mood||''}; ${direction||''}`],{stdio:'inherit'});
  if(!fs.existsSync(file)||fs.statSync(file).size<100000)throw new Error('Licensed BGM was not created correctly');return file;
}

function render(image,bgm,quote){
  const out=path.join(WORK_DIR,'output.mp4'),overlay=path.join(WORK_DIR,'quote_overlay.png'),quoteFile=path.join(WORK_DIR,'quote.txt');
  fs.writeFileSync(quoteFile,quote,'utf8');
  execFileSync('python3',[path.join(__dirname,'render_quote.py'),'--text',quoteFile,'--output',overlay],{stdio:'inherit'});
  execFileSync('ffmpeg',['-y','-loop','1','-i',image,'-i',bgm,'-i',overlay,'-filter_complex','[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[bg];[bg][2:v]overlay=0:0:format=auto[v]','-t',String(VIDEO_SECONDS),'-map','[v]','-map','1:a:0','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-af',`volume=0.82,afade=t=in:st=0:d=1,afade=t=out:st=${VIDEO_SECONDS-1.2}:d=1.2`,'-shortest',out],{stdio:'inherit'});
  const probe=execSync(`ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 "${out}"`,{encoding:'utf8'}).trim();if(!probe)throw new Error('Final video has no audio stream; refusing upload');log(`Audio verified: ${probe}`);return out;
}

async function upload(video,title,quote){
  const auth=new google.auth.OAuth2(YT_CLIENT_ID,YT_CLIENT_SECRET);auth.setCredentials({refresh_token:YT_REFRESH_TOKEN});const yt=google.youtube({version:'v3',auth});
  const r=await yt.videos.insert({part:['snippet','status'],requestBody:{snippet:{title:(title||'Telugu Romantic Quote').slice(0,95),description:`${quote}\n\nOriginal Telugu romantic quote with an exact-situation cinematic image and mood-matched licensed instrumental BGM.`,tags:['telugu quotes','telugu romantic quotes','tenglish quotes','romantic shorts','telugu shorts'],categoryId:'22'},status:{privacyStatus:'public',selfDeclaredMadeForKids:false}},media:{body:fs.createReadStream(video)}});
  log(`Uploaded: https://www.youtube.com/watch?v=${r.data.id}`);
}

async function main(){
  fs.mkdirSync(WORK_DIR,{recursive:true});for(const [n,v] of Object.entries({GROQ_API_KEY,YT_CLIENT_ID,YT_CLIENT_SECRET,YT_REFRESH_TOKEN}))if(!v)throw new Error(`${n} is missing`);
  log('Run: meaningful quote + exact situation image + exact mood-matched licensed cinematic BGM. NO VOICE.');
  const q=await makeQuote();log(`QUOTE: ${q.quote}`);log(`SITUATION: ${q.situation}`);log(`IMAGE: ${q.image_prompt}`);log(`MUSIC MOOD: ${q.music_mood}`);log(`MUSIC DIRECTION: ${q.music_direction}`);
  const image=await makeImage(q.image_prompt);const bgm=generateBgm(path.join(WORK_DIR,'original_bgm.wav'),VIDEO_SECONDS,q.music_mood,q.music_direction);const video=render(image,bgm,q.quote);await upload(video,q.title,q.quote);saveState(q.title);log('Done.');
}
main().catch(e=>{console.error('FAILED:',e.stack||e);process.exit(1);});
