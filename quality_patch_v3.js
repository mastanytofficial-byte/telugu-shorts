const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'index.js');
let s = fs.readFileSync(file, 'utf8');

if (s.includes('// QUALITY_PATCH_V3_APPLIED')) {
  console.log('QUALITY_PATCH_V3 already applied.');
  process.exit(0);
}

// The verified outline must remain the single factual source of truth.
s = s.replace(
  /\s*const beats = await generateStoryBeats\(outline\);/,
  '\n  // QUALITY_PATCH_V3_APPLIED: verified outline is the single source of truth.\n  const beats = {};'
);

const startMarker = 'function buildNarrationPrompt(category, recentTitles, outline, beats) {';
const start = s.indexOf(startMarker);
if (start < 0) throw new Error('QUALITY_PATCH_V3: buildNarrationPrompt not found');

const afterStart = start + startMarker.length;
const nextFunction = /\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/g;
nextFunction.lastIndex = afterStart;
const match = nextFunction.exec(s);
if (!match) throw new Error('QUALITY_PATCH_V3: end of narration prompt not found');
const end = match.index;

const avoidLine = "\n\nఇటీవల వాడిన titles/hooks: " + recentTitlesPlaceholder() + "\nవాటి wording, opening pattern, twist లేదా ending pattern ని copy చేయకు.";

const newPrompt = `// QUALITY_PATCH_V3_APPLIED
function buildNarrationPrompt(category, recentTitles, outline, beats) {
  const avoidLine = recentTitles.length
    ? "\\n\\nఇటీవల వాడిన titles/hooks: " + recentTitles.slice(-10).join(" | ") + "\\nవాటి wording, opening pattern, twist లేదా ending pattern ని copy చేయకు."
    : "";
  const target = WORD_COUNT_TARGETS[category] || { min: 70, max: 100 };

  return "కింద ఇచ్చిన VERIFIED FACT ఆధారంగా ఒక original Telugu YouTube Shorts narration రాయి.\\n\\n" +
    "VERIFIED FACT — THIS IS THE ONLY SOURCE OF TRUTH:\\n" + compactOutlineForGrounding(outline) + "\\n\\n" +
    "నీ ROLE:\\n" +
    "నువ్వు textbook writer కాదు. ఒక professional Telugu Shorts storyteller. Viewer scroll ఆపి, తరువాత ఏమిటి? అనిపించేలా ఈ fact ని చిన్న spoken storyగా చెప్పాలి.\\n\\n" +
    "ముందుగా నీలోనే silently plan చేయి — output లో plan చూపించకు:\\n" +
    "1. ఈ fact లో అసలు scroll-stopping curiosity ఏది?\\n" +
    "2. Viewer మొదట ఏ question అడుగుతాడు?\\n" +
    "3. Answer ని వెంటనే చెప్పకుండా ఏ చిన్న steps లో reveal చేయాలి?\\n" +
    "4. Fact లో strongest surprise ఏది?\\n" +
    "5. చివర్లో viewer గుర్తుపెట్టుకునే payoff ఏది?\\n\\n" +
    "WRITING FLOW:\\n" +
    "Hook → curiosity → question → partial reveal → real fact → strongest surprising detail → memorable payoff.\\n" +
    "ప్రతి line తర్వాత వచ్చే line వినాలనిపించేలా information ముందుకు కదలాలి.\\n\\n" +
    "TARGET:\\n" +
    "- " + target.min + "-" + target.max + " తెలుగు పదాలు. Word count కోసం filler ఎప్పుడూ జోడించవద్దు.\\n" +
    "- సుమారు 10-16 short spoken lines.\\n" +
    "- ఒక line = ఒక natural spoken thought.\\n" +
    "- Paragraphలా చదివినట్టు కాకుండా camera ముందు ఎవరో exciting-ga చెబుతున్నట్టు conversational Telugu.\\n" +
    "- మొదటి 2-3 lines లో curiosity strongగా ఉండాలి.\\n" +
    "- Core answer ని మొదటి line లో dump చేయవద్దు.\\n" +
    "- కానీ suspense కోసం fact ని unnecessarily hide చేయవద్దు.\\n\\n" +
    "HOOK EXAMPLE STYLE ONLY:\\n" +
    "ఒక గుహలో దొరికిన చీజ్...\\n" +
    "దాదాపు ఏడు వేల ఏళ్ల నాటిదని తెలుసా?\\n" +
    "ఇంత పాత చీజ్ ఎలా మిగిలింది?\\n" +
    "ఇది exact wordingగా copy చేయకూడదు. Fact కి సరిపోయిన hook ని కొత్తగా రాయి.\\n" +
    "అనుకుంటున్నారా? కాదు... ప్రతి script లో తప్పనిసరి కాదు.\\n\\n" +
    "NO FILLER — STRICT:\\n" +
    "- unnecessary scene-setting వద్దు.\\n" +
    "- generic lines వద్దు.\\n" +
    "- ఒకే fact ని మూడు రకాలుగా repeat చేయవద్దు.\\n" +
    "- Word count కోసం adjectives, formal explanations, artificial emotion లేదా generic ending జోడించవద్దు.\\n" +
    "- Fact లో లేని bridge detail ఊహించి రాయవద్దు.\\n\\n" +
    "FACTUAL DISCIPLINE — ABSOLUTE:\\n" +
    "- VERIFIED FACT లో లేని number, name, date, location, cause, mechanism, comparison, example లేదా claim జోడించకూడదు.\\n" +
    "- Source లో limitation ఉంటే దాన్ని overclaim చేయవద్దు.\\n" +
    "- found in ని made in గా మార్చవద్దు.\\n" +
    "- used to filter ని made from గా మార్చవద్దు.\\n" +
    "- ఏ detail ఖచ్చితంగా source లో లేకపోతే దాన్ని వదిలేయి.\\n" +
    "- Fact ని interesting చేయడానికి కొత్త information invent చేయడం strictly forbidden.\\n\\n" +
    "LANGUAGE:\\n" +
    "- సహజమైన మాట్లాడే తెలుగు.\\n" +
    "- textbook/news-reader/formal Telugu వద్దు.\\n" +
    "- Telugu script ప్రధానంగా వాడు.\\n" +
    "- Technical term అవసరమైతే మాత్రమే వాడు.\\n" +
    "- ASCII digits వద్దు; సంఖ్యలను తెలుగు మాటల్లో రాయి.\\n" +
    "- Natural English terms మాత్రమే అవసరమైనప్పుడు వాడు.\\n\\n" +
    "PUNCTUATION / TTS:\\n" +
    "- ... = suspense, reveal లేదా emotional pause. సాధారణంగా 2-4 meaningful places మాత్రమే.\\n" +
    "- , = చిన్న natural breath కోసం మాత్రమే.\\n" +
    "- . = complete thought ముగిసినప్పుడు.\\n" +
    "- ఒక sentence లో clauses ని commaలతో ఎక్కువగా కుక్కవద్దు.\\n" +
    "- Line break = spoken beat.\\n" +
    "- Punctuation ని decoration కోసం వాడవద్దు.\\n\\n" +
    "ENDING:\\n" +
    "చివరి 1-2 lines generic CTA కాకుండా fact యొక్క strongest memorable takeaway కావాలి.\\n" +
    avoidLine + "\\n\\n" +
    "FINAL SILENT CHECK:\\n" +
    "- ఇది నిజంగా మాట్లాడే తెలుగు లాగా ఉందా?\\n" +
    "- మొదటి 3 lines curiosity create చేస్తున్నాయా?\\n" +
    "- ప్రతి line ఏదో కొత్తది చేస్తున్నదా?\\n" +
    "- filler line ఉందా? ఉంటే delete చేయి.\\n" +
    "- source fact కి మించి claim చేశానా? చేస్తే delete చేయి.\\n" +
    "- reveal clearగా ఉందా?\\n" +
    "- ending memorableగా ఉందా?\\n" +
    "- punctuation naturalగా ఉందా?\\n\\n" +
    "కేవలం final narration text మాత్రమే ఇవ్వు.";
}
`;

// Remove the unused helper text from the patch source itself. It exists only
// to make the patch file's template generation visually simple.
function recentTitlesPlaceholder() { return '${recentTitles.slice(-10).join(" | ")}'; }

s = s.slice(0, start) + newPrompt + s.slice(end);
s = s.replace(/min:\s*85,\s*max:\s*115/g, 'min: 70, max: 100');

fs.writeFileSync(file, s, 'utf8');
console.log('QUALITY_PATCH_V3 applied successfully.');
