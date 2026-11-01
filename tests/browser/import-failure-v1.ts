import {restoreAssetAvailable} from '../../src/playback/queue-restore';
import {importFileDetailed,importFile} from '../../src/imports/import-file';
import {importOperation,recoverImportOperationDetailed,cleanupOperation,updateOperation} from '../../src/storage/import-operations';
import {assetDirectory,openAssetReader,verificationFailure} from '../../src/storage/asset-reader';
import {all,type LocalAsset,editTrack,createPlaylist,changePlaylist,type Track,type Playlist} from '../../src/library/library';
import {openDatabase,readRecord,writeRecord} from '../../src/storage/database';
import {copyWorkerResponse,createResponseGate} from '../../src/imports/import-protocol';
import {validOutcomeV1,type ImportAttemptResult} from '../../src/imports/import-outcome';
import {nativeDOMName,fromKnownError} from '../../src/errors/app-failure';
import {wav,assert} from './import-failure-fixture';
const signal=()=>new AbortController().signal;
const params=new URLSearchParams(location.search);const backend=params.get('backend')==='idb'?'idb':'opfs';
const name=params.get('case')!;
const cases:Record<string,()=>Promise<unknown>>={};
function outcome(result:ImportAttemptResult){assert(validOutcomeV1(result.outcome),'invalid outcome');assert(!JSON.stringify(result.outcome).includes('PRIVATE_CANARY'),'raw canary in outcome');return result.outcome;}
async function published(seed=1){const result=await importFileDetailed(wav(seed),signal(),()=>{},{backend});assert(result.kind==='confirmed','fixture did not publish');return result;}
async function assetFor(id:string){const asset=await readRecord<LocalAsset>('assets',id);assert(asset,'asset absent');return asset;}
async function verify(asset:LocalAsset,integrity=true){try{const reader=await openAssetReader(asset);try{return await reader.verifyDetailed(integrity);}finally{reader.release();}}catch(error){return verificationFailure(error,asset.backend);}}
async function kept(){
 const imported=await published();const asset=await assetFor(imported.result.track.assetId);
 await editTrack(imported.result.track.id,1,{title:'Manual preserved',favorite:true});const track=imported.result.track;
 const list=await createPlaylist('Private list');await changePlaylist(list.id,list.revision,{type:'add',trackId:track.id});
 return async()=>{const current=await assetFor(asset.id);assert(current.storageKey===asset.storageKey,'kept generation replaced');assert((await verify(current)).state==='valid','kept bytes changed');const t=await readRecord<Track>('tracks',track.id);assert(t?.favorite&&t.title==='Manual preserved','manual/favorite lost');const p=await readRecord<Playlist>('playlists',list.id);assert(p?.entries[0]?.trackId===track.id,'playlist lost');};
}
cases['success-legacy']=async()=>{
 const a=await published();const o=outcome(a);assert(o.status==='confirmed'&&o.writeState==='published','not durable');assert(o.closeState===(backend==='idb'?'not-applicable':'acknowledged'),'fake close');
 const b=await importFile(wav(),signal(),()=>{},{backend});assert(b.duplicate&&b.track.id===a.result.track.id,'legacy mismatch');return o;
};
for(const secondary of ['none','abort','cleanup','reconcile','combined'])cases[`quota-${secondary}`]=async()=>{
 const retained=await kept();const id=crypto.randomUUID();
 const write=FileSystemWritableFileStream.prototype.write,abort=FileSystemWritableFileStream.prototype.abort,remove=FileSystemDirectoryHandle.prototype.removeEntry,put=IDBObjectStore.prototype.put,get=IDBObjectStore.prototype.get;
 let injected=false;
 if(backend==='opfs')FileSystemWritableFileStream.prototype.write=async function(){injected=true;throw new DOMException('PRIVATE_CANARY quota','QuotaExceededError');};
 else IDBObjectStore.prototype.put=function(...args){if(this.name==='chunks'){injected=true;throw new DOMException('PRIVATE_CANARY quota','QuotaExceededError');}return put.apply(this,args);};
 if(secondary==='abort'||secondary==='combined')FileSystemWritableFileStream.prototype.abort=async function(){throw Error('PRIVATE_CANARY abort');};
 if(secondary==='cleanup'){
 if(backend==='opfs')FileSystemDirectoryHandle.prototype.removeEntry=async function(){throw Error('PRIVATE_CANARY cleanup');};
 else IDBObjectStore.prototype.openCursor=function(){throw new DOMException('PRIVATE_CANARY cleanup','SecurityError');};
 }
 if(secondary==='reconcile'||secondary==='combined')IDBObjectStore.prototype.get=function(...args){if(injected&&this.name==='jobs')throw new DOMException('PRIVATE_CANARY reopen','SecurityError');return get.apply(this,args);};
 const cursor=IDBObjectStore.prototype.openCursor; // saved separately below for IDB cleanup case
 let result;
 try{result=await importFileDetailed(wav(2),signal(),()=>{},{backend,operationId:id});}
 finally{FileSystemWritableFileStream.prototype.write=write;FileSystemWritableFileStream.prototype.abort=abort;FileSystemDirectoryHandle.prototype.removeEntry=remove;IDBObjectStore.prototype.put=put;IDBObjectStore.prototype.get=get;if(secondary==='cleanup'&&backend==='idb')IDBObjectStore.prototype.openCursor=originalCursor;else IDBObjectStore.prototype.openCursor=cursor;}
 const o=outcome(result);assert(result.kind==='failed'&&o.primary?.code==='quota-exceeded'&&o.primary.phase==='write'&&o.primary.backend===backend,'primary quota/phase/backend lost');
 const uncertain=secondary!=='none'&&(backend==='opfs'||secondary!=='abort');assert(o.recoveryRequired===uncertain,'recovery state');
 if(secondary==='combined'&&backend==='opfs')assert(o.cleanup&&o.reconcile,'independent failures missing');
 if(secondary==='cleanup')assert(o.cleanup?.phase==='cleanup','cleanup missing');
 if(secondary==='reconcile'||secondary==='combined')assert(o.reconcile?.phase==='reconcile','reconcile missing');
 const job=await importOperation(id);assert(job&&job.backend===backend,'late fallback');assert((await all<LocalAsset>('assets')).length===1,'partial published');await retained();return o;
};
const originalCursor=IDBObjectStore.prototype.openCursor;
cases['open-writer']=async()=>{
 assert(backend==='opfs','opfs only');const create=FileSystemFileHandle.prototype.createWritable;
 FileSystemFileHandle.prototype.createWritable=async function(){throw new DOMException('PRIVATE_CANARY open','QuotaExceededError');};
 let r;try{r=await importFileDetailed(wav(),signal(),()=>{},{backend});}finally{FileSystemFileHandle.prototype.createWritable=create;}
 const o=outcome(r);assert(o.primary?.phase==='open'&&o.primary.backend==='opfs'&&o.primary.code==='quota-exceeded','open phase');return o;
};
cases['job-idb']=async()=>{
 const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='jobs')throw new DOMException('PRIVATE_CANARY job','QuotaExceededError');return put.apply(this,args);};
 let r;try{r=await importFileDetailed(wav(),signal(),()=>{},{backend});}finally{IDBObjectStore.prototype.put=put;}
 const o=outcome(r);assert(o.primary?.phase==='write'&&o.primary.backend==='idb'&&o.primary.code==='quota-exceeded','physical backend confused with job');return o;
};
cases['close-ack']=async()=>{
 const close=FileSystemWritableFileStream.prototype.close;FileSystemWritableFileStream.prototype.close=async function(){await close.call(this);throw Error('PRIVATE_CANARY close');};
 const id=crypto.randomUUID();let r;try{r=await importFileDetailed(wav(),signal(),()=>{},{backend:'opfs',operationId:id});}finally{FileSystemWritableFileStream.prototype.close=close;}
 const o=outcome(r);assert(o.status==='uncertain'&&o.primary?.phase==='close'&&o.primary.code==='unknown'&&o.closeState==='unknown','close ACK assumed');
 const job=await importOperation(id);assert(job,'job missing');const recovery=await recoverImportOperationDetailed(id,job.revision,'resume');assert(recovery.kind==='confirmed'&&recovery.operation.state==='sealed','recover failed');
 const twice=await recoverImportOperationDetailed(id,recovery.operation.revision,'resume');assert(twice.kind==='confirmed'&&(await all('tracks')).length===1,'double counted');return {o,recovery:recovery.outcome};
};
cases['reader-states']=async()=>{
 const r=await published();const asset=await assetFor(r.result.track.assetId);assert((await verify(asset)).state==='valid','valid');
 let reader=await openAssetReader(asset);assert(await reader.verify(false),'legacy presence false');reader.release();
 if(backend==='idb'){
 const chunk=await readRecord<Uint8Array>('chunks',[asset.storageKey,0]);assert(chunk,'chunk');await writeRecord('chunks',[asset.storageKey,0],'invalid');assert((await verify(asset)).state==='corrupt','type corrupt');
 const db=await openDatabase();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('chunks','readwrite');tx.objectStore('chunks').delete([asset.storageKey,0]);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();assert((await verify(asset)).state==='missing','missing chunk');
 await writeRecord('chunks',[asset.storageKey,0],chunk);const bad=chunk.slice();bad[0]^=255;await writeRecord('chunks',[asset.storageKey,0],bad);assert((await verify(asset)).failure?.code==='digest-mismatch','digest');await writeRecord('chunks',[asset.storageKey,0],chunk);
 const get=IDBObjectStore.prototype.get;IDBObjectStore.prototype.get=function(...args){if(this.name==='chunks')throw new DOMException('PRIVATE_CANARY IO','SecurityError');return get.apply(this,args);};try{assert((await verify(asset)).state==='unknown','IO not unknown');reader=await openAssetReader(asset);assert(!await reader.verify(),'legacy error not false');reader.release();}finally{IDBObjectStore.prototype.get=get;}
 // One read per chunk for both legacy presence and detailed SHA; no redundant pass.
 let reads=0;IDBObjectStore.prototype.get=function(...args){if(this.name==='chunks')reads++;return get.apply(this,args);};try{await verify(asset);assert(reads===asset.chunks,'extra SHA/readback');reads=0;reader=await openAssetReader(asset);assert(await reader.verify(false),'presence');reader.release();assert(reads===asset.chunks,'extra presence pass');}finally{IDBObjectStore.prototype.get=get;}
 }else{
 const dir=await assetDirectory();const handle=await dir.getFileHandle(asset.storageKey);for(const length of [asset.bytes-1,asset.bytes+1]){const w=await handle.createWritable();await w.write(new Uint8Array(length));await w.close();assert((await verify(asset)).failure?.code==='length-mismatch','length');}
 const w=await handle.createWritable();await w.write(new Uint8Array(asset.bytes));await w.close();assert((await verify(asset)).failure?.code==='digest-mismatch','digest');
 const get=FileSystemFileHandle.prototype.getFile;FileSystemFileHandle.prototype.getFile=async function(){throw new DOMException('PRIVATE_CANARY IO','SecurityError');};try{assert((await verify(asset)).state==='unknown','IO unknown');}finally{FileSystemFileHandle.prototype.getFile=get;}
 await dir.removeEntry(asset.storageKey);assert((await verify(asset)).state==='missing','missing file');
 }
 return {backend,states:['valid','missing','corrupt','unknown']};
};
cases['dedup-unknown']=async()=>{
 const r=await published();const asset=await assetFor(r.result.track.assetId);const get=IDBObjectStore.prototype.get,file=FileSystemFileHandle.prototype.getFile;
 if(backend==='idb')IDBObjectStore.prototype.get=function(...args){if(this.name==='chunks'&&Array.isArray(args[0])&&args[0][0]===asset.storageKey)throw Error('PRIVATE_CANARY read');return get.apply(this,args);};
 else FileSystemFileHandle.prototype.getFile=async function(){if(this.name===asset.storageKey)throw Error('PRIVATE_CANARY read');return file.call(this);};
 let attempt;try{attempt=await importFileDetailed(wav(),signal(),()=>{},{backend});}finally{IDBObjectStore.prototype.get=get;FileSystemFileHandle.prototype.getFile=file;}
 assert(attempt.kind==='failed','IO authorized replacement');assert((await assetFor(asset.id)).storageKey===asset.storageKey,'kept replaced');return outcome(attempt);
};
cases['cancel-copy']=async()=>{
 const controller=new AbortController();const id=crypto.randomUUID();const r=await importFileDetailed(wav(),controller.signal,()=>controller.abort(),{backend,operationId:id});const o=outcome(r);assert(o.status==='cancelled'&&!o.recoveryRequired,'cancel copy');assert((await importOperation(id))?.state==='discarded','partial remains');return o;
};
cases['callback-unknown']=async()=>{
 const id=crypto.randomUUID();const r=await importFileDetailed(wav(),signal(),()=>{throw Error('PRIVATE_CANARY callback');},{backend,operationId:id});const o=outcome(r);assert(o.primary?.phase==='transport'&&o.status==='uncertain','callback unknown not blocked');assert((await importOperation(id))?.state==='uncertain','callback staging deleted');return o;
};
for(const mode of ['precommit','second-put','abort','ack-lost','postcommit'])cases[`commit-${mode}`]=async()=>{
 const controller=new AbortController(),id=crypto.randomUUID();const put=IDBObjectStore.prototype.put,add=IDBObjectStore.prototype.add;
 let injected=false;IDBObjectStore.prototype.put=function(...args){
 if(this.name==='assets'){
 if(mode==='precommit')controller.abort();
 if(mode==='abort')this.transaction.abort();
 if(mode==='ack-lost'||mode==='postcommit'){const tx=this.transaction;tx.addEventListener('complete',()=>{if(mode==='postcommit')controller.abort();});
 if(mode==='ack-lost'){const original=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete')!;Object.defineProperty(tx,'oncomplete',{set(handler){original.set!.call(this,()=>{injected=true; // commit is real; only the caller acknowledgement rejects.
 const abort=this.onabort;Object.defineProperty(this,'error',{value:new DOMException('PRIVATE_CANARY ACK','UnknownError')});abort?.call(this,new Event('abort'));});},get(){return original.get!.call(this);}});const existing=tx.oncomplete;tx.oncomplete=existing;}
 }
 }
 return put.apply(this,args);
 };
 if(mode==='second-put')IDBObjectStore.prototype.add=function(...args){if(this.name==='tracks'){injected=true;throw new DOMException('PRIVATE_CANARY second put','QuotaExceededError');}return add.apply(this,args);};
 let r;try{r=await importFileDetailed(wav(),controller.signal,()=>{},{backend,operationId:id});}finally{IDBObjectStore.prototype.put=put;IDBObjectStore.prototype.add=add;}
 const o=outcome(r);const count=(await all('tracks')).length;
 if(mode==='postcommit'||mode==='ack-lost'){assert(r.kind==='confirmed'&&count===1,'confirmed commit lost');if(mode==='ack-lost')assert(injected&&o.primary?.phase==='commit','ACK failure not observed');}
 else {assert(r.kind==='failed'&&count===0,'partial transaction published');if(mode==='second-put')assert(injected&&o.primary?.code==='quota-exceeded','sync quota lost');if(mode==='precommit')assert(o.primary?.code==='cancelled'&&o.recoveryRequired,'precommit must retain observed cancel and legacy conservative publishing gate');if(mode==='abort')assert(o.primary?.code==='transaction-aborted','abort invented cause');}
 return o;
};
for(const fault of ['metadata-optional','metadata-hostile'])cases[fault]=async()=>{
 const get=IDBObjectStore.prototype.get;let sealed=false;
 const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='jobs'&&args[0]?.state==='sealed')this.transaction.addEventListener('complete',()=>{sealed=true;});return put.apply(this,args);};
 IDBObjectStore.prototype.get=function(...args){if(sealed&&this.name==='assets')throw fault==='metadata-hostile'?new Proxy({}, {getPrototypeOf(){throw Error('PRIVATE_CANARY proxy');},get(){throw Error('PRIVATE_CANARY getter');}}):new DOMException('PRIVATE_CANARY metadata','QuotaExceededError');return get.apply(this,args);};
 let r;try{r=await importFileDetailed(wav(),signal(),()=>{},{backend});}finally{IDBObjectStore.prototype.get=get;IDBObjectStore.prototype.put=put;}
 assert(r.kind==='confirmed'&&r.result.artworkWarning&&r.result.lyricsWarning,'optional metadata killed audio');assert((await all('tracks')).length===1,'audio gone');assert((await verify(await assetFor(r.result.track.assetId))).state==='valid','audio invalid');return outcome(r);
};
cases['read-lock']=async()=>{
 const id=crypto.randomUUID();const controller=new AbortController();const r=await importFileDetailed(wav(),controller.signal,()=>{throw Error('PRIVATE_CANARY callback');},{backend,operationId:id});assert(r.kind==='failed','fixture');
 const job=await importOperation(id);assert(job,'job');const fake={id:crypto.randomUUID(),namespace:'local',storageKey:job.storageKey,backend,bytes:job.expectedBytes,sha256:'a'.repeat(64),mime:'audio/wav',chunks:4,state:'complete',revision:1,chunkSize:65536,retention:'kept'} as LocalAsset;
 const reader=await openAssetReader(fake,false);let completed=false;const cleanup=await updateOperation(job,{state:'cleanup'});const pending=cleanupOperation(cleanup).then(()=>{completed=true;});await new Promise(r=>setTimeout(r,60));assert(!completed,'cleanup passed shared read lock');reader.release();await pending;assert(completed,'cleanup did not unlock');return {locked:true};
};
cases['worker-v2']=async()=>{
 const worker=new Worker(new URL('./import-failure-v2.worker.ts',import.meta.url),{type:'module'});worker.postMessage({type:'test-init',backend,fault:''});const id=crypto.randomUUID();const file=wav();const request={version:2,type:'import',operationId:id,file} as const;const gate=createResponseGate(request);const messages:unknown[]=[];
 const result=await new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('worker timeout')),20000);worker.onerror=()=>reject(Error('worker error'));worker.onmessage=e=>{messages.push(e.data);const response=gate(e.data);assert(response.kind==='accepted','worker invalid response');if(response.response.type!=='progress'){clearTimeout(timer);resolve(response.response);}};worker.postMessage(request);});worker.terminate();
 assert(result.type==='complete'&&result.result.track.title.includes('PRIVATE_CANARY'),'legitimate private track lost');assert(copyWorkerResponse(result),'result invalid');assert(!JSON.stringify(result.outcome).includes('PRIVATE_CANARY'),'PII outcome');
 assert(fromKnownError(Object.assign(new Error('PRIVATE_CANARY'),{name:'QuotaExceededError'}),{phase:'write',backend}).code==='unknown','imitated quota');
 let calls=0;const q=Object.defineProperty({...result},'outcome',{get(){calls++;throw Error();}});assert(!copyWorkerResponse(q)&&calls===0,'getter invoked');assert(!copyWorkerResponse({...result,raw:'PRIVATE_CANARY'}),'raw extras');assert(!copyWorkerResponse({...result,version:1}),'version accepted');
 return {messages:messages.length,status:result.outcome.status,privateResultAllowed:true,outcomePII:false};
};

cases['dedup-cleanup']=async()=>{
 const a=await published();const remove=FileSystemDirectoryHandle.prototype.removeEntry,cursor=IDBObjectStore.prototype.openCursor;
 if(backend==='opfs')FileSystemDirectoryHandle.prototype.removeEntry=async function(){throw new DOMException('PRIVATE_CANARY dedup cleanup','SecurityError');};
 else IDBObjectStore.prototype.openCursor=function(){throw new DOMException('PRIVATE_CANARY dedup cleanup','SecurityError');};
 const id=crypto.randomUUID();let r;try{r=await importFileDetailed(wav(),signal(),()=>{},{backend,operationId:id});}finally{FileSystemDirectoryHandle.prototype.removeEntry=remove;IDBObjectStore.prototype.openCursor=cursor;}
 const o=outcome(r);assert(r.kind==='failed'&&o.recoveryRequired&&o.writeState==='published'&&o.cleanup,'dedup terminal success invented');
 const job=await importOperation(id);assert(job?.state==='cleanup'&&job.result?.track.id===a.result.track.id,'dedup receipt lost');
 const resumed=await recoverImportOperationDetailed(id,job.revision,'resume');assert(resumed.kind==='confirmed'&&resumed.operation.state==='sealed','cleanup resume failed');assert((await all('tracks')).length===1,'dedup duplicate');return o;
};
cases['restored-null-asset']=async()=>{
 const a=await published();const t=a.result.track;const restored={...t,id:crypto.randomUUID(),assetId:null,title:'Restored manual',favorite:true,revision:7,manualOverrides:{title:'Restored manual'}};
 await writeRecord('tracks',restored.id,restored);const p=await createPlaylist('Restored');await changePlaylist(p.id,p.revision,{type:'add',trackId:restored.id});
 const duplicate=await importFileDetailed(wav(),signal(),()=>{},{backend});assert(duplicate.kind==='confirmed','dedup');const after=await readRecord<Track>('tracks',restored.id);
 assert(after?.assetId===t.assetId&&after.favorite&&after.title==='Restored manual'&&after.revision===8,'restored overwritten');const list=await readRecord<Playlist>('playlists',p.id);assert(list?.entries[0]?.trackId===restored.id,'restored playlist lost');return outcome(duplicate);
};
cases['worker-errors-recovery']=async()=>{
 const id=crypto.randomUUID();
 async function run(fault:string,message:any){const worker=new Worker(new URL('./import-failure-v2.worker.ts',import.meta.url),{type:'module'});worker.postMessage({type:'test-init',backend,fault});
 try{return await new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('v2 worker timeout')),20000);worker.onerror=()=>reject(Error('v2 worker crashed'));worker.onmessage=e=>{assert(copyWorkerResponse(e.data),'bad v2 wire');if(e.data.type!=='progress'){clearTimeout(timer);resolve(e.data);}};worker.postMessage(message);});}finally{worker.terminate();}}
 const r=await run('quota',{version:2,type:'import',operationId:id,file:wav()});assert(r.type==='error'&&r.outcome.primary.code==='quota-exceeded'&&!JSON.stringify(r.outcome).includes('PRIVATE_CANARY'),'worker raw error');
 // Recovery uses the same real v2 handler, with a newly captured private request ID.
 const job=await importOperation(id);assert(job,'worker job');const requestId=crypto.randomUUID();const recovery=await run('',{version:2,type:'recover',requestId,operationId:id,revision:job.revision,action:'discard'});
 assert(recovery.type==='recovered'&&recovery.requestId===requestId&&recovery.state==='discarded','v2 recovery');return {failure:r.outcome,recovery:recovery.outcome};
};
for(const fault of ['header','view','parser-quota','parser-unknown','parser-retry','parser-hostile'])cases[`read-parse-${fault}`]=async()=>{
 const arrayBuffer=Blob.prototype.arrayBuffer;let calls=0;
 if(fault==='header'||fault==='view')Blob.prototype.arrayBuffer=async function(){if(++calls===(fault==='header'?1:2))throw new DOMException('PRIVATE_CANARY file IO','QuotaExceededError');return arrayBuffer.call(this);};
 (globalThis as any).__importFailureParse=fault;
 let r;try{r=await importFileDetailed(wav(),signal(),()=>{},{backend});}finally{Blob.prototype.arrayBuffer=arrayBuffer;delete (globalThis as any).__importFailureParse;}
 const o=outcome(r);
 if(fault==='parser-retry')assert(r.kind==='confirmed','parser retry failed');
 else {assert(r.kind==='failed','read/parse accepted');assert(o.primary?.phase===(fault==='header'||fault==='view'?'read':'parse'),'read/parse phase lost');assert(o.primary?.code===(fault==='parser-unknown'||fault==='parser-hostile'?'unknown':'quota-exceeded'),'invented parser integrity');assert((await all('jobs')).length===0,'parser wrote staging');}
 return o;
};

cases['worker-rejects']=async()=>{
 const worker=new Worker(new URL('./import-failure-v2.worker.ts',import.meta.url),{type:'module'});const id=crypto.randomUUID();const messages:any[]=[];worker.onmessage=e=>messages.push(e.data);
 worker.postMessage({version:1,type:'import',operationId:id,file:wav()});worker.postMessage({version:2,type:'import',operationId:id,file:wav(),raw:'PRIVATE_CANARY'});
 await new Promise(r=>setTimeout(r,100));assert(messages.length===0&&(await all('jobs')).length===0,'invalid request wrote/responded');
 await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('probe timeout')),10000);worker.onmessage=e=>{if(e.data.type==='test-probed'){clearTimeout(timer);assert(e.data.rejected&&e.data.calls===0,'worker invoked getter');resolve();}};worker.postMessage({type:'test-probe',id});});worker.terminate();return {versionRejected:true,extrasRejected:true,getterCalls:0};
};
cases['close-before']=async()=>{
 let stream:FileSystemWritableFileStream|undefined;const close=FileSystemWritableFileStream.prototype.close;
 FileSystemWritableFileStream.prototype.close=async function(){stream=this;throw new DOMException('PRIVATE_CANARY before close','QuotaExceededError');};
 const id=crypto.randomUUID();let r;try{r=await importFileDetailed(wav(),signal(),()=>{},{backend:'opfs',operationId:id});}finally{FileSystemWritableFileStream.prototype.close=close;}
 const o=outcome(r);assert(o.status==='uncertain'&&o.primary?.phase==='close'&&o.primary.code==='quota-exceeded'&&o.closeState==='unknown','false close');
 // The harness now closes the retained stream explicitly; the failed attempt did not claim it.
 assert(stream,'close not called');await close.call(stream);const job=await importOperation(id);assert(job,'job');const recovered=await recoverImportOperationDetailed(id,job.revision,'resume');assert(recovered.kind==='confirmed','explicit reopen failed');return o;
};

cases['legacy-reader-consumers']=async()=>{
 const r=await published();const asset=await assetFor(r.result.track.assetId);
 if(backend==='opfs')await(await assetDirectory()).removeEntry(asset.storageKey);
 else{const db=await openDatabase();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('chunks','readwrite');tx.objectStore('chunks').delete([asset.storageKey,0]);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();}
 assert(await restoreAssetAvailable(asset.id)===false,'legacy restore no longer recognizes absence');assert((await verify(asset)).state==='missing','detailed missing lost');return {legacy:false,detailed:'missing'};
};

cases['reader-hostile']=async()=>{
 const r=await published();const asset=await assetFor(r.result.track.assetId);const get=IDBObjectStore.prototype.get,file=FileSystemFileHandle.prototype.getFile;
 const error=new Proxy({}, {getPrototypeOf(){throw Error('PRIVATE_CANARY prototype');},get(){throw Error('PRIVATE_CANARY getter');}});
 if(backend==='idb')IDBObjectStore.prototype.get=function(...args){if(this.name==='chunks')throw error;return get.apply(this,args);};
 else FileSystemFileHandle.prototype.getFile=async function(){throw error;};
 try{const verified=await verify(asset);assert(verified.state==='unknown'&&verified.failure?.code==='unknown','hostile reader escaped/misclassified');}
 finally{IDBObjectStore.prototype.get=get;FileSystemFileHandle.prototype.getFile=file;}
 assert((await verify(asset)).state==='valid','reader lock/resource not released');return {state:'unknown',code:'unknown'};
};

cases['lock-denied']=async()=>{
 const request=navigator.locks.request;navigator.locks.request=function(){return Promise.reject(new DOMException('PRIVATE_CANARY lock','SecurityError'));};
 let importing,recovery;
 try{importing=await importFileDetailed(wav(),signal(),()=>{},{backend});recovery=await recoverImportOperationDetailed(crypto.randomUUID(),1,'resume');}finally{navigator.locks.request=request;}
 for(const r of [importing,recovery])assert(r.kind==='failed'&&r.outcome.primary?.code==='storage-denied'&&!r.outcome.recoveryRequired,'lock failure escaped detailed result');
 assert((await all('jobs')).length===0,'lock rejection wrote');return {import:importing.outcome,recovery:recovery.outcome};
};
try{const result=await cases[name]();(window as any).importFailureReport={passed:true,name,backend,result};}
catch(error){(window as any).importFailureReport={passed:false,name,backend,error:error instanceof Error?error.message:'unknown',dom:nativeDOMName(error)};}
document.querySelector('#results')!.textContent=JSON.stringify((window as any).importFailureReport);
