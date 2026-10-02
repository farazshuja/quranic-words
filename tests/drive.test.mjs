import test from 'node:test';
import assert from 'node:assert/strict';
import {DriveCards} from '../src/drive.js';

const response = data => ({ok:true,status:200,json:async()=>data});
test('default browser fetch retains its Window receiver for profile and Drive requests',async()=>{
  const originalFetch=globalThis.fetch;
  const urls=[];
  globalThis.fetch=function(url,options){
    assert.equal(this,globalThis);
    assert.equal(options.headers.Authorization,'Bearer mock-token');
    urls.push(url);
    return Promise.resolve(response(url.includes('userinfo') ? {sub:'account-a'} : {files:[]}));
  };
  try {
    const cloud=new DriveCards({clientId:'test',storage:{getItem:()=>null,setItem:()=>{}}});
    cloud.token='mock-token';cloud.expires=Date.now()+100000;
    await cloud.request('https://www.googleapis.com/oauth2/v3/userinfo');
    await cloud.listFiles();
    assert.equal(urls.length,2);
  } finally {globalThis.fetch=originalFetch;}
});
function setup(fetcher) {
  const values = new Map();
  const storage = {getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
  const cloud = new DriveCards({clientId:'test',storage,fetcher});
  cloud.user = {sub:'account-a',name:'Test'}; cloud.token = 'mock-token'; cloud.expires = Date.now()+100000; cloud.ready = true;
  return {cloud,values};
}
test('Drive sync merges remote reviews and local removals without resurrecting cards', async () => {
  const requests=[];
  const {cloud,values}=setup(async(url,options)=>{
    requests.push({url,options});
    assert.equal(options.headers.Authorization,'Bearer mock-token');
    if(url.includes('upload/'))return response({id:'file-1'});
    if(url.includes('alt=media'))return response({version:1,cards:{'alif-entry-1':{due:0,updatedAt:10},'ba-entry-2':{due:100,updatedAt:30,reviews:4}}});
    return response({files:[{id:'file-1',createdTime:'2026-01-01'}]});
  });
  cloud.deck={'alif-entry-1':{due:0,updatedAt:20,deleted:true}};
  await cloud.sync();
  const upload=requests.find(r=>r.options.method==='PATCH');
  const written=JSON.parse(upload.options.body);
  assert.equal(written.cards['alif-entry-1'].deleted,true);
  assert.equal(written.cards['ba-entry-2'].reviews,4);
  assert.ok(values.has('qw.deck.account-a'));
  cloud.signOut(); assert.equal(cloud.authorized,false); assert.deepEqual(cloud.deck,{}); assert.equal(cloud.token,null);
});
test('new Drive card file is created atomically in appDataFolder', async()=>{
  let upload;
  const {cloud}=setup(async(url,options)=>{
    if(url.includes('upload/')){upload=options; return response({id:'new-file'});}
    return response({files:[]});
  });
  cloud.deck={'alif-entry-1':{due:0,updatedAt:20}};
  await cloud.sync();
  assert.equal(upload.method,'POST');assert.ok(upload.headers['Content-Type'].includes('multipart/related'));
  assert.ok(upload.body.includes('"parents":["appDataFolder"]'));assert.ok(upload.body.includes('"alif-entry-1"'));
});
test('failed upload preserves local changes and makes sync failure visible', async()=>{
  const {cloud,values}=setup(async(url)=>{
    if(url.includes('upload/'))return {ok:false,status:503};
    return response({files:[]});
  });
  cloud.deck={'ba-entry-2':{due:0,updatedAt:20}};
  await cloud.sync();
  assert.match(cloud.status,/503/);assert.equal(JSON.parse(values.get('qw.deck.account-a')).cards['ba-entry-2'].updatedAt,20);
  assert.equal(cloud.busy,false);
});
test('unsupported remote schema is never overwritten', async()=>{
  let writes=0;
  const {cloud}=setup(async(url)=>{
    if(url.includes('upload/')){writes++;return response({});}
    if(url.includes('alt=media'))return response({version:999,cards:{}});
    return response({files:[{id:'old-file',createdTime:'2026'}]});
  });
  await cloud.sync();assert.equal(writes,0);assert.match(cloud.status,/unsupported/);
});
test('expired session cannot mutate saved cards',()=>{
  const {cloud}=setup(async()=>response({}));cloud.expires=0;
  assert.throws(()=>cloud.mutate('alif-entry-1',{due:0,updatedAt:1}));assert.deepEqual(cloud.deck,{});
});
test('a card saved during a sync gets a second upload',async()=>{
  let release, uploads=0;
  const waiting = new Promise(resolve=>{release=resolve;});
  const {cloud}=setup(async(url)=>{
    if(url.includes('upload/')){uploads++;if(uploads===1)await waiting;return response({id:'file'});}
    if(url.includes('alt=media'))return response({version:1,cards:{}});
    return response({files:[{id:'file',createdTime:'2026'}]});
  });
  const sync=cloud.sync();
  while(!uploads)await new Promise(resolve=>setImmediate(resolve));
  cloud.mutate('ba-entry-2',{due:0,updatedAt:30});release();await sync;
  assert.equal(uploads,2);assert.ok(cloud.deck['ba-entry-2']);
});
test('Google sign-in loads only the authenticated account cache and refuses missing consent',async()=>{
  const original=globalThis.google;
  let granted=true;
  globalThis.google={accounts:{oauth2:{
    hasGrantedAllScopes:()=>granted,
    initTokenClient:options=>({requestAccessToken:()=>options.callback({access_token:'mock-token',expires_in:3600})})
  }}};
  try {
    const {cloud,values}=setup(async(url)=>url.includes('userinfo') ? response({sub:'account-b',name:'Second user'}) : response({files:[]}));
    values.set('qw.deck.account-a',JSON.stringify({cards:{'alif-entry-1':{due:0,updatedAt:10}}}));
    cloud.signOut();await cloud.signIn();
    assert.equal(cloud.user.sub,'account-b');assert.deepEqual(cloud.deck,{});assert.equal(cloud.authorized,true);
    cloud.signOut();granted=false;await assert.rejects(cloud.signIn(),/Allow profile/);assert.equal(cloud.authorized,false);
  } finally {globalThis.google=original;}
});
