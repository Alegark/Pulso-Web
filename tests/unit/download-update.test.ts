import test from 'node:test';
import assert from 'node:assert/strict';
import {createDownloadIntentStore} from '../../src/service-worker/download-update';

const account='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const action={kind:'library',request:{id:account,title:'Playlist',trackIds:[other],play:false},checkpointId:other} as const;
const target={entry:'/releases/0123456789abcdef.html',bundle:'/assets/next.js'};

function fixture(){
 const entries=new Map<string,string>();
 let time=0;
 const storage={getItem:(key:string)=>entries.get(key)??null,setItem:(key:string,value:string)=>{entries.set(key,value);},removeItem:(key:string)=>{entries.delete(key);}};
 return {
  setTime:(value:number)=>{time=value;},
  old:createDownloadIntentStore(storage,'/assets/old.js',()=>time),
  next:createDownloadIntentStore(storage,target.bundle,()=>time),
 };
}

test('only the matching account and actual new bundle can resume a checkpoint once',()=>{
 const f=fixture();
 for(const handoff of [action,{...action,automatic:true}]){
  f.old.save(account,handoff,target);
  assert.equal(f.old.take(account,'library'),null);
  assert.equal(f.next.take(other,'library'),null);
  assert.equal(f.next.take(account,'song'),null);
  assert.deepEqual(f.next.take(account,'library'),handoff);
  assert.equal(f.next.take(account,'library'),null);
 }
});

test('expired and cancelled intents cannot start a download',()=>{
 const f=fixture();
 f.old.save(account,action,target);
 f.setTime(91_000);
 assert.equal(f.next.read(account),null);
 const clear=f.old.save(account,action,target);
 clear();
 assert.equal(f.next.take(account,'library'),null);
});

test('discard removes only the handoff for the failed account and target bundle',()=>{
 const f=fixture();
 f.old.save(account,action,target);
 f.old.discard(other,target);
 f.old.discard(account,{...target,bundle:'/assets/different.js'});
 assert.deepEqual(f.next.read(account),action);
 f.old.discard(account,target);
 assert.equal(f.next.take(account,'library'),null);
});
