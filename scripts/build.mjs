import {readFile, writeFile, mkdir, cp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {alphabet, normalize} from '../src/core.js';

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
const roots = new Map(entries.filter(e => e.word.includes('/')).map(e => [normalize(e.word), e.id]));
// Explicit allowlist prevents English markdown or other master fields leaking.
const publicEntries = entries.map(({id, word, markdown_ur = '', nouns = '', verbs = '', root = ''}) =>
  ({id, word, markdown_ur, nouns, verbs, root, rootId: root ? roots.get(normalize(root)) || null : null}));
const toc = Object.fromEntries(alphabet.map(([id]) => [id, []]));
const nodes = new Map();
const entryMap = new Map(publicEntries.map(e => [e.id, e]));
for (const e of publicEntries) {
  const node = {id: e.id, word: e.word, children: []};
  nodes.set(e.id, node);
}
for (const e of publicEntries) {
  let parent = e;
  const seen = new Set([e.id]);
  while (parent.rootId && !seen.has(parent.rootId)) {
    seen.add(parent.rootId);
    parent = entryMap.get(parent.rootId);
  }
  if (parent.id !== e.id) nodes.get(parent.id).children.push({id: e.id, word: e.word});
  else (toc[e.id.split('-')[0]] ||= []).push(nodes.get(e.id));
}
await mkdir(path.join(out, 'data/verses'), {recursive: true});
await mkdir(path.join(out, 'vendor'), {recursive: true});
await cp(path.join(app, 'src'), path.join(out, 'src'), {recursive: true});
await cp(path.join(app, 'index.html'), path.join(out, 'index.html'));
// Resolve from this package; existing root dependency also supports local builds.
const marked = fileURLToPath(import.meta.resolve('marked'));
await cp(marked, path.join(out, 'vendor/marked.js'));
const config = JSON.parse(await readFile(path.join(app, 'config.json'), 'utf8'));
config.googleClientId = process.env.GOOGLE_CLIENT_ID || config.googleClientId || '';
await writeFile(path.join(out, 'config.json'), JSON.stringify(config));
await writeFile(path.join(out, '.nojekyll'), '');
await writeFile(path.join(out, 'data/entries.json'), JSON.stringify(publicEntries));
await writeFile(path.join(out, 'data/toc.json'), JSON.stringify(toc));
await writeFile(path.join(out, 'data/manifest.json'), JSON.stringify({entryCount: entries.length,
  surahs: Object.fromEntries(qwords.map(s => [s.surah_no, Math.max(...s.ayahs.map(a => a.no))]))}));
for (const surah of qwords) await writeFile(path.join(out, `data/verses/${surah.surah_no}.json`), JSON.stringify(surah.ayahs));
console.log(`Built ${publicEntries.length} Urdu entries and ${qwords.length} Surahs in dist from sanitized public data.`);
