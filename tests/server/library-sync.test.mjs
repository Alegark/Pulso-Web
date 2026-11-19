import test from 'node:test';import assert from 'node:assert/strict';
import {accountLibraryRequest,createLibrarySync} from '../../src/accounts/library-sync.ts';
import {emptyLibrary} from '../../src/accounts/library-document.mjs';

const id='11111111-1111-4111-8111-111111111111';
const remote=()=>({accountId:id,revision:null,document:emptyLibrary()});
const local={...emptyLibrary(),playlists:[{id,name:'Lista',entries:[]}]};
const host=extra=>({ready:()=>true,read:async()=>({document:local,base:emptyLibrary()}),remote:async()=>remote(),save:async()=>({...remote(),document:local}),apply:async()=>{},changed:()=>{},...extra});

test('library rejections keep local changes and pause retries until the library changes',async()=>{
 for(const [code,state] of [['LIBRARY_TOO_LARGE','tooLarge'],['LIBRARY_INVALID','invalid']]){
  let calls=0,applied=0;
  const sync=createLibrarySync(host({apply:async()=>{applied++;},save:(id,revision,document,signal)=>accountLibraryRequest(id,signal,{revision,document},async()=>{
   return ++calls===1?Response.json({code},{status:400}):Response.json({accountId:id,revision:1,document});
  })}));
  try{
   sync.account(id);await sync.sync();
   assert.equal(sync.getSnapshot(),state);
   await sync.sync();assert.equal(calls,1);assert.equal(applied,0);
   sync.changed();await sync.sync();assert.equal(calls,2);assert.equal(applied,1);
  }finally{sync.dispose();}
 }
});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

test('visible fallback waits 20 minutes and transient retries back off',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval']});
 let calls=0,available=true;
 const sync=createLibrarySync(host({remote:async()=>{
  calls++;
  if(!available)throw Error('temporary');
  return remote();
 }}));
 try{
  sync.startPolling();
  sync.account(id);await sync.sync();assert.equal(calls,1);
  t.mock.timers.tick(60_000);await flush();assert.equal(calls,1);
  t.mock.timers.tick(19*60_000);await flush();assert.equal(calls,2);
  available=false;await sync.sync();assert.equal(calls,3);
  await sync.sync();assert.equal(calls,3);
  t.mock.timers.tick(59_999);await flush();assert.equal(calls,3);
  t.mock.timers.tick(1);await flush();assert.equal(calls,4);
  t.mock.timers.tick(60_000);await flush();assert.equal(calls,4);
  available=true;t.mock.timers.tick(60_000);await flush();assert.equal(calls,5);
  assert.equal(sync.getSnapshot(),'saved');
 }finally{sync.dispose();}
});

test('local edits arriving during a sync are picked up by a follow-up',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']});
 let calls=0,finish;
 const sync=createLibrarySync(host({remote:async()=>{
  if(++calls===1)await new Promise(resolve=>{finish=resolve;});
  return remote();
 }}));
 try{
  sync.account(id);const first=sync.sync();await flush();
  sync.changed();t.mock.timers.tick(700);await flush();assert.equal(calls,1);
  finish();await first;
  t.mock.timers.tick(700);await flush();assert.equal(calls,2);
 }finally{sync.dispose();}
});

test('an unrecognized cloud document asks for a reload and blocks writes',async()=>{
 for(const get of [
  async()=>Response.json({...remote(),document:{...emptyLibrary(),version:2}}),
  async()=>Response.json({code:'LIBRARY_UNRECOGNIZED'},{status:422}),
 ]){
  let reads=0;
  const sync=createLibrarySync(host({
   remote:(id,signal)=>{reads++;return accountLibraryRequest(id,signal,undefined,get);},
   save:async()=>assert.fail('must never overwrite unrecognized cloud data'),
   apply:async()=>assert.fail('must never apply unrecognized cloud data'),
  }));
  try{
   sync.account(id);await sync.sync();assert.equal(sync.getSnapshot(),'reloadRequired');
   sync.changed();await sync.sync();assert.equal(reads,1);
  }finally{sync.dispose();}
 }
});

test('library rate limit retains local changes and waits for Retry-After before writing again',async()=>{
 let writes=0,applied=0;
 const sync=createLibrarySync(host({
  apply:async()=>{applied++;},
  save:(id,revision,document,signal)=>accountLibraryRequest(id,signal,{revision,document},async()=>{
   writes++;
   return Response.json({code:'RATE_LIMITED'},{status:429,headers:{'Retry-After':'60'}});
  }),
 }));
 try{
  sync.account(id);
  await sync.sync();
  assert.equal(sync.getSnapshot(),'rateLimited');
  sync.changed();
  await sync.sync();
  assert.equal(writes,1);
  assert.equal(applied,0);
 }finally{sync.dispose();}
});
