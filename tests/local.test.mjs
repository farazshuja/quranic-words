import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalCards} from '../src/local-cards.js';
import {adoptSeed} from '../src/core.js';

const storage = () => {
  const values = new Map();
  return {getItem:k=>values.get(k) ?? null, setItem:(k,v)=>values.set(k,v), removeItem:k=>values.delete(k)};
};

test('LocalCards persists cards and studies in the browser store', () => {
  const store = storage();
  let cloud = new LocalCards({storage:store});
  cloud.mutate('alif-1', {due:5, updatedAt:5, deleted:false});
  cloud.mutateStudy('1-2', {name:'1-2', cards:['alif-1'], updatedAt:7});
  cloud.setLastVerse('2:255');
  store.setItem('qw.lastVerse', JSON.stringify({reference:'2:255'})); // written by app.js
  assert.equal(cloud.authorized, true); assert.equal(cloud.mode, 'local'); assert.equal(cloud.synced, true);
  // A fresh instance reloads what the first one saved.
  const reloaded = new LocalCards({storage:store});
  assert.equal(reloaded.deck['alif-1'].due, 5);
  assert.deepEqual(reloaded.studies['1-2'].cards, ['alif-1']);
  assert.equal(reloaded.lastVerse, '2:255');
  reloaded.signOut();
  assert.deepEqual(new LocalCards({storage:store}).deck, {});
});

test('LocalCards survives a broken cache and the seed merges into Firebase data', () => {
  const store = storage();
  store.setItem('qw.local', '{broken');
  const cloud = new LocalCards({storage:store});
  assert.deepEqual(cloud.deck, {});
  cloud.mutate('alif-1', {due:5, updatedAt:5, deleted:false});
  cloud.mutateStudy('1-2', {name:'1-2', cards:['alif-1'], updatedAt:7});
  const merged = adoptSeed({'alif-2':{due:9, updatedAt:9}}, {'General':{name:'General', cards:[], updatedAt:10}}, {deck:{...cloud.deck}, studies:{...cloud.studies}});
  assert.equal(merged.deck['alif-1'].due, 5); assert.ok(merged.deck['alif-2']);
  assert.equal(merged.studies['1-2'].updatedAt, 7);
  // Older local studies never overwrite newer cloud ones.
  assert.equal(merged.studies['General'].updatedAt, 10);
});
