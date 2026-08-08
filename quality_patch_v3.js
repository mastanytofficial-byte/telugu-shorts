const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'index.js');
let s = fs.readFileSync(file, 'utf8');

if (s.includes('// QUALITY_PATCH_V3_APPLIED')) {
  console.log('QUALITY_PATCH_V3 already applied.');
  process.exit(0);
}

// Keep the verified fact as the only factual source. If the older story-beat
// call still exists, disable it so a second model response cannot introduce
// invented details.
s = s.replace(
  /\s*const beats = await generateStoryBeats\(outline\);/,
  '\n  // QUALITY_PATCH_V3_APPLIED: verified outline is the single source of truth.\n  const beats = {};'
);

const startMarker = 'function buildNarrationPrompt(category, recentTitles, outline, beats) {';
const start = s.indexOf(startMarker);
if (start < 0) {
  throw new Error('QUALITY_PATCH_V3: buildNarrationPrompt not found');
}

// Find the next top-level function after the narration prompt. This is more
// robust than relying on a historical comment such as "CALL B of Stage 2".
const afterStart = start + startMarker.length;
const nextFunction = /\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/g;
nextFunction.lastIndex = afterStart;
const match = nextFunction.exec(s);
if (!match) {
  throw new Error('QUALITY_PATCH_V3: end of narration prompt not found');
}
const end = match.index;

const newPrompt = String.raw`// QUALITY_PATCH_V3_APPLIED
function buildNarrationPrompt(category, recentTitles, outline, beats) {
  const avoidLine = recentTitles.length
    ? `\n\nఇటీవల వాడిన titles/hooks: ${recentTitles.slice(-10).join(' | ')}\nవాటి wording, opening pattern, twist లేదా ending pattern ని copy చేయకు.`
    : '';
  const target = WORD_COUNT_TARGETS[category] || { min: 70, max: 100 };

  return `కింద ఇచ్చిన VERIFIED FACT ఆధారంగా ఒక original Telugu YouTube Shorts narration రాయి.

VERIFIED FACT — THIS IS THE ONLY SOURCE OF TRUTH:
${compactOutlineForGrounding(outline)}

నీ ROLE:
నువ్వు textbook writer కాదు. ఒక professional Telugu Shorts storyteller. Viewer scroll ఆపి, “తర్వాత ఏమిటి?” అనిపించేలా ఈ fact ని చిన్న spoken storyగా చెప్పాలి.

ముందుగా నీలోనే silently plan చేయి — output లో plan చూపించకు:
1. ఈ fact లో అసలు scroll-stopping curiosity ఏది?
2. Viewer మొదట ఏ question అడుగుతాడు?
3. Answer ని వెంటనే చెప్పకుండా ఏ చిన్న steps లో reveal చేయాలి?
4. Fact లో strongest surprise ఏది?
5. చివర్లో viewer గుర్తుపెట్టుకునే payoff ఏది?

WRITING FLOW:
Hook → curiosity → question → partial reveal → real fact → strongest surprising detail → memorable payoff.
ప్రతి line తర్వాత వచ్చే line వినాలనిపించేలా information ముందుకు కదలాలి.

TARGET:
- ${target.min}-${target.max} తెలుగు పదాలు. Word count కోసం filler ఎప్పుడూ జోడించవద్దు.
- సుమారు 10-16 short spoken lines.
- ఒక line = ఒక natural spoken thought.
- Paragraphలా చదివినట్టు కాకుండా camera ముందు ఎవరో exciting-ga చెబుతున్నట్టు conversational Telugu.
- మొదటి 2-3 lines లో curiosity strongగా ఉండాలి.
- Core answer ని మొదటి line లో dump చేయవద్దు.
- కానీ suspense కోసం fact ని unnecessarily hide చేయవద్దు.

HOOK EXAMPLE STYLE ONLY:
“🤯 ఒక గుహలో దొరికిన చీజ్...”
“దాదాపు ఏడు వేల ఏళ్ల నాటిదని తెలుసా?”
“ఇంత పాత చీజ్ ఎలా మిగిలింది?”
ఇది exact wordingగా copy చేయకూడదు. Fact కి సరిపోయిన hook ని కొత్తగా రాయి.
“అనుకుంటున్నారా? కాదు...” ప్రతి script లో తప్పనిసరి కాదు.

NO FILLER — STRICT:
- “పురావస్తుశాస్త్రవేత్తలు సాహసంగా తవ్వారు” లాంటి unnecessary scene-setting వద్దు.
- “ఇది చరిత్రలో కొత్త అధ్యాయం”, “ఇది చాలా ఆసక్తికరం”, “మనల్ని ఆశ్చర్యపరుస్తుంది” లాంటి generic lines వద్దు.
- ఒకే fact ని మూడు రకాలుగా repeat చేయవద్దు.
- Word count కోసం adjectives, formal explanations, artificial emotion లేదా generic ending జోడించవద్దు.
- Fact లో లేని bridge detail ఊహించి రాయవద్దు.

FACTUAL DISCIPLINE — ABSOLUTE:
- VERIFIED FACT లో లేని number, name, date, location, cause, mechanism, comparison, example లేదా claim జోడించకూడదు.
- Source లో limitation ఉంటే దాన్ని overclaim చేయవద్దు.
- “found in” ని “made in” గా మార్చవద్దు.
- “used to filter” ని “made from” గా మార్చవద్దు.
- ఏ detail ఖచ్చితంగా source లో లేకపోతే దాన్ని వదిలేయి.
- Fact ని interesting చేయడానికి కొత్త information invent చేయడం strictly forbidden.

LANGUAGE:
- సహజమైన మాట్లాడే తెలుగు.
- textbook/news-reader/formal Telugu వద్దు.
- Telugu script ప్రధానంగా వాడు.
- Technical term అవసరమైతే మాత్రమే వాడు.
- ASCII digits వద్దు; సంఖ్యలను తెలుగు మాటల్లో రాయి.
- Natural English terms మాత్రమే అవసరమైనప్పుడు వాడు.

PUNCTUATION / TTS:
- “...” = suspense, reveal లేదా emotional pause. సాధారణంగా 2-4 meaningful places మాత్రమే.
- “,” = చిన్న natural breath కోసం మాత్రమే.
- “.” = complete thought ముగిసినప్పుడు.
- ఒక sentence లో clauses ని commaలతో ఎక్కువగా కుక్కవద్దు.
- Line break = spoken beat.
- Punctuation ని decoration కోసం వాడవద్దు.

ENDING:
చివరి 1-2 lines generic CTA కాకుండా fact యొక్క strongest memorable takeaway కావాలి.

${avoidLine}

FINAL SILENT CHECK:
- ఇది నిజంగా మాట్లాడే తెలుగు లాగా ఉందా?
- మొదటి 3 lines curiosity create చేస్తున్నాయా?
- ప్రతి line ఏదో కొత్తది చేస్తున్నదా?
- filler line ఉందా? ఉంటే delete చేయి.
- source fact కి మించి claim చేశానా? చేస్తే delete చేయి.
- reveal clearగా ఉందా?
- ending memorableగా ఉందా?
- punctuation naturalగా ఉందా?

కేవలం final narration text మాత్రమే ఇవ్వు.`;
}
`;

s = s.slice(0, start) + newPrompt + s.slice(end);

// Prefer a compact quality-first target over forcing the model to pad scripts.
s = s.replace(/min:\s*85,\s*max:\s*115/g, 'min: 70, max: 100');

fs.writeFileSync(file, s, 'utf8');
console.log('QUALITY_PATCH_V3 applied successfully.');
