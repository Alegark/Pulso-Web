/** Standalone native harness. Build ONLY this HTML with Vite configFile:false,
 * publicDir:false, outDir:.local/queue-source-composition-r107/build; build the
 * existing src/service-worker/sw.ts separately with SHELL_FILES=[] into that
 * same directory. Serve loopback in an isolated browser context. ?mode=blob
 * tests native Blob/IDB/OPFS; ?mode=sw tests the actual physicalSources:1 worker.
 * Reply barriers and URL failure injections are explicitly TESTONLY below.
 * No ignored fixture input, existing runner changes or owner data are needed. */
import {createLocalCopyProtection} from '../../src/playback/local-copy-protection';
import {prepareBoundedBlobSources} from '../../src/playback/blob-source';
import {prepareLocalSources,startLocalSourcePreparation,preparedSourceProvenance} from '../../src/playback/transport';
import {Player} from '../../src/playback/player';
import {openDatabase,closeDatabase,writeRecord,DATABASE} from '../../src/storage/database';
import {openAssetReader,generationLock,ASSET_DIRECTORY} from '../../src/storage/asset-reader';
import type {LocalAsset} from '../../src/library/library';
import type {Entry} from '../../src/playback/player';
import type {InsertionPreparation,NewSourceBundle,PreparedLocalSources,BlobCredit} from '../../src/playback/local-source-protocol';
const checks:{name:string;kind:'native'|'TESTONLY';details?:unknown}[]=[];
function ok(value:unknown,message:string):asserts value {if(!value)throw new Error(message);}
function equal(a:unknown,b:unknown,message:string){ok(JSON.stringify(a)===JSON.stringify(b),`${message}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);}
function passed(name:string,kind:'native'|'TESTONLY'='native',details?:unknown){checks.push({name,kind,details});}
const nextTask=()=>new Promise<void>(r=>setTimeout(r,0));
function deferred<T=void>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
async function hold(name:string,mode:'shared'|'exclusive'='exclusive'){
 const ready=deferred(),end=deferred();const done=navigator.locks.request(name,{mode},async()=>{ready.resolve();await end.promise;});await ready.promise;
 return async()=>{end.resolve();await done;};
}
const hex=(b:ArrayBuffer)=>[...new Uint8Array(b)].map(n=>n.toString(16).padStart(2,'0')).join('');
async function fixture(backend:'idb'|'opfs'='idb',length=131116):Promise<LocalAsset>{
 const bytes=new Uint8Array(length);for(let i=44;i<length;i++)bytes[i]=(i*17)%251;
 // Own synthetic PCM WAV, valid enough for native Audio playback.
 const v=new DataView(bytes.buffer);const str=(at:number,s:string)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));
 str(0,'RIFF');v.setUint32(4,length-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,length-44,true);
 const asset:LocalAsset={id:crypto.randomUUID(),namespace:'local',storageKey:crypto.randomUUID(),bytes:length,sha256:hex(await crypto.subtle.digest('SHA-256',bytes)),mime:'audio/wav',chunks:Math.ceil(length/65536),state:'complete',revision:1,chunkSize:65536,retention:'kept',backend};
 if(backend==='idb')for(let i=0;i<asset.chunks;i++)await writeRecord('chunks',[asset.storageKey,i],bytes.slice(i*65536,(i+1)*65536));
 else{const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle(ASSET_DIRECTORY,{create:true}),file=await dir.getFileHandle(asset.storageKey,{create:true}),w=await file.createWritable();await w.write(bytes);await w.close();}
 await writeRecord('assets',asset.id,asset);return Object.freeze(asset);
}
function setup(){
 const audio=new Audio(),player=new Player(audio);let current=true;
 const registry=createLocalCopyProtection({captureCurrent:()=>()=>current,getPlayer:()=>({entries:player.entries,currentEntryId:player.current?.id??null,source:audio.getAttribute('src')||null})});
 player.subscribe(registry.observePlayer);
 return {audio,player,registry,revoke(){current=false;},async dispose(){player.suspend();registry.invalidateScope();await registry.releaseUnused();audio.remove();}};
}
const entry=(trackId:string,src:string):Entry=>({id:crypto.randomUUID(),trackId,title:trackId,src});
const newBundle=(bundle:PreparedLocalSources):NewSourceBundle=>({bundle,allocations:preparedSourceProvenance(bundle)!.allocations});
function bind(p:InsertionPreparation,trackIds:readonly string[]){const list=p.getSources();ok(list,'complete routed sources');const entries=list.map((s,i)=>entry(trackIds[i],s.url));ok(p.bindEntries(entries),'bound entries');return entries;}
function commit(f:ReturnType<typeof setup>,p:InsertionPreparation,entries:readonly Entry[],revision=f.player.queueRevision){
 return p.commitInsertion({intentId:crypto.randomUUID(),placement:'end',entries,expectedQueueRevision:revision,expectedQueueEpoch:f.player.queueEpoch,afterEntryId:null},f.player);
}
async function oldBlob(f:ReturnType<typeof setup>,assets:readonly LocalAsset[],proof:string,tracks=assets.map(a=>a.id)){
 const p=f.registry.beginPreparation(tracks,()=>true);ok(p.setPlanned(tracks),'old planned');
 const credit=p.reserveBlob(assets);ok(credit,'old shared credit');
 const bundle=await prepareBoundedBlobSources(assets.map(a=>a.id),proof,()=>true,{expected:assets,credit,signal:new AbortController().signal,deadlineAt:performance.now()+30000});
 const entries=tracks.map((id,i)=>entry(id,bundle.sources[i].url));ok(p.stage(bundle,entries),'old stage');ok(p.publish(),'old publish');f.player.setQueue(entries);f.player.select(0);await p.settle();return {bundle,entries};
}
async function materialize(p:InsertionPreparation,assets:readonly LocalAsset[],proof:string){
 const credit=p.reserveBlob(assets);ok(credit,'insertion shared credit');
 const bundle=await prepareBoundedBlobSources(assets.map(a=>a.id),proof,()=>true,{expected:assets,credit,signal:new AbortController().signal,deadlineAt:performance.now()+30000});
 ok(p.stageNew(newBundle(bundle)),'new stage');return bundle;
}
async function runBlob(proof:string){
 const a=await fixture(),b=await fixture('opfs'),f=setup();
 try{
  const old=await oldBlob(f,[a],proof,['A']);await f.audio.play();const src=f.audio.src,oldBytes=hex(await (await fetch(src)).arrayBuffer());
  let reads=0,urls=0;const create=URL.createObjectURL,originalGet=IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get=function(...args:Parameters<IDBObjectStore['get']>){if(this.name==='chunks')reads++;return originalGet.apply(this,args);};
  URL.createObjectURL=function(obj){urls++;return create.call(URL,obj);};
  try{
   const p=f.registry.beginInsertion(['A','A'],()=>true);p.setPlanned(['A','A']);const route=p.reserveSources([a,a]);equal(route.missing.length,0,'reuse zero producer');
   const entries=bind(p,['A','A']);equal(entries.map(e=>e.src),[src,src],'two occurrence URLs reused');ok(entries[0].id!==entries[1].id,'occurrence IDs distinct');
   equal(commit(f,p,entries).kind,'inserted','reuse commit');await p.settle();equal([reads,urls],[0,0],'reuse no chunks/hash/materialization');
  }finally{IDBObjectStore.prototype.get=originalGet;URL.createObjectURL=create;}
  passed('reuse A twice: one native allocation, two IDs, zero old IO');
  const p=f.registry.beginInsertion(['B'],()=>true);p.setPlanned(['B']);equal(p.reserveSources([b]).missing.length,1,'B unique');const bundle=await materialize(p,[b],proof);const entries=bind(p,['B']);
  let coherent=false;const unsub=f.player.subscribe(()=>{const s=f.registry.getReadonlySnapshot();coherent=!s.unknown&&s.prepared.some(e=>e.id===entries[0].id);});
  equal(commit(f,p,entries).kind,'inserted','compose A+B');unsub();ok(coherent,'observer sees coherent two states');await p.settle();
  equal(f.audio.src,src,'A still installed');equal(hex(await(await fetch(src)).arrayBuffer()),oldBytes,'A bytes unchanged');
  f.player.removeFuture(entries[0].id);await f.registry.releaseUnused();equal(hex(await(await fetch(src)).arrayBuffer()),oldBytes,'A survives B release');
  let revoked=false;try{await fetch(bundle.sources[0].url);}catch{revoked=true;}ok(revoked,'only B revoked');passed('multi-record Blob A + native OPFS B, removal releases B only');
  const gen2=await fixture('opfs');const repair={...gen2,id:a.id,revision:2} as LocalAsset;await writeRecord('assets',a.id,repair);
  const q=f.registry.beginInsertion(['A'],()=>true);q.setPlanned(['A']);equal(q.reserveSources([repair]).missing.length,1,'generation2 distinct');await materialize(q,[repair],proof);const e2=bind(q,['A']);ok(e2[0].src!==src,'repaired new URL');equal(commit(f,q,e2).kind,'inserted','repair commit');await q.settle();
  equal(f.registry.getReadonlySnapshot().current?.source.asset?.storageKey,a.storageKey,'old source snapshot unchanged');equal(hex(await(await fetch(src)).arrayBuffer()),oldBytes,'old Blob bytes unchanged');passed('same Track repair gets generation2; generation1 current snapshot retained');
  const collision=f.registry.beginInsertion(['A'],()=>true);collision.setPlanned(['A']);let rejected=false;try{collision.reserveSources([{...a,revision:5}]);}catch{rejected=true;}ok(rejected,'same physical metadata collision fails');await collision.settle();passed('physical key metadata mismatch denied');
  const cas=f.registry.beginInsertion(['A'],()=>true);cas.setPlanned(['A']);cas.reserveSources([a]);const ce=bind(cas,['A']),before=f.registry.getReadonlySnapshot(),count=f.player.entries.length;
  equal(commit(f,cas,ce,f.player.queueRevision-1),{kind:'rejected',reason:'stale-queue'},'CAS rejected');equal(f.player.entries.length,count,'Player unchanged');equal(f.registry.getReadonlySnapshot().prepared,before.prepared,'protection map unchanged');await cas.settle();passed('CAS rejection preserves Player and all exact bindings');
  equal(old.bundle.sources[0].asset?.storageKey,a.storageKey,'raw source immutable');
  // TESTONLY synchronous ownership loss immediately after native URL creation.
  const stale=f.registry.beginInsertion(['late'],()=>true);stale.setPlanned(['late']);const lateAsset=await fixture('opfs');stale.reserveSources([lateAsset]);
  const credit=stale.reserveBlob([lateAsset]);ok(credit,'late credit');const originalCreate=URL.createObjectURL;let lateURL='';
  URL.createObjectURL=function(obj){lateURL=originalCreate.call(URL,obj);stale.cancel();return lateURL;};
  try{let failed=false;try{await prepareBoundedBlobSources([lateAsset.id],proof,()=>true,{expected:[lateAsset],credit,signal:new AbortController().signal,deadlineAt:performance.now()+30000});}catch{failed=true;}ok(failed,'late URL guard rejected');}
  finally{URL.createObjectURL=originalCreate;}
  await stale.settle();await stale.settle();let lateRevoked=false;try{await fetch(lateURL);}catch{lateRevoked=true;}ok(lateRevoked,'late own URL revoked');equal(hex(await(await fetch(src)).arrayBuffer()),oldBytes,'old A never revoked');passed('URL retained before guard; stale producer cleanup only owns late URL','TESTONLY');
  const corrupted=await fixture();await writeRecord('chunks',[corrupted.storageKey,0],new Uint8Array(65536));
  const bad=f.registry.beginPreparation(['bad'],()=>true),badCredit=bad.reserveBlob([corrupted]);ok(badCredit,'bad reserved');
  let failure=false;try{await prepareBoundedBlobSources([corrupted.id],proof,()=>true,{expected:[corrupted],credit:badCredit,signal:new AbortController().signal,deadlineAt:performance.now()+30000});}catch{failure=true;}ok(failure,'native SHA mismatch denied');await bad.settle();passed('native IDB digest mismatch never publishes a subset');
  const mismatch=f.registry.beginPreparation(['changed'],()=>true),mismatchCredit=mismatch.reserveBlob([lateAsset]);ok(mismatchCredit,'manifest reserved');
  await writeRecord('assets',lateAsset.id,{...lateAsset,mime:'audio/mpeg'});failure=false;try{await prepareBoundedBlobSources([lateAsset.id],proof,()=>true,{expected:[lateAsset],credit:mismatchCredit,signal:new AbortController().signal,deadlineAt:performance.now()+30000});}catch{failure=true;}ok(failure,'exact expected MIME mismatch rejected');await mismatch.settle();passed('twelve-field expected manifest fixed before producer IO');
  const original=IDBObjectStore.prototype.get;let chunkReads=0;IDBObjectStore.prototype.get=function(...args:Parameters<IDBObjectStore['get']>){if(this.name==='chunks')chunkReads++;return original.apply(this,args);};
  try{failure=false;try{await prepareBoundedBlobSources([b.id],proof,()=>true,{expected:[b],credit:{current:()=>true} as BlobCredit,signal:new AbortController().signal,deadlineAt:performance.now()+30000});}catch{failure=true;}ok(failure,'fabricated credit rejected');equal(chunkReads,0,'no chunk read with forged credit');}
  finally{IDBObjectStore.prototype.get=original;}
  passed('opaque credit rejected before chunks/Blob/URL','TESTONLY');
  const delivered=await fixture('opfs'),custody=f.registry.beginInsertion(['late'],()=>true);custody.setPlanned(['late']);custody.reserveSources([delivered]);const deliveredCredit=custody.reserveBlob([delivered]);ok(deliveredCredit,'delivered credit');
  const deliveredRaw=await prepareBoundedBlobSources([delivered.id],proof,()=>true,{expected:[delivered],credit:deliveredCredit,signal:new AbortController().signal,deadlineAt:performance.now()+30000});
  custody.cancel();equal(custody.stageNew(newBundle(deliveredRaw)),false,'stale raw adopted but not published');await custody.settle();await custody.settle();let gone=false;try{await fetch(deliveredRaw.sources[0].url);}catch{gone=true;}ok(gone,'stale adopted own raw cleaned');equal(hex(await(await fetch(src)).arrayBuffer()),oldBytes,'stale adopted cleanup preserves A');passed('late prepared raw adopted exactly once after cancellation; own cleanup idempotent');
  const invalid=f.registry.beginInsertion(['released'],()=>true);invalid.setPlanned(['released']);invalid.reserveSources([delivered]);const invalidCredit=invalid.reserveBlob([delivered]);ok(invalidCredit,'invalid credit');const invalidRaw=await prepareBoundedBlobSources([delivered.id],proof,()=>true,{expected:[delivered],credit:invalidCredit,signal:new AbortController().signal,deadlineAt:performance.now()+30000});await invalidRaw.release();equal(invalid.stageNew(newBundle(invalidRaw)),false,'released producer is not live authority');await invalid.settle();passed('trusted provenance includes live lifecycle, never a previously released allocation');


 }finally{await f.dispose();}
 // Historical producer created two actual URLs for the SAME asset; do not
 // retroactively call those allocations one merely because bytes match.
 const big=await fixture('idb',8388608),g=setup();
 try{
  const old=await oldBlob(g,[big,big],proof,['A','A']);ok(old.entries[0].src!==old.entries[1].src,'historical allocations distinct');
  g.player.removeFuture(old.entries[1].id);await g.registry.releaseUnused();equal(g.registry.getReadonlySnapshot().retainedSources.length,1,'raw sibling retained');
  const p=g.registry.beginInsertion(['C'],()=>true);p.setPlanned(['C']);const expected=await fixture('opfs',8388608);p.reserveSources([expected]);ok(p.reserveBlob([expected]),'16+8 exact allowed');
  const overflow=g.registry.beginPreparation(['D'],()=>true);equal(overflow.reserveBlob([{...a,id:crypto.randomUUID(),storageKey:crypto.randomUUID(),bytes:1,chunks:1}]),null,'16+8+1 denied');await overflow.settle();await p.settle();passed('two old URLs count twice; sibling retained; entire queue24MiB exact/+1');
  const replace=g.registry.beginPreparation(['new','new','new'],()=>true);equal(replace.reserveBlob([big,big,big]),null,'cannot prepare24 old retained16 + new24');await replace.settle();passed('replacement shares budget and preserves old installed source');
  // TESTONLY inject revoke failure; real allocation remains observable/charged.
  const revoke=URL.revokeObjectURL;URL.revokeObjectURL=()=>{throw new Error('TESTONLY revoke failure');};
  try{g.player.suspend();g.registry.invalidateScope();await g.registry.releaseUnused();ok(g.registry.getReadonlySnapshot().unknown,'failed cleanup unknown');const n=g.registry.beginInsertion(['A'],()=>true);n.setPlanned(['A']);equal(n.reserveBlob([a]),null,'failed cleanup denies budget');await n.settle();}
  finally{URL.revokeObjectURL=revoke;for(const s of old.bundle.sources)revoke.call(URL,s.url);}
  passed('failed raw cleanup retains unknown budget; no invented zero','TESTONLY');
 }finally{await g.dispose();}
 const lock=await fixture(),unlock=await hold(generationLock(lock));
 try{const abort=new AbortController();const r=openAssetReader(lock,true,{signal:abort.signal});await nextTask();abort.abort();let rejected=false;try{await r;}catch{rejected=true;}ok(rejected,'pending reader cancelled');}
 finally{await unlock();}
 const r=await openAssetReader(lock);equal((await r.verifyDetailed()).state,'valid','lock available after own cancelled request');r.release();passed('native Web Locks pending own shared request abort; other lock intact');
}
async function runSW(proof:string){
 await navigator.serviceWorker.register('/sw.js',{type:'module'});await navigator.serviceWorker.ready;
 if(!navigator.serviceWorker.controller)await new Promise<void>(r=>navigator.serviceWorker.addEventListener('controllerchange',()=>r(),{once:true}));
 const a=await fixture(),b=await fixture('opfs'),f=setup();
 try{
  const old=f.registry.beginPreparation(['A'],()=>true);old.setPlanned(['A']);const bundle=await prepareLocalSources([a.id],proof,()=>true,{signal:new AbortController().signal,current:()=>true,deadlineAt:performance.now()+30000,reserveBlob:old.reserveBlob});
  equal(preparedSourceProvenance(bundle)?.allocations[0].kind,'sw','native pinned provenance');const entries=[entry('A',bundle.sources[0].url)];old.stage(bundle,entries);ok(old.publish(),'old SW publish');f.player.setQueue(entries);f.player.select(0);await old.settle();
  const source=f.audio.src,before=hex(await(await fetch(source)).arrayBuffer());
  const p=f.registry.beginInsertion(['B'],()=>true);p.setPlanned(['B']);const routing=p.reserveSources([b]);const signal=new AbortController();const attempt=startLocalSourcePreparation(routing.missing,proof,{signal:signal.signal,current:()=>true,deadlineAt:performance.now()+30000,reserveBlob:p.reserveBlob});
  const result=await attempt.result;ok(result.kind==='prepared','B physical prepared');ok(p.stageNew(result.prepared),'B stage');const added=bind(p,['B']);equal(commit(f,p,added).kind,'inserted','SW append');await attempt.settled;await p.settle();
  equal(hex(await(await fetch(source)).arrayBuffer()),before,'SW A bytes same after append');f.player.removeFuture(added[0].id);await f.registry.releaseUnused();equal((await fetch(added[0].src)).status,403,'B ticket released');equal(hex(await(await fetch(source)).arrayBuffer()),before,'SW A remains');passed('native SW physical1 A bytes stable append B / release B exact tokens');
  // Native worker/IDB and native MessageChannel, with TESTONLY late/double reply.
  for(const scenario of ['cancel','timeout','controllerABA'] as const){
   const original=ServiceWorker.prototype.postMessage;const captured=deferred<{port:MessagePort;data:unknown;proxy:MessagePort}>();
   ServiceWorker.prototype.postMessage=function(message:unknown,transfer?:Transferable[]|StructuredSerializeOptions){
    const m=message as {type?:string};
    if(m.type==='pinned-local-sources'&&Array.isArray(transfer)){
     const channel=new MessageChannel(),port=transfer[0] as MessagePort;
     channel.port1.onmessage=event=>captured.resolve({port,data:event.data,proxy:channel.port1});
     return Reflect.apply(original,this,[message,[channel.port2]]);
    }
    return Reflect.apply(original,this,[message,transfer]);
   };
   const late=f.registry.beginInsertion(['B'],()=>true);late.setPlanned(['B']);late.reserveSources([b]);const abort=new AbortController();let settled=false;
   let pending:ReturnType<typeof startLocalSourcePreparation>|null=null;
   try{
    pending=startLocalSourcePreparation([b],proof,{signal:abort.signal,current:()=>true,deadlineAt:performance.now()+30000,reserveBlob:late.reserveBlob});pending.settled.then(()=>{settled=true;});
    const ack=await captured.promise;
    // Wrong request and changed assets cannot release the native custody channel.
    const dto=ack.data as Record<string,unknown>;
    ack.port.postMessage({...dto,requestId:crypto.randomUUID()});ack.port.postMessage({...dto,assets:[{...b,revision:9}]});await nextTask();equal(settled,false,'malformed ACK not terminal');
    if(scenario==='cancel')abort.abort();
    if(scenario==='controllerABA'){navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));}
    if(scenario!=='controllerABA'){
     const terminal=await pending.result;equal(terminal.kind,scenario==='cancel'?'cancelled':'failed','logical terminal');equal(terminal.kind==='prepared'?null:terminal.resourceState,'uncertain','unobserved ACK uncertain');
    }
    await nextTask();equal(settled,false,'not physically settled before ACK');ok(f.registry.getReadonlySnapshot().pending.length===1,'pending retained while ACK late');
    ack.port.postMessage(ack.data);ack.port.postMessage(ack.data);ack.port.close();ack.proxy.close();
    if(scenario==='controllerABA'){const terminal=await pending.result;equal(terminal.kind,'failed','controller ABA never publishes');}
    await pending.settled;await late.settle();equal(settled,true,'late terminal cleanup settled once');equal(hex(await(await fetch(source)).arrayBuffer()),before,'late B cleanup never touches A');
   }finally{ServiceWorker.prototype.postMessage=original;}
   passed(`native pin + TESTONLY ACK barrier: ${scenario}, malformed/double ACK, exact cleanup`,'TESTONLY');
  }
 }finally{await f.dispose();}
}
async function cleanup(){
 for(const registration of await navigator.serviceWorker.getRegistrations())await registration.unregister();
 for(const key of await caches.keys())await caches.delete(key);
 const root=await navigator.storage.getDirectory();await root.removeEntry(ASSET_DIRECTORY,{recursive:true}).catch(()=>{});
 const db=await openDatabase();closeDatabase(db);
 await new Promise<void>((resolve,reject)=>{const r=indexedDB.deleteDatabase(DATABASE);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('cleanup database blocked'));});
}
const mode=new URL(location.href).searchParams.get('mode')??'blob';
void (async()=>{
 let releasePlayback:(()=>Promise<void>)|undefined,releaseProof:(()=>Promise<void>)|undefined,error:unknown=null,clean=false;
 try{const proof=`pulso-web:local:owner:${crypto.randomUUID()}`;releasePlayback=await hold('pulso-web:local:playback');releaseProof=await hold(proof);if(mode==='sw')await runSW(proof);else await runBlob(proof);}
 catch(e){error=e instanceof Error?{message:e.message,stack:e.stack}:String(e);}
 finally{await releaseProof?.();await releasePlayback?.();try{await cleanup();clean=true;}catch(e){error??=String(e);}}
 const report={mode,checks,error,cleanup:clean};Object.assign(window,{queueSourceReport:report});document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);
})();
