// NARRATION_QUALITY_GUARD_V14 — authoritative final fact narration boundary.
const PREVIOUS = global.fetch;
const GUARD_MARKER = 'NARRATION_QUALITY_GUARD_V14';
const PRIMARY_MODEL = 'openai/gpt-oss-120b';
const FALLBACK_MODEL = 'openai/gpt-oss-20b';
if (!PREVIOUS || PREVIOUS.__NARRATION_QUALITY_GUARD_V14__) { module.exports = { enabled:true, marker:GUARD_MARKER, styleErrors:styleErrors, hasBareDigits:hasBareDigits, extractBareDigitNumbers:extractBareDigitNumbers, teluguTextContainsNumber:teluguTextContainsNumber, nums:nums, parseTeluguNumbers:parseTeluguNumbers }; return; }
function isGroq(url,options){return String(url).includes('api.groq.com/openai/v1/chat/completions')&&String(options?.method||'GET').toUpperCase()==='POST';}
function isNarrationPrompt(p){return /VERIFIED FACT\s*[—-]\s*ACCURACY GROUNDING:/i.test(String(p||''));}
function sourceFrom(p){const m='VERIFIED FACT — ACCURACY GROUNDING:',s=String(p||''),i=s.indexOf(m);if(i<0)return '';const a=i+m.length,b=s.indexOf('\n\nనీ ROLE:',a);return s.slice(a,b<0?s.length:b).trim();}
function clean(s){return String(s||'').replace(/\s+/g,' ').replace(/^["“”'`]+|["“”'`]+$/g,'').replace(/[.!?।]+$/g,'').trim();}
function words(s){return String(s||'').split(/\s+/).filter(Boolean).length;}
// Each JSON field must represent exactly one narration beat. Terminal punctuation is stripped before this
// check; punctuation anywhere else means the model produced multiple beats inside one field. A '.' sitting
// directly between two digits is a decimal point (e.g. "3.5"), not a beat break, and "..." is a suspense
// pause WITHIN one beat (retention pacing), not a beat break either — both are excluded.
function oneSentence(s){s=String(s||'').trim();if(!s)return false;const t=s.replace(/(\d)\.(\d)/g,'$1$2').replace(/\.{2,}|…/g,'');return !/[.!?।]/.test(t);}
function nums(s){return (String(s||'').match(/\b\d+(?:\.\d+)?\b/g)||[]).map(Number);}

// Deterministic Telugu number-word -> numeric value parser. grounded()'s
// number check below only ever looked at ASCII digits, but the guard now
// requires every number in the script to be spelled out in Telugu words —
// which made that check permanently blind to a script inventing or
// misremembering a number, as long as it spelled the wrong number out
// correctly. Real bug this exists to catch: a script stated the speed of
// light as "మూడు వందల తొంభై తొమ్మిది వేల ఏడు వందల తొంభై రెండు" (399,792)
// when the true value is 299,792 — and the figure wasn't even in that run's
// verified source at all (the model added it from general knowledge and
// misremembered it).
//
// Scope is DELIBERATELY narrow: only phrases with an explicit place-value
// marker (వందల/వేల/వెయ్యి/లక్ష/కోటి) are reported. A bare small number
// (1-99, no marker) is never reported — words like "ఒక"/"ఒకటి" (a/one),
// "రెండు" etc. are extremely common ordinary Telugu words outside numeric-
// fact contexts (indefinite articles, idioms like "ఒకటి రెండు రోజుల్లో" =
// "in a day or two"). Flagging every such word as "a number requiring
// grounding" would false-positive constantly and risk exactly the kind of
// hard-reject regression already hit once this session (run #285: a
// validator that fires too often burns the whole bounded retry budget). A
// fully marker-scaled phrase like "మూడు వందల ..." is essentially never
// accidental, so it's safe to treat as a real, confidently-parsed number.
const TELUGU_UNITS={'సున్నా':0,'ఒకటి':1,'ఒక':1,'రెండు':2,'మూడు':3,'నాలుగు':4,'ఐదు':5,'ఆరు':6,'ఏడు':7,'ఎనిమిది':8,'తొమ్మిది':9};
const TELUGU_TEENS={'పది':10,'పదకొండు':11,'పన్నెండు':12,'పదమూడు':13,'పద్నాలుగు':14,'పదిహేను':15,'పదిహేనూ':15,'పదహారు':16,'పదిహేడు':17,'పద్దెనిమిది':18,'పందొమ్మిది':19,'పంతొమ్మిది':19};
const TELUGU_TENS={'ఇరవై':20,'ముప్పై':30,'నలభై':40,'యాభై':50,'అరవై':60,'డెబ్బై':70,'ఎనభై':80,'తొంభై':90};
const HUNDRED_WORDS=new Set(['వందల','వందలు','వంద']);
const THOUSAND_MULT_WORDS=new Set(['వేల','వేలు']);
const LAKH_MULT_WORDS=new Set(['లక్షల','లక్షలు']);
const CRORE_MULT_WORDS=new Set(['కోట్ల','కోట్లు']);
const BARE_HUNDRED=new Set(['వంద']);
const BARE_THOUSAND=new Set(['వెయ్యి']);
const BARE_LAKH=new Set(['లక్ష']);
const BARE_CRORE=new Set(['కోటి']);
// Telugu case markers attach directly onto a word with no space (e.g.
// "1920లో" = "in 1920", spoken "...ఇరవైలో" — a real example seen in
// production). Without stripping these the trailing word of a phrase
// silently fails to match. Kept to a small set of common, unambiguous
// 2-character markers so an unrelated word can't coincidentally lose a
// syllable and match a number by accident.
const CASE_SUFFIXES=['లో','కి','కు','ని','గా','తో'];
function teluguDictHas(dict,w){return dict instanceof Set?dict.has(w):Object.prototype.hasOwnProperty.call(dict,w);}
function teluguResolve(token,dict){if(teluguDictHas(dict,token))return token;for(const suf of CASE_SUFFIXES){if(token.length>suf.length&&token.endsWith(suf)){const base=token.slice(0,-suf.length);if(teluguDictHas(dict,base))return base;}}return null;}
function teluguTokens(text){return String(text||'').replace(/[.,!?।…"'“”]/g,' ').split(/\s+/).filter(Boolean);}
function parseSmallNumber(tokens,i){if(i>=tokens.length)return null;const w=tokens[i];let base=teluguResolve(w,TELUGU_TEENS);if(base)return{value:TELUGU_TEENS[base],next:i+1};base=teluguResolve(w,TELUGU_TENS);if(base){const tensVal=TELUGU_TENS[base],nextW=tokens[i+1],unitBase=nextW?teluguResolve(nextW,TELUGU_UNITS):null;if(unitBase&&TELUGU_UNITS[unitBase]!==0)return{value:tensVal+TELUGU_UNITS[unitBase],next:i+2};return{value:tensVal,next:i+1};}base=teluguResolve(w,TELUGU_UNITS);if(base)return{value:TELUGU_UNITS[base],next:i+1};return null;}
function parseHundredGroup(tokens,i){if(i>=tokens.length)return null;if(teluguResolve(tokens[i],BARE_HUNDRED))return{value:100,next:i+1};const base=teluguResolve(tokens[i],TELUGU_UNITS);if(base&&TELUGU_UNITS[base]>=1&&TELUGU_UNITS[base]<=9){const markerBase=tokens[i+1]?teluguResolve(tokens[i+1],HUNDRED_WORDS):null;if(markerBase)return{value:TELUGU_UNITS[base]*100,next:i+2};}return null;}
// A full 1-999 count: optional hundred-group + optional tens/units remainder
// (e.g. "మూడు వందల తొంభై తొమ్మిది" = 399) — the multiplier count that can
// precede వేల/లక్షల/కోట్ల. A plain 0-99 count alone isn't enough: the real
// speed-of-light bug this parser exists to catch is exactly a 3-digit count
// before వేల ("399 వేల").
function parseUpToThousand(tokens,i){let idx=i,value=0,matched=false;const hundred=parseHundredGroup(tokens,idx);if(hundred){value+=hundred.value;idx=hundred.next;matched=true;}const small=parseSmallNumber(tokens,idx);if(small){value+=small.value;idx=small.next;matched=true;}if(!matched)return null;return{value,next:idx};}
function parseScaleGroup(tokens,i,markerWords,scale,bareWords){if(i>=tokens.length)return null;if(teluguResolve(tokens[i],bareWords))return{value:scale,next:i+1};const count=parseUpToThousand(tokens,i);if(count&&count.value>=1){const markerBase=tokens[count.next]?teluguResolve(tokens[count.next],markerWords):null;if(markerBase)return{value:count.value*scale,next:count.next+1};}return null;}
// Walks place-value tiers strictly in descending order (crore -> lakh ->
// thousand -> hundred -> tens/units), each optional but consumed at most
// once. Returns null if nothing matched, or if the match never included an
// explicit scale marker (see module comment on why bare tens/units alone
// are never confident enough to report).
// Real user correction (after the 1974->1904 conversion bug): a 4-digit
// YEAR in Telugu is naturally read as a "century pair" — "పందొమ్మిది వందల
// డెబ్బై నాలుగు" (nineteen-hundred seventy-four) for 1974 — mirroring how
// English says "nineteen seventy-four", not "one thousand nine hundred
// seventy-four". This is a DIFFERENT reading from the normal thousand-based
// form (parseHundredGroup only accepts a single unit digit 1-9 before
// వందల, giving 100-900) — here the teens word itself (11-19) sits before
// వందల, giving 1100-1900. Deliberately scoped to years/dates only in the
// prompt rules; this parser addition just makes the grounding check able to
// recognize that reading too, wherever it legitimately appears.
function parseCenturyPair(tokens,i){if(i>=tokens.length)return null;const base=teluguResolve(tokens[i],TELUGU_TEENS);if(!base||TELUGU_TEENS[base]<11)return null;const markerBase=tokens[i+1]?teluguResolve(tokens[i+1],HUNDRED_WORDS):null;if(!markerBase)return null;let idx=i+2,value=TELUGU_TEENS[base]*100;const small=parseSmallNumber(tokens,idx);if(small){value+=small.value;idx=small.next;}return{value,next:idx};}
function parseNumberAt(tokens,i){const centuryPair=parseCenturyPair(tokens,i);if(centuryPair)return{value:centuryPair.value,next:centuryPair.next};let idx=i,value=0,hasScaleMarker=false;const crore=parseScaleGroup(tokens,idx,CRORE_MULT_WORDS,10000000,BARE_CRORE);if(crore){value+=crore.value;idx=crore.next;hasScaleMarker=true;}const lakh=parseScaleGroup(tokens,idx,LAKH_MULT_WORDS,100000,BARE_LAKH);if(lakh){value+=lakh.value;idx=lakh.next;hasScaleMarker=true;}const thousand=parseScaleGroup(tokens,idx,THOUSAND_MULT_WORDS,1000,BARE_THOUSAND);if(thousand){value+=thousand.value;idx=thousand.next;hasScaleMarker=true;}const hundred=parseHundredGroup(tokens,idx);if(hundred){value+=hundred.value;idx=hundred.next;hasScaleMarker=true;}const small=parseSmallNumber(tokens,idx);if(small){value+=small.value;idx=small.next;}if(idx===i||!hasScaleMarker)return null;return{value,next:idx};}
function parseTeluguNumbers(text){const tokens=teluguTokens(text);const results=[];let i=0;while(i<tokens.length){const m=parseNumberAt(tokens,i);if(m){results.push(m.value);i=m.next;}else{i++;}}return results;}
// Like parseNumberAt, but without requiring a crore/lakh/thousand/hundred
// scale marker — used only by teluguTextContainsNumber() below, where the
// caller already knows the exact target value it's looking for (e.g. "does
// this text really say 1974 somewhere"), so the false-positive risk from
// common bare words like "ఒక"/"రెండు" that parseNumberAt avoids (see the
// module comment above) doesn't apply: a coincidental match of an unrelated
// small number to the target is vanishingly unlikely for values that came
// from a real digit run (years, counts, percentages), and matters far less
// than reliably confirming a real conversion did NOT change the value.
function parseAnyNumberAt(tokens,i){const centuryPair=parseCenturyPair(tokens,i);if(centuryPair)return{value:centuryPair.value,next:centuryPair.next};let idx=i,value=0;const crore=parseScaleGroup(tokens,idx,CRORE_MULT_WORDS,10000000,BARE_CRORE);if(crore){value+=crore.value;idx=crore.next;}const lakh=parseScaleGroup(tokens,idx,LAKH_MULT_WORDS,100000,BARE_LAKH);if(lakh){value+=lakh.value;idx=lakh.next;}const thousand=parseScaleGroup(tokens,idx,THOUSAND_MULT_WORDS,1000,BARE_THOUSAND);if(thousand){value+=thousand.value;idx=thousand.next;}const hundred=parseHundredGroup(tokens,idx);if(hundred){value+=hundred.value;idx=hundred.next;}const small=parseSmallNumber(tokens,idx);if(small){value+=small.value;idx=small.next;}if(idx===i)return null;return{value,next:idx};}
// Real bug this exists to catch (run #294): the digit-optimizer pass in
// index.js asked Groq to convert a bare ASCII year ("1974") into Telugu
// words, and the conversion silently came back wrong ("వెయ్యి తొమ్మిది
// వందల నాలుగు" = 1904) — a transcription slip nothing verified, since the
// existing word-count/notation checks on that pass only confirm the SHAPE
// of the output, never that the converted number's VALUE is unchanged.
function teluguTextContainsNumber(text,target){const tokens=teluguTokens(text);for(let i=0;i<tokens.length;i++){const m=parseAnyNumberAt(tokens,i);if(m&&m.value===target)return true;}return false;}

function grounded(script,source){const allowed=new Set(nums(source));for(const n of nums(script))if(!allowed.has(n))return 'unsupported number introduced';for(const n of parseTeluguNumbers(script))if(!allowed.has(n))return `unsupported number introduced (Telugu word-form: ${n})`;if(/(?:^|\s)कि(?:\s|$)|\b(?:hook|buildup|reveal|detail|twist|ending)\s*:/i.test(script))return 'language or structural contamination detected';const tokens=(source.toLowerCase().match(/[a-z0-9]{4,}|[ఀ-౿]{4,}/g)||[]),low=script.toLowerCase(),hits=tokens.filter(t=>low.includes(t));if(tokens.length>=3&&new Set(hits).size<2)return 'script is insufficiently grounded in verified source';return '';}
// Retention-critical clickbait clichés only — genuine suspense connectors (అసలు విషయం ఏంటంటే etc.) are now allowed and expected by makePrompt's storyteller flow, so they are NOT banned here.
function clickbait(script){return /నమ్మలేకపోతారు|లైక్ చేయండి|సబ్‌స్క్రైబ్/i.test(script)?'generic clickbait cliché detected':'';}
// Two concrete mistakes observed in a real generated script: (1) 'వక్రీభవించడం' is an optical-refraction-only term, wrongly used for a physical/orbital path bending; (2) mid-script direct viewer address ('నువ్వు...తున్నావు') breaking the third-person narrator voice the rest of the script uses.
// Real production run (#284) got past every existing check with "1920లో" and "24 శాతం" both left
// as bare ASCII digits despite makePrompt's own instruction to spell every number out in Telugu
// words. A hard-reject-and-retry attempt at this (run #285) turned out unsafe: under real Groq
// rate-limit pressure only 1-2 of the 6 bounded attempts ever reach content validation at all, so
// a model that keeps writing one persistent fact's year/count as digits burns the whole retry
// budget and the run fails outright — worse than the original silent-mispronunciation bug. Kept
// as an exported helper instead: index.js runs a dedicated, non-blocking correction pass after
// acceptance (mirrors the existing punctuation-optimizer pattern) that always falls back to the
// original script on any doubt, so a failed correction is never worse than the pre-existing
// warn-only behavior. A 2+ digit run counts UNLESS a Latin-letter name/version token sits
// immediately before it, separated by a space (never a hyphen there — that's its own hard-reject
// now, below) — the documented exception for things like 'AES 256', 'iOS 15'.
function hasBareDigits(s){const re=/\d{2,}/g;let m;while((m=re.exec(s))){const before=s.slice(Math.max(0,m.index-2),m.index);if(/[A-Za-z] ?$/.test(before))continue;return true;}return false;}
// Same digit-run detection and model/version-name exception as hasBareDigits
// above, but returns the actual numeric values instead of a boolean — used
// to verify a digit-to-Telugu-word conversion didn't silently change a
// number's value (see teluguTextContainsNumber's comment for the real bug).
function extractBareDigitNumbers(s){const re=/\d{2,}/g;let m;const out=[];while((m=re.exec(s))){const before=s.slice(Math.max(0,m.index-2),m.index);if(/[A-Za-z] ?$/.test(before))continue;out.push(Number(m[0]));}return out;}
function styleErrors(script){if(/వక్రీభవించ/.test(script))return "wrong terminology — వక్రీభవించడం means optical refraction, not physical/orbital bending";if(/(?:^|\s)నువ్వు(?:\s|$)|తున్నావు|తున్నారు(?=\s|$)/.test(script))return 'second-person direct address broke third-person narrator voice';if(/[\u2070\u00B9\u00B2\u00B3\u2074-\u2079]/.test(script))return 'scientific notation (superscript exponent) present — TTS reads it as two separate numbers, spell the magnitude out in words instead';if(/[\u00BC\u00BD\u00BE\u2150-\u215E]/.test(script))return 'fraction symbol present — TTS cannot read it, spell it out in words (ఉదా. సగం, పావు వంతు)';if(/[%₹$°×÷±√π≈≤≥]/.test(script))return 'math/currency/percent symbol present — TTS cannot pronounce it, spell it out in words (ఉదా. % → శాతం, ₹ → రూపాయలు)';if(/[ఀ-౿][-‐‑‒–—][ఀ-౿]/.test(script))return 'hyphen/dash glued between Telugu script characters (likely a transliterated English compound term, e.g. "నాన్-లోకల్") — TTS word-boundary detection breaks on this, drop the hyphen and either fuse into one Telugu word, separate with a space, or keep the term in plain English';if(/\d[-‐‑‒–—]|[-‐‑‒–—]\d/.test(script))return 'hyphen/dash glued directly to a digit (e.g. "ఒమెగా-3", "AES-256") — TTS reads this as "minus", confirmed by a real listen ("ఒమెగా-3" played back as "omega minus 3"); replace the hyphen with a space (ఒమెగా 3, AES 256) or write the number out in Telugu words';if(/అంతే కాకుండా|అందువల్ల|తత్ఫలితంగా|దీనివల్ల/.test(script))return 'banned formal written-Telugu connective used (అంతే కాకుండా/అందువల్ల/తత్ఫలితంగా/దీనివల్ల) — the prompt already explicitly forbids these (real example: run #297 shipped "...పనిచేస్తుంది అందువల్ల టైటాన్ పై..."); rewrite without it, using natural spoken Telugu flow instead';return '';}
// Real, twice-recurring bug (runs #321 and #328): the model keeps writing
// English compound terms (rhythmite-adjacent physics/finance jargon like
// "circuit-breaker") transliterated with a hyphen glued directly between
// two Telugu words (e.g. "సర్క్యూట్‑బ్రేకర్"), which styleErrors() below
// correctly rejects — but the prompt instruction alone never stopped the
// model from doing it again on retry, even across a model switch, burning
// the entire 6-attempt budget on both real runs. Since the fix the reject
// message itself asks for (replace the hyphen with a space) is completely
// mechanical and never changes meaning, apply it automatically here before
// any check runs, rather than only ever rejecting and hoping a retry does
// better.
function parse(data,status,source){if(data?.error)return{api:true,reason:`Groq API error ${status}: ${data.error.message||data.error.code||'unknown'}`};const c=data?.choices?.[0],m=c?.message,r=m?.content;if(!r)return{reason:`model returned empty content (finish_reason=${c?.finish_reason||'unknown'})`};let o;try{o=JSON.parse(String(r).replace(/^```(?:json|text)?\s*/i,'').replace(/```$/i,'').trim());}catch{return{reason:'model returned non-JSON content'}}const k=['hook','buildup','reveal','detail','twist','ending'];if(!k.every(x=>typeof o[x]==='string'&&o[x].trim()))return{reason:'six-part field missing'};if(!k.every(x=>oneSentence(clean(o[x]))))return{reason:'field contains multiple beats'};const p=k.map((x,i)=>i?clean(o[x])+'.':clean(o[x])+'?'),script=p.join(' ').replace(/([ఀ-౿])[-‐‑‒–—]([ఀ-౿])/g,'$1 $2'),wc=words(script);if(wc<85||wc>115)return{reason:`word count ${wc} outside 85-115`,rejectedScript:script};if((script.match(/\?/g)||[]).length!==1)return{reason:'expected exactly one hook question',rejectedScript:script};const cb=clickbait(script);if(cb)return{reason:cb,rejectedScript:script};const se=styleErrors(script);if(se)return{reason:se,rejectedScript:script};const g=grounded(script,source);if(g)return{reason:g,rejectedScript:script};for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++){const a=p[i].toLowerCase().split(/\s+/),b=new Set(p[j].toLowerCase().split(/\s+/));const overlap=a.filter(x=>x.length>=4&&b.has(x)).length;if(a.length>=8&&overlap/a.length>.65)return{reason:'repetitive beats detected',rejectedScript:script};}return{script};}
function makePrompt(original,repairReason=''){const source=sourceFrom(original);const repair=repairReason?`\n\nPREVIOUS ATTEMPT FAILED: ${repairReason}. Correct that exact problem. Do not repeat it.`:'';return `నువ్వు ఒక VERIFIED FACT ని Telugu YouTube Shorts కోసం ఒక high-retention storyteller లాగా narration గా మార్చాలి — friend దగ్గర ఒక unbelievable fact వింటున్నట్టు, viewer చివరి వరకు ఆగకుండా చూసేలా.\n\nVERIFIED SOURCE:\n${source}\n\nఈ source మాత్రమే factual authority. Source లో లేని కొత్త fact, number, date, name, cause, effect, example, statistic, comparison లేదా background జోడించకూడదు — నీకు సాధారణంగా తెలిసిన "well-known" విషయాలు (ఉదా. కాంతి వేగం, భూమి వ్యాసం వంటి స్థిరాంకాలు) అయినా సరే, source లో లేకపోతే జోడించకు; ఇలాంటివి తప్పుగా ఉండొచ్చు. Source లో ఒక విషయం మాత్రమే ఉంటే దానినే ఆరు connected beats లో explain చేయాలి; unrelated facts కలపకూడదు.\n\nFLOW (ఖచ్చితంగా ఈ క్రమంలో ఆరు beats):\n1 Hook — curiosity పెంచే ప్రశ్న; fact ని ఇక్కడ reveal చేయకూడదు.\n2 Buildup — ఇంకా జవాబు ఇవ్వకుండా, scale/tension పెంచే ఒక్క thought.\n3 Reveal — hook కి అసలు జవాబు, ఇక్కడే మొదటిసారి core fact చెప్పాలి.\n4 Detail — source లో ఉన్న ఒక ఆశ్చర్యకరమైన నిర్దిష్ట సంఖ్య లేదా వివరం.\n5 Twist — source ఆధారంగా ఒక అదనపు, unexpected angle లేదా implication.\n6 Ending — అదే fact నుంచి వచ్చే memorable takeaway.\n\nSTRICT: ప్రతి beat friend తో మాట్లాడుతున్నట్టు natural స్పోకెన్ తెలుగు లో ఉండాలి — వ్యాసం/పుస్తకం చదివేటట్టు ఉండకూడదు. Formal written-Telugu connectives ('అంతే కాకుండా', 'అందువల్ల', 'తత్ఫలితంగా', 'దీనివల్ల') మరియు passive voice ('తయారు చేయబడింది', 'నిర్మించబడింది', 'గుర్తింపు పొందడంతో') వాడొద్దు — బదులుగా active voice, direct, తక్కువ subordinate-clause వాక్యాలు వాడు. EXACTLY 6 beats. EXACTLY 85-115 whitespace-separated words మొత్తం. Beat 1 మాత్రమే ప్రశ్న; మిగతావి statements. అన్ని beats ఒకే fact కి connected. Source లో లేని number/date/name/claim వద్దు. సైంటిఫిక్ నొటేషన్ (10¹⁸, 2⁵⁶⁸ వంటి superscript exponent) ఎప్పుడూ వాడకూడదు — TTS దాన్ని రెండు వేర్వేరు సంఖ్యలుగా విడగొట్టి తప్పుగా చదువుతుంది; బదులుగా magnitude ని మాటల్లో రాయి (ఉదా. 'బిలియన్ బిలియన్ రెట్లు' లేదా 'క్వింటిలియన్ కీలు'). ఏ సంఖ్యనైనా (సంవత్సరాలు, లెక్కలు, కొలతలు సహా) ASCII అంకెలుగా కాకుండా, ఎప్పుడూ తెలుగు మాటల్లోనే రాయి — **సాధారణ నియమం (తెలుగు లక్ష/కోటి పద్ధతిలో, ఆంగ్ల million పద్ధతిలో కాదు):** పెద్ద భాగం నుండి చిన్న భాగం వరకు వరుసగా చెప్పు, ప్రతి భాగం 0 అయితే పూర్తిగా వదిలేయి — కోట్ల భాగం ('కోటి'/'X కోట్లు'), లక్షల భాగం ('లక్ష'/'X లక్షలు'), వేల భాగం (సరిగ్గా 1000 అయితే ఎప్పుడూ 'వెయ్యి', ఎక్కువైతే 'X వేల'), వందల భాగం ('Y వందల'), చివరగా పదులు+units — మధ్యలో ఉన్న సున్నా భాగాలను ఎప్పుడూ 'సున్నా' అని పలకవద్దు. 'వంద వేల' వద్దు — అది 'లక్ష'. ఉదా. 1000 → 'వెయ్యి', 1500 → 'వెయ్యి ఐదు వందల', 100000 → 'లక్ష', 150000 → 'లక్ష యాభై వేల', 10000000 → 'కోటి'. **మినహాయింపు — YEARS/తేదీలు మాత్రమే:** సంవత్సరం 1100-1999 మధ్య ఉంటే పైన చెప్పిన 'వెయ్యి...' పద్ధతి కాకుండా 'XX వందల Y' century-pair పద్ధతిలో చదవాలి (ఆంగ్లంలో "nineteen seventy-four" అన్నట్టే, "one thousand nine hundred seventy-four" అనరు). ఉదా. 1974 (సంవత్సరం) → 'పందొమ్మిది వందల డెబ్బై నాలుగు', 1904 (సంవత్సరం) → 'పందొమ్మిది వందల నాలుగు' (కాదు 'వెయ్యి తొమ్మిది వందల నాలుగు'). ఇది సంవత్సరాలకు మాత్రమే — count/quantity అయితే (ఉదా. '1500 జాతులు') ఎప్పటిలాగే 'వెయ్యి...' పద్ధతినే వాడు ('వెయ్యి ఐదు వందల జాతులు', 'పదిహేను వందల' కాదు). 2000 తర్వాతి సంవత్సరాలకు (ఉదా. 2024) ఇది వర్తించదు — 'రెండు వేల ఇరవై నాలుగు' వాడు. ఇదే నియమం (century-pair మినహాయింపు తప్ప) numbers/percent/currency/fraction అన్నింటికీ వర్తిస్తుంది (% → శాతం, ₹ → రూపాయలు, ½ → సగం). మోడల్/వెర్షన్ పేర్లలో భాగమైన సంఖ్యలు మాత్రమే మినహాయింపు (ఉదా. 'AES 256', 'iOS 15' యథాతథంగా ఉంచొచ్చు — కానీ మధ్యలో హైఫన్ మాత్రం ఎప్పుడూ వద్దు, 'AES-256' కాదు 'AES 256' — హైఫన్ సంఖ్యకి ఆనుకుని ఉంటే TTS దాన్ని 'మైనస్' అని చదువుతుంది). ఆంగ్ల technical పదాలను (ఉదా. non-local, real-time) తెలుగు లిపిలోకి transliterate చేసేటప్పుడు మధ్యలో హైఫన్ (-) ఎప్పుడూ వాడకు — బదులుగా ఒకే పదంగా కలిపి రాయి లేదా space తో వేరు చేయి (ఉదా. 'నాన్-లోకల్' కాదు, 'నాన్ లోకల్' లేదా ఆంగ్లంలోనే 'non-local' రాయి). Hook (beat 1) లో viewer ని direct గా address చేస్తూ natural engagement phrase వాడొచ్చు, ఉదాహరణకు 'మీకు తెలుసా', 'మీరు నమ్మగలరా', 'ఎప్పుడైనా ఆలోచించారా' — ఇది సహజమైన style. కానీ Beats 2-6 (buildup నుంచి ending వరకు) మాత్రం ఖచ్చితంగా మూడో వ్యక్తి objective storyteller voice లోనే ఉండాలి — మధ్యలో మళ్ళీ నువ్వు/మీరు అని address చేస్తే వాయిస్ మారిపోయినట్టు అనిపిస్తుంది, అది వద్దు. Subject-verb number ఎప్పుడూ సరిపోవాలి — 'ప్రతి X' ఎప్పుడూ ఏకవచన verb తోనే (ఉదా. 'ప్రతి కామెట్ ... కలిగి ఉంటుంది', 'ఉంటాయి' కాదు). 'వక్రీభవించడం' (refraction) అనేది కాంతి ఒక మాధ్యమం గుండా వంగడాన్ని మాత్రమే సూచించే పదం — భౌతిక వస్తువు/పథం వంగడాన్ని చెప్పడానికి దీన్ని వాడకూడదు, బదులుగా 'వంగి' లేదా 'వక్రంగా మారి' వాడు. Source qualifier మార్చవద్దు. Natural spoken Telugu, friend తో మాట్లాడుతున్నట్టు — textbook లేదా news-reader టోన్ వద్దు. Technical English terms అవసరమైతే అలాగే ఉంచు; 3D ని ఎప్పుడూ మూడు D/మూడు డీగా మార్చవద్దు. Labels, CTA, title, keywords, emoji, moral, personal example, engagement request వద్దు. "అసలు విషయం ఏంటంటే", "ఇంకా షాక్ ఏంటంటే" వంటి natural suspense connectors అవసరమైనప్పుడు మాత్రమే వాడు — ప్రతి beat కి కాదు; "నమ్మలేకపోతారు" వంటి generic clickbait వద్దు. ఒకే idea ని repeat చేయవద్దు. **Sentence-to-sentence continuity ముఖ్యం:** ప్రతి beat, దాని ముందు వచ్చిన beat నుంచి నేరుగా కొనసాగింపుగా అనిపించాలి — ఒక్కో beat విడిగా, తనంతట తానే నిలబడే ప్రత్యేక statement లా అనిపించకూడదు. అంశాన్ని/పేరుని ప్రతి beat లో మళ్ళీ పూర్తిగా చెప్పకుండా, 'ఇది', 'అది', 'ఆ', 'ఈ', 'దాంట్లో', 'అక్కడ', 'ఇంత' వంటి reference పదాలతో ముందు వాక్యానికి ముడిపెట్టు — ఆరు విడివిడి facts ని వరుసగా చదివినట్టు కాదు. **ప్రతి ఆంగ్ల పదం/పేరు/సాంకేతిక పదాన్ని/సంఖ్యను తెలుగు లిపిలోకి మార్చేటప్పుడు జాగ్రత్త:** ఇలాంటివి పదే పదే తప్పుగా వస్తున్నాయి — 'పన్నెండు' (12) బదులు 'పన్నెడు', 'కాంగ్రెస్‌మెన్' బదులు 'కాంగ్రెస్మెం', 'బయోమెట్రిక్' బదులు 'బైోమెట్రిక్', 'రిథమైట్‌లు' (rhythmites) బదులు 'రీతిమితులు' — ఇవి చూడటానికి నిజమైన తెలుగు పదంలానే అనిపించొచ్చు, కానీ నిజానికి తెలుగులో లేని పదాలు. ప్రతి transliteration రాసిన తర్వాత, అది ఖచ్చితంగా ఆ ఆంగ్ల పదం ఎలా వినిపిస్తుందో సరిగ్గా ప్రతిబింబిస్తుందో నీకు నువ్వే verify చేసుకో.\n\nగతంలో వచ్చిన తప్పులు (వీటిని అస్సలు చేయకు):
తప్పు: "ఒక అగ్నిపర్వతం సముద్రం అడుగున దాగి ఉంది. ఇది మూడు కిలోమీటర్ల లోతులో ఉంది. దీని ఉష్ణోగ్రత 400 డిగ్రీలు ఉంటుంది. శాస్త్రవేత్తలు దీన్ని కొత్తగా కనుగొన్నారు." (ప్రతి వాక్యం విడిగా ఆగిపోయిన fact-dump లా ఉంది, connect కాలేదు) | సరైనది: "ఒక అగ్నిపర్వతం సముద్రం అడుగున దాగి ఉంది... ఇది కూడా మామూలుది కాదు, ఏకంగా మూడు కిలోమీటర్ల లోతులో. అంత లోతులో కూడా అక్కడి ఉష్ణోగ్రత 400 డిగ్రీలు ఉంటుంది. ఇంత తీవ్రమైన పరిస్థితుల్లోనే శాస్త్రవేత్తలు దీన్ని కొత్తగా కనుగొన్నారు." (ప్రతి వాక్యం ముందుదాన్ని ముందుకు తీసుకెళ్తుంది)
తప్పు: "...ధూళి వాలు వంగి, పథం వెంట వక్రీభవించి..." (వక్రీభవించడం అంటే కాంతి వంగడం మాత్రమే, దీన్ని ఇలా వాడకూడదు) | సరైనది: "...ధూళి వాలు వంగి, పథం వెంట మారి..."
తప్పు: బీట్ 2-6 మధ్యలో "...ఏ దిశలోకి విస్తరిస్తాయో ఊహించలేకపోతున్నావు" లాంటి direct "నువ్వు" address (ఇది hook కాదు, మధ్యలో వాయిస్ మారిపోయినట్టు అనిపిస్తుంది) | సరైనది: "...ఏ దిశలోకి విస్తరిస్తాయో ఊహించలేని విధంగా ఉంటుంది" (మూడో వ్యక్తి; హుక్‌లో మాత్రమే "మీకు తెలుసా"/"మీరు నమ్మగలరా" వాడు).
తప్పు: "ప్రతి కామెట్‌ రెండు వేర్వేరు వాలు కలిగి ... అందిస్తాయి" (బహువచన verb, subject ఏకవచనం) | సరైనది: "ప్రతి కామెట్‌ రెండు వేర్వేరు వాలు కలిగి ... అందిస్తుంది" (ఏకవచన verb)
తప్పు: "ఈ స్థలం యునెస్కో వారసత్వంగా గుర్తింపు పొందడంతో, యూరోపియన్ల మొదటి స్థిర నివాసంగా నిలిచింది" (formal, passive, వ్యాసం style — ఇది TTS చదివితే "చదువుతున్నట్టు" వినిపిస్తుంది) | సరైనది: "ఈ స్థలానికి యునెస్కో వారసత్వ గుర్తింపు కూడా వచ్చింది, ఇది యూరోపియన్ల మొదటి అమెరికా నివాసం" (direct, active, మాట్లాడుతున్నట్టు).
తప్పు: హుక్ లో "ఎలెక్ట్రిక్ ఈల్స్ తమ విద్యుత్తుతో అంధులైపోతాయా?" అని అడిగి, Reveal/Detail/Twist/Ending అంతా voltage గురించే చెప్పి, "అంధులైపోవడం" ప్రస్తావననే వదిలేయడం (Reveal హుక్ కి నిజమైన జవాబు కావాలనే నియమం పాటించలేదు) | సరైనది: హుక్ ని Reveal నిజంగా జవాబిచ్చే విషయానికే సరిపోయేలా రాయాలి — "ఎలెక్ట్రిక్ ఈల్స్ ఎంత శక్తివంతమైన విద్యుత్తు తయారుచేస్తాయో మీకు తెలుసా?" లాంటిది, Reveal లో లేని కొత్త claim హుక్ లో పెట్టకూడదు.
తప్పు: Ending లో generic life-advice/moral రాయడం ("చిన్న తప్పులు పెద్ద మార్పులకు దారితీస్తాయి, జాగ్రత్తగా ఉండాలి" — ఏ fact కైనా అతికించగలిగే generic సలహా) లేదా source లో లేని personal టిప్ కల్పించడం ("స్కిన్‌కేర్ రూటిన్ మార్చితే చర్మం త్వరగా పునరుద్ధరించబడుతుంది" వంటిది) | సరైనది: Ending, ఈ ఒక్క fact scale/takeaway నే నొక్కి ముగించాలి, కొత్త సలహా/జీవిత-పాఠం కల్పించకుండా — ఉదా. "ఇంత చిన్న తేడా కొన్ని రోజుల్లోనే ఇంత పెద్ద దూరంగా మారిపోతుంది".
తప్పు: Detail లో ఒకే వాక్యంలో బహుళ దశాబ్దాలు+పరిశోధకుల పేర్లు కుక్కడం ("1960లలో Festinger... 1970లలో Wason & Lord, Lepper, Preston..." — citation-list లా వినిపిస్తుంది) లేదా అస్పష్టమైన % phrasing ("30 శాతం కంటే ఎక్కువ నిజంగా భావించారు" — దేనికంటే ఎక్కువో స్పష్టం కాదు) | సరైనది: ఒక్క ప్రధాన ఫలితాన్నే స్పష్టమైన, నిస్సందేహమైన పోలికగా చెప్పు, పేర్లు/దశాబ్దాలు కుక్కకుండా — "శాస్త్రవేత్తలు దీన్ని పరీక్షించినప్పుడు, రాజకీయ అభిప్రాయాలకు సరిపోయే వార్తలను వారు ఎక్కువగా నమ్మారు".
తప్పు: Ending లో విరుద్ధమైన పదాలు కలపడం ("90 శాతం పైగా మాత్రమే" — 'మాత్రమే' తక్కువ, 'పైగా' ఎక్కువ సూచిస్తాయి) లేదా script లో ఎక్కడా ప్రస్తావించని కొత్త పోలిక సంఖ్య కల్పించడం ("ప్రపంచంలోని 70 శాతం") | సరైనది: script లో ఇప్పటికే స్థాపించిన fact నే స్పష్టంగా, సూటిగా ముగించాలి, కొత్త సంఖ్య కల్పించకుండా — ఉదా. "మనం చూసే వార్తల్లో చాలా భాగం నిజం కాకపోయినా, మన బబుల్ లోపల మాత్రం అవే నిజంలా అనిపిస్తాయి".

JSON beat rule: ప్రతి beat ఒక్క connected thought మాత్రమే కావాలి. Sentence-ending punctuation ('.', '?', '!', '।') పెట్టవద్దు — program స్వయంగా జోడిస్తుంది. Beat మధ్యలో '...' వాడొచ్చు, కామా (',') కి బదులుగా కూడా — ప్రత్యేకంగా 'మీకు తెలుసా', 'మీరు నమ్మగలరా' వంటి opening interjection తర్వాత ఎప్పుడూ ',' కాకుండా '...' వాడు (ఇది storyteller ఆగి చెప్తున్నట్టు అనిపిస్తుంది, ',' రాసిన వాక్యంలా అనిపిస్తుంది). ఉదా: తప్పు: "మీకు తెలుసా, వైకింగ్స్‌లు ఉత్తర అమెరికా తీరంలో ఒక నగరాన్ని స్థాపించారా" | సరైనది: "మీకు తెలుసా... వైకింగ్స్‌లు ఉత్తర అమెరికా తీరంలో ఒక నగరాన్ని స్థాపించారా". అంతకుమించి ఏ punctuation వద్దు. Abbreviations with periods వద్దు.\n\nJSON మాత్రమే ఇవ్వాలి: {"hook":"curiosity question beat","buildup":"tension beat","reveal":"direct answer beat","detail":"surprising number/detail beat","twist":"unexpected angle beat","ending":"memorable takeaway beat"}${repair}`;}
// CONFIRMED REAL BUG (production run failure, log: 'Clean fact narration
// failed — This operation was aborted'): the outer caller (index.js's
// fetchWithTimeout, via callLLM) wraps its single fetch() in an
// AbortController with its own timeout and passes that signal down through
// options. But by the time that call reaches here, it's not one fetch
// anymore — guardedFetch below can retry up to 6 times with model
// switching and exponential backoff, easily taking minutes. The outer
// signal was being forwarded to every retry's native fetch, so the OUTER
// timeout — sized for a single call — fired mid-loop and aborted whatever
// attempt was in flight, discarding retry budget the guard still had left.
// Fix: ignore the inherited signal entirely and give each individual
// attempt its own fresh, dedicated timeout, so the guard's multi-attempt
// process is self-contained and not at the mercy of a caller-sized budget.
async function request(url,options,original,model,repairReason=''){let b=JSON.parse(String(options.body||'{}'));b.model=model;b.messages=[{role:'user',content:makePrompt(original,repairReason)}];b.temperature=.15;b.reasoning_effort='low';b.include_reasoning=false;b.max_completion_tokens=2500;delete b.max_tokens;b.response_format={type:'json_schema',json_schema:{name:'telugu_fact_narration',strict:true,schema:{type:'object',properties:{hook:{type:'string'},buildup:{type:'string'},reveal:{type:'string'},detail:{type:'string'},twist:{type:'string'},ending:{type:'string'}},required:['hook','buildup','reveal','detail','twist','ending'],additionalProperties:false}}};const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),45000);let r;try{r=await PREVIOUS(url,{...options,signal:controller.signal,body:JSON.stringify(b)});}catch(e){if(e.name==='AbortError'){const te=new Error('Groq request timed out after 45000ms (per-attempt cap, independent of the outer request-level timeout)');te.status=598;throw te;}throw e;}finally{clearTimeout(timer);}let d;try{d=await r.clone().json();}catch{throw new Error(`Groq returned non-JSON response (HTTP ${r.status})`);}if(!r.ok||d?.error){const e=new Error(`Groq API error ${r.status}: ${d?.error?.message||d?.error?.code||'unknown'}`);e.status=r.status;e.retryAfter=Number(r.headers.get('retry-after')||0);throw e;}return{r,d};}
const sleep=ms=>new Promise(x=>setTimeout(x,ms));
async function guardedFetch(url,options={}){if(!isGroq(url,options))return PREVIOUS(url,options);let b;try{b=JSON.parse(String(options.body||'{}'));}catch{return PREVIOUS(url,options);}const last=Array.isArray(b.messages)?b.messages[b.messages.length-1]:null,original=last?.content||'';if(!isNarrationPrompt(original))return PREVIOUS(url,options);const source=sourceFrom(original);if(!source)throw new Error('Clean fact narration failed — verified source missing');console.log(`${GUARD_MARKER}: intercepted final narration request.`);let model=PRIMARY_MODEL,lastReason='unknown';for(let attempt=0;attempt<6;attempt++){try{const x=await request(url,options,original,model,lastReason==='unknown'?'':lastReason),v=parse(x.d,x.r.status,source);if(v.script){x.d.choices[0].message.content=v.script;x.d.choices[0].finish_reason='stop';console.log(`${GUARD_MARKER}: FINAL FACT NARRATION accepted — ${words(v.script)} words, 6-beat retention arc, model=${model}.`);return new Response(JSON.stringify(x.d),{status:x.r.status,statusText:x.r.statusText,headers:x.r.headers});}lastReason=v.reason;console.log(`${GUARD_MARKER}: validation ${attempt+1}/6 rejected — ${lastReason}${v.rejectedScript?` | rejected script: ${v.rejectedScript.slice(0,400)}`:''}`);}catch(e){lastReason=e.message;const transient=[429,498,500,502,503,504,598].includes(e.status)||(e.status===400&&/Failed to validate JSON/i.test(lastReason));if(!transient)throw new Error(`Clean fact narration failed — ${lastReason}`);if(model===PRIMARY_MODEL&&attempt>=2){model=FALLBACK_MODEL;console.log(`${GUARD_MARKER}: switching to ${model}.`);}const delay=e.retryAfter?Math.min(e.retryAfter*1000,60000):Math.min(8000*Math.pow(2,attempt),30000);await sleep(delay);}}throw new Error(`Clean fact narration failed after bounded attempts — ${lastReason}`);}
global.fetch=guardedFetch;guardedFetch.__NARRATION_QUALITY_GUARD_V14__=true;module.exports={enabled:true,marker:GUARD_MARKER,styleErrors:styleErrors,hasBareDigits:hasBareDigits,extractBareDigitNumbers:extractBareDigitNumbers,teluguTextContainsNumber:teluguTextContainsNumber,nums:nums,parseTeluguNumbers:parseTeluguNumbers};console.log(`${GUARD_MARKER}: enabled — strict grounded six-beat retention-style fact narration guard loaded.`);
