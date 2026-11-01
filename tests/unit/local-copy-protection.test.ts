import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLocalCopyProtection} from '../../src/playback/local-copy-protection';
import {Player,type Media} from '../../src/playback/player';
import type {PreparedLocalSource,PreparedLocalSources} from '../../src/playback/local-source-protocol';

const assetId=(id:string)=>`00000000-0000-0000-0000-${id.charCodeAt(0).toString(16).padStart(12,'0')}`;
const asset=(id:string)=>Object.freeze({id:assetId(id),namespace:'local' as const,storageKey:assetId(id),bytes:4,sha256:'a'.repeat(64),mime:'audio/wav',chunks:1,state:'complete' as const,revision:1,chunkSize:65536,retention:'kept' as const,backend:'idb' as const});
function deferred(){let resolve!:()=>void;let reject!:(error:Error)=>void;const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
class Audio implements Media {
 src='';currentTime=0;duration=10;ended=false;
 listeners=new Map<string,Set<EventListener>>();
 async play(){this.event('playing');}pause(){this.event('pause');}load(){}
 addEventListener(type:string,fn:EventListener){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type)!.add(fn);}
 removeEventListener(type:string,fn:EventListener){this.listeners.get(type)?.delete(fn);}
 event(type:string){for(const fn of this.listeners.get(type)??[])fn(new Event(type));}
}
function setup(){
 const audio=new Audio(),player=new Player(audio);let scope=0,proof=0,db=0,activity=0,ready=true;
 const captureCurrent=()=>{const s=scope,p=proof,d=db,a=activity;return()=>s===scope&&p===proof&&d===db&&a===activity&&ready;};
 const registry=createLocalCopyProtection({getPlayer:()=>({entries:player.entries,currentEntryId:player.current?.id??null,source:audio.src||null}),captureCurrent});
 player.subscribe(registry.observePlayer);
 let next=0;const resources=new Set<string>();
 function bundle(ids:string[],release?:()=>Promise<void>,legacy=false){
  let calls=0;const sources:PreparedLocalSource[]=ids.map(id=>{const url=`blob:${++next}`;resources.add(url);return legacy?{url,protection:'unknown',asset:null}:{url,protection:'pinned',asset:asset(id)};});
  const value:PreparedLocalSources={sources,async release(){++calls;if(release)await release();for(const source of sources){assert.notEqual(audio.src,source.url,'resource still installed');resources.delete(source.url);}}};
  return {value,get calls(){return calls;}};
 }
 function stage(ids:string[],b=bundle(ids),entryIds=ids.map((_,i)=>`e${i}`)){
  const h=registry.beginPreparation(ids,captureCurrent());h.setPlanned(ids);
  const entries=ids.map((id,i)=>({id:entryIds[i],trackId:id,title:id,src:b.value.sources[i].url}));
  h.stage(b.value,entries);return {h,entries,b};
 }
 async function install(ids:string[],b=bundle(ids)) {const staged=stage(ids,b);assert.equal(staged.h.publish(),true);player.setQueue(staged.entries);player.select(0);await staged.h.settle();return staged;}
 return {audio,player,registry,bundle,stage,install,resources,captureCurrent,bumpScope:()=>{scope++;},bumpProof:()=>{proof++;},bumpDb:()=>{db++;},bumpActivity:()=>{activity++;},setReady:(v:boolean)=>{ready=v;}};
}

test('opaque captures require exact registry identity and cannot be recovered from readonly JSON',()=>{
 const a=setup(),b=setup(),capture=a.registry.capture();
 assert.ok(a.registry.inspect(capture));assert.equal(b.registry.inspect(capture),null);
 assert.equal(a.registry.inspect(JSON.parse(JSON.stringify(capture))),null);
 const snapshot=a.registry.getReadonlySnapshot();assert.ok(Object.isFrozen(snapshot));assert.ok(Object.isFrozen(snapshot.prepared));
 a.registry.beginPreparation(['A'],()=>true);assert.equal(a.registry.inspect(capture),null);
});

test('all A/B/A occurrences protect their exact resource in paused, ended and error states',async()=>{
 const t=setup(),queue=await t.install(['A','B','A']);
 for(const state of ['paused','ended','error'] as const){t.player.state=state;const s=t.registry.getReadonlySnapshot();assert.equal(s.unknown,false);assert.equal(s.current?.id,'e0');assert.deepEqual(s.prepared.map(e=>e.id),['e1','e2']);assert.deepEqual([s.current!,...s.prepared].map(e=>e.source.asset?.id),['A','B','A'].map(assetId));}
 assert.equal(t.resources.size,3);assert.equal(queue.b.calls,0);assert.notEqual(queue.entries[0].src,queue.entries[2].src);
});

test('admission exposes the entire pending selection synchronously before async preparation',async()=>{
 const t=setup(),ids=Array.from({length:1000},(_,i)=>i%2?'B':'A'),gate=deferred();
 const h=t.registry.beginPreparation(ids,t.captureCurrent());
 const preparing=(async()=>{await gate.promise;h.setPlanned(['A','B','A']);})();
 ids.pop();const s=t.registry.getReadonlySnapshot();assert.equal(s.pending[0].trackIds.length,1000);assert.equal(s.pending[0].planned,false);assert.equal(s.unknown,true);
 gate.resolve();await preparing;assert.deepEqual(t.registry.getReadonlySnapshot().pending[0],{trackIds:['A','B','A'],planned:true});
 await h.settle();assert.equal(t.registry.getReadonlySnapshot().pending.length,0);
});

test('removing a future occurrence retains its whole-bundle resource until confirmed replacement',async()=>{
 const t=setup(),old=await t.install(['A','B','A']);t.player.removeFuture('e2');
 const s=t.registry.getReadonlySnapshot();assert.deepEqual(s.prepared.map(e=>e.id),['e1']);assert.deepEqual(s.retainedSources.map(e=>e.url),[old.entries[2].src]);assert.equal(s.unknown,false);
 await t.registry.releaseUnused();assert.equal(old.b.calls,0);assert.equal(t.resources.size,3);
 await t.install(['C']);assert.equal(old.b.calls,1);assert.equal(t.resources.size,1);assert.equal(t.registry.getReadonlySnapshot().retainedSources.length,0);
});

test('stale preparation releases only its own late bundle and cannot clear a newer queue',async()=>{
 const t=setup();await t.install(['A']);const stale=t.registry.beginPreparation(['B'],t.captureCurrent());stale.setPlanned(['B']);
 t.bumpScope();t.player.suspend();t.registry.invalidateScope();
 const fresh=await t.install(['C']);const late=t.bundle(['B']);
 assert.equal(stale.stage(late.value,[{id:'late',trackId:'B',src:late.value.sources[0].url}]),false);assert.equal(stale.publish(),false);
 await stale.settle();await stale.settle();assert.equal(late.calls,1);assert.equal(fresh.b.calls,0);assert.equal(t.audio.src,fresh.entries[0].src);assert.equal(t.resources.size,1);
});

test('async failed cleanup remains retained and unknown without failing the confirmed replacement',async()=>{
 const t=setup(),gate=deferred(),old=t.bundle(['A'],()=>gate.promise);await t.install(['A'],old);
 const newer=t.stage(['B']);assert.equal(newer.h.publish(),true);t.player.setQueue(newer.entries);t.player.select(0);
 const settlement=newer.h.settle();await Promise.resolve();
 let s=t.registry.getReadonlySnapshot();assert.equal(s.retainedSources[0].url,old.value.sources[0].url);assert.equal(s.pending.length,1);
 gate.reject(new Error('cleanup failed'));await settlement;await t.registry.releaseUnused();
 s=t.registry.getReadonlySnapshot();assert.equal(s.unknown,true);assert.equal(s.current?.trackId,'B');assert.equal(s.retainedSources[0].url,old.value.sources[0].url);assert.equal(old.calls,1);assert.equal(newer.b.calls,0);assert.equal(t.resources.size,2);
});

test('unregistered entries, changed src, duplicate occurrence and installed-source mismatch are unknown',async()=>{
 const t=setup();await t.install(['A','B']);const original=t.player.entries.map(e=>({...e}));
 for(const entries of [[...original,{id:'x',trackId:'X',title:'X',src:'blob:x'}],[{...original[0],src:'blob:alien'},original[1]],[original[0],original[0]]]){t.player.entries=entries;assert.equal(t.registry.getReadonlySnapshot().unknown,true);}
 t.player.entries=original;t.audio.src='blob:alien';assert.equal(t.registry.getReadonlySnapshot().unknown,true);
 t.audio.src=original[0].src;assert.equal(t.registry.getReadonlySnapshot().unknown,false);
});

test('legacy unknown sources remain playable and never acquire an invented asset snapshot',async()=>{
 const t=setup(),b=t.bundle(['A'],undefined,true);await t.install(['A'],b);await t.player.play();
 const s=t.registry.getReadonlySnapshot();assert.equal(t.player.state,'playing');assert.equal(s.unknown,true);assert.equal(s.current?.source.asset,null);
 assert.ok(Object.isFrozen(s.current));assert.ok(Object.isFrozen(s.current?.source));
});

test('serial invalidates resource transitions but stays stable for ticks, titles, repeat, shuffle and movement',async()=>{
 const t=setup();await t.install(['A','B','A']);const serial=t.registry.getReadonlySnapshot().serial,capture=t.registry.capture();
 for(let i=0;i<100;i++){t.audio.event('timeupdate');t.player.setRepeat('all');t.player.setShuffle(true,()=>0.5);t.player.entries[0].title='Edited';t.player.moveEntry('e1',1);t.player.moveEntry('e1',-1);}
 assert.equal(t.registry.getReadonlySnapshot().serial,serial);assert.ok(t.registry.inspect(capture));
 t.player.select(1);assert.ok(t.registry.getReadonlySnapshot().serial>serial);assert.equal(t.registry.inspect(capture),null);
 const before=t.registry.getReadonlySnapshot().serial;const h=t.registry.beginPreparation(['C'],()=>true);assert.ok(t.registry.getReadonlySnapshot().serial>before);const admitted=t.registry.getReadonlySnapshot().serial;h.setPlanned(['C']);assert.ok(t.registry.getReadonlySnapshot().serial>admitted);await h.settle();
});

test('root scope/proof/Activity/DB ABA guards never resurrect captures; scope retirement unloads own bundles',async()=>{
 for(const invalidate of ['bumpScope','bumpProof','bumpDb','bumpActivity'] as const){const t=setup();const old=await t.install(['A']);const capture=t.registry.capture();t[invalidate]();t.setReady(false);t.setReady(true);assert.equal(t.registry.inspect(capture),null);assert.equal(old.b.calls,0);t.player.suspend();t.registry.invalidateScope();await t.registry.releaseUnused();assert.equal(old.b.calls,1);assert.equal(t.resources.size,0);}
 const t=setup();const h=t.registry.beginPreparation(['A'],()=>true);h.setPlanned(['A']);t.registry.invalidateScope();const b=t.bundle(['A']);assert.equal(h.stage(b.value,[{id:'e0',trackId:'A',src:b.value.sources[0].url}]),false);assert.equal(h.publish(),false);await h.settle();assert.equal(b.calls,1);
});

const reserve=(t:ReturnType<typeof setup>,id='Z')=>{
 const result=t.registry.reserve(t.registry.capture(),asset(id));
 assert.equal(result.kind,'reserved');if(result.kind!=='reserved')throw new Error(result.reason);return result.reservation;
};
test('R86 captures, closed targets and competing reservations fail closed',()=>{
 const t=setup(),other=setup(),capture=t.registry.capture();
 assert.equal(t.registry.reserve(other.registry.capture(),asset('Z')).kind,'blocked');
 assert.equal(t.registry.reserve(JSON.parse(JSON.stringify(capture)),asset('Z')).kind,'blocked');
 assert.equal(t.registry.reserve(capture,{...asset('Z'),revision:0}).kind,'blocked');
 const h=reserve(t);assert.equal(h.current(),true);assert.equal(t.registry.inspect(capture),null);
 assert.equal(t.registry.reserve(t.registry.capture(),asset('Y')).kind,'blocked');
 assert.equal(t.registry.hasReservation(),true);assert.equal(t.registry.canPrepare(),false);
 h.release();assert.equal(h.current(),false);assert.equal(t.registry.canPrepare(),true);
});
test('R86 physical identity blocks current, prepared and retained despite changed manifest',async()=>{
 const t=setup();await t.install(['A','B','C']);
 for(const [id,reason] of [['A','player-current'],['B','player-prepared']] as const){assert.deepEqual(t.registry.reserve(t.registry.capture(),{...asset(id),id:assetId('Z'),revision:2,sha256:'b'.repeat(64)}),{kind:'blocked',reason});}
 t.player.removeFuture('e2');assert.deepEqual(t.registry.reserve(t.registry.capture(),{...asset('C'),revision:9}),{kind:'blocked',reason:'source-retained'});
 const h=reserve(t);h.release();
});
test('R86 pending ANY blocks regardless of target; legacy/mismatch remain unknown',async()=>{
 const t=setup(),p=t.registry.beginPreparation(['A'],t.captureCurrent());
 assert.deepEqual(t.registry.reserve(t.registry.capture(),asset('Z')),{kind:'blocked',reason:'queue-pending'});
 p.setPlanned(['A']);assert.equal(t.registry.reserve(t.registry.capture(),asset('Z')).kind,'blocked');await p.settle();
 await t.install(['A'],t.bundle(['A'],undefined,true));assert.deepEqual(t.registry.reserve(t.registry.capture(),asset('Z')),{kind:'blocked',reason:'runtime-unknown'});
 t.audio.src='blob:unregistered';assert.equal(t.registry.reserve(t.registry.capture(),asset('Z')).kind,'blocked');
});
test('R86 denied preparation adopts its own late bundle and never wins publication',async()=>{
 const t=setup(),h=reserve(t),empty=t.registry.beginPreparation(['B'],t.captureCurrent());await empty.settle();assert.equal(h.current(),true);
 const p=t.registry.beginPreparation(['A'],t.captureCurrent());
 assert.equal(p.setPlanned(['A']),false);assert.equal(h.current(),true);
 const b=t.bundle(['A']);assert.equal(p.stage(b.value,[{id:'late',trackId:'A',src:b.value.sources[0].url}]),false);assert.equal(p.publish(),false);
 assert.equal(h.current(),false);assert.equal(t.registry.canPrepare(),false);
 await p.settle();assert.equal(b.calls,1);assert.equal(t.resources.size,0);assert.equal(t.registry.hasReservation(),true);h.release();
});
test('R86 reservation survives scope invalidation conservatively and old release cannot ABA clear newer',()=>{
 const t=setup(),old=reserve(t);t.registry.invalidateScope();assert.equal(old.current(),false);assert.equal(t.registry.hasReservation(),true);assert.equal(t.registry.canPrepare(),false);
 assert.equal(t.registry.reserve(t.registry.capture(),asset('Y')).kind,'blocked');old.release();const fresh=reserve(t);old.release();assert.equal(fresh.current(),true);assert.equal(t.registry.hasReservation(),true);fresh.release();
});
test('R86 Player and root proof DB Activity epochs invalidate without reopening admission',async()=>{
 for(const change of ['bumpScope','bumpProof','bumpDb','bumpActivity'] as const){const t=setup(),h=reserve(t);t[change]();assert.equal(h.current(),false);assert.equal(t.registry.canPrepare(),false);h.release();}
 const t=setup();await t.install(['A','B']);const h=reserve(t);t.player.select(1);t.player.select(0);assert.equal(h.current(),false);assert.equal(t.registry.hasReservation(),true);h.release();
});
test('R86 ticks titles modes do not invalidate; release invalidates captures',async()=>{
 const t=setup();await t.install(['A','B']);const h=reserve(t),capture=t.registry.capture();
 for(let i=0;i<30;i++){t.audio.event('timeupdate');t.player.entries[0].title='Title';t.player.setRepeat('all');t.player.setShuffle(true,()=>0.5);}
 assert.equal(h.current(),true);assert.ok(t.registry.inspect(capture));h.release();assert.equal(t.registry.inspect(capture),null);h.release();
});
test('R86 throwing root guards never authorize or reopen admission',()=>{
 let throws=false;const r=createLocalCopyProtection({getPlayer:()=>({entries:[],currentEntryId:null,source:null}),captureCurrent:()=>{if(throws)throw new Error('root unavailable');return()=>{if(throws)throw new Error('guard unavailable');return true;};}});
 const c=r.capture();throws=true;assert.equal(r.reserve(c,asset('Z')).kind,'blocked');assert.equal(r.canPrepare(),false);
 throws=false;const result=r.reserve(r.capture(),asset('Z'));assert.equal(result.kind,'reserved');if(result.kind!=='reserved')return;
 throws=true;assert.equal(result.reservation.current(),false);throws=false;assert.equal(result.reservation.current(),false);assert.equal(r.canPrepare(),false);result.reservation.release();
});
