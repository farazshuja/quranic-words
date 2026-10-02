import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {alignWords, parseReference, verseReferences, schedule, mergeDecks} from '../src/core.js';

test('meaning references recognize verses and ranges while rejecting invalid Ayahs', () => {
  const counts = {2:286,37:182};
  const text = 'حفاظت (37:6-7)، (2:255)، (37:6–7)، (2:999)، (999:1)';
  const references = verseReferences(text,counts);
  assert.deepEqual(references.map(r=>[r.label,r.reference]), [['37:6-7','37:6'],['2:255','2:255'],['37:6–7','37:6']]);
  for (const r of references) assert.equal(text.slice(r.index,r.index+r.label.length),r.label);
});

test('verse references reject malformed and out-of-range input', () => {
  const counts = {1:7, 2:286, 114:6};
  assert.equal(parseReference(' 2 : 255 ', counts), '2:255');
  for (const ref of ['1:8', '0:1', '115:1', '2:0', '2:255:1', '2x:1', '2:1.5']) assert.throws(() => parseReference(ref, counts));
});
test('API words map to the source position, preserving missing IDs', () => {
  const source = [{arabic:'بسم',entryId:'seen-entry-318'}, {arabic:'الله',entryId:'alif-entry-211'}, {arabic:'الرحمن'}];
  const result = alignWords('بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ', source, '1:1');
  assert.equal(result.aligned, true);
  assert.deepEqual(result.words.map(w => w.entryId), ['seen-entry-318', 'alif-entry-211', undefined]);
});
test('first-Ayah Bismillah does not shift entry IDs', () => {
  const source = [{arabic:'الم',entryId:'alif-entry-1'}];
  const result = alignWords('بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ الٓمٓ', source, '2:1');
  assert.equal(result.words.length, 1); assert.equal(result.words[0].entryId, 'alif-entry-1');
  assert.equal(alignWords('بسم الله الرحمن الرحيم الم', source, '9:1').aligned, false);
});
test('count mismatch never assigns a shifted ID to an unmatched token', () => {
  const result = alignWords('قال جديد الله', [{arabic:'قال',entryId:'qaf-entry-1'},{arabic:'الله',entryId:'alif-entry-211'}], '2:2');
  assert.equal(result.aligned, false);
  assert.deepEqual(result.words.map(w => w.entryId), ['qaf-entry-1', undefined, 'alif-entry-211']);
});
test('review choices separate learning failure from growing review intervals', () => {
  const now = 1000000, card = {due:now,updatedAt:now,ease:2.5,interval:10,reviews:2,lapses:0};
  const failed = schedule(card,'failed',now), hard = schedule(card,'difficult',now), medium = schedule(card,'medium',now), easy = schedule(card,'easy',now);
  assert.equal(failed.due, now + 600000); assert.equal(failed.lapses, 1);
  assert.ok(hard.due < medium.due && medium.due < easy.due);
  assert.equal(easy.reviews,3); assert.equal(easy.grade,'easy');
  assert.equal(card.reviews,2); assert.throws(() => schedule(card,'invalid'));
});
test('newer tombstones survive merges with stale saved cards', () => {
  const saved = {'alif-entry-1':{due:0,updatedAt:10,deleted:false}};
  const removed = {'alif-entry-1':{due:0,updatedAt:20,deleted:true}};
  assert.equal(mergeDecks(removed,saved)['alif-entry-1'].deleted,true);
  assert.deepEqual(mergeDecks({'bad':{due:0,updatedAt:1},'alif-entry-2':{due:'invalid',updatedAt:1}}),{});
});
test('standalone build preserves public inputs, excludes English, covers every entry and linked root', async () => {
  const app = fileURLToPath(new URL('../',import.meta.url));
  const masters = ['entries','qwords'].map(name => new URL(`../data/${name}.json`,import.meta.url));
  const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
  const before = masters.map(hash);
  execFileSync(process.execPath,['scripts/build.mjs'],{cwd:app});
  assert.deepEqual(masters.map(hash),before);
  const entries = JSON.parse(readFileSync(new URL('../dist/data/entries.json',import.meta.url)));
  const original = JSON.parse(readFileSync(masters[0]));
  const allowed = ['id','word','markdown_ur','nouns','verbs','root'];
  for (const entry of original) assert.ok(Object.keys(entry).every(key=>allowed.includes(key)));
  assert.equal(entries.length,original.length);
  const map = new Map(entries.map(e=>[e.id,e]));
  for (const e of entries) {
    assert.ok(!('markdown' in e)); assert.ok(!('usage' in e));
    if (e.rootId) assert.ok(map.has(e.rootId));
    assert.equal(e.markdown_ur,original.find(o=>o.id===e.id).markdown_ur || '');
  }
  const toc = JSON.parse(readFileSync(new URL('../dist/data/toc.json',import.meta.url)));
  const ids = Object.values(toc).flatMap(group => group.flatMap(n=>[n.id,...n.children.map(c=>c.id)]));
  assert.equal(ids.length,entries.length); assert.equal(new Set(ids).size,entries.length);
  const {parseUrdu} = await import('../dist/src/markup.js');
  const rendered = parseUrdu('**رحمت**\n\n<script>alert(1)</script>');
  assert.ok(rendered.includes('<strong>رحمت</strong>'));
  assert.ok(!rendered.includes('<script>')); assert.ok(rendered.includes('&lt;script&gt;'));
});
