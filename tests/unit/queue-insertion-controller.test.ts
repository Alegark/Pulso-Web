import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Player,type Entry,type Media} from '../../src/playback/player';
import {Activity} from '../../src/playback/ownership';
import {createQueueInsertionController,type QueueInsertionHost,type QueueInsertionIntent,type IntentHandle,type InsertionStatus} from '../../src/playback/queue-insertion-controller';
import type {InsertionPreparation,SourcePreparationResult} from '../../src/playback/local-source-protocol';
import type {LocalAsset} from '../../src/library/library';
import {makeFailure} from '../../src/errors/app-failure';

// Unit boundaries: real coordinator, Player and Activity. Media, source custody
// and storage are declared doubles; native transport is covered separately.
class MediaDouble extends EventTarget implements Media {
 src='';currentTime=0;duration=60;ended=false;calls:string[]=[];
 play(){this.calls.push('play');return Promise.resolve();}
 pause(){this.calls.push('pause');}load(){this.calls.push('load');}
}
const id=(n:number)=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const asset=(n:number):LocalAsset=>({id:id(n),namespace:'local',storageKey:id(n),bytes:1,sha256:'a'.repeat(64),mime:'audio/wav',chunks:1,state:'complete',revision:1,chunkSize:65536,retention:'kept',backend:'idb'});
const entry=(n:number):Entry=>({id:id(n),trackId:id(n),title:String(n),src:`blob:old-${n}`});
const intent=(n:number,placement:'next'|'end'='next',count=1):QueueInsertionIntent=>({intentId:id(10000+n),placement,selection:Array.from({length:count},(_,i)=>({selectionKey:`${n}/${i}`,trackId:id(n+i),entryId:id(1000+n+i)}))});
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
async function until(predicate:()=>boolean){for(let i=0;i<100&&!predicate();i++)await Promise.resolve();assert.equal(predicate(),true,'microtask frontier reached');}
function fixture(options:{empty?:boolean;reuse?:boolean}={}){
 const audio=new MediaDouble(),activity=new Activity();activity.open();let live=true,admitted=true;
 const player=new Player(audio);player.setQueue(options.empty?[]:[entry(1),entry(2)]);if(!options.empty)player.select(0);audio.calls=[];
 const reads:{rows:QueueInsertionIntent['selection'];gate:ReturnType<typeof deferred<void>>}[]=[],producers:{ready:ReturnType<typeof deferred<SourcePreparationResult>>;done:ReturnType<typeof deferred<void>>;cancelled:number}[]=[];
 const preparations:{cancelled:number;settled:number;staged:number}[]=[],statuses:InsertionStatus[]=[],saved:string[][]=[];
 let saveGate:ReturnType<typeof deferred<void>>|null=null;
 const host:QueueInsertionHost={
  canAccept:()=>admitted,beginActivity:()=>activity.begin(),captureExecution:()=>()=>live,getOwnerProof:()=>id(999),getPlayer:()=>player,
  beginSources:(_ids,current)=>{
   const state={cancelled:0,settled:0,staged:0};preparations.push(state);let selected:readonly Readonly<LocalAsset>[]=[];
   const preparation:InsertionPreparation={
    setPlanned:()=>current(),reserveSources:assets=>{selected=assets;return {bindings:assets.map(()=>null),missing:options.reuse?[]:assets,missingIndexByOccurrence:assets.map((_,i)=>i)};},reserveBlob:()=>null,
    stageNew:()=>{state.staged++;return current();},getSources:()=>selected.map(a=>({url:`blob:new-${a.id}`,protection:'pinned',asset:a})),
    bindEntries:()=>current(),commitInsertion:(request,p)=>p.insertQueue(request,()=>current()),cancel:()=>{state.cancelled++;},settle:async()=>{state.settled++;},
   };return preparation;
  },
  resolveSelection:async rows=>{const gate=deferred<void>();reads.push({rows,gate});await gate.promise;return rows.map((r,i)=>({...r,title:`new-${r.trackId}`,asset:asset(50+i)}));},
  startSources:()=>{const p={ready:deferred<SourcePreparationResult>(),done:deferred<void>(),cancelled:0};producers.push(p);return {result:p.ready.promise,settled:p.done.promise,cancel:()=>{p.cancelled++;}};},
  saveLatestQueue:async current=>{if(saveGate)await saveGate.promise;if(!current())return 'not-saved';saved.push(player.entries.map(e=>e.id));return 'saved';},
  onStatus:value=>statuses.push(value),onPendingChanged:()=>{},
 };
 const c=createQueueInsertionController(host);
 const enqueue=(value:QueueInsertionIntent)=>{const result=c.enqueue(value,{current:()=>true});assert.equal(result.kind,'accepted');if(result.kind!=='accepted')throw Error('rejected');return result.handle;};
 const releaseRead=async(index=0)=>{await until(()=>reads.length>index);reads[index].gate.resolve();await until(()=>options.reuse||producers.length>index);};
 const prepared=(index=0)=>{const p=producers[index];p.ready.resolve({kind:'prepared',prepared:{bundle:{sources:[],release:async()=>{}},allocations:[]}});p.done.resolve();};
 return {audio,activity,player,c,reads,producers,preparations,statuses,saved,enqueue,releaseRead,prepared,revoke:()=>{live=false;},deny:()=>{admitted=false;},holdSave:()=>saveGate=deferred<void>()};
}
async function settled(h:IntentHandle){const result=await h.result;await h.settled;return result;}

test('FIFO next intents append after their own tail and preserve the current medium',async()=>{
 const f=fixture(),before={src:f.audio.src,generation:f.player.generation,current:f.player.current};
 const a=f.enqueue(intent(10)),b=f.enqueue(intent(11));assert.equal(f.activity.count,2);assert.equal(f.c.pendingCount,2);assert.equal(f.reads.length,1);
 await f.releaseRead();f.prepared();assert.equal((await settled(a)).kind,'inserted');
 await f.releaseRead(1);f.prepared(1);assert.equal((await settled(b)).kind,'inserted');
 assert.deepEqual(f.player.entries.map(e=>e.id),[id(1),id(1010),id(1011),id(2)]);
 assert.equal(f.player.current,before.current);assert.equal(f.audio.src,before.src);assert.equal(f.player.generation,before.generation);assert.deepEqual(f.audio.calls,[]);assert.equal(f.activity.count,0);
});
test('commit reanchors to the selected occurrence after IO and current FIFO tail invalidation',async()=>{
 const f=fixture(),a=f.enqueue(intent(10));await f.releaseRead();f.player.select(1);f.prepared();await settled(a);
 assert.deepEqual(f.player.entries.map(e=>e.id),[id(1),id(2),id(1010)]);
 const b=f.enqueue(intent(11));await f.releaseRead(1);f.player.moveEntry(id(1010),-1);f.prepared(1);await settled(b);
 assert.deepEqual(f.player.entries.map(e=>e.id),[id(1),id(1010),id(2),id(1011)]);
});
test('one intent is idempotent; changed payload is rejected and whole 53-occurrence selection is captured',async()=>{
 const f=fixture({reuse:true}),value=intent(30,'end',53),h=f.enqueue(value);
 const duplicate=f.c.enqueue(value,{current:()=>false});assert.equal(duplicate.kind,'accepted');if(duplicate.kind==='accepted')assert.equal(duplicate.handle,h);
 assert.deepEqual(f.c.enqueue({...value,placement:'next'},{current:()=>true}),{kind:'rejected',reason:'invalid-input'});
 await f.releaseRead();await settled(h);assert.equal(f.player.entries.length,55);assert.equal(f.producers.length,0);assert.equal(f.reads[0].rows.length,53);assert.equal(f.saved.length,1);
});
test('unselected empty queue remains paused until a later explicit Play',async()=>{
 const f=fixture({reuse:true,empty:true}),h=f.enqueue(intent(10));await f.releaseRead();await settled(h);
 assert.equal(f.player.current,undefined);assert.equal(f.player.state,'paused');assert.equal(f.audio.src,'');assert.deepEqual(f.audio.calls,[]);
 await f.player.play();assert.equal(f.player.current?.id,id(1010));assert.ok(f.audio.calls.includes('play'));
});
test('logical failure retains Activity and prevents a second producer until native settlement',async()=>{
 const f=fixture(),a=f.enqueue(intent(10)),b=f.enqueue(intent(11));await f.releaseRead();
 f.producers[0].ready.resolve({kind:'failed',failure:makeFailure('transport','storage-unavailable','storage-denied','idb'),resourceState:'settling'});
 assert.equal((await a.result).kind,'failed');assert.equal(f.c.pendingCount,2);assert.equal(f.activity.count,2);assert.equal(f.reads.length,1);
 f.producers[0].done.resolve();await a.settled;await f.releaseRead(1);f.prepared(1);await settled(b);assert.equal(f.activity.count,0);
});
test('cancel adopts a late produced bundle before cleanup and preserves the prior queue',async()=>{
 const f=fixture(),h=f.enqueue(intent(10));await f.releaseRead();h.cancel();
 f.producers[0].ready.resolve({kind:'prepared',prepared:{bundle:{sources:[],release:async()=>{}},allocations:[]}});
 assert.equal((await h.result).kind,'cancelled');assert.equal(f.preparations[0].staged,1);assert.equal(f.activity.count,1);assert.equal(f.preparations[0].settled,0);
 f.producers[0].done.resolve();await h.settled;assert.equal(f.preparations[0].settled,1);assert.deepEqual(f.player.entries.map(e=>e.id),[id(1),id(2)]);assert.equal(f.activity.count,0);
});
test('cancel queued attempt settles only its own registration; running producer retains custody',async()=>{
 const f=fixture(),a=f.enqueue(intent(10)),b=f.enqueue(intent(11));await f.releaseRead();b.cancel();assert.equal((await settled(b)).kind,'cancelled');
 assert.equal(f.c.pendingCount,1);assert.equal(f.preparations[0].settled,0);assert.equal(f.preparations[1].settled,1);
 f.prepared();await settled(a);assert.equal(f.reads.length,1);
});
test('replacement epoch or execution revocation prevents publication after a delayed read',async()=>{
 for(const mode of ['epoch','guard'] as const){const f=fixture({reuse:true}),h=f.enqueue(intent(10));if(mode==='epoch')f.player.setQueue([entry(7)]);else f.revoke();
  await f.releaseRead();assert.equal((await settled(h)).kind,'cancelled');assert.equal(f.saved.length,0);assert.equal(f.player.entries.length,mode==='epoch'?1:2);assert.equal(f.activity.count,0);}
});
test('a committed insertion wins cancellation and remains installed if its guarded save is denied',async()=>{
 const f=fixture({reuse:true}),gate=f.holdSave(),h=f.enqueue(intent(10));await f.releaseRead();await until(()=>f.player.entries.length===3);
 h.cancel();f.revoke();gate.resolve();const result=await settled(h);assert.equal(result.kind,'inserted');if(result.kind==='inserted')assert.equal(result.persistence,'not-saved');assert.equal(f.player.entries.length,3);assert.equal(f.activity.count,0);
});
test('limits, stale admission and accessor input reject before any Activity/IO',async()=>{
 const f=fixture();f.deny();assert.equal(f.c.enqueue(intent(10),{current:()=>true}).kind,'rejected');assert.equal(f.activity.count,0);
 const g=fixture();assert.deepEqual(g.c.enqueue(intent(10,'end',1000),{current:()=>true}),{kind:'rejected',reason:'queue-limit'});
 let getters=0;const bad=Object.defineProperty(intent(11),'selection',{get(){getters++;throw Error('getter');}});
 assert.deepEqual(g.c.enqueue(bad,{current:()=>true}),{kind:'rejected',reason:'invalid-input'});assert.equal(getters,0);assert.equal(g.activity.count,0);assert.equal(g.reads.length,0);
});
