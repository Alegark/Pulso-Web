import {verifiedAssetDetailed,verifiedAsset,type LocalAsset,type VerifiedAssetResult} from '../../src/library/library';
import {planQueueRestore,restoreAssetAvailable,type Snapshot} from '../../src/playback/queue-restore';
import {assetDirectory,generationLock} from '../../src/storage/asset-reader';
import {openDatabase,readRecord,writeRecord} from '../../src/storage/database';
import {issuedFailure,type FailureV1} from '../../src/errors/app-failure';

// Counters/hooks are installed ONLY by the isolated Vite runner's transforms.
interface Probe {
 enabled:boolean;assets:number;chunks:number;opens:number;verifies:number;ranges:number;hashes:number;digests:number;releases:number;
 onOpen?:(asset:LocalAsset)=>Promise<void>;onVerify?:(asset:LocalAsset)=>Promise<void>;manifest?:(value:unknown)=>unknown;
}
declare global {var readerProbe:Probe;var readerAvailabilityReport:unknown;}
const probe=globalThis.readerProbe={enabled:false,assets:0,chunks:0,opens:0,verifies:0,ranges:0,hashes:0,digests:0,releases:0} as Probe;
const params=new URLSearchParams(location.search),backend=params.get('backend')==='opfs'?'opfs':'idb',name=params.get('case')!;
function assert(ok:unknown,message:string):asserts ok {if(!ok)throw Error(message);}
function reset(){Object.assign(probe,{enabled:true,assets:0,chunks:0,opens:0,verifies:0,ranges:0,hashes:0,digests:0,releases:0});}
function counts(){const {assets,chunks,opens,verifies,ranges,hashes,digests,releases}=probe;return {assets,chunks,opens,verifies,ranges,hashes,digests,releases};}
async function fixture(){
 const bytes=Uint8Array.from({length:2*65536+37},(_,i)=>(i*17+3)%251);
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const asset:LocalAsset={id:crypto.randomUUID(),namespace:'local',storageKey:crypto.randomUUID(),backend,bytes:bytes.length,sha256,mime:'audio/wav',chunks:3,state:'complete',revision:1,chunkSize:65536,retention:'kept'};
 if(backend==='opfs'){const file=await(await assetDirectory()).getFileHandle(asset.storageKey,{create:true});const writer=await file.createWritable();await writer.write(bytes);await writer.close();}
 else for(let i=0;i<3;i++)await writeRecord('chunks',[asset.storageKey,i],bytes.slice(i*65536,(i+1)*65536));
 await writeRecord('assets',asset.id,asset);return {asset,bytes};
}
async function unlocked(asset:LocalAsset){
 // release resolves the holder promise; the browser relinquishes the lock
 // asynchronously. Queue a bounded exclusive request instead of racing it with
 // ifAvailable in the same microtask.
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3000);
 try{await navigator.locks.request(generationLock(asset),{mode:'exclusive',signal:controller.signal},lock=>{assert(lock,'generation lock leaked');});}
 finally{clearTimeout(timer);}
}
function failure(result:VerifiedAssetResult,state:string,code:string,expectedBackend:string=backend):FailureV1 {
 assert(result.state===state,'wrong detailed state');assert(result.asset===null,'failed result exposed asset');
 assert(result.failure?.code===code,'wrong safe code');assert(result.failure.backend===expectedBackend,'wrong failure backend');
 assert(!JSON.stringify(result).includes('PRIVATE_CANARY'),'raw failure leaked');return result.failure;
}
async function uncertain(id:string,code:string,expectedBackend:string=backend){
 const f=failure(await verifiedAssetDetailed(id,true),'unknown',code,expectedBackend);
 let caught:unknown;try{await restoreAssetAvailable(id);}catch(error){caught=error;}
 assert(issuedFailure(caught)?.code===code,'restore failed to throw issued AppFailure');
 assert(await verifiedAsset(id,true)===null,'legacy must return null for unknown');return f;
}
async function changeBytes(asset:LocalAsset,bytes:Uint8Array<ArrayBuffer>){
 if(backend==='opfs'){const file=await(await assetDirectory()).getFileHandle(asset.storageKey);const writer=await file.createWritable();await writer.write(bytes);await writer.close();}
 else for(let i=0;i<asset.chunks;i++)await writeRecord('chunks',[asset.storageKey,i],bytes.slice(i*65536,(i+1)*65536));
}
const cases:Record<string,()=>Promise<unknown>>={};
for(const mode of ['presence','integrity','restore','legacy-default','legacy-integrity'])cases[`valid-${mode}`]=async()=>{
 const {asset}=await fixture();let fileOpens=0;const getFile=FileSystemFileHandle.prototype.getFile;
 FileSystemFileHandle.prototype.getFile=async function(){fileOpens++;return getFile.call(this);};
 probe.onVerify=async current=>{const held=await navigator.locks.request(generationLock(current),{mode:'exclusive',ifAvailable:true},lock=>Boolean(lock));assert(!held,'verification ran without generation lock');};
 reset();let result;
 try{
  if(mode==='restore')result=await restoreAssetAvailable(asset.id);
  else if(mode.startsWith('legacy'))result=await verifiedAsset(asset.id,mode==='legacy-integrity');
  else result=await verifiedAssetDetailed(asset.id,mode==='integrity');
 }finally{FileSystemFileHandle.prototype.getFile=getFile;delete probe.onVerify;}
 assert(mode==='restore'?result===true:mode.startsWith('legacy')?(result as LocalAsset)?.id===asset.id:(result as VerifiedAssetResult).state==='valid','valid asset lost');
 const integrity=['integrity','restore','legacy-integrity'].includes(mode),ranges=integrity||backend==='idb'?asset.chunks:0;
 assert(probe.assets===2,'manifest read duplicated beyond initial + current generation check');
 assert(probe.opens===1&&probe.verifies===1&&probe.releases===1,'open/verify/release not once');
 assert(probe.ranges===ranges&&probe.chunks===(backend==='idb'?ranges:0),'extra read/prepass');
 assert(probe.hashes===(integrity?1:0)&&probe.digests===(integrity?1:0),'duplicate/missing incremental hash');
 assert(fileOpens===(backend==='opfs'?1:0),'OPFS reopened');await unlocked(asset);return {...counts(),fileOpens};
};
cases['missing-manifest']=async()=>{
 const id=crypto.randomUUID();reset();failure(await verifiedAssetDetailed(id,true),'missing','asset-missing','idb');
 assert(probe.assets===1&&probe.opens===0,'missing manifest opened reader');assert(await restoreAssetAvailable(id)===false,'missing not false');return counts();
};
for(const mode of ['null','invalid','id-mismatch','hostile-manifest'])cases[`manifest-${mode}`]=async()=>{
 const {asset}=await fixture();
 if(mode==='hostile-manifest'){
  let touched=0;probe.manifest=()=>Object.defineProperty({...asset},'backend',{get(){touched++;throw Error('PRIVATE_CANARY backend');}});
  reset();try{failure(await verifiedAssetDetailed(asset.id,true),'corrupt','local-corrupt','idb');assert(touched===0,'manifest getter invoked');}finally{delete probe.manifest;}
 }else{
  await writeRecord('assets',asset.id,mode==='null'?null:mode==='invalid'?{...asset,backend:{name:'opfs'}}:{...asset,id:crypto.randomUUID()});
  reset();failure(await verifiedAssetDetailed(asset.id,true),'corrupt','local-corrupt','idb');assert(await restoreAssetAvailable(asset.id)===false,'corrupt manifest not false');
 }
 assert(probe.opens===0,'invalid manifest opened backend');return counts();
};
cases['digest-presence-legacy-false']=async()=>{
 const {asset,bytes}=await fixture();bytes[0]^=1;await changeBytes(asset,bytes);reset();
 const result=await verifiedAssetDetailed(asset.id);
 assert(result.state==='valid'&&result.failure===null,'presence invented hash failure');
 assert((await verifiedAsset(asset.id))?.id===asset.id,'legacy default changed integrity meaning');
 assert(probe.hashes===0&&probe.digests===0,'presence hashed');
 failure(await verifiedAssetDetailed(asset.id,true),'corrupt','digest-mismatch');await unlocked(asset);return counts();
};
for(const mode of ['missing','short','long','digest','chunk-type'])cases[`bytes-${mode}`]=async()=>{
 if(mode==='chunk-type'&&backend==='opfs')return {notApplicable:'IDB chunk type only'};
 const {asset,bytes}=await fixture();
 if(mode==='missing'){
  if(backend==='opfs')await(await assetDirectory()).removeEntry(asset.storageKey);
  else {const db=await openDatabase();try{const tx=db.transaction('chunks','readwrite');tx.objectStore('chunks').delete([asset.storageKey,1]);await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=reject;});}finally{db.close();}}
 }else if(mode==='chunk-type')await writeRecord('chunks',[asset.storageKey,1],new ArrayBuffer(65536));
 else if(mode==='long'&&backend==='idb')await writeRecord('chunks',[asset.storageKey,2],new Uint8Array(38));
 else {const changed=mode==='short'?bytes.slice(0,-1):mode==='long'?new Uint8Array([...bytes,0]):bytes.slice();if(mode==='digest')changed[65536]^=1;await changeBytes(asset,changed);}
 reset();failure(await verifiedAssetDetailed(asset.id,true),mode==='missing'?'missing':'corrupt',mode==='missing'?'asset-missing':mode==='digest'?'digest-mismatch':mode==='chunk-type'?'local-corrupt':'length-mismatch');
 assert(await restoreAssetAvailable(asset.id)===false,'confirmed bad bytes not false');await unlocked(asset);return counts();
};
cases['generation-changed']=async()=>{
 const {asset}=await fixture();probe.onOpen=async current=>{await writeRecord('assets',asset.id,{...current,revision:current.revision+1});};reset();
 try{const f=await uncertain(asset.id,'asset-changed');assert(f.phase==='open','generation failure phase lost');await unlocked(asset);return counts();}finally{delete probe.onOpen;}
};
for(const where of ['manifest','open','bytes'])for(const kind of ['security','quota','abort','hostile'])cases[`io-${where}-${kind}`]=async()=>{
 if(where==='open'&&backend==='idb')return {notApplicable:'OPFS file open only'};
 const {asset}=await fixture();let touched=0;
 const error=()=>kind==='hostile'?Object.defineProperties({},Object.fromEntries(['name','message','code','cause','toString'].map(key=>[key,{get(){touched++;throw Error('PRIVATE_CANARY getter');}}]))):new DOMException('PRIVATE_CANARY IO',kind==='security'?'SecurityError':kind==='quota'?'QuotaExceededError':'AbortError');
 const get=IDBObjectStore.prototype.get,read=Blob.prototype.arrayBuffer,getFile=FileSystemFileHandle.prototype.getFile;
 IDBObjectStore.prototype.get=function(...args){
  if(where==='manifest'&&this.name==='assets'||where==='bytes'&&backend==='idb'&&this.name==='chunks'){
   if(kind==='abort'){const req=get.apply(this,args);queueMicrotask(()=>this.transaction.abort());return req;}
   throw error();
  }return get.apply(this,args);
 };
 if(where==='bytes'&&backend==='opfs')Blob.prototype.arrayBuffer=async function(){throw error();};
 if(where==='open')FileSystemFileHandle.prototype.getFile=async function(){throw error();};
 reset();try{
  const effectiveBackend=where==='manifest'?'idb':backend;
  const code=kind==='security'?'storage-denied':kind==='quota'?'quota-exceeded':kind==='abort'&&effectiveBackend==='idb'?'transaction-aborted':'unknown';
  const f=await uncertain(asset.id,code,effectiveBackend);assert(f.phase===(where==='open'?'open':'read'),'IO phase lost');
  assert(touched===0,'hostile failure getter invoked');await unlocked(asset);return {...counts(),failure:f,gettersInvoked:touched};
 }finally{IDBObjectStore.prototype.get=get;Blob.prototype.arrayBuffer=read;FileSystemFileHandle.prototype.getFile=getFile;}
};
cases['unknown-plan-preserves']=async()=>{
 const {asset}=await fixture();const snapshot:Snapshot={version:1,entries:[{id:'q0',trackId:asset.id},{id:'q1',trackId:'B'},{id:'q2',trackId:asset.id}],currentEntryId:'q2',position:7,repeat:'one',shuffleOrder:['q2','q1','q0']};
 await writeRecord('settings','queue',snapshot);const original=JSON.stringify(snapshot);const get=IDBObjectStore.prototype.get,put=IDBObjectStore.prototype.put;let writes=0;
 IDBObjectStore.prototype.get=function(...args){if(this.name==='assets'&&args[0]==='B')throw new DOMException('PRIVATE_CANARY','SecurityError');return get.apply(this,args);};
 IDBObjectStore.prototype.put=function(...args){writes++;return put.apply(this,args);};
 reset();let caught:unknown;
 try{await planQueueRestore(snapshot,restoreAssetAvailable);}catch(error){caught=error;}finally{IDBObjectStore.prototype.get=get;IDBObjectStore.prototype.put=put;}
 assert(issuedFailure(caught)?.code==='storage-denied','unknown plan fulfilled');assert(writes===0,'unknown plan wrote');
 assert(JSON.stringify(snapshot)===original&&JSON.stringify(await readRecord('settings','queue'))===original,'snapshot changed');await unlocked(asset);return {writes,...counts()};
};
cases['ABA-survivors-attempt-cache']=async()=>{
 const {asset}=await fixture(),bId=crypto.randomUUID();const snapshot:Snapshot={version:1,entries:[{id:'q0',trackId:asset.id},{id:'q1',trackId:bId},{id:'q2',trackId:asset.id}],currentEntryId:'q2',position:7,repeat:'all',shuffleOrder:['q2','q1','q0']};
 const original=JSON.stringify(snapshot);reset();const plan=await planQueueRestore(snapshot,restoreAssetAvailable);
 assert(plan.missing===1&&plan.snapshot.entries.map(e=>e.id).join()==='q0,q2','ABA survivors lost');
 assert(plan.snapshot.currentEntryId==='q2'&&plan.snapshot.position===7&&plan.snapshot.repeat==='all'&&plan.snapshot.shuffleOrder?.join()==='q2,q0','selection/modes/position changed');
 assert(JSON.stringify(snapshot)===original,'input mutated');assert(probe.verifies===1,'A verified twice in one attempt');
 await writeRecord('assets',bId,{...asset,id:bId});const next=await planQueueRestore(snapshot,restoreAssetAvailable);
 assert(next.missing===0&&next.snapshot.entries.length===3,'availability cached across attempts');assert(Number(probe.verifies)===3,'availability cache survived attempt');await unlocked(asset);return counts();
};
void (async()=>{
 try{assert(cases[name],'unknown case');const details=await cases[name]();globalThis.readerAvailabilityReport={name,backend,passed:true,details};}
 catch(error){globalThis.readerAvailabilityReport={name,backend,passed:false,error:error instanceof Error?error.message:'non-Error test failure'};}
 document.querySelector('#results')!.textContent=JSON.stringify(globalThis.readerAvailabilityReport,null,2);
})();
