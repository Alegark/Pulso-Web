import {authorizeRealmFixture} from './realm-fixture';
authorizeRealmFixture();
import {importFile} from '../../src/imports/import-file';
import {all,type Track,type LocalAsset,type Playlist} from '../../src/library/library';
import {assetDirectory,generationLock} from '../../src/storage/asset-reader';
import {openDatabase,readRecord,writeRecord} from '../../src/storage/database';
import {createLocalBatch,readLocalBatch,listLocalBatches,runLocalBatch,recoverLocalBatch,retryLocalBatch,LOCAL_BATCH_PREFIX,LOCAL_BATCH_LOCK,validLocalBatch,localBatchProgress,updateLocalBatch,LocalBatchError,type LocalBatch} from '../../src/library/local-batches';
const results:string[]=[];
function assert(v:unknown,m:string):asserts v{if(!v)throw new Error(m);}
async function check(name:string,fn:()=>Promise<void>){try{await fn();results.push(`PASS ${name}`);}catch(e){results.push(`FAIL ${name}: ${e instanceof Error?e.message:String(e)}`);}document.querySelector('#results')!.textContent=results.join('\n');}
async function rejects(fn:()=>Promise<unknown>){try{await fn();return false;}catch{return true;}}
const signal=()=>new AbortController().signal;
function wav(seed:number,size=196608){const data=new Uint8Array(size+44),v=new DataView(data.buffer);const text=(o:number,s:string)=>{for(let i=0;i<s.length;i++)data[o+i]=s.charCodeAt(i);};text(0,'RIFF');v.setUint32(4,data.length-8,true);text(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,22050,true);v.setUint32(28,44100,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,size,true);for(let i=44;i<data.length;i++)data[i]=(i*seed+seed)%251;return new File([data],`propio-${seed}.wav`,{type:'audio/wav'});}
async function fixture(backend:'idb'|'opfs',seed:number){const r=await importFile(wav(seed),signal(),()=>{},{backend});const asset=await readRecord<LocalAsset>('assets',r.track.assetId);assert(asset?.backend===backend,'backend');return {track:r.track,asset};}
async function playlist(tracks:Track[]):Promise<Playlist>{const p:Playlist={id:crypto.randomUUID(),name:'Snapshot original ñ',revision:1,entries:tracks.map(t=>({id:crypto.randomUUID(),trackId:t.id}))};await writeRecord('playlists',p.id,p);return p;}
async function batch(tracks:Track[]){const p=await playlist(tracks);return createLocalBatch(p.id,p.revision);}
const NativeWorker=window.Worker;
let workerMode='';let probes:string[]=[];let lastWorker:Worker|undefined;let interruptResolve:(()=>void)|undefined;
// Test-only worker bootstrap. No production injection points or alternate verification path.
class TestWorker extends NativeWorker {
 constructor(url:string|URL,options?:WorkerOptions){
 const mode=workerMode;
 const source=`
 const mode=${JSON.stringify(mode)};
 let incoming=null,once=false;
 const queued=[];self.onmessage=e=>{queued.push(e);if(e.data?.type==='start')incoming=e.data;};
 let heldDone;const post=self.postMessage.bind(self);
 const notify=name=>post({testProbe:name});
 const live=new Set();let sawHash=false,sawIO=false;
 const transaction=IDBDatabase.prototype.transaction;
 IDBDatabase.prototype.transaction=function(...args){const tx=transaction.apply(this,args);live.add(tx);const ended=()=>live.delete(tx);tx.addEventListener('complete',ended,{once:true});tx.addEventListener('abort',ended,{once:true});return tx;};
 const read32=DataView.prototype.getUint32;
 DataView.prototype.getUint32=function(...args){if(live.size)notify('binary-work-in-tx');else if(!sawHash){sawHash=true;notify('hash-outside-tx');}return read32.apply(this,args);};
 const slice=Blob.prototype.slice;
 Blob.prototype.slice=function(...args){if(live.size)notify('blob-io-in-tx');else if(!sawIO){sawIO=true;notify('blob-io-outside-tx');}return slice.apply(this,args);};
 const stop=()=>self.onmessage({data:{...incoming,type:'cancel'}});
 const put=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(value,key){
 if(this.name==='chunks')notify('unexpected-byte-write');
 if(this.name==='settings'&&value?.version===1&&value?.state==='complete'&&String(key).startsWith('local-batch:v1:')&&!once){
 if(mode==='precommit'){once=true;notify('precommit');stop();}
 // postcommit is exercised at the first complete progress message, after await tx completion.
 }
 return put.call(this,value,key);
 };
 const getAll=IDBObjectStore.prototype.getAll;
 IDBObjectStore.prototype.getAll=function(range,...args){if(this.name==='settings'&&!range)notify('unbounded-settings');return getAll.call(this,range,...args);};
 const writable=FileSystemFileHandle.prototype.createWritable;
 FileSystemFileHandle.prototype.createWritable=function(...args){notify('unexpected-file-write');return writable.apply(this,args);};
 self.postMessage=(m,...args)=>{
 if(m?.type==='done'&&mode==='done-retry'){notify('done-retry');post({testTerminal:m.batch});heldDone=m;return;}
 if(m?.type==='progress'&&!once){
 if(mode==='postcommit'&&m.progress.state==='complete'){once=true;notify('postcommit');stop();}
 if(mode==='firstchunk'&&m.progress.bytesRead===65536){once=true;notify('firstchunk');stop();}
 if(mode==='midverify'&&m.progress.counts.ready===1&&m.progress.counts.verifying===1&&m.progress.bytesRead>196652){once=true;notify('midverify');stop();}
 if(mode==='interrupt'&&m.progress.counts.verifying===1){once=true;notify('interrupt');}
 if((mode==='revision-race'&&m.progress.bytesRead>0)||(mode==='ready-race'&&m.progress.counts.ready===1)){
 once=true;notify(mode);
 // Emulated competing writer: excluded from this verifier's transaction monitor.
 const req=indexedDB.open('pulso-web-local-v1',2);req.onsuccess=()=>{const db=req.result;const tx=transaction.call(db,'assets','readwrite');const store=tx.objectStore('assets');const r=store.get(${JSON.stringify((window as unknown as {raceAsset?:string}).raceAsset??'')});r.onsuccess=()=>store.put({...r.result,revision:r.result.revision+1},r.result.id);tx.oncomplete=()=>db.close();};
 }
 }
 post(m,...args);
 };
 await import(${JSON.stringify(String(url))});
 const handler=self.onmessage;self.onmessage=e=>{if(e.data?.testRelease){post(heldDone);return;}handler(e);};for(const event of queued)handler(event);
 `;
 const objectUrl=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));super(objectUrl,{...options,type:'module'});URL.revokeObjectURL(objectUrl);lastWorker=this;
 this.addEventListener('message',e=>{if(e.data?.testTerminal){void retryLocalBatch(e.data.testTerminal.id,e.data.testTerminal.revision).then(()=>this.postMessage({testRelease:true}));}if(e.data?.testProbe){probes.push(e.data.testProbe);if(e.data.testProbe==='interrupt'){this.terminate();interruptResolve?.();}}});
 }
}
window.Worker=TestWorker;
let idb:Awaited<ReturnType<typeof fixture>>,opfs:Awaited<ReturnType<typeof fixture>>;
await check('dos backends reales: hash ready y cero copias/chunks/ficheros nuevos',async()=>{
 idb=await fixture('idb',31);opfs=await fixture('opfs',32);
 const chunks=(await all('chunks')).length;const filesBefore:string[]=[];for await(const key of (await assetDirectory()).keys())filesBefore.push(key);
 const b=await batch([idb.track,opfs.track,idb.track]);const done=await runLocalBatch(b.id,signal());
 assert(done.state==='complete'&&done.entries.length===3&&done.entries.every(e=>e.state==='ready'),'no completo');
 assert(done.bytesRead===idb.asset.bytes+opfs.asset.bytes,'repitió bytes por ocurrencia');
 assert((await all('chunks')).length===chunks,'chunks nuevos');const filesAfter:string[]=[];for await(const key of (await assetDirectory()).keys())filesAfter.push(key);
 assert(filesBefore.sort().join()===filesAfter.sort().join(),'ficheros nuevos');assert(!probes.some(p=>p.startsWith('unexpected')),'escritura bytes');
});
await check('snapshot congela orden/repeticiones/labels; rename/reorder/add/delete no lo reescribe',async()=>{
 const p=await playlist([idb.track,opfs.track,idb.track]);const b=await createLocalBatch(p.id,1);
 await writeRecord('playlists',p.id,{...p,name:'Después',revision:2,entries:[...p.entries].reverse().concat({id:crypto.randomUUID(),trackId:opfs.track.id})});
 await writeRecord('tracks',idb.track.id,{...idb.track,title:'Título posterior',revision:idb.track.revision+1});
 const db=await openDatabase();const tx=db.transaction('playlists','readwrite');tx.objectStore('playlists').delete(p.id);await new Promise<void>((r,j)=>{tx.oncomplete=()=>r();tx.onabort=()=>j(tx.error);});db.close();
 const done=await runLocalBatch(b.id,signal());assert(done.state==='complete','playlist borrada afectó lote');
 assert(done.playlistName===p.name&&done.entries.map(e=>e.entryId).join()===p.entries.map(e=>e.id).join(),'snapshot cambió');assert(done.entries[0].title===idb.track.title,'label no congelada');
});
await check('rechaza vacío/conflicto/relación inválida sin guardar queued parcial',async()=>{
 const before=(await listLocalBatches()).length;const p=await playlist([]);
 assert(await rejects(()=>createLocalBatch(p.id,1)),'vacía');assert(await rejects(()=>createLocalBatch(p.id,2)),'revisión');
 await writeRecord('playlists',p.id,{...p,entries:[{id:crypto.randomUUID(),trackId:crypto.randomUUID()}]});assert(await rejects(()=>createLocalBatch(p.id,1)),'relación');
 assert((await listLocalBatches()).length===before,'snapshot parcial');
});
await check('missing y corrupción reales conservan track/playlist/kept en ambos backends',async()=>{
 for(const backend of ['idb','opfs'] as const){
 const f=await fixture(backend,backend==='idb'?33:34);const p=await playlist([f.track]);const b=await createLocalBatch(p.id,1);
 if(backend==='idb'){await writeRecord('chunks',[f.asset.storageKey,0],undefined);}else await(await assetDirectory()).removeEntry(f.asset.storageKey);
 let done=await runLocalBatch(b.id,signal());assert(done.state==='incomplete'&&done.entries[0].state==='missing','ausencia');
 assert(await readRecord('tracks',f.track.id)&&await readRecord('playlists',p.id),'perdió organización');assert((await readRecord<LocalAsset>('assets',f.asset.id))?.retention==='kept','retention');
 const corrupt=await fixture(backend,backend==='idb'?35:36);const bad=await batch([corrupt.track]);
 if(backend==='idb'){const data=(await readRecord<Uint8Array>('chunks',[corrupt.asset.storageKey,0]))!;data[10]^=255;await writeRecord('chunks',[corrupt.asset.storageKey,0],data);}else{const handle=await(await assetDirectory()).getFileHandle(corrupt.asset.storageKey);const w=await handle.createWritable({keepExistingData:true});await w.write(new Uint8Array([255]));await w.close();}
 done=await runLocalBatch(bad.id,signal());assert(done.state==='incomplete'&&done.entries[0].state==='invalid','hash corrupto aceptado');
 }
});
await check('asset repair durante lectura devuelve changed y libera generation lock',async()=>{
 const f=await fixture('idb',37);(window as unknown as {raceAsset:string}).raceAsset=f.asset.id;
 workerMode='revision-race';const b=await batch([f.track]);let done:LocalBatch;try{done=await runLocalBatch(b.id,signal());}finally{workerMode='';}
 assert(probes.includes('revision-race')&&done!.state==='incomplete'&&done!.entries[0].state==='changed','mezcló revisiones');
 assert(await navigator.locks.request(generationLock(f.asset),{ifAvailable:true},lock=>!!lock),'lector sin liberar');
 const earlier=await fixture('idb',39);(window as unknown as {raceAsset:string}).raceAsset=earlier.asset.id;
 workerMode='ready-race';const next=await batch([earlier.track,opfs.track]);
 try{done=await runLocalBatch(next.id,signal());}finally{workerMode='';}
 assert(probes.includes('ready-race')&&done.state==='incomplete'&&done.entries[0].state==='changed','ready obsoleto llegó a complete');
});
await check('cancelación midverify conserva ready y counts/progreso de bytes reales',async()=>{
 const b=await batch([opfs.track,idb.track]);workerMode='midverify';let done:LocalBatch;let ready=0;
 try{done=await runLocalBatch(b.id,signal(),p=>{ready=Math.max(ready,p.counts.ready);});}finally{workerMode='';}
 assert(probes.includes('midverify')&&done!.state==='cancelled'&&done!.entries[0].state==='ready'&&done!.entries[1].state==='pending'&&ready===1,'cancel perdió ready');
 assert(done!.bytesRead===opfs.asset.bytes+65536,'perdió progreso parcial del segundo asset');
 assert(done!.owner===null&&done!.operationId===null,'identidad vigente');
});
await check('cancelación precommit invalida complete; postcommit conserva complete',async()=>{
 for(const mode of ['precommit','postcommit']){const b=await batch([idb.track]);workerMode=mode;let done:LocalBatch;try{done=await runLocalBatch(b.id,signal());}finally{workerMode='';}
 assert(probes.includes(mode),'frontera no ejercida');assert(done!.state===(mode==='precommit'?'cancelled':'complete'),`frontera ${mode}: ${done!.state}`);assert(done!.entries[0].state==='ready','perdió listo');}
});
await check('AbortSignal ya cancelado y cancelación del consumidor no dejan verifying',async()=>{
 const c=new AbortController();c.abort();const b=await batch([idb.track]);const done=await runLocalBatch(b.id,c.signal);assert(done.state==='cancelled','preabort');
 const next=await batch([idb.track]);const mid=new AbortController();const result=await runLocalBatch(next.id,mid.signal,p=>{if(p.state==='verifying')mid.abort();});assert(result.state==='cancelled','abort consumidor');
});
await check('reopen tras worker terminado exige recover/retry explícito y reinicia desde cero',async()=>{
 const b=await batch([idb.track]);workerMode='interrupt';const interrupted=new Promise<void>(resolve=>{interruptResolve=resolve;});
 // Terminated workers leave an unresolved caller; model recovery is independent of that Promise.
 void runLocalBatch(b.id,signal());await interrupted;workerMode='';interruptResolve=undefined;
 let current=(await readLocalBatch(b.id))!;assert(current.state==='verifying','no interrumpió activo');
 assert(await rejects(()=>runLocalBatch(b.id,signal())),'reanudó automáticamente');
 current=await recoverLocalBatch(b.id,current.revision);assert(current.state==='interrupted','no recuperó');
 current=await retryLocalBatch(b.id,current.revision);assert(current.bytesRead===0&&current.entries.every(e=>e.state==='pending'),'no reinició');
 const done=await runLocalBatch(b.id,signal());assert(done.state==='complete'&&done.attempt===2,'retry');
});
await check('otro owner lock bloquea run/recover/retry sin takeover',async()=>{
 const b=await batch([idb.track]);let release!:()=>void;let acquired!:()=>void;const ready=new Promise<void>(r=>{acquired=r;});
 const held=navigator.locks.request(LOCAL_BATCH_LOCK,async()=>{acquired();await new Promise<void>(r=>{release=r;});});await ready;
 try{assert(await rejects(()=>runLocalBatch(b.id,signal())),'run robó lock');assert(await rejects(()=>recoverLocalBatch(b.id,b.revision)),'recover robó lock');assert(await rejects(()=>retryLocalBatch(b.id,b.revision)),'retry robó lock');assert((await readLocalBatch(b.id))?.state==='queued','mutó sin owner');}finally{release();await held;}
});
await check('mensajes viejos/malformados no cancelan ni publican; CAS rechaza revisión vieja',async()=>{
 const b=await batch([idb.track]);let sent=false;
 const done=await runLocalBatch(b.id,signal(),()=>{if(sent)return;sent=true;for(const message of [{version:2,type:'cancel',requestId:crypto.randomUUID(),jobId:b.id},{version:1,type:'cancel',requestId:crypto.randomUUID(),jobId:b.id},{version:1,type:'cancel',requestId:'bad',jobId:b.id}])lastWorker!.postMessage(message);lastWorker!.dispatchEvent(new MessageEvent('message',{data:{version:1,type:'done',requestId:crypto.randomUUID(),jobId:b.id}}));});
 assert(sent&&done.state==='complete','mensaje viejo afectó lote');assert(await rejects(()=>retryLocalBatch(b.id,b.revision)),'CAS viejo');
});
await check('listado settings por prefijo evita materializar covers; manifiesto inválido se rechaza',async()=>{
 await writeRecord('settings','artwork-blob-test',{blob:new Blob([new Uint8Array(2*1024*1024)])});
 const getAll=IDBObjectStore.prototype.getAll;const get=IDBObjectStore.prototype.get;let bounded=false;
 IDBObjectStore.prototype.getAll=function(...args:Parameters<IDBObjectStore['getAll']>){if(this.name==='settings'){assert(args[0] instanceof IDBKeyRange,'sin rango');assert(args[0].lower===LOCAL_BATCH_PREFIX,'prefijo ajeno');bounded=true;}return getAll.apply(this,args);};
 IDBObjectStore.prototype.get=function(key){if(this.name==='settings')assert(typeof key==='string'&&key.startsWith(LOCAL_BATCH_PREFIX),'leyó portada');return get.call(this,key);};
 try{const rows=await listLocalBatches();assert(bounded&&rows.length>0&&rows.every(b=>b.version===1),'listado');}finally{IDBObjectStore.prototype.getAll=getAll;IDBObjectStore.prototype.get=get;}
 const f=await fixture('idb',38);const b=await batch([f.track]);await writeRecord('assets',f.asset.id,{...f.asset,retention:'temporary'});const done=await runLocalBatch(b.id,signal());assert(done.entries[0].state==='invalid'&&done.state==='incomplete','manifest inválido aceptado');
 assert(probes.includes('hash-outside-tx')&&probes.includes('blob-io-outside-tx'),'instrumentación V11 no ejercida');
 assert(!probes.some(p=>p.endsWith('-in-tx')||p.startsWith('unexpected')||p==='unbounded-settings'),'V11/escritura/rango violado: '+[...new Set(probes)].join(','));
});
await check('done correlaciona terminal propio aunque retry ya haya guardado queued',async()=>{
 const b=await batch([idb.track]);workerMode='done-retry';let done:LocalBatch;
 try{done=await runLocalBatch(b.id,signal());}finally{workerMode='';}
 const current=(await readLocalBatch(b.id))!;
 assert(probes.includes('done-retry')&&current.state==='queued','retry no ganó la carrera antes de done');
 assert(done!.state==='complete'&&done!.attempt===1&&done!.revision+1===current.revision,'devolvió resultado del retry');
 const second=await runLocalBatch(b.id,signal());assert(second.state==='complete'&&second.attempt===2,'retry posterior');
 assert(done!.attempt===1&&done!.state==='complete','snapshot terminal mutó');
});
await check('coherencia persistida: intentos/bytes/estados y dedup por asset, counts por ocurrencia',async()=>{
 const b=await batch([idb.track,idb.track]);const done=await runLocalBatch(b.id,signal());
 const progress=localBatchProgress(done);
 assert(validLocalBatch(done)&&progress.counts.ready===2&&progress.totalBytes===idb.asset.bytes&&done.bytesRead===idb.asset.bytes,'dedup/counts');
 const small=structuredClone(done);for(const e of small.entries){e.asset.bytes=10;e.asset.chunks=1;}
 small.attempt=0;small.bytesRead=0;
 assert(!validLocalBatch(small),'complete ready attempt0 bytes0 asset10 aceptado');
 for(const bad of [{...done,attempt:0},{...done,bytesRead:0},{...done,bytesRead:done.bytesRead+1},{...done,state:'queued'},{...done,state:'incomplete',entries:done.entries.map(e=>({...e,state:'pending'}))}])assert(!validLocalBatch(bad),'estado incoherente aceptado');
 const conflicting=structuredClone(done);conflicting.entries[1].asset.revision++;
 assert(!validLocalBatch(conflicting),'dedup de dos generaciones distintas');
 await writeRecord('settings',LOCAL_BATCH_PREFIX+done.id,small);
 assert(await rejects(()=>readLocalBatch(done.id)),'lectura aceptó incoherencia');
 assert(!(await listLocalBatches()).some(row=>row.id===done.id),'listado aceptó incoherencia');
 await writeRecord('settings',LOCAL_BATCH_PREFIX+done.id,done);
});
await check('cancelar primer chunk persiste 65536; reopen conserva y retry reinicia desde cero',async()=>{
 for(const f of [idb,opfs]){
 const b=await batch([f.track]);workerMode='firstchunk';let done:LocalBatch;let reported=0;
 try{done=await runLocalBatch(b.id,signal(),p=>{reported=Math.max(reported,p.bytesRead);});}finally{workerMode='';}
 const reopened=(await readLocalBatch(b.id))!;
 assert(done!.state==='cancelled'&&reported===65536&&done!.bytesRead===reported&&reopened.bytesRead===reported,'progreso cancelado perdido');
 const retry=await retryLocalBatch(b.id,reopened.revision);assert(retry.bytesRead===0&&retry.entries[0].state==='pending','retry no reinició');
 const complete=await runLocalBatch(b.id,signal());assert(complete.attempt===2&&complete.bytesRead===f.asset.bytes&&complete.state==='complete','retry acumuló bytes previos');
 }
});
await check('APIs normalizan fallos IDB de open/transaction/request con causa privada y mensaje seguro',async()=>{
 const b=await batch([idb.track]);const cause=new DOMException('ruta privada de prueba','SecurityError');
 const calls=[()=>readLocalBatch(b.id),()=>listLocalBatches(),()=>createLocalBatch(b.playlistId,b.playlistRevision),()=>updateLocalBatch(b,()=>{}),()=>recoverLocalBatch(b.id,b.revision),()=>retryLocalBatch(b.id,b.revision),()=>runLocalBatch(b.id,signal())];
 for(const stage of ['open','transaction','request','abort']){
 const open=IDBFactory.prototype.open;const transaction=IDBDatabase.prototype.transaction;const get=IDBObjectStore.prototype.get;const getAll=IDBObjectStore.prototype.getAll;
 if(stage==='open')IDBFactory.prototype.open=function(){throw cause;};
 else if(stage==='transaction')IDBDatabase.prototype.transaction=function(){throw cause;};
 else{
 IDBObjectStore.prototype.get=function(key){if(stage==='request')throw cause;const req=get.call(this,key);this.transaction.abort();return req;};
 IDBObjectStore.prototype.getAll=function(...args:Parameters<IDBObjectStore['getAll']>){if(stage==='request')throw cause;const req=getAll.apply(this,args);this.transaction.abort();return req;};
 }
 try{for(const call of calls){let caught:unknown;try{await call();}catch(error){caught=error;}
 assert(caught instanceof LocalBatchError&&caught.code==='storage'&&(stage==='abort'?caught.cause instanceof DOMException&&caught.cause.name==='AbortError':caught.cause===cause),'error crudo o causa perdida: '+stage);
 assert(caught.message==='Lote local: storage'&&!String(caught).includes('privada'),'detalle crudo público');
 }}finally{IDBFactory.prototype.open=open;IDBDatabase.prototype.transaction=transaction;IDBObjectStore.prototype.get=get;IDBObjectStore.prototype.getAll=getAll;}
 }
 const current=await readLocalBatch(b.id);assert(current?.state==='queued','fallo storage mutó lote');
});
window.Worker=NativeWorker;
(window as unknown as {pulsoLocalBatches:unknown}).pulsoLocalBatches={passed:results.length===16&&results.every(s=>s.startsWith('PASS')),results,probes,userAgent:navigator.userAgent};
document.querySelector('#results')!.textContent+='\nCOMPLETADO';
