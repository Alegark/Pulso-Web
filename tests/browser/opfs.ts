import {importFile,importOperation,importOperations,recoverImportOperation} from '../../src/imports/import-file';
import {all,editTrack,createPlaylist,changePlaylist,verifiedAsset,type LocalAsset,type Track,type Playlist} from '../../src/library/library';
import {assetDirectory,openAssetReader} from '../../src/storage/asset-reader';
import {readRecord,writeRecord} from '../../src/storage/database';
import {createOperation,updateOperation,importIssues,retainImportIssue,assertImportsResolved,type ImportOperation} from '../../src/storage/import-operations';
const results:string[]=[];
function assert(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
async function check(name:string,fn:()=>Promise<void>){try{await fn();results.push(`PASS ${name}`);}catch(e){results.push(`FAIL ${name}: ${e instanceof Error?e.message:String(e)}`);}document.querySelector('#results')!.textContent=results.join('\n');}
const signal=()=>new AbortController().signal;
function wav(seed:number){const data=new Uint8Array(196608+44);const v=new DataView(data.buffer);const text=(offset:number,s:string)=>{for(let i=0;i<s.length;i++)data[offset+i]=s.charCodeAt(i);};text(0,'RIFF');v.setUint32(4,data.length-8,true);text(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,22050,true);v.setUint32(28,44100,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,data.length-44,true);for(let i=44;i<data.length;i++)data[i]=(i*seed+seed)%251;return new File([data],`sintético-${seed}.wav`,{type:'audio/wav'});}
async function rejects(fn:()=>Promise<unknown>){try{await fn();return false;}catch{return true;}}
async function missing(key:string){try{await(await assetDirectory()).getFileHandle(key);return false;}catch(e){return e instanceof DOMException&&e.name==='NotFoundError';}}
let originalAsset:LocalAsset;let originalTrack:Track;
await check('OPFS real: copia, hash incremental, reopen, rangos y dedup conserva metadata',async()=>{
 assert(typeof navigator.storage.getDirectory==='function','OPFS ausente');
 const file=wav(1);const operationId=crypto.randomUUID();const result=await importFile(file,signal(),()=>{},{operationId});originalTrack=result.track;
 const asset=await verifiedAsset(result.track.assetId,true);assert(asset?.backend==='opfs','auto no prefirió OPFS');originalAsset=asset;
 for(let i=0;i<2;i++){const reader=await openAssetReader(asset);try{assert(await reader.verify(),'reopen hash');const bytes=await reader.readRange(65530,65549);const expected=new Uint8Array(await file.slice(65530,65549).arrayBuffer());assert(bytes.every((b,i)=>b===expected[i]),'rango frontera');}finally{reader.release();}}
 await editTrack(result.track.id,result.track.revision,{title:'Corrección vigente',favorite:true});
 const duplicate=await importFile(file,signal());assert(duplicate.duplicate&&duplicate.track.id===result.track.id&&duplicate.track.title==='Corrección vigente'&&duplicate.track.favorite,'dedup metadata');
 const same=await importFile(file,signal(),()=>{},{operationId});assert(same.track.id===result.track.id,'reintento idempotente');
 const published=await readRecord<LocalAsset>('assets',asset.id);assert(published?.storageKey===asset.storageKey,'dedup cambió generación');
 assert((await importOperations()).every(j=>j.revision>1&&(j.state==='sealed'||j.state==='discarded')),'jobs sin revisión o staging acumulado');
});
await check('IDB legacy sin migración; reparación OPFS missing/corrupt conserva organización y generaciones',async()=>{
 const getDirectory=StorageManager.prototype.getDirectory;
 try{Object.defineProperty(StorageManager.prototype,'getDirectory',{configurable:true,writable:true,value:undefined});const fallback=await importFile(wav(9),signal());assert((await readRecord<LocalAsset>('assets',fallback.track.assetId))?.backend==='idb','no eligió fallback antes de escribir');}finally{Object.defineProperty(StorageManager.prototype,'getDirectory',{configurable:true,writable:true,value:getDirectory});}
 const createWritable=FileSystemFileHandle.prototype.createWritable;
 try{Object.defineProperty(FileSystemFileHandle.prototype,'createWritable',{configurable:true,writable:true,value:undefined});const fallback=await importFile(wav(14),signal());assert((await readRecord<LocalAsset>('assets',fallback.track.assetId))?.backend==='idb','no eligió fallback sin writer OPFS');}finally{Object.defineProperty(FileSystemFileHandle.prototype,'createWritable',{configurable:true,writable:true,value:createWritable});}
 const legacy=await importFile(wav(2),signal(),()=>{},{backend:'idb'});const before=await verifiedAsset(legacy.track.assetId,true);assert(before?.backend==='idb','IDB');
 await importFile(wav(2),signal());assert((await readRecord<LocalAsset>('assets',before.id))?.storageKey===before.storageKey,'migró legacy');
 const list=await createPlaylist('Conservar');await changePlaylist(list.id,list.revision,{type:'add',trackId:originalTrack.id});
 await(await assetDirectory()).removeEntry(originalAsset.storageKey);
 assert(!await verifiedAsset(originalAsset.id,true),'missing no detectado');
 let repaired=await importFile(wav(1),signal());assert(repaired.track.id===originalTrack.id&&repaired.track.title==='Corrección vigente'&&repaired.track.favorite,'missing pisó metadata');
 let current=(await verifiedAsset(originalAsset.id,true))!;const corruptKey=current.storageKey;const handle=await(await assetDirectory()).getFileHandle(corruptKey);const writer=await handle.createWritable();await writer.write(new Uint8Array(current.bytes));await writer.close();
 assert(!await verifiedAsset(current.id,true),'corrupción no detectada');
 repaired=await importFile(wav(1),signal(),bytes=>{if(bytes===wav(1).size){void readRecord<Track>('tracks',originalTrack.id).then(t=>t&&editTrack(t.id,t.revision,{album:'Edición durante copia'}));}});
 current=(await verifiedAsset(current.id,true))!;assert(current.storageKey!==corruptKey&&current.revision===originalAsset.revision+2,'revisión reparación');
 assert(!await missing(corruptKey),'borró generación anterior por reparación');assert(repaired.track.album==='Edición durante copia','pisó edición concurrente');
 assert((await readRecord<Playlist>('playlists',list.id))?.entries[0].trackId===originalTrack.id,'perdió playlist');
 // IDB repair through OPFS also preserves its previous chunks.
 const chunk=await readRecord<Uint8Array>('chunks',[before.storageKey,0]);assert(chunk,'legacy bytes');const bad=chunk.slice();bad[0]^=255;await writeRecord('chunks',[before.storageKey,0],bad);
 await importFile(wav(2),signal());assert((await verifiedAsset(before.id,true))?.backend==='opfs','legacy repair');assert(await readRecord('chunks',[before.storageKey,0]),'borró legacy anterior');
});
await check('cancelación y cuota durante copia limpian solo staging propio en ambos backends',async()=>{
 for(const backend of ['opfs','idb'] as const){
 const id=crypto.randomUUID();const abort=new AbortController();assert(await rejects(()=>importFile(wav(3),abort.signal,()=>abort.abort(),{backend,operationId:id})),'cancel aceptado');const job=await importOperation(id);assert(job?.state==='discarded','cancel staging acumulado');if(backend==='opfs')assert(await missing(job.storageKey),'staging cancel presente');
 const operationId=crypto.randomUUID();let injected=false;
 const originalWrite=FileSystemWritableFileStream.prototype.write;const originalPut=IDBObjectStore.prototype.put;
 if(backend==='opfs')FileSystemWritableFileStream.prototype.write=async function(){injected=true;throw new DOMException('test quota','QuotaExceededError');};
 else IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){if(this.name==='chunks'){injected=true;throw new DOMException('test quota','QuotaExceededError');}return originalPut.apply(this,args);};
 try{assert(await rejects(()=>importFile(wav(4),signal(),()=>{},{backend,operationId})),'cuota aceptada');}finally{FileSystemWritableFileStream.prototype.write=originalWrite;IDBObjectStore.prototype.put=originalPut;}
 assert(injected,'no se inyectó cuota');const failed=await importOperation(operationId);assert(failed?.state==='discarded'&&failed.backend===backend,'cuota no limpió staging o cambió backend');assert((await all<LocalAsset>('assets')).every(a=>a.storageKey!==failed.storageKey),'publicó parcial');
 }
 assert(await verifiedAsset(originalAsset.id,true),'afectó bytes conservados');
});
await check('close incierto conserva bytes, bloquea mutaciones y recupera tras doble reopen',async()=>{
 const id=crypto.randomUUID();const close=FileSystemWritableFileStream.prototype.close;let exercised=false;
 FileSystemWritableFileStream.prototype.close=async function(){await close.call(this);exercised=true;throw new Error('close acknowledgement lost');};
 try{assert(await rejects(()=>importFile(wav(5),signal(),()=>{},{operationId:id})),'closefail aceptado');}finally{FileSystemWritableFileStream.prototype.close=close;}
 assert(exercised,'closefail no ejercitado');const first=await importOperation(id);const second=await importOperation(id);assert(first?.state==='uncertain'&&first.cause==='close-uncertain'&&second?.revision===first.revision,'incertidumbre no durable');
 assert(!await missing(first.storageKey),'eliminó bytes inciertos');assert(await rejects(()=>importFile(wav(6),signal())),'no pausó mutaciones');
 const resolved=await recoverImportOperation(id,second!.revision,'resume');assert(resolved.state==='sealed'&&resolved.result,'no recuperó');assert(await verifiedAsset(resolved.result.track.assetId,true),'recuperó bytes inválidos');
 const again=await recoverImportOperation(id,resolved.revision,'resume');assert(again.result?.track.id===resolved.result.track.id,'recuperación duplicada');
});
await check('publicación: corte postcommit se resuelve sin duplicar; fallo precommit se recupera',async()=>{
 const desc=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete')!;let exercised=false;
 Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...desc,set(this:IDBTransaction,callback:((event:Event)=>void)|null){const tx=this;desc.set!.call(tx,callback&&function(event:Event){if(!exercised&&tx.mode==='readwrite'&&tx.objectStoreNames.contains('assets')&&tx.objectStoreNames.contains('tracks')&&tx.objectStoreNames.contains('jobs')){exercised=true;tx.onabort?.call(tx,event);}else callback.call(tx,event);});}});
 const id=crypto.randomUUID();let result;
 try{result=await importFile(wav(6),signal(),()=>{},{operationId:id});}finally{Object.defineProperty(IDBTransaction.prototype,'oncomplete',desc);}
 assert(exercised&&result,'postcommit no ejercitado');assert((await importOperation(id))?.state==='sealed','postcommit no confirmado');const retry=await importFile(wav(6),signal(),()=>{},{operationId:id});assert(result.track.id===retry.track.id,'duplicó postcommit');
 const put=IDBObjectStore.prototype.put;let injected=false;const failedId=crypto.randomUUID();const trackCount=(await all('tracks')).length;
 IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){if(this.name==='jobs'&&(args[0] as ImportOperation).state==='sealed'){injected=true;throw new Error('publication interrupted after assets and track staged');}return put.apply(this,args);};
 try{assert(await rejects(()=>importFile(wav(7),signal(),()=>{},{operationId:failedId})),'publicación fallida aceptada');}finally{IDBObjectStore.prototype.put=put;}
 assert(injected,'fallo publicación no ejercitado');const pending=await importOperation(failedId);assert(pending?.state==='uncertain','no conservó fallo publicación');assert(!(await all<LocalAsset>('assets')).some(a=>a.storageKey===pending.storageKey)&&(await all('tracks')).length===trackCount,'publicó parcialmente ante excepción síncrona');const resolved=await recoverImportOperation(failedId,pending.revision,'resume');assert(resolved.state==='sealed','no recuperó publicación');
});
await check('cleanup revisado espera lectores, rechaza referencias kept e incertidumbre incompleta',async()=>{
 const id=crypto.randomUUID(),key=crypto.randomUUID();let job:ImportOperation={version:1,operationId:id,owner:crypto.randomUUID(),revision:1,state:'writing',backend:'opfs',storageKey:key,bytes:0,expectedBytes:wav(8).size};await createOperation(job);const bytes=new Uint8Array(await wav(8).arrayBuffer());const writer=await(await(await assetDirectory()).getFileHandle(key,{create:true})).createWritable();await writer.write(bytes);await writer.close();
 const asset:LocalAsset={...originalAsset,id:crypto.randomUUID(),storageKey:key};
 job=await updateOperation(job,{state:'uncertain',bytes:bytes.length,cause:'interrupted'});
 assert(await rejects(()=>recoverImportOperation(id,job.revision,'resume')),'resumió incompleto');assert(!await missing(key),'eliminó incierto');
 const reader=await openAssetReader(asset,false);let finished=false;const cleanup=recoverImportOperation(id,job.revision,'discard').then(j=>{finished=true;return j;});
 await new Promise(resolve=>setTimeout(resolve,30));assert(!finished&&!await missing(key),'cleanup ignoró lector');reader.release();assert((await cleanup).state==='discarded'&&await missing(key),'no limpió al liberar');
 const kept=(await verifiedAsset(originalAsset.id,true))!;const referenced:ImportOperation={...job,operationId:crypto.randomUUID(),storageKey:kept.storageKey};await writeRecord('jobs',referenced.operationId,referenced);
 assert(await rejects(()=>recoverImportOperation(referenced.operationId,1,'discard')),'limpió referencia kept');assert(await verifiedAsset(kept.id,true),'perdió kept');
 // Remove only this synthetic job record, never its referenced generation.
 const {openDatabase,committed}=await import('../../src/storage/database');const db=await openDatabase();const tx=db.transaction('jobs','readwrite');const done=committed(tx);tx.objectStore('jobs').delete(referenced.operationId);await done;db.close();
});
await check('resume duplicado reutiliza dedup, conserva revisión y limpia staging',async()=>{
 const id=crypto.randomUUID();const close=FileSystemWritableFileStream.prototype.close;
 FileSystemWritableFileStream.prototype.close=async function(){await close.call(this);throw new Error('lost close ack');};
 try{assert(await rejects(()=>importFile(wav(1),signal(),()=>{},{operationId:id})),'close aceptado');}finally{FileSystemWritableFileStream.prototype.close=close;}
 const job=(await importOperation(id))!;const before=(await verifiedAsset(originalAsset.id,true))!;
 const resolved=await recoverImportOperation(id,job.revision,'resume');const after=(await verifiedAsset(before.id,true))!;
 assert(resolved.state==='sealed'&&resolved.result?.duplicate,'resume no deduplicó');
 assert(before.storageKey===after.storageKey&&before.revision===after.revision,'reemplazó generación válida');assert(await missing(job.storageKey),'staging duplicado acumulado');
});
await check('cancelación en asset put aborta commit; cancelación postcommit conserva publicación',async()=>{
 const put=IDBObjectStore.prototype.put;const controller=new AbortController();const id=crypto.randomUUID();let injected=false;
 IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){const req=put.apply(this,args);if(this.name==='assets'){injected=true;controller.abort();}return req;};
 try{assert(await rejects(()=>importFile(wav(11),controller.signal,()=>{},{operationId:id})),'cancelación publicó');}finally{IDBObjectStore.prototype.put=put;}
 const job=(await importOperation(id))!;assert(injected&&job.state==='uncertain','frontera no ejercitada');assert(!(await all<LocalAsset>('assets')).some(a=>a.storageKey===job.storageKey),'publicación tras abort');
 await recoverImportOperation(id,job.revision,'discard');
 const desc=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete')!;const after=new AbortController();let post=false;
 Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...desc,set(this:IDBTransaction,callback:((event:Event)=>void)|null){const tx=this;desc.set!.call(tx,callback&&function(event:Event){if(tx.mode==='readwrite'&&tx.objectStoreNames.contains('assets')&&tx.objectStoreNames.contains('tracks')){post=true;after.abort();}callback.call(tx,event);});}});
 let result;try{result=await importFile(wav(12),after.signal);}finally{Object.defineProperty(IDBTransaction.prototype,'oncomplete',desc);}
 assert(post&&await verifiedAsset(result.track.assetId,true),'cancelación postcommit perdió bytes');
});
await check('fallos create/writable y segundo put IDB no dejan commit parcial ni complete',async()=>{
 for(const step of ['create','writable','second-put'] as const){
 const id=crypto.randomUUID();const get=FileSystemDirectoryHandle.prototype.getFileHandle;const writable=FileSystemFileHandle.prototype.createWritable;const put=IDBObjectStore.prototype.put;let injected=false;
 if(step==='create')FileSystemDirectoryHandle.prototype.getFileHandle=function(name,options){if(options?.create){injected=true;return Promise.reject(new Error('create failed'));}return get.call(this,name,options);};
 if(step==='writable')FileSystemFileHandle.prototype.createWritable=function(){injected=true;return Promise.reject(new Error('writable failed'));};
 if(step==='second-put')IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){if(this.name==='jobs'&&(args[0] as ImportOperation).state==='writing'){injected=true;throw new Error('second put failed');}return put.apply(this,args);};
 try{assert(await rejects(()=>importFile(wav(13),signal(),()=>{},{operationId:id,backend:step==='second-put'?'idb':'opfs'})),'fallo aceptado');}finally{FileSystemDirectoryHandle.prototype.getFileHandle=get;FileSystemFileHandle.prototype.createWritable=writable;IDBObjectStore.prototype.put=put;}
 const job=(await importOperation(id))!;assert(injected&&job.state==='discarded'&&job.bytes===0,'falso progreso o complete');assert(!await readRecord('chunks',[job.storageKey,0]),'segundo put comprometió primer chunk');
 }
});
await check('jobs inválidos/legacy bloquean hasta retención expresa; snapshot y ownership protegen bytes',async()=>{
 const legacyKey='legacy-writing';await writeRecord('jobs',legacyKey,{state:'writing',storageKey:originalAsset.storageKey});
 assert(await rejects(assertImportsResolved),'legacy no bloqueó');let issue=(await importIssues()).find(i=>i.key===legacyKey)!;assert(issue.kind==='legacy'&&!issue.retained,'legacy invisible');
 await writeRecord('jobs',legacyKey,{state:'writing',storageKey:originalAsset.storageKey,bytes:1});assert(await rejects(()=>retainImportIssue(issue)),'aceptó snapshot viejo');issue=(await importIssues()).find(i=>i.key===legacyKey)!;await retainImportIssue(issue);await assertImportsResolved();
 assert((await readRecord<{state:string}>('jobs',legacyKey))?.state==='writing','retención fingió completed');
 const id=crypto.randomUUID();let job:ImportOperation={version:1,operationId:id,owner:crypto.randomUUID(),revision:1,state:'writing',backend:'opfs',storageKey:crypto.randomUUID(),bytes:0,expectedBytes:100};await createOperation(job);
 const handle=await(await assetDirectory()).getFileHandle(job.storageKey,{create:true});const writer=await handle.createWritable();await writer.write(new Uint8Array(100));await writer.close();
 for(const patch of [{owner:'bad'},{revision:0},{state:'alien'},{bytes:101},{storageKey:originalAsset.storageKey},{operationId:crypto.randomUUID()},{asset:{...originalAsset,storageKey:job.storageKey},track:originalTrack,expectedAssetRevision:0}]){
 await writeRecord('jobs',id,{...job,...patch});assert(!await importOperation(id),'aceptó job inválido');assert(!(await importOperations()).some(j=>j.operationId===id),'listó job inválido');assert(await rejects(()=>recoverImportOperation(id,1,'discard')),'limpió corrupto');assert(!await missing(job.storageKey),'perdió staging ante job corrupto');assert(await rejects(assertImportsResolved),'corrupto no bloqueó');
 const invalid=(await importIssues()).find(i=>i.key===id)!;assert(invalid.kind==='invalid','issue inválido ausente');
 }
 await writeRecord('jobs',id,job);job=await updateOperation(job,{state:'uncertain'});await recoverImportOperation(id,job.revision,'discard');
 // Unowned preclaim generations, including previous kept generations, can never gain proof.
 const pre=crypto.randomUUID();await writeRecord('jobs',pre,{...job,operationId:pre,storageKey:originalAsset.storageKey,state:'cleanup'});
 assert(await rejects(()=>recoverImportOperation(pre,job.revision,'discard')),'limpió sin proof');await retainImportIssue((await importIssues()).find(i=>i.key===pre)!);
 assert(await rejects(()=>createOperation({...job,operationId:crypto.randomUUID(),revision:1,state:'writing',bytes:0,storageKey:originalAsset.storageKey})),'reclamó generación anterior');
 const currentAsset=(await verifiedAsset(originalAsset.id,true))!;
 let previous:ImportOperation|undefined;for(const candidate of await importOperations())if(candidate.state==='sealed'&&candidate.backend==='opfs'&&candidate.asset?.id===originalAsset.id&&candidate.storageKey!==currentAsset.storageKey&&!await missing(candidate.storageKey)){previous=candidate;break;}
 assert(previous&&!await missing(previous.storageKey),'no hay generación anterior conservada');
 await writeRecord('jobs',previous.operationId,{...previous,state:'cleanup'});
 assert(!await importOperation(previous.operationId),'job publicado alterado admitido');assert(await rejects(()=>recoverImportOperation(previous.operationId,previous.revision,'discard')),'limpió everPublished');assert(!await missing(previous.storageKey),'perdió generación kept anterior');
 await writeRecord('jobs',previous.operationId,previous);
 const circular:{self?:unknown}={};circular.self=circular;await writeRecord('jobs','malformed-cycle',circular);const cycle=(await importIssues()).find(i=>i.key==='malformed-cycle')!;assert(cycle&&!cycle.retained,'ciclo no revisable');await retainImportIssue(cycle);
 assert(await verifiedAsset(originalAsset.id,true),'perdió kept');await assertImportsResolved();
});
(window as unknown as {pulsoOpfs:unknown}).pulsoOpfs={passed:results.length===10&&results.every(s=>s.startsWith('PASS')),results,userAgent:navigator.userAgent};
document.querySelector('#results')!.textContent+='\nCOMPLETADO';
