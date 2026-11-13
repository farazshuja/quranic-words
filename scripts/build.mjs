import {readFile, writeFile, mkdir, cp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {alphabet} from '../src/core.js';
import {syncData} from './sync-data.mjs';

await syncData({optional: true});

const app = fileURLToPath(new URL('../', import.meta.url));
const master = path.resolve(app, 'data');
const out = path.join(app, 'dist');
const read = async name => JSON.parse(await readFile(path.join(master, `${name}.json`), 'utf8'));
const [entries, qwords] = await Promise.all([read('entries'), read('qwords')]);
const allowedEntryFields = new Set(['id','word','markdown_ur','nouns','verbs','root']);
for (const entry of entries) {
  if (Object.keys(entry).some(key => !allowedEntryFields.has(key)))
    throw new Error('Public dictionary data contains an unexpected field. Export sanitized data from the private repository first.');
}
// The web dictionary and TOC contain only entries with a real Urdu explanation.
const explainedEntries = entries.filter(e => typeof e.markdown_ur === 'string' && e.markdown_ur.trim());
const explainedIds = new Set(explainedEntries.map(e => e.id));
const roots = new Map(entries.filter(e => e.word.includes('/')).map(e => [`${e.id.split('-')[0]}:${e.word.trim()}`, e]));
// Explicit allowlist prevents English markdown or other master fields leaking.
const publicEntries = explainedEntries.map(({id, word, markdown_ur, nouns = '', verbs = '', root = ''}) =>
  ({id, word, markdown_ur, nouns, verbs, root, rootId: root && explainedIds.has(roots.get(`${id.split('-')[0]}:${root.trim()}`)?.id) ? roots.get(`${id.split('-')[0]}:${root.trim()}`).id : null}));
const toc = Object.fromEntries(alphabet.map(([id]) => [id, []]));
const nodes = new Map();
const explainedById = new Map(explainedEntries.map(e => [e.id, e]));
// Match the desktop TOC: roots own direct children from the same letter section;
// unexplained words are excluded, while a root label remains as a group heading
// when it has at least one explained child.
for (const entry of entries) {
  const section = entry.id.split('-')[0];
  if (!toc[section]) continue;
  if (entry.word.includes('/')) {
    if (nodes.has(entry.id)) continue;
    const node = {id:entry.id, word:entry.word, children:[]};
    nodes.set(entry.id, node);
    if (explainedIds.has(entry.id)) toc[section].push(node);
    continue;
  }
  if (!explainedById.has(entry.id)) continue;
  const root = entry.root?.trim() ? roots.get(`${section}:${entry.root.trim()}`) : null;
  if (root) {
    let node = nodes.get(root.id);
    if (!node) {
      node = {id:root.id, word:root.word, children:[]};
      nodes.set(root.id, node);
      toc[section].push(node);
    } else if (!toc[section].includes(node)) toc[section].push(node);
    node.children.push({id:entry.id, word:entry.word});
  } else {
    toc[section].push({id:entry.id, word:entry.word});
  }
}
for (const section of Object.keys(toc)) toc[section] = toc[section].filter(node => explainedIds.has(node.id) || node.children?.length);
await mkdir(path.join(out, 'data/verses'), {recursive: true});
await mkdir(path.join(out, 'vendor'), {recursive: true});
await cp(path.join(app, 'src'), path.join(out, 'src'), {recursive: true});
await cp(path.join(app, 'index.html'), path.join(out, 'index.html'));
await cp(path.join(app, 'public/quranic-words-logo.svg'), path.join(out, 'quranic-words-logo.svg'));
// Resolve from this package; existing root dependency also supports local builds.
const marked = fileURLToPath(import.meta.resolve('marked'));
await cp(marked, path.join(out, 'vendor/marked.js'));
const config = JSON.parse(await readFile(path.join(app, 'config.json'), 'utf8'));
await writeFile(path.join(out, 'config.json'), JSON.stringify(config));
await writeFile(path.join(out, '.nojekyll'), '');
await writeFile(path.join(out, 'data/entries.json'), JSON.stringify(publicEntries));
await writeFile(path.join(out, 'data/toc.json'), JSON.stringify(toc));
await writeFile(path.join(out, 'data/manifest.json'), JSON.stringify({entryCount: publicEntries.length,
  surahs: Object.fromEntries(qwords.map(s => [s.surah_no, Math.max(...s.ayahs.map(a => a.no))]))}));
await writeFile(path.join(out, 'data/study-index.json'), JSON.stringify(qwords.map(s => ({surah_no:s.surah_no,
  ayahs:s.ayahs.map(a => ({no:a.no, entries:[...new Set((a.words || []).map(w => w.entryId).filter(id => explainedIds.has(id)))]}))}))));
for (const surah of qwords) await writeFile(path.join(out, `data/verses/${surah.surah_no}.json`), JSON.stringify(surah.ayahs));
console.log(`Built ${publicEntries.length} explained Urdu entries and ${qwords.length} Surahs in dist from sanitized public data.`);
