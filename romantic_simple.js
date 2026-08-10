const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const { google } = require('googleapis');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const YT_CLIENT_ID = process.env.YT_CLIENT_ID;
const YT_CLIENT_SECRET = process.env.YT_CLIENT_SECRET;
const YT_REFRESH_TOKEN = process.env.YT_REFRESH_TOKEN;

const WORK_DIR = path.join(__dirname, 'work');
const BANK_FILE = path.join(__dirname, 'romantic_quotes.json');
const USED_FILE = path.join(__dirname, 'romantic-used-quotes.json');
const VIDEO_SECONDS = 20;

function log(x){ console.log(`[${new Date().toISOString()}] ${x}`); }

async function get(url, options={}, timeout=30000){
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeout);
  try { return await fetch(url, { ...options, signal: c.signal }); }
  finally { clearTimeout(t); }
}

function parseJson(raw){
  const cleaned = String(raw).replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const s = fenced ? fenced[1].trim() : cleaned;
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if(a < 0 || b <= a) throw new Error('Model did not return JSON');
  return JSON.parse(s.slice(a,b+1));
}

async function groq(prompt, temperature=0.15){
  const r = await get('https://api.groq.com/openai/v1/chat/completions', {
    method:'POST',
    headers:{'Content-Type':'application/json', Authorization:`Bearer ${GROQ_API_KEY}`},
    body:JSON.stringify({
      model:'llama-3.3-70b-versatile',
      temperature,
      messages:[{role:'user',content:prompt}]
    })
  });
  const d = await r.json();
  if(!d.choices?.[0]?.message?.content) throw new Error('Groq returned no content');
  return d.choices[0].message.content;
}

function normalizeQuote(text){
  return String(text||'')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[“”"'`.,!?;:()\[\]{}\-_/\\|]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function tokens(text){
  return new Set(normalizeQuote(text).split(' ').filter(w=>w.length>=3));
}

function jaccard(a,b){
  const A=tokens(a), B=tokens(b);
  if(!A.size || !B.size) return 0;
  let common=0; for(const x of A) if(B.has(x)) common++;
  return common/(A.size+B.size-common);
}

function editSimilarity(a,b){
  const A=normalizeQuote(a), B=normalizeQuote(b);
  if(!A || !B) return 0;
  const prev=Array(B.length+1).fill(0);
  const cur=Array(B.length+1).fill(0);
  for(let j=0;j<=B.length;j++) prev[j]=j;
  for(let i=1;i<=A.length;i++){
    cur[0]=i;
    for(let j=1;j<=B.length;j++){
      const cost=A[i-1]===B[j-1]?0:1;
      cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+cost);
    }
    for(let j=0;j<=B.length;j++) prev[j]=cur[j];
  }
  const distance=prev[B.length];
  return 1-(distance/Math.max(A.length,B.length));
}

function readUsed(){
  try{
    const d=JSON.parse(fs.readFileSync(USED_FILE,'utf8'));
    return Array.isArray(d.used)?d:{used:[]};
  }catch{return {used:[]};}
}

function isDuplicate(candidate, used){
  const normalized=normalizeQuote(candidate.quote);
  for(const u of used){
    if(u.id===candidate.id || u.normalized===normalized) return {duplicate:true,reason:'exact'};
    const jac=jaccard(candidate.quote,u.quote||u.normalized);
    const edit=editSimilarity(candidate.quote,u.quote||u.normalized);
    if(jac>=0.72 || edit>=0.84) return {duplicate:true,reason:`similarity jaccard=${jac.toFixed(2)} edit=${edit.toFixed(2)}`};
  }
  return {duplicate:false};
}

function markUsed(candidate){
  const data=readUsed();
  const normalized=normalizeQuote(candidate.quote);
  if(!data.used.some(u=>u.id===candidate.id || u.normalized===normalized)){
    data.used.push({id:candidate.id,quote:candidate.quote,normalized,usedAt:new Date().toISOString()});
  }
  data.updatedAt=new Date().toISOString();
  fs.writeFileSync(USED_FILE,JSON.stringify(data,null,2),'utf8');
}

function loadBank(){
  const bank=JSON.parse(fs.readFileSync(BANK_FILE,'utf8'));
  if(!Array.isArray(bank) || bank.length===0) throw new Error('romantic_quotes.json is empty');
  return bank;
}

async function analyzeQuote(candidate){
  const prompt=`You are a strict native-Telugu creative director. The quote below is ALREADY WRITTEN and MUST NOT be rewritten, translated, shortened, lengthened, or paraphrased.

QUOTE: ${candidate.quote}

First judge the quote itself. Pass only if it has a clear complete meaning, natural Telugu phrasing when spoken aloud, one believable romantic situation or emotion, and a memorable emotional point. Reject if it is nonsense, random romantic words, forced poetry, contradictory, grammatically awkward, or resembles a known movie/song lyric or famous quote.

If it passes, derive the creative elements from the EXACT meaning of the quote:
- situation: what is actually happening emotionally/physically;
- image_prompt: ONE realistic vertical 9:16 cinematic photograph that directly depicts that exact situation, not a generic lake/sunset/couple image;
- music_mood: 2-5 mood tags;
- music_direction: specific cinematic instrumental direction with tempo, instruments, texture, intensity and emotional movement.

Do not change the quote under any circumstance.

Return ONLY JSON:
{"pass":true,"reason":"...","situation":"...","image_prompt":"...","music_mood":"...","music_direction":"..."}`;
  return parseJson(await groq(prompt,0.1));
}

async function selectQuote(){
  const bank=loadBank();
  const used=readUsed().used;
  log(`Quote bank: ${bank.length} original quotes; already used: ${used.length}`);

  const candidates=bank.filter(q=>q?.id && q?.quote && !isDuplicate(q,used).duplicate);
  if(!candidates.length) throw new Error('All original romantic quotes in the bank have already been used or are too similar to previously used quotes. Add new original quotes to romantic_quotes.json. No duplicate will be published.');

  // Deterministic rotation through the remaining pool. No random repeat risk.
  for(let offset=0;offset<Math.min(candidates.length,12);offset++){
    const candidate=candidates[(used.length+offset)%candidates.length];
    const duplicate=isDuplicate(candidate,used);
    if(duplicate.duplicate){ log(`Skip ${candidate.id}: duplicate (${duplicate.reason})`); continue; }

    const analysis=await analyzeQuote(candidate);
    log(`Quote ${candidate.id}: editor=${analysis.pass}`);
    if(!analysis.pass){ log(`Skip ${candidate.id}: ${analysis.reason||'failed meaning/naturalness check'}`); continue; }

    return {
      ...candidate,
      situation:analysis.situation,
      image_prompt:analysis.image_prompt,
      music_mood:analysis.music_mood,
      music_direction:analysis.music_direction
    };
  }
  throw new Error('No unused quote passed the strict meaning/naturalness review. No duplicate or unverified quote will be published.');
}

async function makeImage(prompt){
  fs.mkdirSync(WORK_DIR,{recursive:true});
  const enhanced=`${prompt}, vertical 9:16, cinematic still photograph, realistic natural human emotion, photorealistic, coherent anatomy, subtle film grain, no words, no letters, no logo, no watermark, no collage`;
  const url=`https://image.pollinations.ai/prompt/${encodeURIComponent(enhanced)}?width=1080&height=1920&nologo=true`;
  const r=await get(url,{},60000);
  if(!r.ok) throw new Error(`AI image failed HTTP ${r.status}`);
  const b=Buffer.from(await r.arrayBuffer());
  if(b.length<10000) throw new Error('AI image response too small');
  const p=path.join(WORK_DIR,'background.jpg');
  fs.writeFileSync(p,b);
  log('Created ONE exact-situation full-screen AI image.');
  return p;
}

function generateBgm(file,duration,mood,direction){
  fs.mkdirSync(WORK_DIR,{recursive:true});
  const script=path.join(__dirname,'romantic_bgm.py');
  if(!fs.existsSync(script)) throw new Error('romantic_bgm.py is missing');
  execFileSync('python3',[script,'--output',file,'--seconds',String(duration),'--mood',`${mood||''}; ${direction||''}`],{stdio:'inherit'});
  if(!fs.existsSync(file)||fs.statSync(file).size<100000) throw new Error('Licensed BGM was not created correctly');
  return file;
}

function render(image,bgm,quote){
  const out=path.join(WORK_DIR,'output.mp4');
  const overlay=path.join(WORK_DIR,'quote_overlay.png');
  const quoteFile=path.join(WORK_DIR,'quote.txt');
  fs.writeFileSync(quoteFile,quote,'utf8');
  execFileSync('python3',[path.join(__dirname,'render_quote.py'),'--text',quoteFile,'--output',overlay],{stdio:'inherit'});
  execFileSync('ffmpeg',['-y','-loop','1','-i',image,'-i',bgm,'-i',overlay,'-filter_complex','[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[bg];[bg][2:v]overlay=0:0:format=auto[v]','-t',String(VIDEO_SECONDS),'-map','[v]','-map','1:a:0','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-af',`volume=0.82,afade=t=in:st=0:d=1,afade=t=out:st=${VIDEO_SECONDS-1.2}:d=1.2`,'-shortest',out],{stdio:'inherit'});
  const probe=execSync(`ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 "${out}"`,{encoding:'utf8'}).trim();
  if(!probe) throw new Error('Final video has no audio stream; refusing upload');
  log(`Audio verified: ${probe}`);
  return out;
}

async function upload(video,title,quote){
  const auth=new google.auth.OAuth2(YT_CLIENT_ID,YT_CLIENT_SECRET);
  auth.setCredentials({refresh_token:YT_REFRESH_TOKEN});
  const yt=google.youtube({version:'v3',auth});
  const r=await yt.videos.insert({
    part:['snippet','status'],
    requestBody:{
      snippet:{title:(title||'Telugu Romantic Quote').slice(0,95),description:`${quote}\n\nOriginal Telugu romantic quote with an exact-situation cinematic image and mood-matched licensed instrumental BGM.`,tags:['telugu quotes','telugu romantic quotes','tenglish quotes','romantic shorts','telugu shorts'],categoryId:'22'},
      status:{privacyStatus:'public',selfDeclaredMadeForKids:false}
    },
    media:{body:fs.createReadStream(video)}
  });
  log(`Uploaded: https://www.youtube.com/watch?v=${r.data.id}`);
}

async function main(){
  fs.mkdirSync(WORK_DIR,{recursive:true});
  for(const [n,v] of Object.entries({GROQ_API_KEY,YT_CLIENT_ID,YT_CLIENT_SECRET,YT_REFRESH_TOKEN})) if(!v) throw new Error(`${n} is missing`);

  log('Run: PICK ONE ORIGINAL QUOTE + exact situation image + exact mood-matched licensed cinematic BGM. NO VOICE.');
  const q=await selectQuote();
  log(`QUOTE ID: ${q.id}`);
  log(`QUOTE: ${q.quote}`);
  log(`SITUATION: ${q.situation}`);
  log(`IMAGE: ${q.image_prompt}`);
  log(`MUSIC MOOD: ${q.music_mood}`);
  log(`MUSIC DIRECTION: ${q.music_direction}`);

  const image=await makeImage(q.image_prompt);
  const bgm=generateBgm(path.join(WORK_DIR,'original_bgm.wav'),VIDEO_SECONDS,q.music_mood,q.music_direction);
  const video=render(image,bgm,q.quote);

  // Reserve the quote before upload. The workflow only pushes this state after the
  // complete job succeeds, so a failed upload does not consume a quote permanently.
  markUsed(q);
  await upload(video,q.id,q.quote);
  log('Done. Quote reserved as used; future runs will never publish it again.');
}

main().catch(e=>{console.error('FAILED:',e.stack||e);process.exit(1);});
