import {readFile, writeFile, mkdir, realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// This exporter lives in the public web app repository and reads the private
// master data folder directly. The project data folder receives only explicit
// public fields and never requires private credentials.
const master = fileURLToPath(new URL('../../../quranic-usage-text/quranic-usage-text/data/', import.meta.url));
if (!process.argv[2]) throw new Error('Usage: node scripts/export-web-data.mjs <web-app/data>');
const target = path.resolve(process.argv[2]);
await mkdir(target, {recursive:true});
const resolvedTarget = await realpath(target);
const resolvedMaster = await realpath(master);
if (resolvedTarget.toLowerCase() === resolvedMaster.toLowerCase() ||
    resolvedTarget.toLowerCase().startsWith(resolvedMaster.toLowerCase() + path.sep))
  throw new Error('The export destination must not be inside the master data folder.');
const entries = JSON.parse(await readFile(path.join(master,'entries.json'),'utf8'));
const qwords = JSON.parse(await readFile(path.join(master,'qwords.json'),'utf8'));
const publicEntries = entries.map(({id,word,markdown_ur='',nouns='',verbs='',root='',features=[]}) =>
  ({id,word,markdown_ur,nouns,verbs,root,...(Array.isArray(features) && features.length ? {features} : {})}));
const publicWords = qwords.map(({surah_no,ayahs}) => ({surah_no,ayahs:ayahs.map(({no,words}) =>
  ({no,words:words.map(({key,arabic,entryId}) => ({key,arabic,...(entryId ? {entryId} : {})}))}))}));
await writeFile(path.join(target,'entries.json'), JSON.stringify(publicEntries));
await writeFile(path.join(target,'qwords.json'), JSON.stringify(publicWords));
console.log(`Exported ${publicEntries.length} Urdu entries and ${publicWords.length} Surahs to ${target}. English markdown and usage fields were excluded; features were included where present; master files were only read.`);
