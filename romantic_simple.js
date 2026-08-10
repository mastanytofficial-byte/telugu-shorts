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
const MIN_WORDS = 16;
const MAX_WORDS = 36;
const VIDEO_SECONDS = 20;

const FORBIDDEN = new Set([
  'a','an','and','are','best','beautiful','because','be','but','deep','distance',
  'feeling','feelings','first','forever','happy','heart','heartbeat','life','line',
  'love','memories','memory','miss','missing','my','relationship','sad','special',
  'story','true','waiting','you','your','is','was','were','the','to','of','in','on',
  'for','with','from','this','that','me','mine','someone','one','side','long','old',
  'night','rain','sorry','romantic','quote'
]);

const FALLBACKS = [
  { title:'Nee Gurthulu', screen:'Nuvvu naatho leni prathi kshanam mounanga gadichina, nee gurthulu maatram naa manasulo mellaga palike oka madhuramaina maata la migilipoyayi', mood:'nostalgic longing', image:'lonely person beside rainy window at dusk, warm room light, quiet longing, cinematic romantic photography' },
  { title:'Mounamlo Prema', screen:'Cheppaleni enno maatala madhya, nee kosam aagipoye naa mouname ninnu entha ga korukuntundo prathi roju naaku chebutune untundi', mood:'quiet affection', image:'person sitting quietly by window at sunset, soft golden light, peaceful romantic atmosphere, cinematic photography' },
  { title:'Dooramaina Kshanam', screen:'Mana madhya dooram perigina prathi adugulo, kalisi gadipina chinna kshanalu naa venta nadusthu nannu malli nee daggariki teesukeltunnayi', mood:'bittersweet remembrance', image:'empty road at twilight with distant couple silhouette, nostalgic romantic mood, cinematic photography' },
  { title:'Malli Kalavalani', screen:'Entha dooram vellina manasuki nachina vyakti gurthulu povu, avi marinta daggaravutayi endukante avi manasulo nijamaina chotunu pondutayi', mood:'hopeful reunion', image:'two people meeting on a quiet beach at sunset, warm hopeful romantic mood, cinematic photography' },
  { title:'Oka Chinna Gnapakam', screen:'Nee tho gadipina oka chinna saayantram ippatiki naa manasulo velugula undi, aa kshanam gurthosthe chaalu naa mounam antha navvuthundi', mood:'warm nostalgia', image:'couple walking under evening lights, soft warm glow, tender nostalgic romance, cinematic photography' }
];

function log(x){ console.log(`[${new Date().toISOString()}] ${x}`); }
async function get(url, options={}, timeout=30000){
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeout);
  try{return await fetch(url,{...options,signal:c.signal});}finally{clearTimeout(t);}
}
function countWords(s){return String(s||'').trim().split(/\s+/).filter(Boolean).length;}
function badWords(s){return [...new Set((String(s||'').toLowerCase().match(/[a-z]+/g)||[]).filter(w=>FORBIDDEN.has(w)))];}
function validQuote(s){const n=countWords(s), bad=badWords(s); return n>=MIN_WORDS&&n<=MAX_WORDS&&bad.length===0&&!/#/.test(s);}
function state(){try{return JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));}catch{return {runCount:0};}}
function saveState(title){const s=state();fs.writeFileSync(STATE_FILE,JSON.stringify({runCount:(s.runCount||0)+1,lastTitle:title,lastDate:new Date().toISOString()},null,2));}

async function groq(prompt){
  const r=await get('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${GROQ_API_KEY}`},body:JSON.stringify({model:'llama-3.3-70b-versatile',temperature:.85,messages:[{role:'user',content:prompt}]})});
  const d=await r.json(); if(!d.choices?.[0]?.message?.content) throw new Error('Groq returned no content');
  return d.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
}
function parse(raw){
  const title=raw.match(/TITLE:\s*(.+)/i)?.[1]?.trim()||'Telugu Romantic Quote';
  const screen=(raw.match(/SCREEN:\s*([\s\S]*?)(?=\nMOOD:|\nIMAGE_PROMPT:|$)/i)?.[1]||'').replace(/["“”]/g,'').replace(/\s+/g,' ').trim();
  const mood=raw.match(/MOOD:\s*(.+)/i)?.[1]?.trim()||'soft romantic nostalgia';
  const image=raw.match(/IMAGE_PROMPT:\s*([\s\S]*?)(?=\n$|$)/i)?.[1]?.trim()||'';
  return {title,screen,mood,image};
}
async function makeQuote(){
  const themes=['dooramaina prema','mounamaina anubandham','gurthulu','eduruchupu','malli kalavalani korika','oka madhuramaina kshanam','cheppaleni anubhoothi'];
  const theme=themes[state().runCount%themes.length];
  const prompt=`Create ONE completely original romantic Telugu quote for a YouTube Short. Theme: ${theme}.\nSCREEN: exactly 16-36 words. Write ONLY Telugu vocabulary using English alphabet (Tenglish). ZERO English words. No hashtags. No movie lyrics, song lyrics, famous quotes or imitation. Natural Telugu, emotional, poetic, mature, simple and memorable. Do not write a short slogan. Make one flowing thought with 2-3 connected clauses. Avoid awkward literal translations and unnatural word combinations. Read the sentence once before returning it and rewrite it if the grammar is unnatural.\nMOOD: give 2-4 English mood words only.\nIMAGE_PROMPT: write one detailed English prompt for ONE full-screen 9:16 cinematic photograph that exactly matches the quote's emotion and situation. Include subject, setting, lighting, atmosphere and emotion. No text, no watermark, no collage.\nReturn exactly four lines: TITLE: ...\nSCREEN: ...\nMOOD: ...\nIMAGE_PROMPT: ...`;
  for(let i=1;i<=5;i++){
    const q=parse(await groq(prompt+(i>1?'\nPrevious attempt was invalid. Write a completely new 20-30 word Telugu thought, not a shorter version. Make the Telugu grammar natural and coherent.':'')));
    log(`Quote attempt ${i}: ${countWords(q.screen)} words, valid=${validQuote(q.screen)}`);
    if(validQuote(q.screen)&&q.image) return q;
  }
  const f=FALLBACKS[state().runCount%FALLBACKS.length];
  log(`Groq did not pass validation; using curated original fallback: ${f.title}`);
  return f;
}

async function makeImage(prompt){
  fs.mkdirSync(WORK_DIR,{recursive:true});
  const enhanced=`${prompt}, vertical 9:16, cinematic still photograph, realistic natural human emotion, beautiful composition, soft depth of field, subtle film grain, no words, no letters, no logo, no watermark, no collage`;
  const url=`https://image.pollinations.ai/prompt/${encodeURIComponent(enhanced)}?width=1080&height=1920&nologo=true`;
  const r=await get(url,{},60000); if(!r.ok) throw new Error(`AI image failed HTTP ${r.status}`);
  const b=Buffer.from(await r.arrayBuffer()); if(b.length<10000) throw new Error('AI image response too small');
  const p=path.join(WORK_DIR,'background.jpg'); fs.writeFileSync(p,b); log('Created ONE quote-specific full-screen AI image.'); return p;
}

function generateBgm(file,duration,mood){
  fs.mkdirSync(WORK_DIR,{recursive:true});
  const script=path.join(__dirname,'romantic_bgm.py');
  if(!fs.existsSync(script)) throw new Error('romantic_bgm.py is missing');
  execFileSync('python3',[script,'--output',file,'--seconds',String(duration),'--mood',mood||'quiet affection'],{stdio:'inherit'});
  if(!fs.existsSync(file) || fs.statSync(file).size<100000) throw new Error('Licensed BGM was not created correctly');
  log('Created 20-second licensed cinematic BGM matched to the quote mood.');
  return file;
}

// Wrap by character count so every line stays safely inside the 1080px canvas.
// Shorter lines are intentional: Tenglish characters vary in rendered pixel width.
function quoteLines(text,max=24){
  const out=[]; let line='';
  for(const w of String(text).trim().split(/\s+/)){
    const n=line?`${line} ${w}`:w;
    if(line && n.length>max){out.push(line); line=w;} else line=n;
  }
  if(line) out.push(line);
  return out.join('\\n');
}

function render(image,bgm,quote){
  const out=path.join(WORK_DIR,'output.mp4'),txt=path.join(WORK_DIR,'quote.txt');
  const wrapped=quoteLines(quote,24);
  fs.writeFileSync(txt,wrapped,'utf8');
  const font='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
  const vf=`scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.0009,1.08)':d=500:s=1080x1920:fps=25,drawbox=x=70:y=555:w=940:h=810:color=black@0.28:t=fill,drawtext=fontfile='${font}':textfile='${txt}':fontcolor=white:fontsize=38:line_spacing=20:x=(w-text_w)/2:y=(h-text_h)/2:shadowcolor=black@0.95:shadowx=2:shadowy=3`;
  execSync(`ffmpeg -y -loop 1 -i "${image}" -i "${bgm}" -vf "${vf}" -t ${VIDEO_SECONDS} -map 0:v:0 -map 1:a:0 -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -af "volume=0.82,afade=t=in:st=0:d=1,afade=t=out:st=${VIDEO_SECONDS-1.2}:d=1.2" -shortest "${out}"`,{stdio:'inherit'});
  const probe=execSync(`ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 "${out}"`,{encoding:'utf8'}).trim();
  if(!probe) throw new Error('Final video has no audio stream; refusing upload');
  log(`Audio verified: ${probe}`);
  return out;
}
async function upload(video,title,quote){
  const auth=new google.auth.OAuth2(YT_CLIENT_ID,YT_CLIENT_SECRET);auth.setCredentials({refresh_token:YT_REFRESH_TOKEN});
  const yt=google.youtube({version:'v3',auth});
  const r=await yt.videos.insert({part:['snippet','status'],requestBody:{snippet:{title:title.slice(0,95),description:`${quote}\n\nOriginal Telugu romantic quote with a quote-specific cinematic image and licensed instrumental BGM.`,tags:['telugu quotes','telugu romantic quotes','tenglish quotes','romantic shorts','telugu shorts'],categoryId:'22'},status:{privacyStatus:'public',selfDeclaredMadeForKids:false}},media:{body:fs.createReadStream(video)}});
  log(`Uploaded: https://www.youtube.com/watch?v=${r.data.id}`);
}
async function main(){
  fs.mkdirSync(WORK_DIR,{recursive:true});
  for(const [n,v] of Object.entries({GROQ_API_KEY,YT_CLIENT_ID,YT_CLIENT_SECRET,YT_REFRESH_TOKEN}))if(!v)throw new Error(`${n} is missing`);
  log('Run: quote + ONE full-screen matching image + ONE licensed cinematic BGM. NO VOICE.');
  const q=await makeQuote();log(`SCREEN (${countWords(q.screen)} words): ${q.screen}`);log(`MOOD: ${q.mood}`);log(`IMAGE: ${q.image}`);
  const image=await makeImage(q.image);const bgm=generateBgm(path.join(WORK_DIR,'original_bgm.wav'),VIDEO_SECONDS,q.mood);const video=render(image,bgm,q.screen);await upload(video,q.title,q.screen);saveState(q.title);log('Done.');
}
main().catch(e=>{console.error('FAILED:',e.stack||e);process.exit(1);});
