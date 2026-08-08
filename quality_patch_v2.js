const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'index.js');
let s = fs.readFileSync(file, 'utf8');

if (s.includes('// QUALITY_PATCH_V2')) {
  console.log('QUALITY_PATCH_V2 already applied.');
  process.exit(0);
}

// 1) The old 5-beat LLM call was becoming a second source of hallucination:
// it could invent a detail, and the narration writer would then expand it.
// The verified outline must be the only factual source of truth.
s = s.replace(
  '  const beats = await generateStoryBeats(outline);',
  `  // QUALITY_PATCH_V2: do not ask a second model call to reinterpret the fact.
  // The verified outline is the single source of truth; story planning happens
  // inside the narration writer instead of through a lossy/hallucination-prone
  // intermediate beat generator.
  const beats = {};`
);

// 2) Replace the narration prompt with a story-first writer prompt.
const start = s.indexOf('function buildNarrationPrompt(category, recentTitles, outline, beats) {');
const endMarker = '\n\n// CALL B of Stage 2:';
const end = s.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('QUALITY_PATCH_V2: narration prompt anchors not found');

const newPrompt = String.raw`// QUALITY_PATCH_V2
function buildNarrationPrompt(category, recentTitles, outline, beats) {
  const avoidLine = recentTitles.length
    ? `\n\nఇటీవల వాడిన titles/hooks: ${recentTitles.slice(-10).join(' | ')}\nవాటి wording, opening pattern, twist లేదా ending pattern ని copy చేయకు.`
    : '';
  const { min, max } = WORD_COUNT_TARGETS[category];

  return `కింద ఇచ్చిన VERIFIED FACT ఆధారంగా ఒక original Telugu YouTube Shorts narration రాయి.

VERIFIED FACT — THIS IS THE ONLY SOURCE OF TRUTH:
${compactOutlineForGrounding(outline)}

నీ TASK:
నువ్వు encyclopedia paragraph రాయడం లేదు. Viewer కి ఒక unbelievable fact ని ఒక friend exciting-ga చెబుతున్నట్టు చిన్న spoken story రాస్తున్నావు.

ముందుగా నీలోనే silently ఆలోచించు:
1. ఈ fact లో scroll ఆపించే ఒక్క curiosity ఏది?
2. Viewer మొదట ఏ question అడుగుతాడు?
3. Answer ని ఒక్కసారిగా కాకుండా ఏ 2-4 steps లో reveal చేయాలి?
4. Fact లో నిజంగా ఉన్న strongest surprising detail ఏది?
5. చివర్లో viewer గుర్తుపెట్టుకునే payoff ఏది?

ఆ planning ని output లో చూపించకు. Final narration మాత్రమే ఇవ్వు.

TARGET STYLE:
- ${min}-${max} తెలుగు పదాలు. కానీ word count కోసం filler ఎప్పుడూ జోడించవద్దు.
- సుమారు 10-16 spoken lines. Line count కోసం కూడా filler వద్దు.
- ప్రతి line 2-10 పదాల మధ్య ఉండేలా ప్రయత్నించు, కానీ grammar కోసం అవసరమైతే కొంచెం ఎక్కువ ఉండొచ్చు.
- ఒక line = ఒక natural spoken thought.
- Paragraphలా చదివినట్టు కాకుండా, camera ముందు ఎవరో చెబుతున్నట్టు conversational Telugu.
- మొదటి 1-2 lines curiosity create చేయాలి; core answer ని వెంటనే dump చేయకూడదు.
- తర్వాత question → partial reveal → evidence/detail → strongest surprise → payoff అనే flow ఉండాలి.
- ప్రతి line తర్వాత వచ్చే line వినాలనిపించేలా information progress ఉండాలి.

CRITICAL WRITING TEST:
ప్రతి sentence గురించి నీలోనే అడుగు:
“ఈ line కొత్త fact చెబుతోందా? curiosity పెంచుతోందా? ముందు line కి answer ఇస్తోందా? reveal ని stronger చేస్తోందా? ending కి తీసుకెళ్తుందా?”
ఈ ఐదింటిలో ఏదీ కాకపోతే ఆ line ని DELETE చేయి.

ABSOLUTELY NO FILLER:
- “పురావస్తుశాస్త్రవేత్తలు సాహసంగా తవ్వారు” లాంటి scene-setting filler వద్దు.
- “ఇది చరిత్రలో కొత్త అధ్యాయం”, “ఇది మనల్ని ఆశ్చర్యపరుస్తుంది”, “ఈ విషయం చాలా ఆసక్తికరం” లాంటి generic filler వద్దు.
- Fact already says something; దాన్ని 3 వేర్వేరు sentences లో repeat చేయవద్దు.
- Word count reach చేయడానికి adjective, formal explanation, generic conclusion, artificial emotion జోడించవద్దు.
- ఒక fact తెలియకపోతే దాన్ని ఊహించి bridge sentence రాయవద్దు.

FACTUAL DISCIPLINE — NON-NEGOTIABLE:
- VERIFIED FACT లో లేని కొత్త number, name, location, date, cause, mechanism, comparison, example లేదా claim జోడించకూడదు.
- “may/can/some/possibly” వంటి limitation ఉంటే overclaim చేయవద్దు.
- “found in” ని “made in” గా మార్చవద్దు.
- “used to filter” ని “made from” గా మార్చవద్దు.
- ఒక process గురించి fact చెబితే process ని consequence గా కల్పించవద్దు.
- నీకు ఏ detail ఖచ్చితంగా తెలియకపోతే దాన్ని చెప్పకుండా వదిలేయి.

HOOK STYLE:
Fact కి సరిపోయినప్పుడు మాత్రమే:
“🤯 ఒక గుహలో దొరికిన చీజ్...”
“దాదాపు ఏడు వేల ఏళ్ల నాటిదని తెలుసా?”
“ఇంత పాతది ఎలా మిగిలింది?”
లాంటి curiosity ladder వాడు.
కానీ ఈ exact wording copy చేయవద్దు.
ప్రతి script లో “అనుకుంటున్నారా? కాదు...” తప్పనిసరి కాదు.

PAUSE / PUNCTUATION:
- “...” = suspense/reveal/emotional pause మాత్రమే.
- సాధారణంగా 2-4 meaningful places మాత్రమే ellipsis వాడు.
- “,” = short natural breath.
- “.” = complete thought ముగిసినప్పుడు.
- ఒకే sentence లో multiple clauses ని commaలతో కుక్కవద్దు.
- Line break = spoken beat.

LANGUAGE:
- సహజమైన మాట్లాడే తెలుగు.
- textbook/news-reader/formal Telugu వద్దు.
- Telugu script మాత్రమే.
- Technical term నిజంగా అవసరమైతే మాత్రమే వాడు.
- ASCII digits వద్దు; సంఖ్యలను సహజమైన తెలుగు మాటల్లో రాయి.
- English words only when they are genuinely natural/necessary.

ENDING:
చివరి 1-2 lines fact యొక్క strongest memorable takeaway కావాలి.
Generic moral లేదా subscribe request వద్దు.

${avoidLine}

FINAL SILENT CHECK BEFORE OUTPUT:
- ఇది నిజంగా spoken Telugu లాగా ఉందా?
- ఒక్క sentence కూడా filler గా ఉందా?
- ఏ line అయినా source fact కి మించి claim చేస్తున్నదా?
- మొదటి 3 lines curiosity create చేస్తున్నాయా?
- మధ్యలో actual fact clearly reveal అవుతోందా?
- చివర్లో memorable payoff ఉందా?
- punctuation natural గా ఉందా?

కేవలం final narration text మాత్రమే ఇవ్వు.`;
}`;

s = s.slice(0, start) + newPrompt + s.slice(end);

// 3) Shorter, quality-first range. Do not force the model to manufacture
// 85-115 words when the verified fact is naturally expressible in ~70-100.
s = s.replace(/min: 85, max: 115/g, 'min: 70, max: 100');

// 4) Add a focused editorial reviewer. It is intentionally strict: it checks
// writing quality and factual scope, then returns a clean replacement script
// only when the draft is weak. This is the missing step that distinguishes
// “fact explanation” from “engaging narration”.
const reviewerHelper = String.raw`

// QUALITY_PATCH_V2: editorial quality gate.
function buildNarrationReviewPrompt(script, outline) {
  return `నువ్వు Telugu YouTube Shorts కి senior script editor.

VERIFIED FACT — ONLY SOURCE OF TRUTH:
${compactOutlineForGrounding(outline)}

DRAFT NARRATION:
${script}

ఈ draft ని publish చేయడానికి ముందు కఠినంగా review చేయి.

FAIL చేయాల్సిన కారణాలు:
1. FILLER — fact/story ని ముందుకు తీసుకెళ్లని generic sentence.
2. AWKWARD_TELUGU — సహజంగా మాట్లాడే తెలుగు లా వినిపించకపోవడం.
3. FLAT — hook తర్వాత curiosity/reveal progression లేకపోవడం.
4. REPETITION — అదే fact ని వేరే మాటల్లో repeat చేయడం.
5. UNSUPPORTED — verified fact లో లేని claim/number/name/location/cause/example.
6. TEXTBOOK — encyclopedia/news-reader style.
7. WEAK_ENDING — చివర్లో memorable payoff లేకపోవడం.
8. TTS_BAD — చాలా పొడవైన sentence, unnatural punctuation, లేదా awkward fragments.

PASS criteria:
- మొదటి lines scroll-stopping curiosity.
- ప్రతి line story ని ముందుకు తీసుకెళ్తుంది.
- fact clearly కానీ step-by-step reveal అవుతుంది.
- unnecessary explanation లేదు.
- natural spoken Telugu.
- factual scope intact.
- ending memorable.

DRAFT strong అయితే:
PASS

DRAFT weak అయితే:
REWRITE
(దాని కింద corrected final narration మాత్రమే)

REWRITE చేసేటప్పుడు:
- VERIFIED FACT లో లేని ఏ information జోడించవద్దు.
- సహజమైన short-form length ఉంచు; filler కోసం length పెంచవద్దు.
- 10-16 spoken lines.
- curiosity → reveal → surprise → payoff flow.
- punctuation natural.
- final answer లో review explanation వద్దు.`;
}

async function qualityReviewAndRewrite(script, outline, category) {
  try {
    const review = (await callLLM(buildNarrationReviewPrompt(script, outline))).trim();
    if (/^PASS\b/i.test(review)) {
      log('QUALITY V2: editorial review PASS ✅');
      return script;
    }
    const rewriteMatch = review.match(/^REWRITE\s*\n([\s\S]*)$/i);
    if (!rewriteMatch) {
      log('QUALITY V2: reviewer returned no usable rewrite — keeping draft.');
      return script;
    }
    const rewritten = rewriteMatch[1].trim();
    const wc = narrationWordCount(rewritten);
    const lines = narrationLineCount(rewritten);
    const target = WORD_COUNT_TARGETS[category];
    if (wc >= target.min - 10 && wc <= 115 && lines >= 8 && lines <= 18) {
      log(`QUALITY V2: reviewer rewrote draft → accepted (${wc} words, ${lines} lines).`);
      return rewritten;
    }
    log(`QUALITY V2: reviewer rewrite rejected (${wc} words, ${lines} lines) — keeping original draft.`);
    return script;
  } catch (e) {
    log(`QUALITY V2: editorial review failed (${e.message}) — keeping original draft.`);
    return script;
  }
}
`;
const insertBefore = 'async function generateContent(category, recentTitles, outline, ctaSentence) {';
if (!s.includes(insertBefore)) throw new Error('QUALITY_PATCH_V2: generateContent anchor not found');
s = s.replace(insertBefore, reviewerHelper + '\n' + insertBefore);

// 5) Run the quality gate immediately after the normal length-selection pass,
// before punctuation optimization and metadata. This means title/hook are
// extracted from the final reviewed narration.
const reviewAnchor = '  script = bestScript;\n\n  // Safety-net detection: numbers 1000+ written as digits get mispronounced';
if (!s.includes(reviewAnchor)) throw new Error('QUALITY_PATCH_V2: bestScript anchor not found');
s = s.replace(reviewAnchor, `  script = bestScript;

  // QUALITY_PATCH_V2: final editorial gate. This is where the model must
  // decide whether the draft actually sounds like a human telling a story,
  // not merely whether it contains enough words.
  script = await qualityReviewAndRewrite(script, outline, category);

  // Safety-net detection: numbers 1000+ written as digits get mispronounced`);

// 6) The old retry prompts explicitly asked for “8-word fragments”, which
// encouraged the exact broken fragments seen in production. Replace those
// phrases wherever they occur in retry prompts.
s = s.replace(/"\.\.\." తో dramatic pause ఇస్తూ, 8 పదాల లోపు చిన్న వాక్యఖండాలతో రాయి/g,
  '"..." ను suspense/reveal కోసం మాత్రమే వాడు; సహజమైన పూర్తి spoken thoughts గా రాయి');
s = s.replace(/ప్రతి line తర్వాత curiosity ఉండాలి\. Natural spoken Telugu లో short, punchy sentences వాడు\./g,
  'ప్రతి line story ని ముందుకు తీసుకెళ్లాలి. Natural spoken Telugu లో short, punchy sentences వాడు; filler వద్దు.');

fs.writeFileSync(file, s, 'utf8');
console.log('QUALITY_PATCH_V2 applied successfully.');
