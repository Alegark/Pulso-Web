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
