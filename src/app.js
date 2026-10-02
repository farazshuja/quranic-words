import {escapeHtml as esc, parseUrdu} from './markup.js';
import {alphabet, normalize, parseReference, verseReferences, alignWords, schedule} from './core.js';
import {DriveCards} from './drive.js';

const $ = selector => document.querySelector(selector);
let entries = new Map(), toc = {}, manifest, config, cloud;
let currentRef = '1:1', currentWords = [], readerId = null, dialogId = null, requestId = 0;
let selectedLetter = 'alif', studyId = null, revealed = false, studied = 0;
const surahCache = new Map();
let noticeTimer;
function notice(message) {
  $('#notification').textContent = message; $('#notification').hidden = false;
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('#notification').hidden = true; }, 7000);
}
function readLocal(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch {return fallback;} }
function storeLocal(key, value) {try { localStorage.setItem(key, JSON.stringify(value)); } catch {notice('Browser storage is unavailable. Your reading position cannot be remembered.');} }
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
function entryCard(id) {
  const entry = entries.get(id);
  if (!entry) return '<div class="empty"><h2>No word found</h2><p>This word has not been linked to a dictionary entry yet.</p></div>';
  const children = [...entries.values()].filter(e => e.rootId === id && e.id !== id);
  const root = entry.root && entry.root !== entry.word ? `<div class="form-item"><span>Root</span>${entry.rootId ? `<button class="root-link" data-entry="${esc(entry.rootId)}">${esc(entry.root)} ↗</button>` : esc(entry.root)}</div>` : '';
  return `<article class="entry-card"><header class="entry-header"><div class="entry-heading"><small>DICTIONARY ENTRY</small></div>${children.length ? '<span class="badge">ROOT</span>' : ''}${heart(id)}</header><div class="entry-body"><div class="forms" dir="rtl">${root}${entry.nouns ? `<div class="form-item"><span>Nouns</span>${esc(entry.nouns)}</div>` : ''}${entry.verbs ? `<div class="form-item"><span>Verbs</span>${esc(entry.verbs)}</div>` : ''}</div>${entry.markdown_ur ? `<div class="urdu" lang="ur" dir="rtl">${markdown(entry.markdown_ur)}</div>` : '<p class="muted">An Urdu explanation is not available for this entry yet.</p>'}${children.length ? `<p class="muted">Words from this root</p><div class="related">${children.map(e => `<button class="word-chip" data-entry="${esc(e.id)}">${esc(e.word)}</button>`).join('')}</div>` : ''}</div></article>`;
}
function openEntry(id) {
  dialogId = id; $('#dialog-card').innerHTML = entryCard(id);
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
  $('#detail-dialog').scrollTop = 0;
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
  const html = [];
  for (const [letter, label] of alphabet) {
    if (selectedLetter !== letter) continue;
    const families = toc[letter] || [];
    if (!families.length) continue;
    html.push(`<section class="toc-group"><h2 class="toc-letter">${label}</h2><div class="toc-items">${families.map(item => `<div class="toc-family ${(item.children?.length || item.word.includes('/')) ? 'root-family' : ''}"><button data-entry="${esc(item.id)}">${esc(item.word)}</button>${(item.children || []).map(e => `<button data-entry="${esc(e.id)}">${esc(e.word)}</button>`).join('')}</div>`).join('')}</div></section>`);
  }
  $('#toc').innerHTML = html.join('') || '<div class="empty">No dictionary entries for this letter.</div>';
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
function route() {
  const page = location.hash.slice(1) || 'read';
  const valid = ['read','dictionary','cards','study','privacy'].includes(page) ? page : 'read';
  for (const section of document.querySelectorAll('.page')) section.hidden = section.id !== valid;
  for (const link of document.querySelectorAll('nav a')) {
    link.classList.toggle('active', link.dataset.page === valid);
    if (link.dataset.page === valid) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
  }
  if (valid === 'dictionary') renderToc();
  if (valid === 'cards' || valid === 'study') renderAuth();
}

async function start() {
  try {
    const [data, index, meta, settings] = await Promise.all([json('./data/entries.json'), json('./data/toc.json'), json('./data/manifest.json'), json('./config.json')]);
    entries = new Map(data.map(e => [e.id, e])); toc = index; manifest = meta; config = settings;
    cloud = new DriveCards({clientId:config.googleClientId, onChange:renderAuth});
    $('#dictionary-count').textContent = `${entries.size.toLocaleString()} entries, grouped by Arabic letter and root. Select any word to explore.`;
    $('#startup').hidden = true; renderAuth(); route();
    const last = readLocal('qw.lastVerse', null);
    await loadVerse(last?.reference || '1:1');
  } catch (error) {
    $('#startup').innerHTML = `<h2>The dictionary could not load.</h2><p>${esc(error.message)}</p><button class="button" id="retry-start">Try again</button>`;
  }
}

document.addEventListener('click', async event => {
  const verseLink = event.target.closest('a[data-verse]');
  if (verseLink && manifest) {
    event.preventDefault();
    if ($('#detail-dialog').open) $('#detail-dialog').close();
    location.hash = 'read';
    $('#reference').value = verseLink.dataset.verse;
    void loadVerse(verseLink.dataset.verse);
    $('#verse-form').scrollIntoView({behavior:'smooth', block:'start'});
    return;
  }
  const button = event.target.closest('button');
  if (!button) return;
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
    else if (button.id === 'account') {if (cloud.authorized) cloud.signOut(); else await cloud.signIn();}
    else if (button.id === 'sync') await cloud.sync();
    else if (button.dataset.ref) void loadVerse(button.dataset.ref);
    else if (button.id === 'prev-verse') adjacentVerse(-1);
    else if (button.id === 'next-verse') adjacentVerse(1);
    else if (button.dataset.letter !== undefined) { selectedLetter = button.dataset.letter; renderToc(); }
    else if (button.id === 'reveal') {revealed = true; renderStudy();}
    else if (button.dataset.grade && studyId && revealed) {
      const id = studyId; const next = schedule(cloud.deck[id], button.dataset.grade, Math.max(Date.now(), cloud.deck[id].updatedAt + 1));
      studyId = null; revealed = false; studied++; cloud.mutate(id, next);
    }
    else if (button.id === 'close-dialog') $('#detail-dialog').close();
    else if (button.id === 'clear-local') {
      if (cloud.busy) {notice('Wait for the current sync to finish before clearing local data.'); return;}
      cloud.signOut();
      for (const key of Object.keys(localStorage)) if (key.startsWith('qw.deck.')) localStorage.removeItem(key);
      notice('Local card data cleared. Your Google Drive data is unchanged.');
    }
  } catch (error) {notice(error.message);}
});
$('#verse-form').addEventListener('submit', event => {event.preventDefault(); if (manifest) void loadVerse($('#reference').value);});
$('#cards-search').addEventListener('input', () => {if (cloud) renderCards();});
$('#detail-dialog').addEventListener('click', event => {if (event.target === $('#detail-dialog')) {const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close();}});
window.addEventListener('hashchange', () => {if (manifest) route();});
window.addEventListener('online', () => {if (cloud?.authorized) void cloud.sync();});
window.addEventListener('focus', () => {if (cloud) renderAuth();});
setInterval(() => {if (cloud) renderAuth();}, 60000);
void start();

