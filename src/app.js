import {escapeHtml as esc, parseUrdu} from './markup.js';
import {alphabet, normalize, searchToc, keyboardMap, altGrMap, parseReference, verseReferences, alignWords, schedule} from './core.js';
import {DriveCards} from './drive.js';

const $ = selector => document.querySelector(selector);
let entries = new Map(), toc = {}, manifest, config, cloud;
let currentRef = '1:1', currentWords = [], readerId = null, dialogId = null, requestId = 0;
let selectedLetter = 'alif', studyId = null, revealed = false, studied = 0;
let tocQuery = '', tocInputMode = 'auto', tocMatchIndex = 0;
const surahCache = new Map();
let noticeTimer;
function notice(message) {
  $('#notification').textContent = message; $('#notification').hidden = false;
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('#notification').hidden = true; }, 7000);
}
function readLocal(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch {return fallback;} }
function storeLocal(key, value) {try { localStorage.setItem(key, JSON.stringify(value)); } catch {notice('Browser storage is unavailable. Your reading position cannot be remembered.');} }
function readLocation() {
  const hash = location.hash.slice(1);
  const separator = hash.indexOf('?');
  const page = (separator < 0 ? hash : hash.slice(0, separator)) || 'read';
  const raw = separator < 0 ? '' : hash.slice(separator + 1);
  const params = new URLSearchParams(raw);
  const bare = raw && !raw.includes('=') ? params.keys().next().value : null;
  return {page, params, bare};
}
function writeHash(page, values = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  const query = params.toString();
  history.replaceState(history.state, '', `${location.pathname}${location.search}#${page}${query ? `?${query}` : ''}`);
}
function writeDictionaryLocation(values = {}) { writeHash('dictionary', values); }
function writeVerseLocation(reference) { writeHash('read', {verse:reference}); }
function cardUrlReference(entry) { return entry.word.includes('/') ? entry.word.replaceAll('/', '-') : entry.word; }
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
      link.href = '#read'; link.dataset.verse = reference; link.className = 'verse-reference';
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
  return `<button class="heart ${saved ? 'saved' : ''}" data-heart="${esc(id)}" aria-pressed="${!!saved}" aria-label="${saved ? 'Remove from' : 'Add to'} flashcards" title="${saved ? 'Remove from flashcards' : 'Save to flashcards'}">${saved ? '♥' : '♡'}</button>`;
}
function entryCard(id, inDialog = false) {
  const entry = entries.get(id);
  if (!entry) return '<div class="empty"><h2>No word found</h2><p>This word has not been linked to a dictionary entry yet.</p></div>';
  const children = [...entries.values()].filter(e => e.rootId === id && e.id !== id);
  const root = entry.root && entry.root !== entry.word ? `<div class="form-item"><span>Root</span>${entry.rootId ? `<button class="root-link" data-entry="${esc(entry.rootId)}">${esc(entry.root)} ↗</button>` : esc(entry.root)}</div>` : '';
  return `<article class="entry-card"><header class="entry-header"><div class="entry-heading"><h2 dir="rtl" lang="ar">${esc(entry.word)}</h2><small>${esc(entry.id)}</small></div>${children.length ? '<span class="badge">ROOT</span>' : ''}${inDialog ? '<button id="close-dialog" class="icon-button card-close" aria-label="Close dictionary card">×</button>' : ''}${heart(id)}</header><div class="entry-body"><div class="forms" dir="rtl">${root}${entry.nouns ? `<div class="form-item"><span>Nouns</span>${esc(entry.nouns)}</div>` : ''}${entry.verbs ? `<div class="form-item"><span>Verbs</span>${esc(entry.verbs.split('|')[0].trim())}</div>` : ''}</div>${entry.markdown_ur ? `<div class="urdu" lang="ur" dir="rtl">${markdown(entry.markdown_ur)}</div>` : '<p class="muted">An Urdu explanation is not available for this entry yet.</p>'}${children.length ? `<p class="muted">Words from this root</p><div class="related">${children.map(e => `<button class="word-chip" data-entry="${esc(e.id)}">${esc(e.word)}</button>`).join('')}</div>` : ''}</div></article>`;
}
function openEntry(id, updateLocation = readLocation().page === 'dictionary') {
  dialogId = id; $('#dialog-card').innerHTML = entryCard(id, true);
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
  $('#detail-dialog').scrollTop = 0;
  if (updateLocation) writeDictionaryLocation({card:entries.has(id) ? cardUrlReference(entries.get(id)) : id});
}
function closeEntryDialog() {
  if ($('#detail-dialog').open) $('#detail-dialog').close();
  dialogId = null;
  const state = readLocation();
  if (state.page === 'dictionary' && state.params.has('card')) writeDictionaryLocation({letter:alphabet.find(([id]) => id === selectedLetter)?.[1] || ''});
}
function refreshHearts() {
  for (const button of document.querySelectorAll('[data-heart]')) {
    const saved = cloud.authorized && cloud.deck[button.dataset.heart] && !cloud.deck[button.dataset.heart].deleted;
    button.classList.toggle('saved', !!saved); button.textContent = saved ? '♥' : '♡';
    button.setAttribute('aria-pressed', !!saved); button.setAttribute('aria-label', `${saved ? 'Remove from' : 'Add to'} flashcards`);
  }
}
function toggleCard(id) {
  if (!cloud.authorized) {notice('Sign in with Google to save words to your flashcards.'); return;}
  const old = cloud.deck[id]; const now = Math.max(Date.now(), (old?.updatedAt || 0) + 1);
  if (old && !old.deleted) cloud.mutate(id, {...old, deleted:true, updatedAt:now});
  else cloud.mutate(id, {due:now, updatedAt:now, interval:0, ease:2.5, reviews:0, lapses:0, deleted:false});
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
    if (readLocation().page === 'read') writeVerseLocation(reference);
    $('#reference').value = reference;
    $('#verse-label').textContent = `${result.data.surah?.englishName || 'Surah ' + surah} · ${reference}`;
    $('#verse-status').textContent = [result.cached ? 'Showing your last cached verse; the Quran API is unavailable.' : '', !aligned.aligned ? 'Some words could not be aligned with the dictionary’s word list.' : ''].filter(Boolean).join(' ');
    $('#verse-words').innerHTML = currentWords.map((w, i) => `<button class="verse-word ${entries.has(w.entryId) ? '' : 'unmapped'}" data-word="${i}" aria-label="Look up ${esc(w.arabic)}">${esc(w.arabic)}</button>`).join('');
    storeLocal('qw.lastVerse', {reference, data:result.data});
    readerId = null; $('#reader-card').innerHTML = '<div class="empty"><span class="empty-symbol" aria-hidden="true">✧</span><h2>Follow a word to its meaning.</h2><p>Select a word above to explore its Urdu explanation and root.</p></div>';
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
function renderCards() {
  if (!cloud.authorized) {$('#cards-list').innerHTML = ''; return;}
  const cards = savedCards(); const due = cards.filter(([, c]) => c.due <= Date.now()).length;
  $('#cards-count').textContent = `${cards.length} saved ${cards.length === 1 ? 'word' : 'words'} · ${due} due for review`;
  const query = normalize($('#cards-search').value);
  const visible = cards.filter(([id]) => normalize(entries.get(id).word).includes(query));
  $('#cards-list').innerHTML = visible.map(([id, c]) => `<article class="saved-tile"><button data-entry="${esc(id)}" dir="rtl" lang="ar">${esc(entries.get(id).word)}</button><div class="tile-foot"><small>${c.due <= Date.now() ? 'Ready to review' : `Due ${esc(new Date(c.due).toLocaleDateString())}`}<br>${c.reviews || 0} reviews${c.grade ? ' · Last: ' + esc(c.grade) : ''}</small>${heart(id)}</div></article>`).join('') || `<div class="empty"><h2>${cards.length ? 'No matching cards' : 'Your collection starts with one word.'}</h2><p>${cards.length ? 'Try another word.' : 'Open a dictionary entry and select its heart to save it here.'}</p><a href="#read">Explore a verse →</a></div>`;
}
function duration(card, grade) {
  const next = schedule(card, grade); return next.interval < 1 ? '10 minutes' : `${Math.round(next.interval)} ${Math.round(next.interval) === 1 ? 'day' : 'days'}`;
}
function renderStudy() {
  if (!cloud.authorized) {$('#study-area').innerHTML = ''; return;}
  const due = savedCards().filter(([, c]) => c.due <= Date.now());
  if (!due.some(([id]) => id === studyId)) { studyId = due[0]?.[0] || null; revealed = false; }
  if (!studyId) {
    const next = savedCards()[0]?.[1];
    $('#study-area').innerHTML = `<div class="empty"><span class="empty-symbol" aria-hidden="true">✓</span><h2>${savedCards().length ? 'You’re all caught up.' : 'Save your first word.'}</h2><p>${next ? `Your next review is ${esc(new Date(next.due).toLocaleString())}.` : 'Add words with the heart on a dictionary card, then return here.'}</p><p>${studied ? `${studied} reviewed in this session.` : ''}</p><a href="#cards">Browse your cards →</a></div>`; return;
  }
  const entry = entries.get(studyId), card = cloud.deck[studyId];
  $('#study-area').innerHTML = `<div class="study-top"><span>${due.length} due · ${studied} reviewed</span><a href="#cards">Browse cards</a></div>${revealed ? entryCard(studyId) : `<div class="study-front"><p class="muted">What does this word mean?</p><div class="study-word" dir="rtl" lang="ar">${esc(entry.word)}</div><button class="button" id="reveal">Reveal answer</button></div>`}${revealed ? `<div class="ratings">${['failed','difficult','medium','easy'].map(grade => `<button class="rating ${grade}" data-grade="${grade}">${grade[0].toUpperCase()+grade.slice(1)}<small>${duration(card, grade)}</small></button>`).join('')}</div>` : ''}`;
}
function renderAuth() {
  if (!cloud) return;
  $('#account').textContent = cloud.authorized ? `${cloud.user.name} · Sign out` : cloud.busy ? 'Connecting…' : 'Sign in with Google';
  $('#account').disabled = cloud.busy;
  for (const gate of document.querySelectorAll('.auth-gate')) {
    gate.hidden = cloud.authorized;
    gate.innerHTML = `<div class="empty"><span class="empty-symbol" aria-hidden="true">♡</span><h2>A place for your own words.</h2><p>Sign in to save flashcards and keep your study progress across devices.</p><p>Stored privately in your Google Drive.</p><button class="button" data-signin ${cloud.busy ? 'disabled' : ''}>${cloud.busy ? 'Connecting…' : 'Continue with Google'}</button>${!config.googleClientId ? '<p>Google sign-in is not available yet.</p>' : ''}</div>`;
  }
  for (const panel of document.querySelectorAll('.private-content')) panel.hidden = !cloud.authorized;
  for (const status of document.querySelectorAll('.sync-status')) status.textContent = cloud.status;
  $('#sync').disabled = cloud.busy;
  renderCards(); renderStudy(); refreshHearts();
}
function route({skipVerseLoad = false} = {}) {
  const state = readLocation();
  const page = state.page;
  const valid = ['read','dictionary','cards','study','privacy'].includes(page) ? page : 'read';
  for (const section of document.querySelectorAll('.page')) section.hidden = section.id !== valid;
  for (const link of document.querySelectorAll('nav a')) {
    link.classList.toggle('active', link.dataset.page === valid);
    if (link.dataset.page === valid) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
  }
  if (valid !== 'dictionary' && $('#detail-dialog').open) $('#detail-dialog').close();
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
    const reference = state.params.get('verse') || state.bare;
    if (reference && !skipVerseLoad && manifest) {
      try {const parsed = parseReference(reference, manifest.surahs); if (parsed !== currentRef) void loadVerse(parsed);}
      catch (error) {notice(error.message);}
    } else if (!reference && !skipVerseLoad && currentRef) writeVerseLocation(currentRef);
  }
  if (valid === 'cards' || valid === 'study') renderAuth();
}

async function start() {
  try {
    const [data, index, meta, settings] = await Promise.all([json('./data/entries.json'), json('./data/toc.json'), json('./data/manifest.json'), json('./config.json')]);
    entries = new Map(data.map(e => [e.id, e])); toc = index; manifest = meta; config = settings;
    cloud = new DriveCards({clientId:config.googleClientId, onChange:renderAuth});
    $('#dictionary-count').textContent = `${entries.size.toLocaleString()} entries, grouped by Arabic letter and root. Select any word to explore.`;
    $('#startup').hidden = true; renderAuth(); route({skipVerseLoad:true});
    const state = readLocation();
    const requested = state.page === 'read' ? (state.params.get('verse') || state.bare) : null;
    const last = readLocal('qw.lastVerse', null);
    let initialReference = requested || last?.reference || '1:1';
    try {initialReference = parseReference(initialReference, manifest.surahs);} catch {initialReference = '1:1';}
    await loadVerse(initialReference);
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
    if (button.dataset.entry) openEntry(button.dataset.entry);
    else if (button.dataset.heart) toggleCard(button.dataset.heart);
    else if (button.dataset.word !== undefined) {
      const index = Number(button.dataset.word); readerId = currentWords[index]?.entryId;
      $('#reader-card').innerHTML = entryCard(readerId);
      for (const word of document.querySelectorAll('[data-word]')) word.classList.toggle('selected', word === button);
    }
    else if (button.hasAttribute('data-signin')) await cloud.signIn();
    else if (button.id === 'account') {
      if (cloud.authorized) cloud.signOut();
      else {
        await cloud.signIn();
        const localReference = readLocal('qw.lastVerse', null)?.reference;
        let reference = cloud.lastVerse || localReference || '1:1';
        try {reference = parseReference(reference, manifest.surahs);} catch {reference = '1:1';}
        await loadVerse(reference);
      }
    }
    else if (button.id === 'sync') await cloud.sync();
    else if (button.dataset.ref) void loadVerse(button.dataset.ref);
    else if (button.id === 'prev-verse') adjacentVerse(-1);
    else if (button.id === 'next-verse') adjacentVerse(1);
    else if (button.dataset.letter !== undefined) {
      selectedLetter = button.dataset.letter; renderToc();
      writeDictionaryLocation({letter:alphabet.find(([id]) => id === selectedLetter)?.[1] || selectedLetter});
    }
    else if (button.id === 'reveal') {revealed = true; renderStudy();}
    else if (button.dataset.grade && studyId && revealed) {
      const id = studyId; const next = schedule(cloud.deck[id], button.dataset.grade, Math.max(Date.now(), cloud.deck[id].updatedAt + 1));
      studyId = null; revealed = false; studied++; cloud.mutate(id, next);
    }
    else if (button.id === 'close-dialog') closeEntryDialog();
    else if (button.id === 'clear-local') {
      if (cloud.busy) {notice('Wait for the current sync to finish before clearing local data.'); return;}
      cloud.signOut();
      for (const key of Object.keys(localStorage)) if (key.startsWith('qw.deck.')) localStorage.removeItem(key);
      notice('Local card data cleared. Your Google Drive data is unchanged.');
    }
  } catch (error) {notice(error.message);}
});
$('#verse-form').addEventListener('submit', event => {event.preventDefault(); if (manifest) void loadVerse($('#reference').value);});
$('#toc-search').addEventListener('input', event => {tocQuery = event.target.value; tocMatchIndex = 0; renderToc();});
$('#toc-search').addEventListener('keydown', handleTocKeyDown);
$('#toc-search').addEventListener('beforeinput', handleTocBeforeInput);
$('#cards-search').addEventListener('input', () => {if (cloud) renderCards();});
$('#detail-dialog').addEventListener('click', event => {if (event.target === $('#detail-dialog')) {const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeEntryDialog();}});
$('#detail-dialog').addEventListener('close', () => {
  const state = readLocation();
  if (state.page === 'dictionary' && state.params.has('card')) writeDictionaryLocation({letter:alphabet.find(([id]) => id === selectedLetter)?.[1] || ''});
  dialogId = null;
});
$('#keyboard-layout-dialog').addEventListener('click', event => {if (event.target === $('#keyboard-layout-dialog')) {$('#keyboard-layout-dialog').close(); $('#toc-info').setAttribute('aria-expanded', 'false');}});
$('#keyboard-layout-dialog').addEventListener('close', () => $('#toc-info').setAttribute('aria-expanded', 'false'));
window.addEventListener('hashchange', () => {if (manifest) route();});
window.addEventListener('online', () => {if (cloud?.authorized) void cloud.sync();});
window.addEventListener('focus', () => {if (cloud) renderAuth();});
setInterval(() => {if (cloud) renderAuth();}, 60000);
void start();

