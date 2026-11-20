import {escapeHtml as esc, parseUrdu} from './markup.js';
import {alphabet, normalize, searchToc, keyboardMap, altGrMap, parseReference, verseReferences, alignWords, schedule} from './core.js';
import {FirebaseCards} from './firebase-cards.js';
import {LocalCards} from './local-cards.js';

const $ = selector => document.querySelector(selector);
// Deployments may live in a subdirectory (e.g. GitHub Pages project sites); routes are appended to this root.
const APP_ROOT = (() => {
  const routes = ['q', 'dictionary', 'study', 'privacy'];
  const parts = location.pathname.split('/').filter(Boolean);
  let depth = 0;
  while (depth < parts.length && !routes.includes(parts[depth])) depth++;
  return depth ? `/${parts.slice(0, depth).join('/')}/` : '/';
})();
let entries = new Map(), toc = {}, manifest, config, cloud, firebase;
let currentRef = '1:1', currentWords = [], readerId = null, dialogId = null, requestId = 0;
let entryContext = null;
let selectedLetter = 'alif', studyId = null, studyCardId = null, revealed = false, browseMode = false, studied = 0;
let tocQuery = '', tocInputMode = 'auto', tocMatchIndex = 0;
const surahCache = new Map();
let qwords = null, studyBusy = false;
let noticeTimer;
function notice(message) {
  $('#notification').textContent = message; $('#notification').hidden = false;
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('#notification').hidden = true; }, 7000);
}
function readLocal(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch {return fallback;} }
// Inline SVG icons: identical rendering on every platform, unlike font glyphs
// (arrows/hearts differ per fallback font, which made header buttons uneven).
function svgIcon(name, filled = false) {
  const paths = {
    heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
    close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    prev: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
    next: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="${filled ? 1 : 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}
function storeLocal(key, value) {try { localStorage.setItem(key, JSON.stringify(value)); } catch {notice('Browser storage is unavailable. Your reading position cannot be remembered.');} }
function readLocation() {
  const pathname = APP_ROOT === '/' ? location.pathname : location.pathname.slice(APP_ROOT.length - 1);
  const parts = decodeURIComponent(pathname).split('/').filter(Boolean);
  const params = new URLSearchParams(location.search);
  if (parts[0] === 'q' && parts.length >= 3) return {page:'read', reference:`${parts[1]}:${parts[2]}`, params, bare:null};
  if (parts[0] === 'dictionary') return {page:'dictionary', params, bare:null};
  if (parts[0] === 'study') return {page:'study', study:parts[1] || null, params, bare:null};
  if (parts[0] === 'privacy') return {page:'privacy', params, bare:null};
  return {page:'read', reference:null, params, bare:null};
}
function writeLocation(path, values = {}, replace = false) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  const query = params.toString(), url = `${APP_ROOT === '/' ? '' : APP_ROOT.replace(/\/$/, '')}${path}${query ? `?${query}` : ''}`;
  (replace ? history.replaceState : history.pushState).call(history, history.state, '', url);
}
function writeDictionaryLocation(values = {}) { writeLocation('/dictionary', values); }
function writeVerseLocation(reference, values = {}, replace = false) { writeLocation(`/q/${reference.replace(':','/')}`, values, replace); }
// Card URLs use the stable entry id (e.g. dal-161) instead of the Arabic word:
// shorter, readable links. Word-based links shared earlier still resolve.
function cardUrlReference(entry) { return entry.id; }
function findLetterId(value) {
  if (!value) return null;
  return alphabet.find(([id, label]) => id === value || label === value)?.[0] || null;
}
function findEntryReference(reference) {
  if (entries.has(reference)) return reference;
  const needle = normalize(reference.includes('-') ? reference.replaceAll('-', '/') : reference);
  if (!needle) return null;
  return [...entries.values()].find(entry => normalize(entry.word) === needle)?.id || null;
}
async function json(url) {
  const response = await fetch(url, {signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error(`Could not load ${url.includes('alquran') ? 'the verse' : 'dictionary data'} (${response.status}).`);
  return response.json();
}

function markdown(text) {
  const template = document.createElement('template');
  template.innerHTML = parseUrdu(text);
  const allowed = new Set(['P','BR','STRONG','EM','DEL','CODE','PRE','UL','OL','LI','BLOCKQUOTE','H1','H2','H3','H4','H5','H6','HR','A','TABLE','THEAD','TBODY','TR','TH','TD']);
  for (const node of template.content.querySelectorAll('*')) {
    if (!allowed.has(node.tagName)) {node.replaceWith(document.createTextNode(node.textContent)); continue;}
    const href = node.tagName === 'A' ? node.getAttribute('href') : null;
    for (const attr of [...node.attributes]) node.removeAttribute(attr.name);
    if (href) {
      try {
        const url = new URL(href, location.href);
        if (['http:', 'https:'].includes(url.protocol)) {node.setAttribute('href', url.href); node.setAttribute('target','_blank'); node.setAttribute('rel','noopener noreferrer');}
      } catch { /* unsafe link omitted */ }
    }
  }
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const node of textNodes) {
    if (node.parentElement?.closest('a, pre')) continue;
    const matches = verseReferences(node.textContent, manifest.surahs);
    if (!matches.length) continue;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const {index, label, reference} of matches) {
      fragment.append(document.createTextNode(node.textContent.slice(offset, index)));
      const link = document.createElement('a');
      link.href = `/q/${reference.replace(':','/')}`; link.dataset.verse = reference; link.className = 'verse-reference';
      link.dir = 'ltr'; link.textContent = label;
      link.setAttribute('aria-label', `Open verse ${reference}`);
      fragment.append(link); offset = index + label.length;
    }
    fragment.append(document.createTextNode(node.textContent.slice(offset)));
    node.replaceWith(fragment);
  }
  return template.innerHTML;
}
function heart(id) {
  const saved = cloud?.authorized && cloud.deck[id] && !cloud.deck[id].deleted;
  return `<button class="heart ${saved ? 'saved' : ''}" data-heart="${esc(id)}" aria-pressed="${!!saved}" aria-label="${saved ? 'Remove from' : 'Add to'} flashcards" title="${saved ? 'Remove from flashcards' : 'Save to flashcards'}">${svgIcon('heart', saved)}</button>`;
}
function entryCard(id, inDialog = false) {
  const entry = entries.get(id);
  if (!entry) return '<div class="empty"><h2>No word found</h2><p>This word has not been linked to a dictionary entry yet.</p></div>';
  const children = [...entries.values()].filter(e => e.rootId === id && e.id !== id);
  const root = entry.root && entry.root !== entry.word ? `<div class="form-item"><span>Root</span>${entry.rootId ? `<a class="root-link" href="dictionary?card=${encodeURIComponent(cardUrlReference(entries.get(entry.rootId)))}" data-entry="${esc(entry.rootId)}">${esc(entry.root)} ↗</a>` : esc(entry.root)}</div>` : '';
  const sequence = entryContext?.ids || [];
  const position = sequence.indexOf(id);
  const previous = position > 0 ? sequence[position - 1] : '';
  const next = position >= 0 && position < sequence.length - 1 ? sequence[position + 1] : '';
  const showSequenceNav = entryContext && (entryContext.type !== 'study' || browseMode);
  const nav = showSequenceNav ? `<button class="icon-button" data-entry-nav="${esc(next)}" aria-label="Next word" title="Next word" ${next ? '' : 'disabled'}>${svgIcon('next')}</button><button class="icon-button" data-entry-nav="${esc(previous)}" aria-label="Previous word" title="Previous word" ${previous ? '' : 'disabled'}>${svgIcon('prev')}</button>` : '';
  const close = inDialog ? entryContext?.type === 'study' ? '<button class="icon-button card-close" data-study-browse-close aria-label="Close card" title="Close card">' + svgIcon('close') + '</button>' : '<button id="close-dialog" class="icon-button card-close" aria-label="Close dictionary card" title="Close">' + svgIcon('close') + '</button>' : '';
  const controls = `<div class="card-actions" dir="rtl">${close}${heart(id)}${nav}<button class="copy-card icon-button" data-copy-card="${esc(id)}" aria-label="Copy Urdu markdown" title="Copy Urdu markdown">${svgIcon('copy')}</button></div>`;
  return `<article class="entry-card"><header class="entry-header"><div class="entry-heading"><h2 dir="rtl" lang="ar">${esc(entry.word)}</h2><small>${esc(entry.id)}</small></div>${children.length ? '<span class="badge">ROOT</span>' : ''}${controls}</header><div class="entry-body"><div class="forms" dir="rtl">${root}${entry.nouns ? `<div class="form-item"><span>Nouns</span>${esc(entry.nouns)}</div>` : ''}${entry.verbs ? `<div class="form-item"><span>Verbs</span>${esc(entry.verbs.split('|')[0].trim())}</div>` : ''}</div>${entry.markdown_ur ? `<div class="urdu" lang="ur" dir="rtl">${markdown(entry.markdown_ur)}</div>` : '<p class="muted">An Urdu explanation is not available for this entry yet.</p>'}${children.length ? `<p class="muted">Words from this root</p><div class="related">${children.map(e => `<button class="word-chip" data-entry="${esc(e.id)}">${esc(e.word)}</button>`).join('')}</div>` : ''}</div></article>`;
}
function openEntry(id, updateLocation = readLocation().page === 'dictionary') {
  const page = readLocation().page;
  if (page === 'read') {
    const ids = currentWords.map(word => word.entryId).filter(entryId => entries.has(entryId));
    entryContext = {type:'read', ids, reference:currentRef};
    writeVerseLocation(currentRef, {card:cardUrlReference(entries.get(id))});
  } else if (page === 'dictionary') {
    entryContext = {type:'dictionary', ids:[...entries.keys()]};
    if (updateLocation) writeDictionaryLocation({card:cardUrlReference(entries.get(id))});
  } else entryContext = null;
  dialogId = id; $('#dialog-card').innerHTML = entryCard(id, true);
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
  $('#detail-dialog').scrollTop = 0;
}
function closeEntryDialog() {
  if ($('#detail-dialog').open) $('#detail-dialog').close();
  dialogId = null;
  const state = readLocation();
  if (state.page === 'dictionary' && state.params.has('card')) writeDictionaryLocation({letter:alphabet.find(([id]) => id === selectedLetter)?.[1] || ''});
  else if (state.page === 'read' && state.params.has('card')) writeVerseLocation(currentRef);
}
function refreshHearts() {
  for (const button of document.querySelectorAll('[data-heart]')) {
    const saved = cloud.authorized && cloud.deck[button.dataset.heart] && !cloud.deck[button.dataset.heart].deleted;
    button.classList.toggle('saved', !!saved); button.innerHTML = svgIcon('heart', saved);
    button.setAttribute('aria-pressed', !!saved); button.setAttribute('aria-label', `${saved ? 'Remove from' : 'Add to'} flashcards`);
  }
}
function toggleCard(id) {
  if (!cloud.authorized) {notice('Sign in with Google to save words to your flashcards.'); return;}
  const old = cloud.deck[id]; const now = Math.max(Date.now(), (old?.updatedAt || 0) + 1);
  if (old && !old.deleted) cloud.mutate(id, {...old, deleted:true, updatedAt:now});
  else cloud.mutate(id, {due:now, updatedAt:now, interval:0, ease:2.5, reviews:0, lapses:0, deleted:false});
  const general = cloud.studies.General || {name:'General',cards:[],progress:{},updatedAt:0,deleted:false,permanent:true};
  const cards = new Set(general.cards || []);
  if (old && !old.deleted) cards.delete(id); else cards.add(id);
  cloud.mutateStudy('General', {...general, cards:[...cards], updatedAt:Math.max(Date.now(), general.updatedAt + 1), deleted:false, permanent:true});
}

async function loadVerse(input) {
  let reference;
  try {reference = parseReference(input, manifest.surahs);} catch (error) {notice(error.message); return;}
  const ticket = ++requestId;
  $('#go').disabled = true; $('#verse-status').textContent = 'Loading verse…';
  try {
    const [surah, ayah] = reference.split(':').map(Number);
    const cached = readLocal('qw.lastVerse', null);
    const [mapping, result] = await Promise.all([
      surahCache.has(surah) ? surahCache.get(surah) : json(`./data/verses/${surah}.json`).then(data => {surahCache.set(surah, data); return data;}),
      json(`https://api.alquran.cloud/v1/ayah/${reference}/quran-uthmani`).catch(error => {
        if (cached?.reference === reference && cached?.data?.text) return {code:200, data:cached.data, cached:true};
        throw error;
      })
    ]);
    if (ticket !== requestId) return;
    if (result.code !== 200 || typeof result.data?.text !== 'string') throw new Error('The Quran API did not return this verse. Please try again.');
    const source = mapping.find(a => a.no === ayah)?.words || [];
    const aligned = alignWords(result.data.text, source, reference);
    currentRef = reference; currentWords = aligned.words;
    cloud?.setLastVerse(reference);
    if (readLocation().page === 'read') {const state=readLocation(); writeVerseLocation(reference, state.reference === reference && state.params.has('card') ? {card:state.params.get('card')} : {}, state.reference === reference);}
    $('#reference').value = reference;
    $('#verse-label').textContent = `${result.data.surah?.englishName || 'Surah ' + surah} · ${reference}`;
    $('#verse-status').textContent = [result.cached ? 'Showing your last cached verse; the Quran API is unavailable.' : '', !aligned.aligned ? 'Some words could not be aligned with the dictionary’s word list.' : ''].filter(Boolean).join(' ');
    $('#verse-words').innerHTML = currentWords.map((w, i) => `<button class="verse-word ${entries.has(w.entryId) ? '' : 'unmapped'}" data-word="${i}" aria-label="Look up ${esc(w.arabic)}">${esc(w.arabic)}</button>`).join('');
    storeLocal('qw.lastVerse', {reference, data:result.data});
    readerId = null;
    const cardRef = readLocation().page === 'read' ? readLocation().params.get('card') : null;
    if (cardRef) {
      const cardId = findEntryReference(cardRef);
      if (cardId) {entryContext={type:'read',ids:currentWords.map(word=>word.entryId).filter(id=>entries.has(id)),reference}; dialogId=cardId; $('#dialog-card').innerHTML=entryCard(cardId,true); if(!$('#detail-dialog').open) $('#detail-dialog').showModal();}
    }
  } catch (error) {if (ticket === requestId) $('#verse-status').textContent = `${error.message} Check your connection and try Go again.`;}
  finally {if (ticket === requestId) $('#go').disabled = false;}
}
function adjacentVerse(direction) {
  let [s, a] = currentRef.split(':').map(Number); a += direction;
  if (a < 1) {if (s === 1) return; s--; a = manifest.surahs[s];}
  if (a > manifest.surahs[s]) {if (s === 114) return; s++; a = 1;}
  void loadVerse(`${s}:${a}`);
}

function renderToc() {
  $('#alphabet').innerHTML = alphabet.map(([id, label]) => `<button data-letter="${id}" class="${selectedLetter === id ? 'active' : ''}" aria-pressed="${selectedLetter === id}">${label}</button>`).join('');
  const matches = searchToc(toc, tocQuery);
  const activeMatch = matches[tocMatchIndex];
  const byWord = new Map();
  matches.forEach((match, matchIndex) => {
    const key = `${match.letter}:${match.familyIndex}:${match.wordIndex}`;
    if (!byWord.has(key)) byWord.set(key, []);
    byWord.get(key).push({...match, matchIndex});
  });
  const highlight = (word, letter, familyIndex, wordIndex) => {
    const found = byWord.get(`${letter}:${familyIndex}:${wordIndex}`) || [];
    if (!found.length) return esc(word);
    let offset = 0;
    const parts = found.map(match => {
      const before = esc(word.slice(offset, match.start));
      const text = esc(word.slice(match.start, match.end));
      offset = match.end;
      return `${before}<mark class="toc-match ${match.matchIndex === tocMatchIndex ? 'active' : ''}" data-toc-match="${match.matchIndex}">${text}</mark>`;
    });
    parts.push(esc(word.slice(offset)));
    return parts.join('');
  };
  const html = [];
  for (const [letter, label] of alphabet) {
    if (!tocQuery && selectedLetter !== letter) continue;
    const families = toc[letter] || [];
    if (!families.length) continue;
    const filtered = tocQuery ? families.map((item, familyIndex) => ({item, familyIndex})).filter(({familyIndex}) => matches.some(match => match.letter === letter && match.familyIndex === familyIndex)) : families.map((item, familyIndex) => ({item, familyIndex}));
    if (!filtered.length) continue;
    html.push(`<section class="toc-group"><h2 class="toc-letter">${label}</h2><div class="toc-items">${filtered.map(({item, familyIndex}) => `<div class="toc-family ${(item.children?.length || item.word.includes('/')) ? 'root-family' : ''}" data-toc-id="${esc(item.id)}" data-toc-word="${esc(item.word)}">${entries.has(item.id) ? `<button data-entry="${esc(item.id)}">${highlight(item.word, letter, familyIndex, 0)}</button>` : `<button class="toc-root-label" data-entry="${esc(item.children?.[0]?.id || '')}">${highlight(item.word, letter, familyIndex, 0)}</button>`}${(item.children || []).map((e, index) => `<button data-entry="${esc(e.id)}">${highlight(e.word, letter, familyIndex, index + 1)}</button>`).join('')}</div>`).join('')}</div></section>`);
  }
  $('#toc').innerHTML = html.join('') || `<div class="empty">${tocQuery ? 'No matching dictionary entries.' : 'No dictionary entries for this letter.'}</div>`;
  $('#toc-search-status').textContent = matches.length ? `${tocMatchIndex + 1} / ${matches.length}` : tocQuery ? 'No matches' : '0 / 0';
  $('#toc-prev').disabled = !matches.length;
  $('#toc-next').disabled = !matches.length;
  if (activeMatch) requestAnimationFrame(() => document.querySelector(`[data-toc-match="${tocMatchIndex}"]`)?.scrollIntoView({block:'center', behavior:'smooth'}));
}
function renderTocKeyboard() {
  const container = $('#toc-keyboard-layout');
  const rows = ['1234567890-=', 'qwertyuiop[]', 'asdfghjkl;\'', 'zxcvbnm,./'];
  container.innerHTML = `<div class="toc-keyboard-heading"><strong>Arabic keyboard layout</strong><span>Auto converts the physical keys below. Shift shows the shifted mapping; AltGr mappings appear under the relevant key.</span></div>${rows.map(row => `<div class="toc-keyboard-row">${[...row].map(key => {
    const output = keyboardMap[key] || key;
    const shifted = keyboardMap[key.toUpperCase()] || output;
    const altGr = altGrMap[key];
    return `<div class="toc-key"><small>${esc(key)}</small><b lang="ar" dir="rtl">${esc(output)}</b>${shifted !== output ? `<em>⇧ ${esc(shifted)}</em>` : ''}${altGr ? `<em>AltGr ${esc(altGr)}</em>` : ''}</div>`;
  }).join('')}</div>`).join('')}<p class="toc-keyboard-note">Punctuation and vowel marks follow the Buckwalter keyboard mapping.</p>`;
}
function moveTocMatch(direction) {
  const matches = searchToc(toc, tocQuery);
  if (!matches.length) return;
  tocMatchIndex = (tocMatchIndex + direction + matches.length) % matches.length;
  renderToc();
}
function handleTocKeyDown(event) {
  if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return;
  if (event.key === 'Enter') { event.preventDefault(); moveTocMatch(event.shiftKey ? -1 : 1); return; }
  if (tocInputMode !== 'auto' || event.metaKey) return;
  const altGr = event.getModifierState?.('AltGraph') || (event.ctrlKey && event.altKey);
  if ((event.ctrlKey || event.altKey) && !altGr) return;
  const replacement = (altGr ? altGrMap : keyboardMap)[event.key];
  if (replacement === undefined) return;
  event.preventDefault();
  const input = event.currentTarget, start = input.selectionStart, end = input.selectionEnd;
  tocQuery = input.value.slice(0, start) + replacement + input.value.slice(end); tocMatchIndex = 0;
  input.value = tocQuery; renderToc(); input.setSelectionRange(start + replacement.length, start + replacement.length);
}
function handleTocBeforeInput(event) {
  const text = event.data;
  if (tocInputMode !== 'auto' || !text || event.inputType !== 'insertText' || event.isComposing) return;
  const converted = [...text].map(character => keyboardMap[character] ?? character).join('');
  if (converted === text) return;
  event.preventDefault();
  const input = event.currentTarget;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  tocQuery = input.value.slice(0, start) + converted + input.value.slice(end);
  tocMatchIndex = 0;
  input.value = tocQuery;
  renderToc();
  requestAnimationFrame(() => input.setSelectionRange(start + converted.length, start + converted.length));
}
function savedCards() { return Object.entries(cloud.deck).filter(([id, card]) => !card.deleted && entries.has(id)).sort((a, b) => a[1].due - b[1].due); }
function ensureGeneralStudy() {
  // Wait until the first sync has loaded the remote studies, otherwise an empty
  // local view could overwrite the cloud General study with a newer updatedAt.
  if (!cloud?.authorized || !cloud.synced) return;
  const old = cloud.studies.General;
  const cards = savedCards().map(([id]) => id);
  if (old && !old.deleted && cards.every(id => (old.cards || []).includes(id)) && (old.cards || []).every(id => cards.includes(id))) return;
  cloud.mutateStudy('General', {name:'General', cards, progress:old?.progress || {}, updatedAt:Math.max(Date.now(), (old?.updatedAt || 0) + 1), deleted:false, permanent:true});
}
function duration(card, grade) {
  const next = schedule(card, grade); return next.interval < 1 ? '10 minutes' : `${Math.round(next.interval)} ${Math.round(next.interval) === 1 ? 'day' : 'days'}`;
}
function timeAgo(timestamp) {
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
  if (days === 0) return 'Asked today';
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
function studyStats(study) {
  const cards = (study.cards || []).filter(id => entries.has(id));
  const progress = study.progress || {};
  const now = Date.now(), studiedCount = cards.filter(id => (progress[id]?.reviews || 0) > 0).length;
  const due = cards.filter(id => (progress[id]?.due || 0) <= now);
  return {cards, studiedCount, due};
}
function parseStudyRange(input) {
  const value = input.trim();
  let match = value.match(/^(\d{1,3})$/);
  if (match) {const surah = Number(match[1]); if (!manifest.surahs[surah]) throw new Error('Enter a Surah number from 1 to 114.'); return {start:[surah,1], end:[surah,manifest.surahs[surah]], name:String(surah)};}
  match = value.match(/^(\d{1,3})\s*-\s*(\d{1,3})$/);
  if (match) {
    const [,first,last] = match.map(Number);
    if (!manifest.surahs[first] || !manifest.surahs[last]) throw new Error('Enter Surah numbers from 1 to 114.');
    if (first > last) throw new Error('The range must start before it ends.');
    return {start:[first,1], end:[last,manifest.surahs[last]], name:`${first}-${last}`};
  }
  match = value.match(/^(\d{1,3})\s*:\s*(\d{1,3})\s*(?:-|–|—)\s*(?:(\d{1,3})\s*:\s*)?(\d{1,3})$/);
  if (!match) throw new Error('Use a range like 1:1-3:73 or 23-25, or enter one Surah number such as 23.');
  const [,ss,aa,es,ea] = match;
  const start = [Number(ss),Number(aa)], end = [Number(es || ss),Number(ea)];
  if (!manifest.surahs[start[0]] || start[1] < 1 || start[1] > manifest.surahs[start[0]] || !manifest.surahs[end[0]] || end[1] < 1 || end[1] > manifest.surahs[end[0]]) throw new Error('That study range contains a verse that does not exist.');
  if (start[0] > end[0] || (start[0] === end[0] && start[1] > end[1])) throw new Error('The range must start before it ends.');
  return {start,end,name:`${start[0]}-${start[1]}:${end[0]}:${end[1]}`};
}
async function createStudy(input, onlyNew = false) {
  if (studyBusy) return;
  const range = parseStudyRange(input), started = Date.now();
  studyBusy = true;
  $('#study-area').innerHTML = `<div class="empty" role="status"><span class="empty-symbol">◌</span><h2>Building ${esc(range.name)}</h2><p id="study-progress">${onlyNew ? 'Checking earlier verses for first occurrences…' : 'Preparing verse mappings…'}</p></div>`;
  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  try {
    if (!qwords) qwords = await json('./data/study-index.json');
    const ids = new Set(), seen = new Set(); let inspected = 0;
    const beforeStart = ([s,a]) => s < range.start[0] || (s === range.start[0] && a < range.start[1]);
    const inRange = ([s,a]) => (s > range.start[0] || (s === range.start[0] && a >= range.start[1])) && (s < range.end[0] || (s === range.end[0] && a <= range.end[1]));
    for (const surah of qwords) {
      if (surah.surah_no > range.end[0] || (!onlyNew && surah.surah_no < range.start[0])) continue;
      for (const ayah of surah.ayahs) {
        const reference = [surah.surah_no,ayah.no], prior = beforeStart(reference);
        if (onlyNew && !prior && !inRange(reference)) continue;
        if (!onlyNew && !inRange(reference)) continue;
        for (const entryId of ayah.entries || []) {
          const entry = entries.get(entryId);
          if (prior) seen.add(entryId);
          else if (entry && (entry.nouns?.trim() || entry.verbs?.trim()) && (!onlyNew || !seen.has(entryId))) ids.add(entry.id);
          if (!prior) seen.add(entryId);
        }
        inspected++;
        if (inspected % 80 === 0) {
          const status = $('#study-progress'); if (status) status.textContent = `${inspected} verses checked${onlyNew ? ' · checking first occurrences' : ''} · ${ids.size} cards found…`;
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
    }
    const study = {name:range.name,start:`${range.start[0]}:${range.start[1]}`,end:`${range.end[0]}:${range.end[1]}`,onlyNew,cards:[...ids],updatedAt:Math.max(Date.now(),started+1),deleted:false};
    cloud.mutateStudy(range.name, study); studyId = range.name;
  } finally {studyBusy = false; renderStudy();}
}
async function recoverStudyCards(id, study) {
  const valid = (study.cards || []).filter(cardId => entries.has(cardId));
  if (valid.length) return valid;
  if (!qwords) qwords = await json('./data/study-index.json');
  const numeric = Number(study.name) || Number(id);
  const start = study.start?.split(':').map(Number) || (Number.isInteger(numeric) && manifest.surahs[numeric] ? [numeric,1] : null);
  const end = study.end?.split(':').map(Number) || (start && Number.isInteger(numeric) && manifest.surahs[numeric] ? [numeric,manifest.surahs[numeric]] : start);
  if (!start || !end) return valid;
  const before = ([s,a]) => s < start[0] || (s === start[0] && a < start[1]);
  const after = ([s,a]) => s > end[0] || (s === end[0] && a > end[1]);
  const ids = new Set();
  for (const surah of qwords) {
    if (surah.surah_no < start[0] || surah.surah_no > end[0]) continue;
    for (const ayah of surah.ayahs) {
      const reference = [surah.surah_no, ayah.no];
      if (before(reference) || after(reference)) continue;
      for (const cardId of ayah.entries || []) {
        const entry = entries.get(cardId);
        if (entry && (entry.nouns?.trim() || entry.verbs?.trim())) ids.add(cardId);
      }
    }
  }
  const cards = [...ids];
  if (cards.length) cloud.mutateStudy(id, {...study, cards, updatedAt:Math.max(Date.now(), (study.updatedAt || 0) + 1)});
  return cards;
}
function renderStudy() {
  if (studyBusy) return;
  // While sign-in is in progress (popup open, redirect returning or Firebase
  // auth still connecting) the Study page shows loading bars instead of data.
  if (firebase && cloud.mode !== 'firebase' && (firebase.busy || !firebase.ready)) {
    if ($('#study-dialog').open) $('#study-dialog').close();
    $('#study-area').innerHTML = `<div class="empty" role="status"><span class="empty-symbol">◌</span><h2>${firebase.busy ? 'Signing in…' : 'Connecting…'}</h2><div class="study-loading" aria-hidden="true"><span class="study-loading-bar" style="width:62%"></span><span class="study-loading-bar" style="width:86%"></span><span class="study-loading-bar" style="width:48%"></span><span class="study-loading-bar" style="width:74%"></span></div></div>`;
    return;
  }
  if (!cloud.authorized) {$('#study-area').innerHTML = ''; return;}
  ensureGeneralStudy();
  const studies = Object.entries(cloud.studies || {}).filter(([, study]) => !study.deleted).sort((a,b) => a[0] === 'General' ? -1 : b[0] === 'General' ? 1 : a[0].localeCompare(b[0]));
  const active = studyId ? studies.find(([id]) => id === studyId || id === (studies.find(([,item]) => item.name === studyId)?.[0])) : null;
  if (!active) {
    const list = studies.length ? `<div class="study-list">${studies.map(([id, study]) => {const stats=studyStats(study);return `<article class="study-item"><button class="study-open" data-study="${esc(id)}"><strong>${esc(study.name)}</strong><small>${stats.studiedCount} / ${stats.cards.length} studied · ${stats.due.length} due</small></button><button class="icon-button book-icon" data-browse-study="${esc(id)}" aria-label="Browse ${esc(study.name)} cards" title="Browse cards">▤</button>${id !== 'General' ? `<button class="icon-button" data-delete-study="${esc(id)}" aria-label="Delete ${esc(study.name)}" title="Delete study">×</button>` : ''}</article>`;}).join('')}</div>` : '';
    const localNote = cloud.mode === 'local' ? `<p class="local-note">Cards and studies are saved on this device only. <button type="button" class="text-button" data-signin>Sign in to sync</button></p>` : '';
    $('#study-area').innerHTML = `${localNote}<form id="create-study" class="study-create"><label for="study-range">Create a study</label><div><input id="study-range" placeholder="1:1-3:73, 23 or 23-25" required autocomplete="off"><button class="button" type="submit">Create study</button></div><label class="study-checkbox"><input id="only-new-words" type="checkbox"> Only new words</label><p class="muted">Use a verse range such as 1:1-3:73, a Surah number such as 23 for the whole Surah, or a Surah range such as 23-25.</p></form>${list}`;
    return;
  }
  const [id, selected] = active;
  const stats = studyStats(selected), cards = stats.cards;
  if (!studyCardId || !cards.includes(studyCardId)) studyCardId = stats.due[0] || cards[0] || null;
  if (!studyCardId) {$('#study-area').innerHTML = `<div class="empty"><span class="empty-symbol">✓</span><h2>${stats.studiedCount} / ${cards.length} cards studied</h2><p>This study has no cards yet.</p><button class="button secondary" data-studies>← All studies</button></div>`; return;}
  const entry = entries.get(studyCardId);
  entryContext = {type:'study', ids:cards};
  const progress = selected.progress?.[studyCardId] || {due:0,interval:0,ease:2.5,reviews:0,lapses:0,updatedAt:0};
  // Cards shown before report how long ago they were asked; brand-new cards do not.
  const askedAgo = progress.reviews > 0 && progress.updatedAt ? ` · ${esc(timeAgo(progress.updatedAt))}` : '';
  const actions = browseMode ? '' : revealed ? `<div class="ratings">${[['failed','Again'],['difficult','Hard'],['medium','Medium'],['easy','Easy']].map(([grade,label]) => `<button class="rating ${grade}" data-study-grade="${grade}">${grade === 'failed' ? 'Again' : label}<small>${grade === 'failed' ? 'in 10m' : duration(progress, grade)}</small></button>`).join('')}</div>` : '';
  const revealAttrs = !browseMode && !revealed ? 'class="study-modal-card study-click-to-reveal" role="button" tabindex="0" aria-label="Reveal meaning"' : 'class="study-modal-card"';
  $('#study-dialog-content').innerHTML = `<div class="study-modal-top"><span>${esc(selected.name)} · ${stats.studiedCount} / ${cards.length} studied · ${stats.due.length} due${askedAgo}</span><button class="icon-button" data-studies aria-label="Close study" title="Close">×</button></div><div ${revealAttrs}>${revealed ? entryCard(studyCardId) : `<div class="study-front"><div class="study-word" dir="rtl" lang="ar">${esc(entry.word)}</div></div>`}</div>${actions ? `<div class="study-modal-actions">${actions}</div>` : ''}`;
  if (!$('#study-dialog').open) $('#study-dialog').showModal();
}
function renderAuth() {
  if (!cloud) return;
  const connecting = !!firebase?.busy;
  $('#account').textContent = cloud.mode === 'firebase' && cloud.authorized ? `${cloud.user.name} · Sign out` : connecting ? 'Connecting…' : 'Sign in with Gmail';
  $('#account').disabled = connecting;
  renderStudy(); refreshHearts();
}
// Sign in from either the account button or the local-mode banner; anonymous
// cards/studies travel along as the seed for the first Firebase sync.
async function beginSignIn() {
  if (!firebase || firebase.busy) return;
  await firebase.signIn({deck:{...cloud.deck}, studies:{...cloud.studies}});
  if (firebase.authorized) {
    cloud = firebase;
    renderAuth();
    const localReference = readLocal('qw.lastVerse', null)?.reference;
    let reference = firebase.lastVerse || localReference || '1:1';
    try {reference = parseReference(reference, manifest.surahs);} catch {reference = '1:1';}
    await loadVerse(reference);
  }
}
function route({skipVerseLoad = false} = {}) {
  const state = readLocation();
  const page = state.page;
  const valid = ['read','dictionary','study','privacy'].includes(page) ? page : 'read';
  for (const section of document.querySelectorAll('.page')) section.hidden = section.id !== valid;
  for (const link of document.querySelectorAll('nav a')) {
    link.classList.toggle('active', link.dataset.page === valid);
    if (link.dataset.page === valid) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
  }
  if (valid !== 'study') {studyId=null; studyCardId=null; revealed=false; if ($('#study-dialog').open) $('#study-dialog').close();}
  if (valid === 'study' && !state.study && $('#study-dialog').open) $('#study-dialog').close();
  if (valid !== 'dictionary' && valid !== 'read' && $('#detail-dialog').open) $('#detail-dialog').close();
  if (valid === 'dictionary') {
    const cardRef = state.params.get('card');
    const letterRef = state.params.get('letter') || state.bare;
    const cardId = cardRef ? findEntryReference(cardRef) : null;
    const letter = findLetterId(letterRef) || (cardId ? findLetterId(cardId.split('-')[0]) : null);
    if (letter) selectedLetter = letter;
    if (tocQuery) {tocQuery = ''; $('#toc-search').value = ''; tocMatchIndex = 0;}
    renderToc();
    if (cardRef) {
      if (cardId) openEntry(cardId, false);
      else if ($('#detail-dialog').open) $('#detail-dialog').close();
    } else {
      if ($('#detail-dialog').open) $('#detail-dialog').close();
    }
  }
  if (valid === 'read') {
    const reference = state.reference;
    if (reference && !skipVerseLoad && manifest) {
      try {const parsed = parseReference(reference, manifest.surahs); if (parsed !== currentRef) void loadVerse(parsed);}
      catch (error) {notice(error.message);}
    } else if (!reference && !skipVerseLoad && currentRef) writeVerseLocation(currentRef);
    const cardRef = state.params.get('card');
    if (!cardRef && $('#detail-dialog').open) $('#detail-dialog').close();
    else if (cardRef && currentWords.length && (!state.reference || state.reference === currentRef)) {
      const cardId = findEntryReference(cardRef);
      if (cardId) {entryContext={type:'read',ids:currentWords.map(word=>word.entryId).filter(id=>entries.has(id)),reference:currentRef}; dialogId=cardId; $('#dialog-card').innerHTML=entryCard(cardId,true); if(!$('#detail-dialog').open) $('#detail-dialog').showModal();}
    }
  }
  if (valid === 'study') {
    if (state.study) {
      const studies = Object.entries(cloud?.studies || {});
      studyId = studies.find(([id, item]) => id === state.study || item.name === state.study)?.[0] || state.study;
      const selected = cloud?.studies?.[studyId];
      if (selected) {const cards=(selected.cards || []).filter(id=>entries.has(id)); studyCardId=cards.find(id=>(selected.progress?.[id]?.due || 0)<=Date.now()) || cards[0] || null; revealed = false; browseMode=false;}
    } else {studyId=null; studyCardId=null; browseMode=false;}
    renderAuth();
  }
}

async function start() {
  try {
    const [data, index, meta, settings] = await Promise.all([json('./data/entries.json'), json('./data/toc.json'), json('./data/manifest.json'), json('./config.json')]);
    entries = new Map(data.map(e => [e.id, e])); toc = index; manifest = meta; config = settings;
    // Study and cards work without an account; Firebase is adopted only when a
    // session already exists or after the user signs in.
    cloud = new LocalCards({onChange:renderAuth});
    firebase ??= new FirebaseCards({config:config.firebase, onChange:renderAuth});
    void firebase.authReady.then(() => {
      if (firebase.authorized) {cloud = firebase; renderAuth();}
    });
    $('#dictionary-count').textContent = `${entries.size.toLocaleString()} entries, grouped by Arabic letter and root. Select any word to explore.`;
    $('#app-version').textContent = config.version ? `v${config.version}` : '';
    $('#startup').hidden = true; renderAuth(); route({skipVerseLoad:true});
    const state = readLocation();
    const requested = state.page === 'read' ? state.reference : null;
    const last = readLocal('qw.lastVerse', null);
    let initialReference = requested || last?.reference || '1:1';
    try {initialReference = parseReference(initialReference, manifest.surahs);} catch {initialReference = '1:1';}
    await loadVerse(initialReference);
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('./sw.js').catch(() => {});
  } catch (error) {
    $('#startup').innerHTML = `<h2>The dictionary could not load.</h2><p>${esc(error.message)}</p><button class="button" id="retry-start">Try again</button>`;
  }
}

document.addEventListener('click', async event => {
  const verseLink = event.target.closest('a[data-verse]');
  if (verseLink && manifest) {
    event.preventDefault();
    if ($('#detail-dialog').open) $('#detail-dialog').close();
    writeVerseLocation(verseLink.dataset.verse);
    route({skipVerseLoad:true});
    $('#reference').value = verseLink.dataset.verse;
    void loadVerse(verseLink.dataset.verse);
    $('#verse-form').scrollIntoView({behavior:'smooth', block:'start'});
    return;
  }
  const rootLink = event.target.closest('a.root-link[data-entry]');
  if (rootLink) { event.preventDefault(); openEntry(rootLink.dataset.entry, readLocation().page === 'dictionary'); return; }
  const routeLink = event.target.closest('a[data-page], a.brand, footer a[href="privacy"]');
  if (routeLink) {
    event.preventDefault();
    const target = routeLink.dataset.page === 'dictionary' ? '/dictionary' : routeLink.dataset.page === 'study' ? '/study' : routeLink.dataset.page === 'read' || routeLink.classList.contains('brand') ? `/q/${currentRef.replace(':','/')}` : '/privacy';
    writeLocation(target); route(); return;
  }
  const button = event.target.closest('button');
  if (!button) return;
  if (button.id === 'toc-info') {
    const dialog = $('#keyboard-layout-dialog');
    if (!dialog.open) dialog.showModal();
    if (!$('#toc-keyboard-layout').hasChildNodes()) renderTocKeyboard();
    button.setAttribute('aria-expanded', 'true');
    return;
  }
  if (button.id === 'close-keyboard-layout') {
    $('#keyboard-layout-dialog').close();
    $('#toc-info').setAttribute('aria-expanded', 'false');
    return;
  }
  if (button.id === 'toc-mode-switch') {
    tocInputMode = tocInputMode === 'auto' ? 'sys' : 'auto';
    button.setAttribute('aria-checked', String(tocInputMode === 'sys'));
    $('#toc-mode-auto').classList.toggle('active', tocInputMode === 'auto');
    $('#toc-mode-sys').classList.toggle('active', tocInputMode === 'sys');
    return;
  }
  if (button.dataset.tocMode) {
    tocInputMode = button.dataset.tocMode;
    document.querySelectorAll('[data-toc-mode]').forEach(mode => mode.setAttribute('aria-pressed', String(mode.dataset.tocMode === tocInputMode)));
    $('#toc-search').focus();
    return;
  }
  if (button.id === 'toc-prev') {moveTocMatch(-1); return;}
  if (button.id === 'toc-next') {moveTocMatch(1); return;}
  if (button.id === 'retry-start') {void start(); return;}
  if (!cloud) return;
  try {
    if (button.dataset.copyCard) {
      const entry = entries.get(button.dataset.copyCard);
      if (!entry) return;
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable in this browser.');
      await navigator.clipboard.writeText(entry.markdown_ur || '');
      notice('Urdu Markdown copied.');
    }
    else if (button.dataset.entry) openEntry(button.dataset.entry);
    else if (button.dataset.study || button.dataset.browseStudy) {
      studyId = button.dataset.study || button.dataset.browseStudy;
      const selected=cloud.studies[studyId], cards=selected ? await recoverStudyCards(studyId, selected) : [];
      const validCards=cards.filter(id=>entries.has(id));
      studyCardId = button.dataset.browseStudy ? validCards[0] || null : validCards.find(id=>(selected.progress?.[id]?.due || 0)<=Date.now()) || validCards[0] || null;
      browseMode = !!button.dataset.browseStudy; revealed = browseMode;
      writeLocation(`/study/${encodeURIComponent(studyId)}`); renderStudy();
    }
    else if (button.dataset.openStudyCard) {studyCardId = button.dataset.openStudyCard; revealed = true; browseMode = true; renderStudy();}
    else if (button.dataset.deleteStudy) {
      const id = button.dataset.deleteStudy, old = cloud.studies[id];
      if (old) cloud.mutateStudy(id, {...old, deleted:true, updatedAt:Math.max(Date.now(), old.updatedAt + 1)});
      if (studyId === id) {studyId = null; studyCardId = null;}
    }
    else if (button.hasAttribute('data-studies')) {studyId = null; studyCardId = null; revealed = false; browseMode=false; $('#study-dialog').close(); writeLocation('/study'); renderStudy();}
    else if (button.dataset.entryNav) {
      const target = button.dataset.entryNav;
      if (target && entryContext) {
        if (entryContext.type === 'study') {studyCardId=target; revealed=true; renderStudy();}
        else {openEntry(target, entryContext.type === 'dictionary');}
      }
    }
    else if (button.hasAttribute('data-study-browse-close')) {studyId=null; studyCardId=null; revealed=false; browseMode=false; $('#study-dialog').close(); writeLocation('/study'); renderStudy();}
    else if (button.dataset.cardNav) {studyCardId = button.dataset.cardNav; revealed = true; renderStudy();}
    else if (button.hasAttribute('data-next-study')) {
      const study = cloud.studies[studyId], ids = study?.cards || [];
      const index = ids.indexOf(studyCardId); studyCardId = ids[(index + 1) % ids.length] || null; revealed = false; renderStudy();
    }
    else if (button.dataset.heart) toggleCard(button.dataset.heart);
    else if (button.dataset.word !== undefined) {
      const index = Number(button.dataset.word); readerId = currentWords[index]?.entryId;
      for (const word of document.querySelectorAll('[data-word]')) word.classList.toggle('selected', word === button);
      if (readerId && entries.has(readerId)) openEntry(readerId, false);
    }
    else if (button.hasAttribute('data-signin')) await beginSignIn();
    else if (button.id === 'account') {
      if (cloud.mode === 'firebase' && cloud.authorized) {
        await cloud.signOut();
        cloud = new LocalCards({onChange:renderAuth});
        renderAuth();
      } else await beginSignIn();
    }
    else if (button.dataset.ref) void loadVerse(button.dataset.ref);
    else if (button.id === 'prev-verse') adjacentVerse(-1);
    else if (button.id === 'next-verse') adjacentVerse(1);
    else if (button.dataset.letter !== undefined) {
      selectedLetter = button.dataset.letter; renderToc();
      writeLocation('/dictionary', {letter:alphabet.find(([id]) => id === selectedLetter)?.[1] || selectedLetter});
    }
    else if (button.id === 'reveal') {revealed = true; renderStudy();}
    else if (button.dataset.studyGrade && studyId && studyCardId && revealed) {
      const current = cloud.studies[studyId], progress = {...(current.progress || {})};
      const oldCard = progress[studyCardId] || {due:0,interval:0,ease:2.5,reviews:0,lapses:0,updatedAt:0};
      const nextCard = schedule(oldCard, button.dataset.studyGrade, Math.max(Date.now(), oldCard.updatedAt + 1));
      progress[studyCardId] = nextCard;
      const nextStudy = {...current, progress, updatedAt:Math.max(Date.now(), current.updatedAt + 1)};
      const cards = (current.cards || []).filter(entryId => entries.has(entryId));
      const index = cards.indexOf(studyCardId), nextDue = cards.filter(entryId => (progress[entryId]?.due || 0) <= Date.now());
      studyCardId = nextDue[0] || cards[(index + 1) % cards.length] || null; revealed = false;
      cloud.mutateStudy(studyId, nextStudy);
    }
    else if (button.dataset.grade && studyId && revealed && !cloud.studies?.[studyId]) {
      const id = studyId; const next = schedule(cloud.deck[id], button.dataset.grade, Math.max(Date.now(), cloud.deck[id].updatedAt + 1));
      studyId = null; revealed = false; studied++; cloud.mutate(id, next);
    }
    else if (button.id === 'close-dialog') closeEntryDialog();
    else if (button.id === 'clear-local') {
      if (firebase?.busy) {notice('Wait for the current sync to finish before clearing local data.'); return;}
      if (cloud.mode === 'firebase') {await cloud.signOut(); cloud = new LocalCards({onChange:renderAuth});}
      else await cloud.signOut();
      for (const key of Object.keys(localStorage)) if (/^qw\.(deck|firebase)\./.test(key) || key === 'qw.local') localStorage.removeItem(key);
      notice('Local card data cleared. Firebase data is unchanged.');
      renderAuth();
    }
  } catch (error) {notice(error.message);}
});
$('#study-area').addEventListener('submit', event => {
  if (event.target.id !== 'create-study') return;
  event.preventDefault();
  void createStudy($('#study-range').value, $('#only-new-words').checked).catch(error => {studyBusy = false; notice(error.message); renderStudy();});
});
$('#verse-form').addEventListener('submit', event => {event.preventDefault(); if (manifest) void loadVerse($('#reference').value);});
$('#toc-search').addEventListener('input', event => {tocQuery = event.target.value; tocMatchIndex = 0; renderToc();});
$('#toc-search').addEventListener('keydown', handleTocKeyDown);
$('#toc-search').addEventListener('beforeinput', handleTocBeforeInput);
$('#detail-dialog').addEventListener('click', event => {if (event.target === $('#detail-dialog')) {const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeEntryDialog();}});
$('#detail-dialog').addEventListener('close', () => {
  const state = readLocation();
  if (state.page === 'dictionary' && state.params.has('card')) writeDictionaryLocation({letter:alphabet.find(([id]) => id === selectedLetter)?.[1] || ''});
  dialogId = null;
});
$('#study-dialog').addEventListener('click', event => {
  if (event.target.closest('.study-click-to-reveal') && !revealed && !browseMode) {revealed=true; renderStudy(); return;}
  if (event.target === $('#study-dialog')) $('#study-dialog').close();
});
$('#study-dialog').addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.study-click-to-reveal') && !revealed && !browseMode) {event.preventDefault(); revealed=true; renderStudy();}
});
$('#study-dialog').addEventListener('close', () => {studyCardId = null; revealed = false; browseMode=false; renderStudy();});
$('#keyboard-layout-dialog').addEventListener('click', event => {if (event.target === $('#keyboard-layout-dialog')) {$('#keyboard-layout-dialog').close(); $('#toc-info').setAttribute('aria-expanded', 'false');}});
$('#keyboard-layout-dialog').addEventListener('close', () => $('#toc-info').setAttribute('aria-expanded', 'false'));
window.addEventListener('popstate', () => {if (manifest) route();});
window.addEventListener('online', () => {if (cloud?.authorized) void cloud.sync();});
window.addEventListener('focus', () => {if (cloud) renderAuth();});
setInterval(() => {if (cloud) renderAuth();}, 60000);
void start();

