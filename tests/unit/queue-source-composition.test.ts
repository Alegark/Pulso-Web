import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLocalCopyProtection,claimBlobCredit} from '../../src/playback/local-copy-protection';
import {preparedSourceProvenance} from '../../src/playback/transport';
import type {LocalAsset} from '../../src/library/library';
import type {BlobCredit,PreparedLocalSources} from '../../src/playback/local-source-protocol';
import {openAssetReader} from '../../src/storage/asset-reader';
import {AUDIO_FILE_MAX_BYTES as fileLimit,AUDIO_BLOB_TOTAL_MAX_BYTES as totalLimit} from '../../src/storage/audio-limits';
const uuid=(n:number)=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const asset=(n:number,bytes=1):LocalAsset=>({id:uuid(n),namespace:'local',storageKey:uuid(n),bytes,sha256:'a'.repeat(64),mime:'audio/wav',chunks:Math.ceil(bytes/65536),state:'complete',revision:1,chunkSize:65536,retention:'kept',backend:'idb'});
function fixture(){
 let current=true,source:string|null=null,entries:{id:string;trackId:string;src:string}[]=[];
 const r=createLocalCopyProtection({captureCurrent:()=>()=>current,getPlayer:()=>({entries,currentEntryId:entries[0]?.id??null,source})});
 return {r,revoke(){current=false;},setPlayer(e:typeof entries,s:string|null){entries=e;source=s;}};
}
test('complete FIFO pending protects removal synchronously and setPlanned cannot omit occurrences',async()=>{
 const {r}=fixture(),ids=['A','B','A'];const p=r.beginInsertion(ids,()=>true);ids.pop();
 assert.deepEqual(r.getReadonlySnapshot().pending,[{trackIds:['A','B','A'],planned:false}]);
 assert.equal(p.setPlanned(['A','B']),false);assert.equal(p.setPlanned(['A','B','A']),true);
 const q=r.beginInsertion(['C'],()=>true);
 assert.deepEqual(r.reserve(r.capture(),asset(99)),{kind:'blocked',reason:'queue-pending'});
 assert.equal(q.getSources(),null);p.cancel();assert.equal(p.setPlanned(['A','B','A']),false);
 await Promise.all([p.settle(),q.settle()]);assert.equal(r.getReadonlySnapshot().pending.length,0);
});
test('32/64 MiB exact, +1 and concurrent reservations share one atomic budget',async()=>{
 const {r}=fixture();const ps=Array.from({length:3},()=>r.beginPreparation(['A'],()=>true));
 assert.equal(totalLimit,2*fileLimit);
 assert.equal(ps[0].reserveBlob([asset(1,fileLimit+1)]),null);
 const a=ps[0].reserveBlob([asset(1,fileLimit)]),b=ps[1].reserveBlob([asset(2,fileLimit)]);
 assert.ok(a&&b);assert.equal(ps[2].reserveBlob([asset(4)]),null);
 assert.equal(ps[0].reserveBlob([asset(5)]),null,'one preparation cannot mint another reservation');
 await ps[0].settle();assert.equal(a.current(),false);assert.ok(ps[2].reserveBlob([asset(4)]));
 await Promise.all(ps.map(p=>p.settle()));
});
test('credits are opaque, single producer claims exact twelve fields and cancellation retains native custody',async()=>{
 const {r}=fixture(),p=r.beginPreparation(['A'],()=>true),expected=asset(1,fileLimit),credit=p.reserveBlob([expected])!;
 assert.ok(credit);assert.equal(claimBlobCredit({current:()=>true} as BlobCredit,[expected]),null);
 assert.equal(claimBlobCredit(credit,[{...expected,mime:'audio/mpeg'}]),null);
 const claim=claimBlobCredit(credit,[expected])!;assert.ok(claim);assert.equal(claimBlobCredit(credit,[expected]),null);
 let settled=false;const wait=p.settle().then(()=>{settled=true;});await Promise.resolve();assert.equal(settled,false);
 const q=r.beginPreparation(['B'],()=>true);
 assert.equal(q.reserveBlob([asset(2,fileLimit),asset(4,1)]),null);
 claim.complete();claim.complete();await wait;assert.equal(settled,true);
 assert.ok(q.reserveBlob([asset(2,fileLimit),asset(4,1)]));await q.settle();
});
test('unknown historical allocations deny appending and reserve before any producer IO',async()=>{
 const f=fixture();let releases=0;
 const raw:PreparedLocalSources={sources:[{url:'blob:historical',protection:'pinned',asset:asset(1)}],async release(){releases++;}};
 const p=f.r.beginPreparation(['A'],()=>true);p.setPlanned(['A']);const entries=[{id:'A',trackId:'A',src:'blob:historical'}];p.stage(raw,entries);assert.equal(p.publish(),true);f.setPlayer(entries,'blob:historical');await p.settle();
 assert.equal(preparedSourceProvenance(raw),null,'pinned data does not attest an allocation');
 const q=f.r.beginInsertion(['A'],()=>true);q.setPlanned(['A']);assert.throws(()=>q.reserveSources([asset(1)]));
 assert.equal(q.reserveBlob([asset(2)]),null);assert.equal(q.getSources(),null);assert.equal(releases,0);
 await q.settle();assert.equal(releases,0);
});
test('denied/stale producers adopt only their raw bundle once; fabricated allocation JSON cannot authorize stage',async()=>{
 const {r}=fixture(),reservation=r.reserve(r.capture(),asset(99));assert.equal(reservation.kind,'reserved');
 let releases=0;const raw:PreparedLocalSources={sources:[{url:'blob:late',protection:'pinned',asset:asset(1)}],async release(){releases++;}};
 const p=r.beginInsertion(['A'],()=>true);assert.equal(p.setPlanned(['A']),false);
 assert.equal(p.stageNew({bundle:raw,allocations:[{sourceIndex:0,allocationId:'blob:late',kind:'blob',bytes:1}]}),false);
 assert.equal(p.getSources(),null);assert.throws(()=>p.stageNew({bundle:raw,allocations:[]}));
 await p.settle();await p.settle();assert.equal(releases,1);
 assert.equal(r.hasReservation(),true);if(reservation.kind==='reserved')reservation.reservation.release();
 const q=r.beginPreparation(['A'],()=>true);assert.throws(()=>q.stage(raw,[]));await q.settle();
});
test('pending shared reader request receives its own abort signal and rejected acquisition settles without a reader',async()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'navigator');let supplied:AbortSignal|undefined;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request(_name:string,options:{signal?:AbortSignal}){
  supplied=options.signal;return new Promise<void>((_resolve,reject)=>{options.signal!.addEventListener('abort',()=>reject(new DOMException('own acquisition cancelled','AbortError')),{once:true});});
 }}}});
 try{const c=new AbortController(),reader=openAssetReader(asset(1),false,{signal:c.signal});assert.equal(supplied,c.signal);c.abort();await assert.rejects(reader);}
 finally{if(prior)Object.defineProperty(globalThis,'navigator',prior);else Reflect.deleteProperty(globalThis,'navigator');}
});
test('TESTONLY late native lock delivery releases exactly its own acquired lock after abort',async()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'navigator');let released=false,own:Promise<unknown>|undefined;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request(_name:string,_options:unknown,work:()=>Promise<void>){
  // Simulate a platform delivery already in flight; it ignores pending abort.
  own=work().then(()=>{released=true;});return own;
 }}}});
 try{const c=new AbortController(),reader=openAssetReader(asset(1),false,{signal:c.signal});c.abort();await assert.rejects(reader);await own;assert.equal(released,true);}
 finally{if(prior)Object.defineProperty(globalThis,'navigator',prior);else Reflect.deleteProperty(globalThis,'navigator');}
});
