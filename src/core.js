export const alphabet = Object.entries({alif:'أ',ba:'ب',ta:'ت',tha:'ث',jeem:'ج',ha:'ح',khaa:'خ',dal:'د',dhal:'ذ',raa:'ر',zaay:'ز',seen:'س',sheen:'ش',saad:'ص',daad:'ض',taa:'ط',dhaa:'ظ',ayen:'ع',ghayen:'غ',faa:'ف',qaf:'ق',kaf:'ك',laam:'ل',meem:'م',noon:'ن',waw:'و',haa:'ه',yaa:'ي'});

// Dictionary feature abbreviations (from the introduction's abbreviation list):
// full term -> abbreviation shown in the UI; hovering reveals the full name.
export const featureAbbreviations = {
  'accusative':'accus.', 'active participle':'act. part.', 'anno domini':'A.D.',
  'adjective':'adj.', 'adverb':'adv.', 'affirmative':'affirm.',
  'year of the hijra':'A.H.', 'cardinal':'card.', 'compare':'cf.',
  'collective':'coll.', 'compound numeral':'comp no.', 'demonstrative':'dem.',
  'diminutive':'dimin.', 'for example':'e.g.', 'elative':'elat.',
  'elliptical':'ellipt.', 'feminine':'fem.', 'genitive':'gen.', 'that is':'i.e.',
  'imperative':'imper.', 'impersonal':'impers.', 'imperfect':'impf.',
  'intensive':'intens.', 'interjection':'interj.', 'intransitive':'intrans.',
  'jurisprudence':'jur.', 'masculine':'masc.', 'noun':'n.', 'number':'no.',
  'nominative':'nom.', 'ordinal':'ord.', 'particle':'part.', 'passive':'pass.',
  'passive participle':'pass. part.', 'perfect':'perf.', 'plural':'pl.',
  'preposition':'prep.', 'pronoun':'pron.', 'pronominal':'pronom.',
  'which see':'q.v.', 'quadrilateral verb':'quad. v.',
  'adjectival active participle':'quasi-act.', 'adjectival passive participle':'quasi-pass.', 'adjectival passive principal':'quasi-pass.',
  'relative':'rel.', 'singular':'sing.', 'transitive':'trans.', 'verb':'v.',
  'verbal noun':'v. n.', 'changed into':'>', 'idiomatic usage':'*'
};
// Reverse index so data may already use the abbreviation form.
const featureKey = text => text.trim().toLowerCase().replace(/[.,;|]/g, ' ').replace(/\s+/g, ' ').trim();
const featureLookup = new Map();
for (const [full, abbr] of Object.entries(featureAbbreviations)) {
  featureLookup.set(featureKey(full), {abbr, full: full.replace(/^\w/, c => c.toUpperCase())});
  featureLookup.set(featureKey(abbr), {abbr, full: full.replace(/^\w/, c => c.toUpperCase())});
}

// Accepts an array of feature names or a delimited string; returns
// {abbr, full} pairs where `abbr` is displayed and `full` is the tooltip.
export function featureTags(features) {
  const items = Array.isArray(features) ? features :
    typeof features === 'string' ? features.split(/[,;|]/) : [];
  const tags = [];
  for (const item of items) {
    if (!item || !item.trim()) continue;
    const key = featureKey(item);
    if (!key) continue;
    tags.push(featureLookup.get(key) || {abbr: item.trim(), full: item.trim().replace(/^\w/, c => c.toUpperCase())});
  }
  return tags;
}

export function normalize(text = '') {
  return text.normalize('NFKD').replace(/[\p{M}\u0640\u06D6-\u06ED]/gu, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/[^\p{L}]/gu, '');
}

// Keep offsets into the original string so search highlights preserve Arabic marks.
export function normalizeWithSpans(text = '') {
  let normalized = '';
  const spans = [];
  let offset = 0;
  for (const character of text) {
    const start = offset;
    offset += character.length;
    const base = character.normalize('NFD').replace(/\p{M}|\u0640/gu, '');
    if (!base) {
      if (spans.length) spans[spans.length - 1].end = offset;
      continue;
    }
    for (const letter of base) {
      normalized += letter;
      for (let i = 0; i < letter.length; i++) spans.push({start, end:offset});
    }
  }
  return {normalized, spans};
}

export function searchToc(rows, query) {
  const needle = normalizeWithSpans(query).normalized;
  if (!needle) return [];
  const matches = [];
  const add = (item, letter, familyIndex, wordIndex, word) => {
    const indexed = normalizeWithSpans(word);
    let at = indexed.normalized.indexOf(needle);
    while (at !== -1) {
      matches.push({id:item.id, letter, familyIndex, wordIndex, start:indexed.spans[at].start,
        end:indexed.spans[at + needle.length - 1].end});
      at = indexed.normalized.indexOf(needle, at + needle.length);
    }
  };
  const sections = Array.isArray(rows) ? [['', rows]] : Object.entries(rows || {});
  sections.forEach(([letter, families]) => families.forEach((item, familyIndex) => {
    add(item, letter, familyIndex, 0, item.word);
    (item.children || []).forEach((child, index) => add(child, letter, familyIndex, index + 1, child.word));
  }));
  return matches;
}

export const keyboardMap = {"1":"\u0661","!":"\u06e8","2":"\u0662","@":"\u06df","3":"\u0663","#":"\u0654","4":"\u0664","$":"\u0634","5":"\u0665","%":"\u06ec","6":"\u0666","^":"\u0653","7":"\u0667","&":"\u0624","8":"\u0668","*":"\u0630","9":"\u0669","(":"(","0":"\u0660",")":")","-":"\u06ea","_":"\u0640","=":"=","+":"\u06eb","q":"\u0642","Q":"\u0688","w":"\u0648","W":"\u0691","e":"e","E":"\u0639","r":"\u0631","R":"\u0698","t":"\u062a","T":"\u0637","y":"\u064a","Y":"\u0649","u":"\u064f","U":"\u06d2","i":"\u0650","I":"I","o":"\u0652","O":"\u06ba","p":"\u0629","P":"\u067e","[":"\u06e2","{":"\u0671","]":"\u06ed","}":"\u0626","a":"\u064e","A":"\u0627","s":"\u0633","S":"\u0635","d":"\u062f","D":"\u0636","f":"\u0641","F":"\u064b","g":"\u063a","G":"\u06af","h":"\u0647","H":"\u062d","j":"\u062c","J":"J","k":"\u0643","K":"\u064d","l":"\u0644","L":"L",";":"\u06e3",":":"\u06dc","'":"\u0621",'"':"\u06e0","`":"\u0670","~":"\u0651","\\":"\\","|":"|","z":"\u0632","Z":"\u0638","x":"\u062e","X":"X","c":"\u0686","C":"\u0679","v":"\u062b","V":"\u0610","b":"\u0628","B":"\u06be","n":"\u0646","N":"\u064c","m":"\u0645","M":"M",",":"\u060c","<":"\u0625",".":".",">":"\u0623","/":"/","?":"\u061f"," ":" "};
export const altGrMap = {e:"\u0611",h:"\u06c1",".":"\u06e6"};

export function parseReference(input, surahs) {
  const match = input.trim().match(/^(\d{1,3})\s*:\s*(\d{1,3})$/);
  if (!match) throw new Error('Enter a verse as Surah:Ayah, for example 2:255.');
  const [, s, a] = match.map(Number);
  if (!surahs[s] || a < 1 || a > surahs[s]) throw new Error('That verse does not exist. Check the Surah and Ayah numbers.');
  return `${s}:${a}`;
}

export function verseReferences(text, surahs) {
  const references = [];
  for (const match of text.matchAll(/(?<![\d:])(\d{1,3}):(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?(?![\d:])/g)) {
    const [, s, a, end] = match;
    try {
      const reference = parseReference(`${s}:${a}`, surahs);
      if (end && (Number(end) < Number(a) || Number(end) > surahs[Number(s)])) continue;
      references.push({index:match.index, label:match[0], reference});
    } catch { /* Only real Quran references become links. */ }
  }
  return references;
}

// Quran API editions and the source use different orthographies. Prefer position
// when their word counts match; never shift dictionary IDs on a count mismatch.
export function alignWords(text, source, reference) {
  let tokens = text.trim().split(/\s+/u).filter(t => normalize(t));
  const [surah, ayah] = reference.split(':').map(Number);
  if (surah !== 1 && surah !== 9 && ayah === 1 && tokens.length === source.length + 4 &&
      normalize(tokens.slice(0, 4).join(' ')) === normalize('بسم الله الرحمن الرحيم')) tokens = tokens.slice(4);
  if (tokens.length === source.length) return { words: tokens.map((arabic, i) => ({arabic, entryId: source[i]?.entryId})), aligned: true };
  // Longest common subsequence gives conservative matches when counts differ.
  const table = Array.from({length: tokens.length + 1}, () => new Uint16Array(source.length + 1));
  for (let i = tokens.length - 1; i >= 0; i--) for (let j = source.length - 1; j >= 0; j--)
    table[i][j] = normalize(tokens[i]) === normalize(source[j].arabic) ? 1 + table[i + 1][j + 1] : Math.max(table[i + 1][j], table[i][j + 1]);
  const words = tokens.map(arabic => ({arabic}));
  let i = 0, j = 0;
  while (i < tokens.length && j < source.length) {
    if (normalize(tokens[i]) === normalize(source[j].arabic)) { words[i].entryId = source[j].entryId; i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) i++; else j++;
  }
  return {words, aligned: false};
}

export function schedule(card, grade, now = Date.now()) {
  if (!['easy', 'medium', 'difficult', 'failed'].includes(grade)) throw new Error('Invalid review grade.');
  const day = 86400000;
  const ease = Math.max(1.3, (card.ease || 2.5) + ({easy: .15, medium: 0, difficult: -.15, failed: -.2}[grade]));
  const interval = grade === 'failed' ? 10 / 1440 : grade === 'difficult' ? Math.max(1, (card.interval || 0) * 1.2)
    : grade === 'medium' ? (card.interval || card.reviews ? Math.max(1, Math.round((card.interval || .4) * ease)) : 2)
    : (card.interval || card.reviews ? Math.max(4, Math.round((card.interval || 1) * ease * 1.3)) : 3);
  return {...card, ease, interval, due: now + interval * day, reviews: (card.reviews || 0) + 1,
    lapses: (card.lapses || 0) + (grade === 'failed' ? 1 : 0), grade, updatedAt: now};
}

// Daily limits per study: how many new cards and due review cards may be asked
// today. Stored on the study document so they sync across devices; 50/50 until
// the user changes them in the study settings dialog.
export const STUDY_LIMIT_DEFAULTS = {maxNew:50, maxReview:50};
export function studyLimits(study) {
  const settings = study?.settings || {};
  const read = value => Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  return {maxNew: read(settings.maxNew) ?? STUDY_LIMIT_DEFAULTS.maxNew, maxReview: read(settings.maxReview) ?? STUDY_LIMIT_DEFAULTS.maxReview};
}
export function dayEnd(now = Date.now()) { const end = new Date(now); end.setHours(23,59,59,999); return end.getTime(); }
// Today's queue: review cards due by the end of today (oldest due first, up to
// Max Today Review) followed by brand-new cards (up to Max Today New). Cards
// beyond the limits stay available on later days instead of appearing at once.
// `cards` receives the study's cards already filtered to existing entries.
export function todayQueue(study, cards = study.cards || [], now = Date.now()) {
  const progress = study.progress || {}, limits = studyLimits(study), end = dayEnd(now);
  const reviews = cards.filter(id => (progress[id]?.reviews || 0) > 0 && (progress[id].due || 0) <= end)
    .sort((a, b) => (progress[a]?.due || 0) - (progress[b]?.due || 0)).slice(0, limits.maxReview);
  const fresh = cards.filter(id => (progress[id]?.reviews || 0) === 0).slice(0, limits.maxNew);
  return [...reviews, ...fresh];
}

export function mergeDecks(...decks) {
  const result = {};
  for (const deck of decks) for (const [id, card] of Object.entries(deck || {})) {
    if (!card || typeof card !== 'object' || !Number.isFinite(card.updatedAt) || !Number.isFinite(card.due) ||
        // Accept both the current `{letter}-{number}` ids and the legacy `{letter}-entry-{number}` ones.
        !/^(?:[a-z0-9]+-entry-|[a-z]+-)\d+$/.test(id)) continue;
    if (!result[id] || card.updatedAt >= result[id].updatedAt) result[id] = {...card};
  }
  return result;
}

// Merge cards/studies saved anonymously in this browser into a signed-in
// account so the first sync uploads them instead of the local work being lost.
export function adoptSeed(deck, studies, seed) {
  const mergedStudies = {...(studies || {})};
  for (const [id, study] of Object.entries(seed?.studies || {}))
    if (!mergedStudies[id] || (study.updatedAt || 0) > (mergedStudies[id].updatedAt || 0)) mergedStudies[id] = study;
  return {deck: mergeDecks(seed?.deck || {}, deck), studies: mergedStudies};
}
