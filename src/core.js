export const alphabet = Object.entries({alif:'أ',ba:'ب',ta:'ت',tha:'ث',jeem:'ج',haa:'ح',khaa:'خ',dal:'د',dhal:'ذ',raa:'ر',zaay:'ز',seen:'س',sheen:'ش',saad:'ص',daad:'ض',taa:'ط',dhaa:'ظ',ayen:'ع',ghayen:'غ',faa:'ف',qaf:'ق',kaf:'ك',laam:'ل',meem:'م',noon:'ن',haa2:'ه',waw:'و',yaa:'ي'});

export function normalize(text = '') {
  return text.normalize('NFKD').replace(/[\p{M}\u0640\u06D6-\u06ED]/gu, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/[^\p{L}]/gu, '');
}

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
    : grade === 'medium' ? Math.max(1, Math.round((card.interval || .4) * ease))
    : Math.max(4, Math.round((card.interval || 1) * ease * 1.3));
  return {...card, ease, interval, due: now + interval * day, reviews: (card.reviews || 0) + 1,
    lapses: (card.lapses || 0) + (grade === 'failed' ? 1 : 0), grade, updatedAt: now};
}

export function mergeDecks(...decks) {
  const result = {};
  for (const deck of decks) for (const [id, card] of Object.entries(deck || {})) {
    if (!card || typeof card !== 'object' || !Number.isFinite(card.updatedAt) || !Number.isFinite(card.due) ||
        !/^[a-z0-9]+-entry-\d+$/.test(id)) continue;
    if (!result[id] || card.updatedAt >= result[id].updatedAt) result[id] = {...card};
  }
  return result;
}
