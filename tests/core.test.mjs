import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {alignWords, parseReference, verseReferences, schedule, mergeDecks, searchToc, normalizeWithSpans, featureTags, todayQueue, studyLimits, dayEnd, dayStart, STUDY_LIMIT_DEFAULTS} from '../src/core.js';
import {syncData} from '../scripts/sync-data.mjs';

test('meaning references recognize verses and ranges while rejecting invalid Ayahs', () => {
  const counts = {2:286,37:182};
  const text = 'حفاظت (37:6-7)، (2:255)، (37:6–7)، (2:999)، (999:1)';
  const references = verseReferences(text,counts);
  assert.deepEqual(references.map(r=>[r.label,r.reference]), [['37:6-7','37:6'],['2:255','2:255'],['37:6–7','37:6']]);
  for (const r of references) assert.equal(text.slice(r.index,r.index+r.label.length),r.label);
});

test('TOC search ignores Arabic marks and reports original word offsets', () => {
  const rows = {alif:[{id:'alif-entry-1',word:'أَللّٰه',children:[{id:'alif-entry-2',word:'إِلٰه'}]}]};
  assert.deepEqual(searchToc(rows,'له').map(({id, start, end})=>({id,start,end})),[
    {id:'alif-entry-1',start:3,end:7},{id:'alif-entry-2',start:2,end:5}
  ]);
  assert.equal(normalizeWithSpans('اَل').normalized,'ال');
});

test('verse references reject malformed and out-of-range input', () => {
  const counts = {1:7, 2:286, 114:6};
  assert.equal(parseReference(' 2 : 255 ', counts), '2:255');
  for (const ref of ['1:8', '0:1', '115:1', '2:0', '2:255:1', '2x:1', '2:1.5']) assert.throws(() => parseReference(ref, counts));
});

test('feature tags map feature names to abbreviations with full-name tooltips', () => {
  assert.deepEqual(featureTags('noun, verbal noun|feminine'), [
    {abbr:'n.', full:'Noun'}, {abbr:'v. n.', full:'Verbal noun'}, {abbr:'fem.', full:'Feminine'}]);
  assert.deepEqual(featureTags(['n.','v.n.','pass. part.']), [
    {abbr:'n.', full:'Noun'}, {abbr:'v. n.', full:'Verbal noun'}, {abbr:'pass. part.', full:'Passive participle'}]);
  assert.deepEqual(featureTags(undefined), []);
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
  assert.equal(mergeDecks({'alif-1':{due:0,updatedAt:10}})['alif-1'].due,0);
  assert.deepEqual(mergeDecks({'bad':{due:0,updatedAt:1},'alif-entry-2':{due:'invalid',updatedAt:1}}),{});
});
test('study limits default to 50 new and 50 review cards per day', () => {
  assert.deepEqual(studyLimits({}), STUDY_LIMIT_DEFAULTS);
  assert.deepEqual(studyLimits({settings:{maxNew:3}}), {maxNew:3, maxReview:50});
  assert.deepEqual(studyLimits({settings:{maxNew:-2, maxReview:'x'}}), STUDY_LIMIT_DEFAULTS);
});
test('today queue caps due reviews and new cards by the daily limits', () => {
  const now = Date.UTC(2026, 0, 15, 12), day = 86400000, end = dayEnd(now);
  const study = {
    cards:['a1','a2','a3','a4','a5','a6','a7'],
    settings:{maxNew:2, maxReview:2},
    progress:{
      a1:{due:now - 2*day, reviews:3, updatedAt:now - 5*day},      // overdue review, oldest first
      a2:{due:now, reviews:1, updatedAt:now - day},               // due now
      a3:{due:now + 3600000, reviews:2, updatedAt:now - 3600000}, // due later today
      a4:{due:now + day, reviews:2, updatedAt:now - day},         // due tomorrow: excluded
      a5:{due:end, reviews:4, updatedAt:now},                     // last minute of today: included
      a6:{due:now - day, reviews:0},                              // never studied: new card
      a7:{due:now - day, reviews:0}                               // never studied: new card
    }
  };
  // Review cap 2 keeps only the two oldest due reviews; new cap 2 keeps two new cards.
  assert.deepEqual(todayQueue(study, study.cards, now), ['a1','a2','a6','a7']);
  // With the default 50/50 limits nothing is held back and tomorrow's reviews stay out.
  const open = {...study, settings:{}};
  assert.deepEqual(todayQueue(open, study.cards, now), ['a1','a2','a3','a5','a6','a7']);
  // Zero limits leave nothing to study today.
  assert.deepEqual(todayQueue({...study, settings:{maxNew:0, maxReview:0}}, study.cards, now), []);
});
test('studying a new card frees no slot for the next one until tomorrow', () => {
  const now = Date.UTC(2026, 0, 15, 12), day = 86400000, start = dayStart(now);
  const cards = ['n1','n2','n3','n4','n5'];
  const progress = Object.fromEntries(cards.map(id => [id, {due:now - day, interval:0, ease:2.5, reviews:0}]));
  const study = {cards, progress, settings:{maxNew:3, maxReview:3}};
  // The limit applies to cards introduced today, not to cards still ungraded.
  assert.deepEqual(todayQueue(study, cards, now), ['n1','n2','n3']);
  // Grade n1 as Easy: it leaves today's queue and no fresh card slides in.
  progress.n1 = schedule(progress.n1, 'easy', now);
  assert.equal(progress.n1.introduced >= start, true);
  assert.deepEqual(todayQueue({...study, progress}, cards, now), ['n2','n3']);
  // Grade n2 and n3 too: nothing new is due today even though n4/n5 are unstudied.
  progress.n2 = schedule(progress.n2, 'medium', now);
  progress.n3 = schedule(progress.n3, 'difficult', now);
  assert.deepEqual(todayQueue({...study, progress}, cards, now), []);
  // A card graded Again returns within the day (due in 10 minutes) for rechecks.
  progress.n2 = schedule(progress.n2, 'failed', now);
  assert.deepEqual(todayQueue({...study, progress}, cards, now), ['n2']);
  // Legacy progress without the introduced stamp falls back to updated-today:
  // l1 (graded today) uses the allowance, l2 (graded earlier) does not, so only
  // one fresh card remains. Overdue reviews l1/l2 are asked before it.
  const legacy = {cards:['l1','l2','l3'], progress:{
    l1:{due:now - day, reviews:1, updatedAt:now}, // graded earlier today
    l2:{due:now - day, reviews:1, updatedAt:now - day}, // graded on an earlier day
    l3:{due:now - day, reviews:0}
  }, settings:{maxNew:2, maxReview:5}};
  assert.deepEqual(todayQueue(legacy, legacy.cards, now), ['l1','l2','l3']);
});
test('the daily new-card allowance resets the next day', () => {
  // Local times keep the day boundaries deterministic in every timezone.
  const now = new Date(2026, 0, 15, 12).getTime(), day = 86400000;
  const cards = ['n1','n2','n3','n4'];
  const progress = {n1:{due:now - day, interval:0, ease:2.5, reviews:0},
    n2:{due:now - day, interval:0, ease:2.5, reviews:0},
    n3:{due:now - day, interval:0, ease:2.5, reviews:0},
    n4:{due:now - day, interval:0, ease:2.5, reviews:0}};
  const study = {cards, progress, settings:{maxNew:2, maxReview:5}};
  progress.n1 = schedule(progress.n1, 'easy', now);
  progress.n2 = schedule(progress.n2, 'easy', now);
  assert.deepEqual(todayQueue(study, cards, now), []);
  // Tomorrow the two remaining new cards fill the allowance again; n1/n2 are
  // due on later days and stay out.
  assert.deepEqual(todayQueue(study, cards, now + day), ['n3','n4']);
});
test('standalone build preserves public inputs and publishes only explained entries with valid TOC roots', async () => {
  await syncData({optional: true});
  const app = fileURLToPath(new URL('../',import.meta.url));
  const masters = ['entries','qwords'].map(name => new URL(`../data/${name}.json`,import.meta.url));
  const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
  const before = masters.map(hash);
  execFileSync(process.execPath,['scripts/build.mjs'],{cwd:app});
  assert.deepEqual(masters.map(hash),before);
  const entries = JSON.parse(readFileSync(new URL('../dist/data/entries.json',import.meta.url)));
  const original = JSON.parse(readFileSync(masters[0]));
  const allowed = ['id','word','markdown_ur','nouns','verbs','root','features'];
  for (const entry of original) assert.ok(Object.keys(entry).every(key=>allowed.includes(key)));
  const explained = original.filter(e=>typeof e.markdown_ur==='string' && e.markdown_ur.trim());
  assert.equal(entries.length,explained.length);
  const map = new Map(entries.map(e=>[e.id,e]));
  for (let index = 0; index < entries.length; index++) {
    const e = entries[index];
    assert.ok(e.markdown_ur.trim());
    assert.ok(!('markdown' in e)); assert.ok(!('usage' in e));
    if (e.rootId) assert.ok(map.has(e.rootId));
    assert.equal(e.markdown_ur,explained[index].markdown_ur ?? '');
  }
  const toc = JSON.parse(readFileSync(new URL('../dist/data/toc.json',import.meta.url)));
  const ids = Object.values(toc).flatMap(group => group.flatMap(n=>[...(map.has(n.id)?[n.id]:[]),...(n.children||[]).map(c=>c.id)]));
  assert.ok(ids.every(id=>map.has(id)));
  assert.equal(ids.length,entries.length);
  for (const families of Object.values(toc)) for (const family of families) {
    assert.ok(map.has(family.id) ? map.get(family.id).markdown_ur.trim() : family.children?.length > 0);
    for (const child of family.children || []) assert.ok(map.get(child.id)?.markdown_ur.trim());
  }
  const {parseUrdu} = await import('../dist/src/markup.js');
  const rendered = parseUrdu('**رحمت**\n\n<script>alert(1)</script>');
  assert.ok(rendered.includes('<strong>رحمت</strong>'));
  assert.ok(!rendered.includes('<script>')); assert.ok(rendered.includes('&lt;script&gt;'));
});
