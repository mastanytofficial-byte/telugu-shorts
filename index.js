// Telugu Amazing Facts Shorts — fully automated, runs on GitHub Actions
// Rotates weekly through 7 fact sub-niches: mindblowing, psychology, earth_space, animal, money, history, human_body
// Topic/Script (Groq) -> Voice (Google TTS) -> Images/Video (Pexels/AI) -> Music (Jamendo) -> Video (FFmpeg) -> YouTube

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { google } = require('googleapis');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY;
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const JAMENDO_CLIENT_ID = process.env.JAMENDO_CLIENT_ID;
const YT_CLIENT_ID = process.env.YT_CLIENT_ID;
const YT_CLIENT_SECRET = process.env.YT_CLIENT_SECRET;
const YT_REFRESH_TOKEN = process.env.YT_REFRESH_TOKEN;

const STATE_FILE = path.join(__dirname, 'state.json');
const WORK_DIR = path.join(__dirname, 'work');

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// A stalled connection to any external API (Groq, Google TTS, Pexels,
// Jamendo) could otherwise hang until GitHub Actions' 15-minute job timeout
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

// "Amazing Facts" niche — 7 specific sub-topics rotating evenly, avoiding
// the "boring generic facts channel" trap by staying hyper-specific per
// video. Accuracy risk was explicitly discussed and accepted (facts,
// unlike fiction, carry hallucination/misinformation risk that can't be
// 100% guaranteed away). 1 video/day — a 10/day scale-up would need real
// infrastructure changes (YouTube upload quota, GH Actions runtime budget).
const FACT_SUBNICHES = ['mindblowing', 'psychology', 'earth_space', 'animal', 'money', 'history', 'human_body', 'technology', 'food', 'ocean'];

function pickCategory(runCount) {
  const category = FACT_SUBNICHES[runCount % FACT_SUBNICHES.length];
  log(`Today's category: ${category} (run #${runCount})`);
  return category;
}

// Curated, fact-checked outlines (hook question + verified explanation +
// twist, fully written) — one bank per sub-niche. Asking the model to
// invent a fact AND its explanation from scratch produced incoherent
// scripts (e.g. asking "why does the moon show one side?" and never
// answering it, wandering into unrelated generic sentences instead).
// Giving it a complete, accurate outline to expand into natural spoken
// Telugu is both more coherent AND safer for accuracy — every fact below
// was chosen because it's well-established, not something the model
// might be uncertain about.
const FACT_OUTLINES = {
  mindblowing: [
    'హుక్: ఒక రోజులో మీరు ఎంతమంది సూక్ష్మజీవులతో కలిసి జీవిస్తున్నారో తెలుసా? వివరణ: మన శరీరంలో ఉన్న బ్యాక్టీరియా కణాల సంఖ్య, మన సొంత మానవ కణాల సంఖ్యకు దాదాపు సమానం. మనం "శుద్ధంగా మనుషులం" అని అనుకుంటాం, కానీ నిజానికి మనం సూక్ష్మజీవులతో కలిసి జీవించే ఒక జీవావరణం లాంటివాళ్ళం. Twist: ఈ బ్యాక్టీరియాలు లేకపోతే, మనం ఆహారాన్ని సరిగ్గా జీర్ణం చేసుకోలేము, మన రోగనిరోధక వ్యవస్థ కూడా సరిగ్గా పనిచేయదు.',
    'హుక్: మీ మెదడు ఎంత విద్యుత్తును ఉత్పత్తి చేస్తుందో తెలుసా? వివరణ: మానవ మెదడు నిరంతరం విద్యుత్ సంకేతాల ద్వారా పనిచేస్తుంది, ఇది సుమారు 20 వాట్ల శక్తిని ఉత్పత్తి చేస్తుంది — ఇది ఒక చిన్న LED బల్బు వెలిగించడానికి సరిపోతుంది. Twist: నిద్రలో ఉన్నప్పుడు కూడా మెదడు ఈ శక్తిని ఖర్చు చేస్తూనే ఉంటుంది, ఎందుకంటే నిద్ర "మెదడు ఆఫ్ అవ్వడం" కాదు, అది జ్ఞాపకాలను క్రమబద్ధీకరించే active ప్రక్రియ.',
    'హుక్: మీ చర్మం ఎంత తరచుగా పూర్తిగా కొత్తగా మారుతుందో తెలుసా? వివరణ: మానవ చర్మం నిరంతరం పునరుత్పత్తి అవుతూ ఉంటుంది — పాత చర్మ కణాలు రాలిపోయి, కొత్తవి వాటి స్థానంలో వస్తాయి, ఇది సుమారు ప్రతి నాలుగు వారాలకు ఒకసారి పూర్తిగా జరుగుతుంది. Twist: ఇంట్లో పేరుకుపోయే dust లో గణనీయమైన భాగం మన రాలిన చర్మ కణాలే అని పరిశోధకులు చెప్తున్నారు.',
    'హుక్: వెలుతురు భూమి నుండి సూర్యుడికి చేరడానికి ఎంత సమయం పడుతుందో తెలుసా? వివరణ: సూర్యుని నుండి భూమికి వెలుతురు చేరడానికి సుమారు ఎనిమిది నిమిషాలు పడుతుంది — అంటే మనం ఆకాశంలో చూసే సూర్యుడు, నిజానికి ఎనిమిది నిమిషాల క్రితం ఉన్నట్టుగానే కనిపిస్తున్నాడు. Twist: సూర్యుడు అకస్మాత్తుగా ఆరిపోయినా, మనకి ఆ విషయం తెలియడానికే ఎనిమిది నిమిషాలు పడుతుంది.',
    'హుక్: మీరు ఒక్కరోజులో ఎన్నిసార్లు కళ్ళు రెప్పలు వేస్తారో తెలుసా? వివరణ: సగటున మనుషులు రోజుకి సుమారు పదిహేను నుండి ఇరవై వేల సార్లు కళ్ళు రెప్పలు వేస్తారు — ఇది కళ్ళను తేమగా ఉంచడానికి, రక్షించడానికి అవసరం. Twist: స్క్రీన్ చూస్తున్నప్పుడు ఈ రెప్పలు వేసే సంఖ్య గణనీయంగా తగ్గిపోతుంది, అందుకే కళ్ళు పొడిబారిపోతాయి.',
    'హుక్: మీ శరీరంలో అతి పొడవైన కణం ఏదో తెలుసా? వివరణ: మానవ శరీరంలో అతి పొడవైన కణాలు నాడీ కణాలు — వెన్నెముక నుండి కాలి వేళ్ళ వరకూ ఉండే ఒక్క నాడీ కణం ఒక మీటరు కన్నా ఎక్కువ పొడవు ఉండగలదు. Twist: ఇంత పొడవైన కణం అయినప్పటికీ, దాని కేంద్రకం వెన్నెముక దగ్గరే, ఒకే చిన్న భాగంలో ఉంటుంది.'
  ],
  psychology: [
    'హుక్: మీరు ఒక పాట వినకుండానే, అది మీ తలలో మళ్ళీ మళ్ళీ ఎందుకు మోగుతూనే ఉంటుంది? వివరణ: దీన్ని "ఇయర్‌వార్మ్" అంటారు — మెదడు అసంపూర్తిగా విన్న లేదా పదేపదే విన్న సంగీత భాగాలను loop లో ప్లే చేస్తుంది, ఎందుకంటే మెదడుకి అసంపూర్తి patterns ని పూర్తి చేయాలనే సహజ ధోరణి ఉంటుంది. Twist: ఆసక్తికరంగా, ఆ పాటనే పూర్తిగా చివరి వరకూ వినడం ఈ loop ని ఆపడానికి బాగా సహాయపడుతుందని పరిశోధనలు చెప్తున్నాయి.',
    'హుక్: మీరు అబద్ధం చెప్తున్నప్పుడు, మీ కళ్ళు నిజంగా ఒక ప్రత్యేక దిశలో కదులుతాయా? వివరణ: ఇది చాలా ప్రాచుర్యంలో ఉన్న ఒక అపోహ మాత్రమే — శాస్త్రీయ పరిశోధనలు కంటి కదలికలకి, అబద్ధం చెప్పడానికి మధ్య ఎలాంటి నమ్మదగిన సంబంధం లేదని రుజువు చేశాయి. Twist: నిజానికి, అబద్ధాలు చెప్పేవారిని పట్టుకోవడంలో మనుషులు (శిక్షణ పొందిన నిపుణులతో సహా) కేవలం అవకాశం (50%) కంటే కొంచెం ఎక్కువ మాత్రమే accurate గా ఉంటారని అధ్యయనాలు చెప్తున్నాయి.',
    'హుక్: మీరు ఒక కొత్త ప్రదేశానికి వెళ్ళి, "ఇది ఇంతకుముందు చూసినట్టు ఉంది" అనిపించిందా? వివరణ: దీన్ని "డేజా వూ" అంటారు — మెదడు కొత్త అనుభవాన్ని పాత జ్ఞాపకాలతో పొరపాటున సరిపోల్చినప్పుడు ఈ అనుభూతి కలుగుతుందని శాస్త్రవేత్తలు భావిస్తున్నారు. Twist: ఇది సాధారణంగా యువకుల్లో ఎక్కువగా జరుగుతుంది, వయసు పెరిగే కొద్దీ దీని frequency తగ్గుతుంది.',
    'హుక్: ఎక్కువ options ఉంటే మంచి నిర్ణయం తీసుకోగలమా? వివరణ: పరిశోధనలో ఒక ఆసక్తికరమైన విషయం తేలింది — options మరీ ఎక్కువగా ఉంటే మనుషులు నిర్ణయం తీసుకోవడంలో ఇబ్బంది పడతారు, దీన్ని "ఛాయిస్ ఓవర్‌లోడ్" అంటారు. Twist: ఒక ప్రసిద్ధ ప్రయోగంలో, 24 రకాల జామ్‌లు ఉన్న స్టాల్ కన్నా, కేవలం 6 రకాలు ఉన్న స్టాల్ దగ్గర ఎక్కువమంది కొనుగోలు చేశారు.',
    'హుక్: మీరు ఒక పని వాయిదా వేస్తూ ఉంటారా, దీనికి కారణం సోమరితనమేనా? వివరణ: పరిశోధకుల ప్రకారం, వాయిదా వేయడం సోమరితనం వల్ల కాదు — ఇది ఎక్కువగా ఆ పని పట్ల భయం, అసంతృప్తి భావోద్వేగాలను తప్పించుకోవడానికి మెదడు వాడే ఒక coping mechanism. Twist: అందుకే willpower మీద మాత్రమే ఆధారపడకుండా, ఆ భావోద్వేగాన్ని అర్థం చేసుకోవడం వాయిదా వేయడాన్ని తగ్గించడంలో ఎక్కువ సహాయపడుతుంది.',
    'హుక్: ఒక కొత్త అలవాటు నేర్చుకోవడానికి నిజంగా ఎన్ని రోజులు పడుతుందో తెలుసా? వివరణ: "21 రోజుల్లో అలవాటు ఏర్పడుతుంది" అనేది ఒక ప్రాచుర్యంలో ఉన్న అపోహ — పరిశోధనలో సగటున ఒక కొత్త అలవాటు స్థిరపడటానికి దాదాపు 66 రోజులు పడుతుందని తేలింది. Twist: వ్యక్తిని బట్టి, అలవాటు రకాన్ని బట్టి ఇది చాలా ఎక్కువ లేదా తక్కువ రోజుల వరకు కూడా మారొచ్చు.'
  ],
  earth_space: [
    'హుక్: చంద్రుడు మనకి ఎప్పుడూ ఒకే వైపు ఎందుకు చూపిస్తాడు? వివరణ: దీన్ని "టైడల్ లాకింగ్" అంటారు — భూమి యొక్క గురుత్వాకర్షణ శక్తి కోట్ల సంవత్సరాలుగా చంద్రుని భ్రమణాన్ని నెమ్మదింపజేసి, చివరికి చంద్రుని భ్రమణ కాలం, భూమి చుట్టూ తిరిగే కక్ష్యా కాలంతో సరిగ్గా సమానం అయ్యేలా చేసింది. Twist: అంటే చంద్రుడు తిరగడం లేదని కాదు — అది తనచుట్టూ తానూ తిరుగుతుంది, కానీ భూమి చుట్టూ ఒకసారి తిరిగే సమయానికి తనచుట్టూ కూడా సరిగ్గా ఒకసారే తిరుగుతుంది, అందుకే మనకి ఎప్పుడూ ఒకే వైపు కనిపిస్తుంది.',
    'హుక్: అంతరిక్షంలో సూర్యుడు రోజుల తరబడి అస్తమించని ప్రదేశం భూమిపైనే ఉందా? వివరణ: అవును — భూమి యొక్క ధ్రువాల దగ్గర, వేసవి కాలంలో సూర్యుడు 24 గంటలూ అస్తమించడు, దీన్ని "అర్ధరాత్రి సూర్యుడు" అంటారు, ఎందుకంటే భూమి యొక్క axis వంపు వల్ల ధ్రువ ప్రాంతాలు నెలల తరబడి నిరంతరం సూర్యరశ్మిని పొందుతాయి. Twist: అదే ప్రాంతాల్లో, శీతాకాలంలో దీనికి వ్యతిరేకంగా, నెలల తరబడి సూర్యుడే ఉదయించని చీకటి కాలం కూడా ఉంటుంది.',
    'హుక్: శుక్ర గ్రహం మీద ఒక రోజు, ఒక సంవత్సరం కన్నా ఎక్కువ ఉంటుందని తెలుసా? వివరణ: శుక్ర గ్రహం తనచుట్టూ తాను తిరగడానికి సుమారు 243 భూమి రోజులు పడుతుంది, కానీ సూర్యుని చుట్టూ ఒకసారి తిరగడానికి కేవలం 225 భూమి రోజులే పడుతుంది. Twist: అంటే శుక్రుడి మీద ఒక "రోజు" దాని "సంవత్సరం" కన్నా పొడవుగా ఉంటుంది.',
    'హుక్: భూమి మీద ఎత్తైన పర్వతం ఏవరెస్ట్ అని అందరికీ తెలుసు, కానీ సముద్రం అడుగు నుండి కొలిస్తే ఏది ఎత్తైనదో తెలుసా? వివరణ: హవాయిలోని మౌనా కియా పర్వతం, సముద్రం అడుగు భాగం నుండి కొలిస్తే ఏవరెస్ట్ కన్నా ఎత్తైనది — కానీ దానిలో ఎక్కువ భాగం నీటి అడుగున ఉంటుంది కాబట్టి కనిపించదు. Twist: సముద్రం మీద కనిపించే భాగం మాత్రమే లెక్కిస్తే, ఏవరెస్టే ఎత్తైనదిగా పరిగణించబడుతుంది.',
    'హుక్: అంతరిక్షంలో వ్యోమగాములు ఎందుకు పొడవుగా మారతారో తెలుసా? వివరణ: గురుత్వాకర్షణ లేని వాతావరణంలో, వెన్నెముకలోని diskలు కుదించుకుపోకుండా విస్తరిస్తాయి, దీనివల్ల వ్యోమగాములు అంతరిక్షంలో కొన్ని సెంటీమీటర్ల వరకు పొడవుగా మారతారు. Twist: భూమికి తిరిగి వచ్చాక, గురుత్వాకర్షణ మళ్ళీ పనిచేయడం మొదలుపెట్టి, కొన్ని వారాల్లో వాళ్ళ ఎత్తు మామూలు స్థితికి వచ్చేస్తుంది.',
    'హుక్: సౌర కుటుంబంలో అత్యంత వేగంగా తిరిగే గ్రహం ఏదో తెలుసా? వివరణ: బుధ గ్రహం సూర్యుని చుట్టూ అత్యంత వేగంగా తిరుగుతుంది, కేవలం 88 భూమి రోజుల్లో ఒక పూర్తి కక్ష్యను పూర్తి చేస్తుంది. Twist: ఇంత దగ్గరగా, వేగంగా తిరుగుతున్నా, బుధుడి ఉపరితల ఉష్ణోగ్రత రాత్రిపూట బాగా పడిపోతుంది, ఎందుకంటే దానికి వేడిని పట్టి ఉంచేలా వాతావరణం లేదు.'
  ],
  animal: [
    'హుక్: ఆక్టోపస్ కి "మెదడు" ఎక్కడ ఉందో ఖచ్చితంగా చెప్పగలరా? వివరణ: ఆక్టోపస్ యొక్క నాడీ కణాల్లో మూడింట రెండు వంతుల భాగం దాని మెదడులో కాదు, దాని ఎనిమిది కాళ్ళలోనే ఉంటుంది. అందుకే ప్రతి కాలు కొంతవరకు స్వతంత్రంగా స్పర్శించి, కదలగలదు. Twist: ప్రయోగాల్లో, మెదడు నుండి వేరుచేయబడిన ఆక్టోపస్ కాలు కూడా కొద్దిసేపు స్వయంగా వస్తువులను పట్టుకునే చర్యలు చేయగలదని కనిపెట్టారు.',
    'హుక్: సొరచేపలు ఎన్ని సంవత్సరాలు జీవిస్తాయో తెలుసా? వివరణ: గ్రీన్‌ల్యాండ్ సొరచేప 300 సంవత్సరాలకు పైగా జీవించగలదని శాస్త్రవేత్తలు కనిపెట్టారు — ఇది తెలిసిన అత్యంత దీర్ఘాయువు కలిగిన వెన్నెముక జంతువు. Twist: ఇవి చాలా నెమ్మదిగా పెరుగుతాయి, లైంగిక పరిపక్వతకు చేరుకోవడానికే దాదాపు 150 సంవత్సరాలు పడుతుంది.',
    'హుక్: తేనెటీగలు తమ తేనెతుట్టెకి దారి ఎలా చూపిస్తాయో తెలుసా? వివరణ: తేనెటీగలు ఒక ప్రత్యేకమైన నృత్యం (waggle dance) చేయడం ద్వారా, ఆహారం ఎక్కడ ఉందో మిగతా తేనెటీగలకి దిశ, దూరం రెండూ కచ్చితంగా తెలియజేస్తాయి. Twist: ఈ నృత్యం సూర్యుని స్థానానికి సంబంధించి కోణాన్ని సూచిస్తుంది, ఇది ఒక రకమైన సహజ దిక్సూచి లాంటిది.',
    'హుక్: ఏనుగులు తమ కాళ్ళతో "వినగలవు" అని మీకు తెలుసా? వివరణ: ఏనుగులు తక్కువ frequency కంపనలను తమ కాళ్ళ ద్వారా, నేల నుండి గ్రహించగలవు — దీనివల్ల చాలా దూరంలో ఉన్న ఇతర ఏనుగుల సంకేతాలను కూడా గుర్తించగలవు. Twist: ఈ సామర్థ్యం వల్ల, కొన్ని ఏనుగులు దూరంగా జరిగే భూకంపాలు లేదా తుఫానులను ముందుగానే పసిగట్టగలవని పరిశోధకులు భావిస్తున్నారు.',
    'హుక్: ఊసరవెల్లి రంగు మారుస్తుంది, అది కేవలం దాక్కోవడానికేనా? వివరణ: ఊసరవెల్లులు రంగు మార్చడం ఎక్కువగా camouflage కోసం కాదు — ఇది వాటి emotions, ఉష్ణోగ్రత, ఇతర ఊసరవెల్లులతో communication కోసం ఎక్కువగా జరుగుతుంది. Twist: వాటి చర్మంలో ఉండే ప్రత్యేక crystal నిర్మాణాలు కాంతిని వంచడం ద్వారా ఈ రంగు మార్పు జరుగుతుంది, pigment మార్పు వల్ల మాత్రమే కాదు.',
    'హుక్: ఒక పిల్లి "మ్యావ్" అని పెద్దలని ఎందుకు పిలుస్తుందో తెలుసా? వివరణ: వయోజన పిల్లులు ఒకదానితో ఒకటి "మ్యావ్" అని మాట్లాడుకోవు — ఈ శబ్దం ప్రధానంగా మనుషులతో communicate చేయడానికే అభివృద్ధి చెందింది. Twist: పిల్లులు మనుషుల attention పొందడానికి, తమ మ్యావ్ శబ్దాన్ని ఆ ఇంటి వ్యక్తుల అలవాట్లకి తగినట్టు మార్చుకుంటాయని పరిశోధనలు చెప్తున్నాయి.'
  ],
  money: [
    'హుక్: ప్రపంచంలో మొదటి కాగితం కరెన్సీ ఎక్కడ మొదలైంది? వివరణ: కాగితం డబ్బు మొదటిసారి చైనాలో, టాంగ్ మరియు సాంగ్ రాజవంశాల కాలంలో వాడుకలోకి వచ్చింది — నాణేలు మోసుకెళ్లడం కష్టంగా ఉండటంతో వ్యాపారులు దీన్ని ప్రవేశపెట్టారు. Twist: యూరప్‌లో కాగితం డబ్బు వాడకం మొదలవ్వడానికి ఇంకో వందల సంవత్సరాలు పట్టింది.',
    'హుక్: మీ జేబులో ఉన్న నాణెం అంచు ఎందుకు గీతలు గీతలుగా ఉంటుందో ఆలోచించారా? వివరణ: పాత కాలంలో నాణేల అంచులు కత్తిరించి, ఆ లోహాన్ని దొంగిలించడం సర్వసాధారణంగా ఉండేది — అంచు మీద గీతలు (reeding) ఈ మోసాన్ని సులభంగా గుర్తించడానికి సహాయపడింది. Twist: శాస్త్రవేత్త ఐజాక్ న్యూటన్, బ్రిటిష్ టంకశాలకి అధిపతిగా ఉన్నప్పుడు ఈ భద్రతా పద్ధతిని improve చేయడంలో కీలక పాత్ర పోషించాడు.',
    'హుక్: ప్రపంచంలో మొట్టమొదటి బ్యాంకు ఎక్కడ మొదలైందో తెలుసా? వివరణ: ప్రపంచంలో అత్యంత పురాతనమైన బ్యాంకుగా పరిగణించబడేది ఇటలీలోని "బాంకా మోంతె దీ పాషి దీ సియెనా", ఇది 1472 నుండి నిరంతరాయంగా పనిచేస్తోంది. Twist: ఇది ఇప్పటికీ కార్యకలాపాలు కొనసాగిస్తున్న ప్రపంచంలోని అత్యంత పాత బ్యాంకుగా గుర్తింపు పొందింది.',
    'హుక్: క్రెడిట్ కార్డు నంబర్లలో ఉండే అంకెలు యాదృచ్ఛికంగా పెట్టేవేనా? వివరణ: క్రెడిట్ కార్డు నంబర్లు ఒక నిర్దిష్ట గణిత సూత్రం ప్రకారం తయారు చేయబడతాయి — ఇది టైపింగ్ పొరపాట్లను, నకిలీ నంబర్లను గుర్తించడానికి సహాయపడుతుంది. Twist: మొదటి అంకె సాధారణంగా ఏ కంపెనీ కార్డో సూచిస్తుంది — ఉదాహరణకి 4 తో మొదలైతే అది సాధారణంగా Visa కార్డు.',
    'హుక్: ప్రపంచంలో అత్యంత విలువైన కరెన్సీ డాలర్ అనుకుంటున్నారా? వివరణ: మారకపు విలువ పరంగా చూస్తే, కువైట్ దీనార్ ప్రపంచంలో అత్యంత విలువైన కరెన్సీలలో ఒకటిగా పరిగణించబడుతుంది, ఇది అమెరికన్ డాలర్ కన్నా ఎక్కువ విలువ కలిగి ఉంటుంది. Twist: కువైట్ చమురు ఎగుమతులపై ఆధారపడిన ఆర్థిక వ్యవస్థ దీనికి ప్రధాన కారణం.',
    'హుక్: పిగ్గీ బ్యాంక్ ని "పిగ్" అని ఎందుకు పిలుస్తారో ఆలోచించారా? వివరణ: మధ్యయుగ కాలంలో, "పిగ్" అనే మట్టి రకాన్ని డబ్బు దాచుకునే కుండలు తయారు చేయడానికి వాడేవారు — కాలక్రమేణా ఆ పదం, పంది ఆకారంలో ఉన్న డబ్బు పెట్టెలుగా అభివృద్ధి చెందింది. Twist: ఇది కేవలం భాషాపరమైన యాదృచ్చికం, పందులతో దీనికి మొదట్లో సంబంధమే లేదు.'
  ],
  history: [
    'హుక్: ఈజిప్ట్ గ్రేట్ పిరమిడ్ ఎంత కచ్చితత్వంతో నిర్మించారో తెలుసా? వివరణ: గిజా గ్రేట్ పిరమిడ్ యొక్క నాలుగు వైపులు, నిజమైన ఉత్తర దిశకు 1 డిగ్రీ కంటే తక్కువ వ్యత్యాసంతో సరిగ్గా సర్దుబాటు చేయబడ్డాయి — ఆధునిక టెక్నాలజీ లేకుండా ఇది ఎలా సాధించారో ఇప్పటికీ శాస్త్రవేత్తలను ఆశ్చర్యపరుస్తుంది. Twist: కొందరు పరిశోధకులు వాళ్ళు నక్షత్రాల స్థానాలను ఉపయోగించి ఉంటారని అంచనా వేస్తున్నారు.',
    'హుక్: చరిత్రలో అతి తక్కువ సమయం సాగిన యుద్ధం ఎంత సేపు జరిగింది? వివరణ: 1896లో బ్రిటన్ మరియు జాంజిబార్ మధ్య జరిగిన యుద్ధం కేవలం నలభై నిమిషాల లోపే ముగిసింది — ఇది చరిత్రలో నమోదైన అతి చిన్న యుద్ధంగా పరిగణించబడుతుంది. Twist: ఇది జాంజిబార్ సుల్తాన్ మరణం తర్వాత వారసత్వ వివాదం వల్ల మొదలైంది, బ్రిటిష్ నౌకల బాంబార్డ్‌మెంట్‌తో వేగంగా ముగిసింది.',
    'హుక్: క్లియోపాత్ర పిరమిడ్‌ల కన్నా, ఆధునిక యుగానికి దగ్గరగా జీవించిందని తెలుసా? వివరణ: గిజా పిరమిడ్‌లు నిర్మించి సుమారు 2500 సంవత్సరాల తర్వాత క్లియోపాత్ర జీవించింది — ఆమె కాలం నుండి ఇప్పటి వరకు గడిచిన సమయం కన్నా, పిరమిడ్‌ల నిర్మాణం నుండి ఆమె కాలం వరకు గడిచిన సమయమే ఎక్కువ. Twist: అంటే చారిత్రకంగా, క్లియోపాత్ర మనకి పిరమిడ్‌ల కన్నా ఆధునిక యుగానికే దగ్గరగా ఉంది.',
    'హుక్: ఆక్స్‌ఫర్డ్ యూనివర్సిటీ, అజ్టెక్ సామ్రాజ్యం కన్నా పాతదని తెలుసా? వివరణ: ఆక్స్‌ఫర్డ్ యూనివర్సిటీలో బోధన 1096 నాటికే మొదలైంది, కానీ అజ్టెక్ సామ్రాజ్యం స్థాపన 1428 లో జరిగింది — అంటే ఆక్స్‌ఫర్డ్ 300 సంవత్సరాలకు పైగా ముందుగా ఉనికిలోకి వచ్చింది. Twist: ఇలాంటి కాల విరుద్ధమైన పోలికలు చరిత్రని ఎంత విస్తృతంగా చూడాలో గుర్తుచేస్తాయి.',
    'హుక్: ప్రపంచంలో మొదటి ట్రాఫిక్ లైట్ ఎప్పుడు వచ్చిందో తెలుసా? వివరణ: మొదటి ట్రాఫిక్ సిగ్నల్ 1868 లో లండన్‌లో ఏర్పాటు చేయబడింది — ఇది కార్ల కోసం కాదు, గుర్రపు బగ్గీలు, పాదచారుల కోసం, గ్యాస్‌తో వెలిగే దీపాలతో పనిచేసేది. Twist: దురదృష్టవశాత్తు, కొన్ని వారాల్లోనే అది పేలిపోయి, దాన్ని నిర్వహిస్తున్న పోలీసు గాయపడ్డాడు.',
    'హుక్: వాచీలు ఎడమ చేతికి ఎందుకు పెట్టుకుంటారో ఆలోచించారా? వివరణ: మొదటి jebు వాచీలు, తర్వాత wristwatches, ఎక్కువగా కుడిచేతి వాళ్ళ కోసమే డిజైన్ చేయబడ్డాయి — వాచీని ఎడమచేతికి పెట్టుకుంటే, కుడిచేత్తో దాన్ని wind చేయడం సులభంగా ఉండేది. Twist: మొదటి ప్రపంచ యుద్ధంలో సైనికులు వాచీలని wrist మీద కట్టుకోవడం మొదలుపెట్టాక, ఈ అలవాటు సర్వసాధారణం అయ్యింది.'
  ],
  human_body: [
    'హుక్: మీరు తుమ్మినప్పుడు మీ శరీరంలో ఎన్ని భాగాలు involve అవుతాయో తెలుసా? వివరణ: తుమ్ము ఒక సంక్లిష్టమైన reflex చర్య — ఇందులో ఛాతీ కండరాలు, గొంతు, కళ్ళు, ముఖం అన్నీ ఏకకాలంలో పనిచేస్తాయి. Twist: ఆసక్తికరంగా, కళ్ళు తెరిచి ఉంచి తుమ్మడం శరీరపరంగా చాలా కష్టం — చాలామంది తుమ్మేటప్పుడు అసంకల్పితంగా కళ్ళు మూసుకుంటారు.',
    'హుక్: మీ శరీరంలో ఎముకలు ఎప్పుడు అత్యధికంగా ఉంటాయో తెలుసా? వివరణ: మీరు పుట్టినప్పుడు మీ శరీరంలో దాదాపు మూడు వందల ఎముకలు ఉంటాయి, కానీ పెద్దయ్యాక కేవలం రెండు వందల ఆరు ఎముకలు మాత్రమే మిగులుతాయి. Twist: ఇది ఎముకలు పోవడం వల్ల కాదు — పెరుగుతున్న కొద్దీ చాలా చిన్న ఎముకలు (ఉదాహరణకి పుర్రెలో) కలిసిపోయి, పెద్ద ఎముకలుగా ఏర్పడతాయి.',
    'హుక్: మీ కడుపులో ఉండే ఆమ్లం దేన్ని కరిగించగలదో తెలుసా? వివరణ: మానవ కడుపులో ఉండే హైడ్రోక్లోరిక్ ఆమ్లం చాలా బలమైనది — ఇది కొన్ని లోహాలను కూడా కరిగించగలిగేంత శక్తివంతమైనది. Twist: అయినా అది కడుపు గోడలను కరిగించదు, ఎందుకంటే కడుపు లోపలి పొర నిరంతరం ఒక రక్షణ శ్లేష్మ పొరను ఉత్పత్తి చేస్తూ ఉంటుంది.',
    'హుక్: మీరు ఒక్క తుమ్ము బలవంతంగా ఆపుకోవడానికి ప్రయత్నిస్తే ఏమవుతుందో తెలుసా? వివరణ: ముక్కు, నోరు రెండూ మూసుకుని బలవంతంగా తుమ్మును ఆపడం ప్రమాదకరం కావొచ్చు — ఇది ఛాతీ లోపల ఒత్తిడిని విపరీతంగా పెంచుతుంది. Twist: అరుదైన సందర్భాల్లో, ఇలా చేయడం వల్ల శరీరంలో గాయాలు ఏర్పడిన సందర్భాలు కూడా వైద్య నివేదికల్లో నమోదయ్యాయి.',
    'హుక్: మీ శరీరంలో రక్తనాళాలు మొత్తం ఎంత పొడవు ఉంటాయో తెలుసా? వివరణ: ఒక వయోజన మానవుడి శరీరంలో ఉండే అన్ని రక్తనాళాలను ఒకదాని తర్వాత ఒకటి పేర్చితే, అవి వేల కిలోమీటర్ల పొడవు ఉంటాయి. Twist: ఇందులో ఎక్కువ భాగం అతి సన్నని కేశనాళికలే, ఇవి కంటికి కనిపించనంత సన్నగా ఉంటాయి.',
    'హుక్: మీ శరీరంలో ఏ అవయవం ఎప్పుడూ ఆగకుండా పనిచేస్తుందో తెలుసా? వివరణ: గుండె నిరంతరం, ఆగకుండా రోజుకి లక్ష సార్లకు పైగా కొట్టుకుంటుంది — జీవితాంతం ఒక్క క్షణం కూడా విశ్రాంతి లేకుండా పనిచేసే అతికొద్ది అవయవాల్లో ఇది ఒకటి. Twist: ఒక సగటు జీవితకాలంలో, గుండె వందల కోట్ల సార్లు కొట్టుకుంటుంది.'
  ],
  technology: [
    'హుక్: మొదటి కంప్యూటర్ మౌస్ దేనితో తయారు చేశారో తెలుసా? వివరణ: 1964లో డగ్లస్ ఎంగెల్‌బార్ట్ కనిపెట్టిన మొదటి కంప్యూటర్ మౌస్ చెక్కతో తయారు చేయబడింది, రెండు లోహపు చక్రాలు కదలికను గుర్తించేవి. Twist: దీన్ని మొదట్లో "X-Y పొజిషన్ ఇండికేటర్" అని పిలిచేవారు, "మౌస్" అనే పేరు దాని తోక లాంటి తీగ వల్ల informal గా వచ్చింది.',
    'హుక్: మొదటి కంప్యూటర్ వైరస్ ఎప్పుడు వచ్చిందో తెలుసా? వివరణ: 1971లో "క్రీపర్" అనే ప్రోగ్రామ్ మొదటి కంప్యూటర్ వైరస్‌గా పరిగణించబడుతుంది — ఇది హానికరం కాదు, కేవలం "నేను క్రీపర్‌ని, వీలైతే నన్ను పట్టుకో" అనే సందేశాన్ని ప్రదర్శించేది. Twist: దీన్ని తొలగించడానికి "రీపర్" అనే మరో ప్రోగ్రామ్‌ని రాశారు, ఇది మొదటి యాంటీవైరస్‌గా పరిగణించబడుతుంది.',
    'హుక్: వైఫై అనే పేరుకి నిజంగా ఏదైనా అర్థం ఉందా? వివరణ: చాలామంది అనుకున్నట్టు "వైఫై" అనేది "Wireless Fidelity" అనే పదాలకి సంక్షిప్త రూపం కాదు — ఇది కేవలం మార్కెటింగ్ కోసం సృష్టించిన ఒక brand name మాత్రమే. Twist: దీన్ని "Hi-Fi" పదానికి పోలికగా, గుర్తుంచుకోవడం సులభంగా ఉండేలా తయారు చేశారు.',
    'హుక్: మొదటి text message లో ఏముందో తెలుసా? వివరణ: 1992లో పంపిన మొదటి SMS సందేశంలో "Merry Christmas" అని రాశారు — దీన్ని ఒక ఇంజనీర్ కంప్యూటర్ నుండి ఒక మొబైల్ ఫోన్‌కి పంపారు. Twist: ఆ సమయంలో మొబైల్ ఫోన్‌లలో టైప్ చేయడానికి కీబోర్డులు లేవు, కాబట్టి ఆ ఫోన్ యజమాని తిరిగి సమాధానం పంపలేకపోయాడు.',
    'హుక్: QWERTY కీబోర్డ్ లేఅవుట్ ఎందుకు అలా ఉందో ఆలోచించారా? వివరణ: QWERTY లేఅవుట్ 1870ల నాటి టైప్‌రైటర్ల కోసం రూపొందించబడింది — తరచుగా కలిసి వాడే అక్షరాలను దూరంగా పెట్టడం ద్వారా, యాంత్రిక కీలు ఒకదానికొకటి తగలకుండా ఆపడానికి. Twist: కంప్యూటర్లలో ఈ యాంత్రిక సమస్య లేకపోయినా, అలవాటు వల్ల ఈ లేఅవుటే కొనసాగుతూ వస్తోంది.'
  ],
  food: [
    'హుక్: తేనె ఎప్పటికీ పాడవ్వదని మీకు తెలుసా? వివరణ: సరిగ్గా నిల్వ చేస్తే తేనె వేల సంవత్సరాలు కూడా పాడవ్వకుండా ఉంటుంది — పురావస్తు శాస్త్రవేత్తలు పురాతన ఈజిప్ట్ సమాధుల్లో వేల సంవత్సరాల నాటి తేనెను తినదగిన స్థితిలో కనుగొన్నారు. Twist: తేనెలో నీటి శాతం చాలా తక్కువగా ఉండటం, సహజ ఆమ్ల గుణం దీనికి కారణం, బ్యాక్టీరియా అందులో పెరగలేదు.',
    'హుక్: క్యారెట్లు మొదట నారింజ రంగులో ఉండేవి కావని తెలుసా? వివరణ: మొదట్లో క్యారెట్లు ఊదా, తెలుపు, పసుపు రంగుల్లో ఉండేవి — నారింజ రంగు క్యారెట్లు నెదర్లాండ్స్‌లో రైతులు ప్రత్యేకంగా పెంచడం మొదలుపెట్టిన తర్వాతే ప్రాచుర్యం పొందాయి. Twist: కొందరు దీన్ని డచ్ రాజకుటుంబానికి గౌరవసూచకంగా చేశారని చెప్తారు, అయితే దీనికి ఖచ్చితమైన చారిత్రక ఆధారాలు తక్కువ.',
    'హుక్: చాక్లెట్ ఒకప్పుడు డబ్బుగా వాడేవారని తెలుసా? వివరణ: ప్రాచీన మాయా, అజ్టెక్ నాగరికతల్లో కోకో గింజలను కరెన్సీగా ఉపయోగించేవారు — వస్తువులు కొనడానికి, పన్నులు కట్టడానికి కూడా వీటిని వాడేవారు. Twist: ఆ కాలంలో చాక్లెట్‌ని తీపి పానీయంగా కాకుండా, చేదైన, మసాలా కలిపిన పానీయంగా తాగేవారు.',
    'హుక్: బాదం నిజానికి గింజ కాదని తెలుసా? వివరణ: వృక్షశాస్త్రపరంగా బాదం ఒక గింజ కాదు — ఇది ఒక పండులోని విత్తనం, ఆప్రికాట్ లాంటి పండులో లోపలి భాగం లాంటిది. Twist: ఇలాంటి "తప్పుడు పేర్లు" ఆహార ప్రపంచంలో సర్వసాధారణం — వేరుశనగ కూడా నిజానికి గింజ కాదు, అది ఒక పప్పు జాతి మొక్క.',
    'హుక్: మంచుతో చేసిన తీపి వంటకాలు ఎంత పురాతనమైనవో తెలుసా? వివరణ: మంచుతో చేసిన తీపి వంటకాలు వేల సంవత్సరాల నుండి ఉన్నాయి — ప్రాచీన చైనాలో మంచుతో పండ్ల రసాలు కలిపిన వంటకాలు తయారు చేసేవారని చారిత్రక ఆధారాలు చెప్తున్నాయి. Twist: ఆధునిక ఐస్‌క్రీమ్ లాంటి వంటకం మాత్రం, శీతలీకరణ టెక్నాలజీ అభివృద్ధి చెందిన తర్వాతే విస్తృతంగా వ్యాప్తి చెందింది.'
  ],
  ocean: [
    'హుక్: సముద్రం అడుగు భాగం గురించి మనకి చంద్రుని ఉపరితలం కన్నా తక్కువ తెలుసని విన్నారా? వివరణ: శాస్త్రవేత్తల ప్రకారం, చంద్రుని ఉపరితలాన్ని మనం సముద్రం అడుగు భాగం కన్నా ఎక్కువగా మ్యాప్ చేశాము — సముద్రంలో ఎక్కువ భాగం ఇప్పటికీ అన్వేషించబడలేదు. Twist: దీనికి కారణం, సముద్రం లోతుల్లో ఒత్తిడి, చీకటి పరిశోధనని చాలా కష్టతరం చేస్తాయి.',
    'హుక్: సముద్రంలో నీరు ఉప్పగా ఎందుకు ఉంటుందో ఆలోచించారా? వివరణ: నదులు భూమి మీద ప్రవహిస్తున్నప్పుడు, రాళ్ళలోని ఖనిజ లవణాలను కరిగించి సముద్రంలోకి తీసుకువెళ్తాయి — కోట్ల సంవత్సరాలుగా ఇది జరుగుతూ, సముద్రంలో లవణం పేరుకుపోయింది. Twist: నీరు ఆవిరైపోతున్నా, లవణం మాత్రం సముద్రంలోనే ఉండిపోతుంది, అందుకే కాలక్రమేణా సముద్రం మరింత ఉప్పగా మారుతూ వచ్చింది.',
    'హుక్: నీలి తిమింగలం గుండె ఎంత పెద్దదిగా ఉంటుందో తెలుసా? వివరణ: నీలి తిమింగలం గుండె ఒక చిన్న కారు అంత పరిమాణంలో ఉంటుంది — ఇది భూమి మీద జీవించిన అతిపెద్ద జంతువుల్లో ఒకటి. Twist: దీని గుండె చప్పుడు చాలా నెమ్మదిగా ఉంటుంది, కొన్నిసార్లు నిమిషానికి కేవలం రెండు సార్లు మాత్రమే కొట్టుకుంటుంది.',
    'హుక్: సముద్రంలో ఎన్ని రకాల జీవులు ఇంకా కనిపెట్టబడలేదో తెలుసా? వివరణ: శాస్త్రవేత్తల అంచనా ప్రకారం, సముద్రంలో ఉన్న జీవజాతుల్లో గణనీయమైన శాతం ఇంకా శాస్త్రీయంగా గుర్తించబడలేదు. Twist: ప్రతి సంవత్సరం కొత్త సముద్ర జీవులు కనిపెట్టబడుతూనే ఉన్నాయి, ముఖ్యంగా లోతైన సముద్ర ప్రాంతాల్లో.',
    'హుక్: సముద్రపు ఆటుపోట్లు ఎందుకు వస్తాయో ఖచ్చితంగా తెలుసా? వివరణ: ఆటుపోట్లు ప్రధానంగా చంద్రుని గురుత్వాకర్షణ శక్తి వల్ల ఏర్పడతాయి — చంద్రుడు భూమి మీద ఉన్న నీటిని తనవైపు లాగుతుంది. Twist: సూర్యుడు కూడా దీనికి తోడ్పడుతుంది, చంద్రుడు, సూర్యుడు, భూమి ఒక వరుసలో వచ్చినప్పుడు ఆటుపోట్లు మరింత బలంగా ఉంటాయి.'
  ]
};

// Combines the curated FACT_OUTLINES bank with any AI-discovered outlines
// persisted from previous runs, so the effective bank only grows over time.
function getCombinedBank(category, discoveredFacts) {
  const curated = FACT_OUTLINES[category] || [];
  const discovered = (discoveredFacts && discoveredFacts[category]) || [];
  return [...curated, ...discovered];
}

// Asks Groq for one new, high-confidence fact outline in the given
// category — used only when the existing bank is about to repeat. Returns
// null if the model itself signals uncertainty (explicitly told to do so
// rather than guess), so nothing shaky ever gets persisted.
async function generateNewFactOutline(category, existingOutlines) {
  const existingSummaries = existingOutlines.map(o => o.split('.')[0]).join(' | ');
  const prompt = `${category} విభాగంలో, ఇప్పటికే వాడిన ఈ అంశాలకు పూర్తిగా వేరైన, కొత్త, ఆసక్తికరమైన fact ఒకటి తెలుగులో ఇవ్వు.

ఇప్పటికే వాడినవి (వీటిని గానీ, వీటికి దగ్గరి సంబంధమున్న విషయాలను గానీ మళ్ళీ వాడకు): ${existingSummaries}

చాలా ముఖ్యం — ఖచ్చితత్వం: నీకు 100% ఖచ్చితంగా, నిస్సందేహంగా తెలిసిన, విస్తృతంగా validated అయిన fact మాత్రమే ఇవ్వు. ఏమాత్రం అనిశ్చితి, సందేహం ఉన్నా, ఖచ్చితమైన సంఖ్యలు గుర్తు లేకపోయినా — fact ఇవ్వకుండా, జవాబుగా కేవలం ఒక్క మాట "UNSURE" అని రాయి, మరేమీ రాయకు.

ఖచ్చితంగా తెలిస్తే, ఈ ఫార్మాట్‌లోనే రాయి (వేరే ఏమీ రాయకు):
హుక్: (ఒక ఆసక్తికరమైన ప్రశ్న)
వివరణ: (ఆ ప్రశ్నకి ఖచ్చితమైన సమాధానం, 2-3 వాక్యాలు)
Twist: (అదనపు ఆశ్చర్యకరమైన వివరం, 1-2 వాక్యాలు)`;

  const raw = await callGroq(prompt);
  const trimmed = raw.trim();
  if (trimmed.toUpperCase().includes('UNSURE') || !trimmed.includes('హుక్') || !trimmed.includes('వివరణ')) {
    log(`  New-fact generation for ${category}: model signaled uncertainty or gave malformed output, skipping.`);
    return null;
  }
  return trimmed;
}

// Independent second pass: asks Groq to specifically critique the
// candidate for accuracy, as a lightweight self-verification safety net
// before anything gets permanently saved to the growing fact bank.
async function verifyFactOutline(outline) {
  const prompt = `కింద ఇచ్చిన fact ని ఒక fact-checker లా జాగ్రత్తగా పరిశీలించు. ఇందులో ఏదైనా సందేహాస్పదమైన, తప్పుగా ఉండే అవకాశం ఉన్న సంఖ్య, పేరు, లేదా వాదన ఉందా?

Fact: ${outline}

ఇది పూర్తిగా ఖచ్చితమైనది, verified అని నీకు నమ్మకం ఉంటేనే "VERIFIED" అని ఒక్క మాట రాయి. ఏమాత్రం సందేహం ఉన్నా "REJECTED" అని రాయి, కారణం చెప్పకు.`;

  const raw = await callGroq(prompt);
  const verified = raw.trim().toUpperCase().startsWith('VERIFIED');
  log(`  Fact self-verification result: ${verified ? 'VERIFIED ✅' : 'REJECTED ❌'}`);
  return verified;
}

// Resolves the outline to use for this run: from the combined (curated +
// discovered) bank normally, or — only when that bank is about to repeat —
// tries to grow it with a fresh, self-verified fact first. Any failure at
// any step falls back to simply reusing the bank as before; this never
// blocks a run, and the curated bank remains the primary source most of
// the time (growth only triggers right at the repeat boundary).
async function getOrGrowFactOutline(category, categoryRunCounts, discoveredFacts) {
  const bank = getCombinedBank(category, discoveredFacts);
  const categoryCount = categoryRunCounts[category] || 0;
  const aboutToRepeat = categoryCount > 0 && categoryCount % bank.length === 0;

  if (aboutToRepeat) {
    log(`"${category}" bank (${bank.length} facts) is about to repeat — attempting to grow it with a fresh, verified fact first.`);
    try {
      const candidate = await generateNewFactOutline(category, bank);
      if (candidate) {
        const isVerified = await verifyFactOutline(candidate);
        if (isVerified) {
          log(`  New fact ADDED to the permanent bank for "${category}".`);
          return { outline: candidate, newlyDiscovered: candidate };
        }
      }
    } catch (e) {
      log(`  WARNING: fact-growth attempt failed (${e.message}) — falling back to the existing bank.`);
    }
    log(`  Growth attempt did not produce a usable fact — reusing an existing one this time.`);
  }

  const outline = bank[categoryCount % bank.length];
  log(`Fact outline for ${category} (its run #${categoryCount}): ${outline.slice(0, 60)}...`);
  return { outline, newlyDiscovered: null };
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      return {
        usedTitles: state.usedTitles || [],
        runCount: state.runCount || 0,
        categoryRunCounts: state.categoryRunCounts || {},
        discoveredFacts: state.discoveredFacts || {}
      };
    } catch (e) {}
  }
  return { usedTitles: [], runCount: 0, categoryRunCounts: {}, discoveredFacts: {} };
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
  mindblowing: 'science mystery curious object closeup',
  psychology: 'human brain mind thinking illustration',
  earth_space: 'planet earth space stars galaxy',
  animal: 'wild animal closeup nature',
  money: 'currency coins finance closeup',
  history: 'ancient historical artifact ruins',
  human_body: 'human anatomy body science illustration',
  technology: 'computer technology gadget closeup',
  food: 'food closeup delicious kitchen',
  ocean: 'ocean underwater sea waves'
};

// 85-100 words targets the 20-30s Amazing Facts Shorts format.
const WORD_COUNT_TARGETS = {
  mindblowing: { min: 110, max: 130 },
  psychology: { min: 110, max: 130 },
  earth_space: { min: 110, max: 130 },
  animal: { min: 110, max: 130 },
  money: { min: 110, max: 130 },
  history: { min: 110, max: 130 },
  human_body: { min: 110, max: 130 },
  technology: { min: 110, max: 130 },
  food: { min: 110, max: 130 },
  ocean: { min: 110, max: 130 }
};

// Shared formatting/voice rules appended to every category's prompt.
// Appended programmatically after generation — never left to the model to
// retype, since it occasionally introduced typos into this fixed sentence
// (e.g. "సబ్‌స్రైబ్" missing a syllable) when asked to reproduce it itself.
const CTA_SENTENCE = 'మరిన్ని ఇలాంటి amazing facts కోసం ఫాలో అవ్వండి, లైక్ షేర్ మరియు సబ్‌స్క్రైబ్ చేయండి.';

function buildPrompt(category, recentTitles, outline) {
  const avoidLine = recentTitles.length
    ? `\n\nఇటీవల ఈ అంశాలు వాడాము — ఇవే facts ని వేరే మాటల్లో మళ్ళీ చెప్పకు కూడా, పూర్తిగా కొత్త fact/విషయం ఎంచుకో: ${recentTitles.slice(-10).join(' | ')}`
    : '';

  const { min, max } = WORD_COUNT_TARGETS[category];

  const topicInstruction = `కింద ఇచ్చిన fact (హుక్ ప్రశ్న + వివరణ + twist) ని తెలుగులో సహజంగా, ఆసక్తికరంగా చెప్పు. ఇది ఇప్పటికే verify చేయబడిన, పూర్తి fact — నువ్వు దీన్ని మార్చకూడదు, కొత్తగా ఏమీ కల్పించకూడదు, కేవలం విస్తరించి అందంగా చెప్పాలి:

${outline}

నిర్మాణం:
1. **Hook:** పైన ఇచ్చిన హుక్ ప్రశ్ననే వాడు (అవసరమైతే సహజంగా అనిపించేలా చిన్నగా మార్చొచ్చు, కానీ అర్థం మార్చకు).
2. **Fact:** పైన ఇచ్చిన వివరణనే విస్తరించి చెప్పు — **ఈ ప్రశ్నకి ఖచ్చితంగా సమాధానం చెప్పాలి**, మధ్యలో సంబంధం లేని వేరే వాక్యాలు/ప్రశ్నలు జోడించకు.
3. **Twist:** పైన ఇచ్చిన twist నే విస్తరించి, చిన్న పదునైన వాక్యాల్లో, reveal చేస్తున్నట్టు చెప్పు.

**చాలా ముఖ్యం:** ప్రతి వాక్యం పైన ఇచ్చిన fact లోని ఏదో ఒక భాగానికి నేరుగా సంబంధించి ఉండాలి. Hook ప్రశ్న అడిగి, దానికి సమాధానం ఇవ్వకుండా వేరే ప్రశ్న/వాక్యం వైపు వెళ్ళకూడదు. పైన ఇచ్చిన వివరణలో లేని కొత్త సంఖ్యలు/గణాంకాలు/వాస్తవాలు స్వయంగా జోడించకు — ఇచ్చినదాన్నే వివరణాత్మకంగా చెప్పు.

**ఇది పూర్తిగా, స్పష్టంగా వివరించు:** హుక్ ప్రశ్న, వివరణ, twist మూడూ తొందరపెట్టినట్టు, అసంపూర్తిగా అనిపించకూడదు — ప్రతి భాగానికీ తగినంత సమయం ఇచ్చి, ఆ దృశ్యాన్ని కళ్ళకు కట్టేలా, ఎందుకు ఆసక్తికరమో అర్థమయ్యేలా చెప్పు. అదే వాక్యాన్ని మళ్ళీ మళ్ళీ చెప్పడం (repetition) వద్దు, కొత్త verify చేయని విషయాలు కల్పించడం వద్దు — ఇచ్చిన fact నే పూర్తిగా న్యాయం చేస్తూ చెప్పు.

**Delivery style గురించి:** వాయిస్ tone ని మనం control చేయలేం, కాబట్టి టెక్స్ట్ లోనే ఉత్సాహం కనిపించాలి:
- పొడవైన, flat వాక్యాలు వద్దు — చిన్న, పదునైన వాక్యాలు వాడు, ముఖ్యంగా twist దగ్గర.
- మధ్యమధ్యలో వినేవారిని నేరుగా engage చేసే పదబంధాలు వాడు (ఉదా. "ఊహించారా?", "ఇది వినండి").
- ఒక వార్తా announcer చదివినట్టు కాకుండా, ఒక స్నేహితుడికి ఆసక్తికరమైన విషయం excited గా చెప్తున్నట్టు రాయి.

నియమాలు:
- ఇది సాధారణంగా ${min}-${max} తెలుగు పదాల నిడివిలో ఉంటుంది — దీనికోసం padding చేయకు, fact ని పూర్తిగా వివరిస్తే ఇది సహజంగానే వస్తుంది. చాలా తక్కువ మాత్రం (${min} కన్నా తక్కువ) రాయకు — అది incomplete గా అనిపిస్తుంది.
- సహజంగా, మాట్లాడేటట్టు రాయి. ప్రతి పూర్తి వాక్యం తర్వాత పూర్ణవిరామం (.).
- ప్రతి వాక్యం పూర్తి క్రియతో ముగియాలి ("...చేసి," వంటి అసంపూర్ణం వద్దు).
- సరైన క్రియా రూపాలు వాడు, రాశాక మళ్ళీ చదివి సరైన పదాలు వాడావో నిర్ధారించుకో.
- సంఖ్యలు (వాడితే) ఎప్పుడూ తెలుగు మాటల్లోనే (2000 → "రెండు వేలు"), అంకెల్లో వద్దు.
- Brand/వ్యక్తుల/శాస్త్రీయ పేర్లు ఆంగ్ల స్పెల్లింగ్‌లోనే ఉంచు.
- ఖచ్చితంగా తెలుగు లిపిలోనే రాయి — Romanized Telugu ఎప్పుడూ వాడకు.
- చివర్లో "లైక్/షేర్/సబ్‌స్క్రైబ్" వాక్యం రాయకు — అది మేమే జోడిస్తాం.${avoidLine}`;

  return `${topicInstruction}

జవాబును ఖచ్చితంగా ఈ నాలుగు లైన్ల ఫార్మాట్‌లోనే ఇవ్వు, ఇదే క్రమంలో, మరేమీ ముందు/వెనుక రాయకు:
TITLE: (5-8 తెలుగు పదాల్లో ఒక చిన్న శీర్షిక, సందర్భానికి తగిన ఒక emoji తో — ఆ emoji వాక్యం చివర్లో కాకుండా, సంబంధిత పదం పక్కనే పెట్టు)
KEYWORDS: (ఈ కంటెంట్‌కి సరిపోయే 3 నిర్దిష్టమైన, దృశ్యమానమైన ఆంగ్ల keywords — abstract పదాలు కాకుండా (ఉదా. "wisdom", "life" వద్దు), కళ్ళకి కనిపించే నిర్దిష్ట scene/object/action పదాలు వాడు, ఉదా: "elderly woman smiling", "children playing park", "mother holding baby", "sunrise mountains road". Content కి నేరుగా సంబంధం ఉండాలి, generic వద్దు.)
HOOK_EMOJI: (పైన ఉన్న Hook ప్రశ్ననే, 1-2 సందర్భోచిత emojis తో, 15 తెలుగు పదాల లోపు తిరిగి రాయి — video description లో వాడతాం, script లో కాదు. Emoji లు వాక్యం చివర్లో మాత్రమే కుప్పగా పెట్టకు — ఏ పదానికి సంబంధించినవో ఆ పదం పక్కనే పెట్టు, ఉదా: "చంద్రుడు 🌙 ఎప్పుడూ ఒకే వైపు ఎందుకు చూపిస్తాడో తెలుసా?")
SCRIPT: (పైన చెప్పిన నియమాల ప్రకారం పూర్తి వాయిస్-ఓవర్ టెక్స్ట్ — ఇందులో emoji లు వాడకు)`;
}

function parseLabeledContent(raw) {
  const titleMatch = raw.match(/TITLE:\s*(.+)/i);
  const keywordsMatch = raw.match(/KEYWORDS:\s*(.+)/i);
  const hookEmojiMatch = raw.match(/HOOK_EMOJI:\s*(.+)/i);
  const scriptMatch = raw.match(/SCRIPT:\s*([\s\S]+)/i);
  return {
    title: titleMatch ? titleMatch[1].trim() : null,
    keywords: keywordsMatch ? keywordsMatch[1].trim() : null,
    hookEmoji: hookEmojiMatch ? hookEmojiMatch[1].trim() : null,
    script: scriptMatch ? scriptMatch[1].trim().replace(/\n+/g, ' ') : null
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callGroq(prompt, attempt = 1) {
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
    // Groq's per-minute token limit (TPM) is a short-lived, transient
    // limit that resets within seconds — the auto-growth fact system
    // (extra generate+verify calls) can occasionally push a run over it.
    // A brief wait and retry succeeds almost every time, versus failing
    // the whole run over a limit that's already gone by the next request.
    const isRateLimit = data.error && data.error.code === 'rate_limit_exceeded';
    if (isRateLimit && attempt <= 3) {
      const waitMs = 15000 * attempt; // 15s, 30s, 45s — long enough to reliably cross a full TPM reset window, even with several of our own calls firing in the same run
      log(`WARNING: Groq rate limit hit (attempt ${attempt}/3) — waiting ${waitMs / 1000}s before retrying.`);
      await sleep(waitMs);
      return callGroq(prompt, attempt + 1);
    }
    throw new Error('Groq did not return content: ' + JSON.stringify(data));
  }
  // Defensive safety net: strip any <think>...</think> block, in case a
  // future model swap brings back a reasoning model whose planning text
  // would otherwise leak straight into the script.
  let content = data.choices[0].message.content.trim();
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // Small proactive spacing after every call — a single run can make up to
  // ~6 Groq calls (script + retries + keywords + auto-growth generate and
  // verify) in quick succession; this naturally throttles our own request
  // rate so we're less likely to burst past the TPM limit in the first
  // place, not just react to it after the fact.
  await sleep(1500);
  return content;
}

async function generateContent(category, recentTitles, outline) {
  log(`Generating ${category} content via Groq...`);
  const prompt = buildPrompt(category, recentTitles, outline);

  let raw = await callGroq(prompt);
  let { title, keywords, hookEmoji, script } = parseLabeledContent(raw);

  if (!script) {
    // Labeled format wasn't followed — fall back to treating the whole
    // reply as the script so one malformed response doesn't fail the run.
    log('WARNING: Groq did not follow the TITLE/KEYWORDS/SCRIPT format, falling back to plain-text parsing.');
    script = raw.replace(/\n+/g, ' ');
  }

  // The many formatting/punctuation rules can sometimes cause the model to
  // under-shoot the word count badly (seen once: ~16s of audio instead of
  // ~25-30s). Retry (up to 2 extra attempts) with the word count called out
  // more forcefully — and critically, keep retrying until the target is
  // actually met, not just "longer than the previous attempt" (a bug: a
  // 40-word retry over a 20-word original passed the old "improved" check
  // while still being far short of a 110-130 word target).
  const target = WORD_COUNT_TARGETS[category];
  let wordCount = script.split(/\s+/).filter(Boolean).length;
  let bestScript = script, bestTitle = title, bestKeywords = keywords, bestHookEmoji = hookEmoji, bestWordCount = wordCount;

  for (let retryAttempt = 1; wordCount < target.min - 15 && retryAttempt <= 2; retryAttempt++) {
    log(`WARNING: script came back too short (${wordCount} words, need ${target.min}-${target.max}) — retry ${retryAttempt}/2 with a stronger word-count reminder.`);
    const retryPrompt = prompt + `\n\nచాలా ముఖ్యం: మీ మునుపటి ప్రయత్నం చాలా చిన్నగా (${wordCount} పదాలు మాత్రమే) వచ్చింది. ఈసారి ఖచ్చితంగా ${target.min}-${target.max} తెలుగు పదాలు ఉండేలా SCRIPT రాయి — అవసరమైతే మరిన్ని వివరాలు/ఉదాహరణలు జోడించి పొడిగించు.`;
    raw = await callGroq(retryPrompt);
    const retryParsed = parseLabeledContent(raw);
    if (retryParsed.script) {
      const retryWordCount = retryParsed.script.split(/\s+/).filter(Boolean).length;
      log(`  Retry ${retryAttempt} produced ${retryWordCount} words.`);
      wordCount = retryWordCount;
      script = retryParsed.script;
      if (retryWordCount > bestWordCount) {
        bestScript = retryParsed.script;
        bestTitle = retryParsed.title;
        bestKeywords = retryParsed.keywords;
        bestHookEmoji = retryParsed.hookEmoji;
        bestWordCount = retryWordCount;
      }
    }
  }
  if (bestWordCount < target.min - 15) {
    log(`⚠️ WARNING: after all retries, script is still short (${bestWordCount} words, target ${target.min}-${target.max}) — using the best attempt available. Video will be shorter than intended this time.`);
  }
  title = bestTitle; keywords = bestKeywords; hookEmoji = bestHookEmoji; script = bestScript;
  if (!title) title = deriveHeadline(script);
  if (!keywords) keywords = FALLBACK_KEYWORDS[category];
  if (!hookEmoji) hookEmoji = title; // fallback: reuse title (no emoji, but never blank)

  // Defensive: strip any CTA-like ending the model wrote anyway, despite
  // being told not to — avoids ending up with two CTA lines back to back.
  const existingSentences = splitIntoSentences(script);
  if (existingSentences.length > 0 && existingSentences[existingSentences.length - 1].includes('సబ్‌స్క్రైబ్')) {
    existingSentences.pop();
    script = existingSentences.join(' ');
  }

  script = ensureSentenceBreaks(script);
  script = (script.trim() + ' ' + CTA_SENTENCE).trim();
  log(`Title: ${title}`);
  log(`Keywords: ${keywords}`);
  log(`Hook emoji line: ${hookEmoji}`);
  log(`Script (${script.length} chars): ${script}`);
  return { title, keywords, hookEmoji, script };
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
// Google TTS adds its own small leading/trailing silence to short
// utterances (more noticeable the shorter the clause) — left untrimmed,
// this compounds with our own explicitly-inserted gap and produces pauses
// far longer than designed (measured up to ~1s instead of 0.35s in a real
// video). Strips it down to a small natural buffer before we add our own
// exact gap on top.
function trimSilence(clipPath) {
  const trimmedPath = clipPath.replace('.wav', '_trimmed.wav');
  const filter = 'silenceremove=start_periods=1:start_duration=0:start_threshold=-35dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_duration=0:start_threshold=-35dB:start_silence=0.05,areverse';
  execSync(`ffmpeg -y -i "${clipPath}" -af "${filter}" -c:a pcm_s16le "${trimmedPath}"`, { stdio: 'pipe' });
  fs.renameSync(trimmedPath, clipPath);
}

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
      try {
        trimSilence(p);
      } catch (e) {
        log(`  WARNING: silence-trim failed for clip ${si}_${ci} (${e.message}) — using untrimmed clip.`);
      }
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

const BGM_MOOD_TAGS = {
  mindblowing: 'curious,upbeat',
  psychology: 'mysterious,curious',
  earth_space: 'ambient,cinematic',
  animal: 'playful,curious',
  money: 'corporate,upbeat',
  history: 'mysterious,cinematic',
  human_body: 'curious,upbeat'
};

// Searches Jamendo's free Creative Commons catalog for an INSTRUMENTAL
// track matching the category's mood (instrumental so it never competes
// with our own narration vocals) and downloads it. The license URL is
// logged for spot-checking — Jamendo tracks vary in exact CC terms
// (attribution / commercial-use permissions), and this project can't
// verify that automatically, so it's worth an occasional manual look.
async function fetchBackgroundMusic(category) {
  const tags = BGM_MOOD_TAGS[category] || 'inspiring,uplifting';
  const clientId = (JAMENDO_CLIENT_ID || '').trim();
  const url = `https://api.jamendo.com/v3.0/tracks/?client_id=${clientId}&format=json&limit=10&tags=${encodeURIComponent(tags)}&vocalinstrumental=instrumental&include=musicinfo&order=popularity_total`;
  log(`Fetching background music from Jamendo for mood: "${tags}"...`);
  const res = await fetchWithTimeout(url, {}, 15000);
  const data = await res.json();
  if (!data.results || data.results.length === 0) {
    throw new Error(`Jamendo returned no tracks for tags "${tags}": ` + JSON.stringify(data).slice(0, 200));
  }
  const track = data.results[Math.floor(Math.random() * data.results.length)];
  const audioUrl = track.audiodownload || track.audio;
  if (!audioUrl) throw new Error('Jamendo track has no downloadable audio URL');
  const audioRes = await fetchWithTimeout(audioUrl, {}, 20000);
  if (!audioRes.ok) throw new Error(`Jamendo audio download failed HTTP ${audioRes.status}`);
  const buf = Buffer.from(await audioRes.arrayBuffer());
  if (buf.length < 10000) throw new Error(`Jamendo audio file suspiciously small (${buf.length} bytes)`);
  const musicPath = path.join(WORK_DIR, 'bgm.mp3');
  fs.writeFileSync(musicPath, buf);
  log(`Downloaded BGM: "${track.name}" by ${track.artist_name} (license: ${track.license_ccurl || 'unknown — spot-check before relying on this'})`);
  return musicPath;
}

// Mixes background music, looped to cover the narration, MUCH quieter
// (volume=0.12) than the voice track — this is meant to be felt, not heard
// as a competing sound. Output stays uncompressed (pcm) since buildVideo's
// final mux re-encodes to AAC once anyway; no need to lossy-encode twice.
function mixBackgroundMusic(narrationPath, musicPath, outPath) {
  const narrationDur = getAudioDuration(narrationPath);
  const cmd = [
    'ffmpeg -y',
    `-i "${narrationPath}"`,
    `-stream_loop -1 -i "${musicPath}"`,
    `-filter_complex "[1:a]volume=0.12[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]"`,
    `-map "[aout]"`,
    `-t ${narrationDur.toFixed(2)}`,
    '-c:a pcm_s16le',
    `"${outPath}"`
  ].join(' ');
  execSync(cmd, { stdio: 'inherit' });
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
async function getSentenceKeywords(sentences, outline) {
  const numbered = sentences.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const outlineContext = outline ? `\n\nమూలం (అసలైన, verify చేయబడిన fact — దీనిలోని నిర్దిష్ట పేర్లు/వస్తువులు/ప్రదేశాలనే image keywords లో వాడు, స్క్రిప్ట్ వాక్యాలు దీన్నే paraphrase చేసినవి): ${outline}` : '';
  const prompt = `ఈ fact video కోసం మూడు విభాగాలు ఇవ్వు.

SUBJECT: ఈ fact యొక్క ప్రధాన విషయం ఏమిటో ఒక లైన్‌లో ఇవ్వు (ఒక జంతువు/వస్తువు/ప్రదేశం/వ్యక్తి — ఏదైతే అది, నిర్దిష్టంగా, ఆంగ్లంలో). ఇదే వర్ణన ప్రతి scene లోనూ వాడతాం, visual consistency కోసం. ఉదా: "Greenland shark, dark grey skin, slow-moving, deep ocean" లేదా "Great Pyramid of Giza, limestone blocks, desert".

KEYWORDS: ప్రతి వాక్యానికి 3-5 పదాల Pexels-సెర్చ్ keyword — ఇది ఒక **real video/photo footage లో ఉండే అవకాశం ఉన్న**, నిర్దిష్ట, documentary-style దృశ్యం కావాలి.

SCENES: ప్రతి వాక్యానికి 15-25 పదాల దృశ్య వర్ణన (ఆంగ్లంలో) — AI image generation కోసం, scientific/documentary/educational style లో, realistic గా. SUBJECT ప్రస్తావిస్తే అదే వర్ణన వాడు.

నియమాలు:
- పైన ఇచ్చిన **మూలం fact లోని నిర్దిష్ట పేర్లు/వస్తువులు/సంఖ్యలనే** వాడు — స్క్రిప్ట్ వాక్యం అస్పష్టంగా ఉన్నా, మూలం fact లో ఉన్న నిర్దిష్ట విషయాన్నే keyword/scene లో పెట్టు (ఉదా. మూలంలో "గ్రీన్‌ల్యాండ్ సొరచేప" అని ఉంటే, కేవలం "shark" అని కాకుండా "Greenland shark" అనే వాడు).
- పదాలు direct గా అనువదించకు, నిజమైన దృశ్యం రాయి (ఉదా. వైద్య "గుండె" కి "heart" వద్దు — romance ఫోటోలు వస్తాయి — "doctor checking heart with stethoscope" రాయి). భావోద్వేగాలను/నైరూప్య భావనలను (mystery, importance) మాటలుగా వాడకు, దృశ్యంగా చూపించు.
- మనుషులు కనిపించే scene అయితే, దేశం చెప్పకపోతే ఎప్పుడూ "Indian"/"South Indian" నేపథ్యం వాడు, Western look వద్దు. (జంతువులు/వస్తువులు/ప్రదేశాలకి ఇది వర్తించదు — అవి ఎక్కడివైతే అక్కడివే చూపించు.)${outlineContext}

వాక్యాలు:
${numbered}

ఖచ్చితంగా ఈ ఫార్మాట్‌లో, ఇదే క్రమంలో ఇవ్వు:

SUBJECT:
1. subject description

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
  const character = parseNumberedSection(raw, 'SUBJECT:', 1)[0];
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
async function fetchImagesPerSentence(sentences, category, outline) {
  let character, keywords, scenes;
  try {
    const result = await getSentenceKeywords(sentences, outline);
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

// libass/drawtext look up fonts by their EMBEDDED family name, not the
// filename — detect it at runtime with fc-scan so text rendering works
// regardless of what the .ttf file happens to be named.
function getFontFamilyName(fontPath, fallback) {
  try {
    const name = execSync(`fc-scan --format "%{family}\n" "${fontPath}"`).toString().trim().split('\n')[0];
    return name || fallback;
  } catch (e) {
    log(`WARNING: fc-scan failed for ${fontPath} (${e.message}), using fallback family name "${fallback}".`);
    return fallback;
  }
}

// Wraps text at a max character count per line so thumbnail text fits the
// frame width at a large, readable size.
function wrapText(text, maxCharsPerLine) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? current + ' ' + word : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Builds a custom thumbnail: a frame from the video's own first slide
// (image or video) with bold, high-contrast hook-text overlaid — shown
// ONLY in YouTube's feed/search preview, never during playback (kept
// completely separate from the on-screen-text-free video itself).
//
// Uses the subtitles/libass rendering path, NOT drawtext — testing showed
// drawtext produces corrupted/overlapping glyphs for some Telugu conjuncts
// (e.g. "చంద్రుడు" rendering with a garbled ending), the same class of bug
// from this project's original on-screen-text era. libass (via harfbuzz)
// shapes Telugu conjuncts correctly, which is why the disabled subtitle
// feature used it too.
function buildThumbnail(mediaPath, mediaType, hookText, outPath) {
  const fontsDir = path.join(__dirname, 'fonts');
  const fontPathBoldCandidate = path.join(fontsDir, 'NotoSansTelugu-Bold.ttf');
  const fontPathBold = fs.existsSync(fontPathBoldCandidate) ? fontPathBoldCandidate : path.join(fontsDir, 'NotoSansTelugu-Regular.ttf');
  const fontFamily = getFontFamilyName(fontPathBold, 'Noto Sans Telugu');

  // Strip emoji before wrapping — libass can't render most emoji glyphs
  // reliably either, and they'd show as tofu boxes on the thumbnail.
  const cleanText = hookText.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim();
  const lines = wrapText(cleanText, 24);
  const assText = lines.join('\\N');

  const frameOut = path.join(WORK_DIR, 'thumb_frame.jpg');
  if (mediaType === 'video') {
    execSync(`ffmpeg -y -i "${mediaPath}" -ss 1 -vf "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280" -frames:v 1 "${frameOut}"`, { stdio: 'inherit' });
  } else {
    execSync(`ffmpeg -y -i "${mediaPath}" -vf "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280" -frames:v 1 "${frameOut}"`, { stdio: 'inherit' });
  }

  const assPath = path.join(WORK_DIR, 'thumbnail.ass');
  const assContent = `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Thumb,${fontFamily},54,&H00FFFFFF,&H000000FF,&H00000000,&HB0000000,-1,0,0,0,100,100,0,0,3,0,2,2,50,50,500,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:05.00,Thumb,,0,0,0,,${assText}
`;
  fs.writeFileSync(assPath, assContent, 'utf8');

  const filters = `eq=contrast=1.1:saturation=1.15,subtitles='${assPath}':fontsdir='${fontsDir}'`;
  execSync(`ffmpeg -y -i "${frameOut}" -vf "${filters}" -frames:v 1 -update 1 -q:v 2 "${outPath}"`, { stdio: 'inherit' });
  log(`Thumbnail built: ${outPath} (font family "${fontFamily}")`);
  return outPath;
}

async function uploadThumbnail(videoId, thumbnailPath) {
  try {
    const oauth2Client = new google.auth.OAuth2(YT_CLIENT_ID, YT_CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: YT_REFRESH_TOKEN });
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    await youtube.thumbnails.set({
      videoId,
      media: { body: fs.createReadStream(thumbnailPath) }
    });
    log('Custom thumbnail uploaded successfully.');
  } catch (e) {
    // Custom thumbnails require a phone-verified YouTube account — if that
    // isn't done yet, this fails but the video itself already uploaded
    // fine with YouTube's auto-selected thumbnail as a fallback.
    log(`WARNING: thumbnail upload failed (${e.message}) — video is still live with YouTube's auto-selected thumbnail. (Custom thumbnails require a phone-verified channel — verify at youtube.com/verify if this keeps failing.)`);
  }
}

function buildVideo(mediaItems, audioPath, customDurations, ctaDuration) {
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

  // The CTA button only appears while the CTA line is actually being
  // spoken (the closing few seconds), not for the whole video — computed
  // from the CTA sentence's own measured audio duration.
  const ctaStartTime = ctaDuration ? Math.max(0, duration - ctaDuration) : duration; // fallback: never shown if unknown
  log(`CTA button will appear starting at ${ctaStartTime.toFixed(2)}s`);

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

    // "STORY" badge, top-left, with a soft drop shadow behind the box
    `drawbox=x=43:y=63:w=165:h=44:color=black@0.35:t=fill`,
    `drawbox=x=40:y=60:w=165:h=44:color=${ACCENT}@0.97:t=fill`,
    `drawtext=fontfile='${fontPathBold}':text='FACTS':fontcolor=0x0f1024:fontsize=22:x=40+(165-text_w)/2:y=60+(44-text_h)/2`,

    // Channel branding, top-center, with text shadow + a thin accent underline
    `drawtext=fontfile='${fontPathBold}':text='TELUGU ECHO':fontcolor=${ACCENT}:fontsize=32:x=(w-text_w)/2:y=140:shadowcolor=black@0.6:shadowx=2:shadowy=2`,
    `drawbox=x=(iw-160)/2:y=192:w=160:h=4:color=${ACCENT}@0.9:t=fill`,

    // Subscribe CTA styled as a real elevated button: soft glow border behind,
    // drop shadow, bold white text with shadow, small tagline underneath.
    `drawbox=x=(iw-572)/2:y=ih-196:w=572:h=88:color=${ACCENT}@0.35:t=fill:enable='gte(t,${ctaStartTime.toFixed(2)})'`,
    `drawbox=x=(iw-566)/2:y=ih-193+6:w=566:h=82:color=black@0.30:t=fill:enable='gte(t,${ctaStartTime.toFixed(2)})'`,
    `drawbox=x=(iw-560)/2:y=ih-190:w=560:h=76:color=${CTA}@0.97:t=fill:enable='gte(t,${ctaStartTime.toFixed(2)})'`,
    `drawtext=fontfile='${fontPathBold}':text='LIKE   SHARE   SUBSCRIBE':fontcolor=white:fontsize=27:x=(w-text_w)/2:y=h-190+(76-text_h)/2:shadowcolor=black@0.5:shadowx=1:shadowy=1:enable='gte(t,${ctaStartTime.toFixed(2)})'`,
    `drawtext=fontfile='${fontPath}':text='daily amazing Telugu facts':fontcolor=white@0.8:fontsize=17:x=(w-text_w)/2:y=h-100:enable='gte(t,${ctaStartTime.toFixed(2)})'`,

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

const CATEGORY_HASHTAGS = {
  mindblowing: ['#amazingfacts', '#mindblowing', '#factsdaily', '#curiousfacts'],
  psychology: ['#psychologyfacts', '#mindfacts', '#humanmind', '#psychologytips'],
  earth_space: ['#spacefacts', '#earthfacts', '#astronomy', '#universe'],
  animal: ['#animalfacts', '#wildlifefacts', '#nature', '#animalworld'],
  money: ['#moneyfacts', '#financefacts', '#economyfacts', '#moneytips'],
  history: ['#historyfacts', '#historymysteries', '#ancienthistory', '#historylovers'],
  human_body: ['#humanbodyfacts', '#sciencefacts', '#bodyfacts', '#anatomy'],
  technology: ['#techfacts', '#technology', '#gadgets', '#innovation'],
  food: ['#foodfacts', '#foodie', '#cookingfacts', '#foodlovers'],
  ocean: ['#oceanfacts', '#marinelife', '#seacreatures', '#underwater']
};
const BASE_HASHTAGS = ['#shorts', '#ytshorts', '#telugufacts', '#didyouknow'];

// Generic curiosity-building teasers — deliberately NOT about any specific
// fact's content (that would summarize/spoil the video), just build
// curiosity to watch. Rotates by run count for variety. Each already has
// its emoji placed next to the relevant word, not tacked on at the end.
const DESCRIPTION_TEASERS = [
  'ఈ వీడియో 🎬 చూశాక మీ ఆలోచన ఖచ్చితంగా మారిపోతుంది!',
  'చివరి వరకూ చూడండి, twist 😲 మిమ్మల్ని ఆశ్చర్యపరుస్తుంది!',
  'చాలా మందికి ఇది తెలియదు 🧐... మీకు తెలుసా?',
  'ఇది విన్నాక మీరు షాక్ ⚡ అవ్వడం ఖాయం!',
  'ఈ fact 🔥 మీ friends కి కూడా చెప్పాలనిపిస్తుంది!'
];

// Short, structured 3-line description (hook / curiosity teaser / CTA) plus
// exactly 8 lowercase hashtags, per spec. Built programmatically (fixed
// teaser bank + templated CTA) except the hook line, which needs to be
// content-aware for its emoji placement — that part comes from Groq's
// HOOK_EMOJI field, kept separate from the spoken SCRIPT.
function buildDescription(hookEmoji, category, runCount) {
  const line1 = hookEmoji;
  const line2 = DESCRIPTION_TEASERS[runCount % DESCRIPTION_TEASERS.length];
  const line3 = 'మరిన్ని facts కోసం Subscribe చేయండి! 🔔';
  const hashtags = [...BASE_HASHTAGS, ...(CATEGORY_HASHTAGS[category] || [])].slice(0, 8).join(' ');

  return `${line1}\n${line2}\n${line3}\n\n${hashtags}`;
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
        tags: ['telugu', 'facts', 'shorts', 'amazing facts', 'telugu facts', 'did you know'],
        categoryId: '27'
      },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false }
    },
    media: { body: fs.createReadStream(videoPath) }
  });
  log(`Uploaded! Video ID: ${res.data.id}`);
  return res.data.id;
}

function saveState(title, category, newlyDiscovered) {
  const { usedTitles, runCount, categoryRunCounts, discoveredFacts } = loadState();
  let newTitles = [...usedTitles, title];
  if (newTitles.length > 50) newTitles = newTitles.slice(-50);
  const newCategoryRunCounts = { ...categoryRunCounts, [category]: (categoryRunCounts[category] || 0) + 1 };
  const newDiscoveredFacts = { ...discoveredFacts };
  if (newlyDiscovered) {
    newDiscoveredFacts[category] = [...(newDiscoveredFacts[category] || []), newlyDiscovered];
    log(`Persisting 1 newly discovered fact for "${category}" — bank is now permanently larger.`);
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    usedTitles: newTitles,
    runCount: runCount + 1,
    categoryRunCounts: newCategoryRunCounts,
    discoveredFacts: newDiscoveredFacts,
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
  checkSecret('JAMENDO_CLIENT_ID', JAMENDO_CLIENT_ID);
  checkSecret('YT_CLIENT_ID', YT_CLIENT_ID);
  checkSecret('YT_CLIENT_SECRET', YT_CLIENT_SECRET);
  checkSecret('YT_REFRESH_TOKEN', YT_REFRESH_TOKEN);

  const { usedTitles, runCount, categoryRunCounts, discoveredFacts } = loadState();
  const category = pickCategory(runCount);
  const { outline, newlyDiscovered } = await getOrGrowFactOutline(category, categoryRunCounts, discoveredFacts);

  const { title, hookEmoji, script } = await generateContent(category, usedTitles, outline);
  const allSentences = splitIntoSentences(script);
  let { audioPath, sentenceDurations, silenceGap } = await generateAudioForScript(allSentences);

  // Background music is a nice-to-have, not critical — any failure here
  // (missing/invalid client ID, network, no matching tracks) just means the
  // video plays with narration only, same as before this feature existed.
  try {
    const musicPath = await fetchBackgroundMusic(category);
    const mixedPath = path.join(WORK_DIR, 'audio_with_bgm.wav');
    mixBackgroundMusic(audioPath, musicPath, mixedPath);
    audioPath = mixedPath;
    log('Background music mixed in successfully.');
  } catch (e) {
    log('WARNING: background music failed (' + e.message + ') — continuing with narration-only audio.');
  }

  // Fold the gap that follows each sentence (except the last) into that
  // sentence's own on-screen time, so the image holds through the pause
  // before the next line — durations still sum exactly to the full audio.
  let imageDurations = sentenceDurations.map((d, i) => i < sentenceDurations.length - 1 ? d + silenceGap : d);
  let imageSentences = allSentences.slice();

  // Pull the closing CTA sentence out — a stock/AI photo search for "like
  // share subscribe" wouldn't mean anything, so its time is folded into the
  // last content sentence's slide instead.
  let ctaAudioDuration = 0; // used later to time-gate the on-screen CTA button
  const ctaIndex = imageSentences.findIndex(s => s.includes('సబ్‌స్క్రైబ్'));
  if (ctaIndex !== -1) {
    const ctaDur = imageDurations[ctaIndex] || 0;
    ctaAudioDuration = ctaDur;
    imageSentences.splice(ctaIndex, 1);
    imageDurations.splice(ctaIndex, 1);
    if (imageDurations.length > 0) {
      imageDurations[imageDurations.length - 1] += ctaDur;
    } else {
      imageSentences = [allSentences[ctaIndex]];
      imageDurations = [ctaDur];
    }
  }

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
  const rawImagePaths = await fetchImagesPerSentence(imageSentences, category, outline);

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

  const videoPath = buildVideo(imagePaths, audioPath, keptDurations, ctaAudioDuration);

  const videoId = await uploadToYouTube(
    videoPath,
    title,
    buildDescription(hookEmoji, category, runCount)
  );

  // Custom thumbnail is a nice-to-have on top of an already-successful
  // upload — any failure here (build error, unverified channel, etc.)
  // must never be treated as the run failing.
  try {
    const thumbnailPath = path.join(WORK_DIR, 'thumbnail.jpg');
    buildThumbnail(imagePaths[0].path, imagePaths[0].type, hookEmoji, thumbnailPath);
    await uploadThumbnail(videoId, thumbnailPath);
  } catch (e) {
    log(`WARNING: thumbnail generation failed (${e.message}) — video is live with YouTube's auto-selected thumbnail instead.`);
  }

  saveState(title, category, newlyDiscovered);
  log('Done!');
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
