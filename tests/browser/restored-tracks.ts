// Focused real-IDB/OPFS reproduction (synthetic owned WAVs only):
// node scripts/browser-build.mjs restored-tracks library opfs
// node scripts/run-browser-tests.mjs restored-tracks library opfs > /tmp/pulso-restored-results.json
// Runner: Chromium Linux with sandbox, ephemeral loopback; no iPhone acceptance.
import {importFile} from '../../src/imports/import-file';
import {all,editTrack,verifiedAsset,type Track,type Playlist,type AudioFingerprint} from '../../src/library/library';
import {openDatabase,committed,readRecord,writeRecord} from '../../src/storage/database';
import {importOperation,importOperations,importIssues,retainImportIssue,recoverImportOperation,validImportOperation} from '../../src/storage/import-operations';
import {readArtwork} from '../../src/library/artwork';
import {readLyrics,setManualLyrics} from '../../src/library/lyrics';
import {createLocalBatch,listLocalBatches} from '../../src/library/local-batches';
const results:string[]=[];
function assert(v:unknown,m:string):asserts v{if(!v)throw new Error(m);}
async function check(n:string,fn:()=>Promise<void>){try{await fn();results.push(`PASS ${n}`);}catch(e){results.push(`FAIL ${n}: ${e instanceof Error?e.message:String(e)}`);}document.querySelector('#results')!.textContent=results.join('\n');}
const signal=()=>new AbortController().signal;
function wav(seed:number){const b=new ArrayBuffer(8044),v=new DataView(b);const str=(p:number,s:string)=>[...s].forEach((c,i)=>v.setUint8(p+i,c.charCodeAt(0)));str(0,'RIFF');v.setUint32(4,b.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,8000,true);for(let i=44;i<b.byteLength;i+=2)v.setInt16(i,Math.sin(i*seed/100)*12000,true);return new File([b],'Mismo título.wav',{type:'audio/wav'});}
async function fingerprint(f:File):Promise<AudioFingerprint>{return {algorithm:'sha256',sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join(''),bytes:f.size};}
async function restored(f:File):Promise<Track>{const t:Track={id:crypto.randomUUID(),assetId:null,audioFingerprint:await fingerprint(f),organizationRef:{libraryId:crypto.randomUUID(),id:crypto.randomUUID()},title:'Mismo título',artist:null,album:null,duration:0.5,favorite:true,manualOverrides:{title:'Mismo título'},revision:1,createdAt:new Date().toISOString()};await writeRecord('tracks',t.id,t);return t;}
await check('sin audio: portada no disponible, letras independientes y lote sin queued parcial',async()=>{
 const get=IDBObjectStore.prototype.get;let nullReads=0;
 IDBObjectStore.prototype.get=function(key){if(key===null){nullReads++;throw new Error('IDB get(null)');}return get.call(this,key);};
 try{
 const t=await restored(wav(1));assert((await readArtwork(t.id)).state==='unavailable','portada');
 assert((await readLyrics(t.id)).state==='absent','letras ausentes');
 await setManualLyrics(t.id,'Letra propia','plain',0);assert((await readLyrics(t.id)).state==='ready','letras sin audio');
 const p:Playlist={id:crypto.randomUUID(),name:'Restaurada',revision:1,entries:[{id:crypto.randomUUID(),trackId:t.id}]};await writeRecord('playlists',p.id,p);
 const count=(await listLocalBatches()).length;let message='';try{await createLocalBatch(p.id,1);}catch(e){message=(e as Error).message;}
 assert(message.includes('Importa el original')&&(await listLocalBatches()).length===count,'lote parcial o error no accionable');
 assert(nullReads===0,'intentó get(null)');
 }finally{IDBObjectStore.prototype.get=get;}
});
for(const backend of ['idb','opfs'] as const){
 await check(`${backend}: enlaza todas sin fusionar, conserva ediciones recientes y relaciones; no parser extra`,async()=>{
 const file=wav(backend==='idb'?2:3),a=await restored(file),b=await restored(file),variant=await restored(wav(70));
 const wrongLength=await restored(file);wrongLength.audioFingerprint!.bytes++;await writeRecord('tracks',wrongLength.id,wrongLength);
 const p:Playlist={id:crypto.randomUUID(),name:'Actual',revision:4,organizationRef:a.organizationRef,entries:[{id:crypto.randomUUID(),trackId:b.id}]};
 const before=(await all('tracks')).length;let edit:Promise<unknown>|undefined;
 const result=await importFile(file,signal(),()=>{edit??=(async()=>{await editTrack(a.id,1,{title:'Última edición',album:'Actual',favorite:false});await writeRecord('playlists',p.id,p);})();},{backend});await edit;
 const x=await readRecord<Track>('tracks',a.id),y=await readRecord<Track>('tracks',b.id);
 assert(x?.assetId&&x.assetId===y?.assetId&&x.id!==y.id,'no enlazó ambas');
 assert(x.title==='Última edición'&&!x.favorite&&x.manualOverrides.album==='Actual'&&x.organizationRef?.id===a.organizationRef?.id,'pisó cambios');
 assert((await all('tracks')).length===before,'creó parser extra');assert((await readRecord<Track>('tracks',variant.id))?.assetId===null,'unió título o bytes diferentes');
 assert((await readRecord<Track>('tracks',wrongLength.id))?.assetId===null,'ignoró longitud');
 assert(JSON.stringify(await readRecord('playlists',p.id))===JSON.stringify(p),'pisó playlist');assert(await verifiedAsset(result.track.assetId,true),'bytes');
 const c=await restored(file);const duplicate=await importFile(file,signal(),()=>{},{backend});assert(duplicate.duplicate&&(await readRecord<Track>('tracks',c.id))?.assetId===x.assetId,'dedup no enlazó');
 });
}
await check('recovery close incierto enlaza placeholders sin publicación parcial',async()=>{
 const file=wav(4),a=await restored(file),b=await restored(file),id=crypto.randomUUID();const close=FileSystemWritableFileStream.prototype.close;
 FileSystemWritableFileStream.prototype.close=async function(){await close.call(this);throw new Error('lost ack');};
 try{await importFile(file,signal(),()=>{},{backend:'opfs',operationId:id});}catch{}finally{FileSystemWritableFileStream.prototype.close=close;}
 const job=await importOperation(id);assert(job?.state==='uncertain','no conservó incertidumbre');assert((await readRecord<Track>('tracks',a.id))?.assetId===null,'publicó antes de verificar');
 await editTrack(a.id,1,{title:'Corrección tras corte'});const count=(await all('tracks')).length;
 const resolved=await recoverImportOperation(id,job.revision,'resume');const x=await readRecord<Track>('tracks',a.id),y=await readRecord<Track>('tracks',b.id);
 assert(resolved.state==='sealed'&&x?.assetId===y?.assetId&&x?.title==='Corrección tras corte'&&(await all('tracks')).length===count,'recovery');
 assert(!validImportOperation({...resolved,track:{...resolved.track,assetId:null}},id),'job aceptó ficha sin asset real');
});
await check('cancel en commit revierte enlaces, recovery dedup enlaza pendientes',async()=>{
 const file=wav(5),a=await restored(file),controller=new AbortController(),id=crypto.randomUUID();const put=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){const r=put.apply(this,args);if(this.name==='assets')controller.abort();return r;};
 try{await importFile(file,controller.signal,()=>{},{backend:'idb',operationId:id});}catch{}finally{IDBObjectStore.prototype.put=put;}
 const job=await importOperation(id);assert(job?.state==='uncertain'&&(await readRecord<Track>('tracks',a.id))?.assetId===null,'cancel publicó enlace');await recoverImportOperation(id,job.revision,'resume');
 const b=await restored(file),pendingId=crypto.randomUUID(),close=FileSystemWritableFileStream.prototype.close;
 FileSystemWritableFileStream.prototype.close=async function(){await close.call(this);throw new Error('lost ack');};
 try{await importFile(file,signal(),()=>{},{backend:'opfs',operationId:pendingId});}catch{}finally{FileSystemWritableFileStream.prototype.close=close;}
 const pending=await importOperation(pendingId);assert(pending,'job');const resolved=await recoverImportOperation(pendingId,pending.revision,'resume');assert(resolved.result?.duplicate&&(await readRecord<Track>('tracks',b.id))?.assetId===resolved.result.track.assetId,'dedup recovery');
});
await check('importación nueva guarda huella original confirmada y legacy string sigue válido',async()=>{
 const file=wav(6),result=await importFile(file,signal(),()=>{},{backend:'idb'});const expected=await fingerprint(file);
 assert(JSON.stringify(result.track.audioFingerprint)===JSON.stringify(expected),'huella original');
 const legacy={...result.track};delete legacy.audioFingerprint;await writeRecord('tracks',legacy.id,legacy);
 const duplicate=await importFile(file,signal(),()=>{},{backend:'idb'});assert(duplicate.track.id===legacy.id&&duplicate.duplicate,'legacy');
});
// Inject only test-owned corrupt rows, then remove the fixture and recover the same operation.
async function removeFixture(key:string){const db=await openDatabase();try{const tx=db.transaction('tracks','readwrite');const done=committed(tx);tx.objectStore('tracks').delete(key);await done;}finally{db.close();}}
async function interrupted(file:File,id:string){
 const close=FileSystemWritableFileStream.prototype.close;
 FileSystemWritableFileStream.prototype.close=async function(){await close.call(this);throw new Error('lost ack');};
 try{await importFile(file,signal(),()=>{},{backend:'opfs',operationId:id});}catch{}finally{FileSystemWritableFileStream.prototype.close=close;}
 const job=await importOperation(id);assert(job?.state==='uncertain','no quedó staging recuperable');return job;
}
for(const mode of ['normal','dedup','recovery'] as const){
 await check(`${mode}: clave K con id H no pisa ficha sana ni publica enlaces/ownership`,async()=>{
 const healthyFile=wav(mode==='normal'?81:mode==='dedup'?82:83);
 const healthy=await importFile(healthyFile,signal(),()=>{},{backend:'idb'});
 await editTrack(healthy.track.id,healthy.track.revision,{title:'Sana favorita '+mode,favorite:true});
 const before=await readRecord<Track>('tracks',healthy.track.id),asset=await verifiedAsset(healthy.track.assetId,true);
 assert(before&&asset,'fixture sana');const assetSnapshot=JSON.stringify(asset),healthySnapshot=JSON.stringify(before);
 const file=mode==='dedup'?healthyFile:wav(mode==='normal'?84:85),id=crypto.randomUUID();
 // Recovery and dedup start with a fully written, closed generation whose acknowledgement was lost.
 if(mode!=='normal')await interrupted(file,id);
 const key=crypto.randomUUID(),bad={...before,assetId:null,audioFingerprint:await fingerprint(file),title:'Intrusa',favorite:false};
 await writeRecord('tracks',key,bad);const badSnapshot=JSON.stringify(bad);
 let rejected=false;
 try{if(mode==='normal')await importFile(file,signal(),()=>{},{backend:'idb',operationId:id});else{const j=await importOperation(id);assert(j,'job');await recoverImportOperation(id,j.revision,'resume');}}catch{rejected=true;}
 assert(rejected,'aceptó clave/identidad contradictoria');
 assert(JSON.stringify(await readRecord('tracks',healthy.track.id))===healthySnapshot,'pisó H sana');
 assert(JSON.stringify(await readRecord('tracks',key))===badSnapshot,'alteró K corrupta');
 assert(JSON.stringify(await verifiedAsset(asset.id,true))===assetSnapshot,'alteró asset sano/bytes');
 const pending=await importOperation(id);assert(pending&&!pending.result,'no conservó operación sin resultado');
 const proofKey=['asset-ownership',pending.backend,pending.storageKey];
 assert((await readRecord<{everPublished:boolean}>('settings',proofKey))?.everPublished===false,'confirió propiedad publicada');
 if(mode!=='dedup')assert(!await readRecord('assets',pending.asset!.id),'publicó asset parcial');
 // After removing only our corrupt fixture, the unchanged staging can complete normally.
 await removeFixture(key);const resumed=await recoverImportOperation(id,pending.revision,'resume');
 assert(resumed.state==='sealed'&&resumed.result,'no recuperó tras reparar fixture');
 assert(JSON.stringify(await readRecord('tracks',healthy.track.id))===healthySnapshot,'recuperación pisó sana');
 assert(JSON.stringify(await verifiedAsset(asset.id,true))===assetSnapshot,'recuperación cambió asset sano');
 });
}
await check('shape inválido de ficha aborta antes de enlazar cualquier placeholder',async()=>{
 const file=wav(86),a=await restored(file),b=await restored(file),id=crypto.randomUUID();
 const job=await interrupted(file,id);const invalid={...b,manualOverrides:[]};await writeRecord('tracks',b.id,invalid);
 let rejected=false;try{await recoverImportOperation(id,job.revision,'resume');}catch{rejected=true;}
 assert(rejected&&JSON.stringify(await readRecord('tracks',a.id))===JSON.stringify(a),'enlace parcial');
 assert(JSON.stringify(await readRecord('tracks',b.id))===JSON.stringify(invalid),'reparó corrupción implícitamente');
 await writeRecord('tracks',b.id,b);const current=await importOperation(id);assert(current,'job');await recoverImportOperation(id,current.revision,'resume');
 assert((await readRecord<Track>('tracks',a.id))?.assetId===(await readRecord<Track>('tracks',b.id))?.assetId,'recuperación no enlazó ambas');
});
await check('validador: huellas/identidad de resultado coherentes; legacy y duplicate legítimos',async()=>{
 const id=crypto.randomUUID();await importFile(wav(87),signal(),()=>{},{backend:'idb',operationId:id});const job=await importOperation(id);assert(job?.track&&job.result&&job.asset,'job completo');
 assert(validImportOperation(job,id),'job normal');
 const tiny={...job,bytes:10,expectedBytes:10,asset:{...job.asset,sha256:'a'.repeat(64),bytes:10},track:{...job.track,audioFingerprint:{algorithm:'sha256',sha256:'b'.repeat(64),bytes:11}},result:undefined,state:'ready'};
 assert(!validImportOperation(tiny,id),'repro r4 asset SHA a/10 y track SHA b/11');
 const f=job.track.audioFingerprint!;
 for(const audioFingerprint of [{...f,sha256:'a'.repeat(64)},{...f,bytes:f.bytes+1}]){
 assert(!validImportOperation({...job,track:{...job.track,audioFingerprint}},id),'aceptó huella job incoherente');
 assert(!validImportOperation({...job,result:{...job.result,track:{...job.result.track,audioFingerprint}}},id),'aceptó huella result incoherente');
 }
 const other={...job.result.track,id:crypto.randomUUID(),title:'Restaurada legítima',favorite:true};
 assert(!validImportOperation({...job,result:{track:other,duplicate:false}},id),'duplicate false identidad ajena');
 assert(validImportOperation({...job,result:{track:other,duplicate:true}},id),'rechazó duplicate con ficha legítima');
 assert(!validImportOperation({...job,result:{track:{...other,assetId:crypto.randomUUID()},duplicate:true}},id),'duplicate ajeno al asset');
 const legacy={...job,track:{...job.track,audioFingerprint:undefined},result:{...job.result,track:{...job.result.track,audioFingerprint:undefined}}};
 assert(validImportOperation(legacy,id),'legacy sin huella');
 const malformed=[null,[],{track:null,duplicate:true},{track:[],duplicate:true},{track:{...other,manualOverrides:[]},duplicate:true},{track:{...other,organizationRef:null},duplicate:true},{track:{...other,title:{}},duplicate:true}];
 for(const result of malformed)assert(!validImportOperation({...job,result},id),'shape inválido result admitido');
 for(const track of [null,[],{...job.track,manualOverrides:new Map()},{...job.track,duration:null}])assert(!validImportOperation({...job,track},id),'shape inválido track admitido');
});
await check('jobs corruptos/null result: enumeración y retención conservan job, bytes y propiedad',async()=>{
 const source=(await importOperations()).find(j=>j.state==='sealed'&&j.result&&!j.result.duplicate);assert(source?.track&&source.asset&&source.result,'base');
 const variants=[{track:{...source.track,audioFingerprint:{algorithm:'sha256',sha256:'a'.repeat(64),bytes:10}}},
 {result:{track:{...source.result.track,id:crypto.randomUUID()},duplicate:false}},
 {result:null},{result:{track:null,duplicate:true}}];
 for(const patch of variants){
 const operationId=crypto.randomUUID(),storageKey=crypto.randomUUID();
 const job={...source,operationId,storageKey,asset:{...source.asset,storageKey},...patch};
 const proofKey=['asset-ownership',job.backend,storageKey],proof={operationId,owner:job.owner,everPublished:false};
 const chunk=new Uint8Array([1,7,3]);await writeRecord('jobs',operationId,job);await writeRecord('settings',proofKey,proof);await writeRecord('chunks',[storageKey,0],chunk);
 assert(!validImportOperation(job,operationId),'job inconsistente válido');
 const issue=(await importIssues()).find(i=>i.key===operationId);assert(issue?.kind==='invalid'&&!issue.retained,'no enumeró inválido');
 assert(!await importOperation(operationId)&&!(await importOperations()).some(j=>j.operationId===operationId),'confirió job válido');
 let rejected=false;try{await recoverImportOperation(operationId,job.revision,'discard');}catch{rejected=true;}assert(rejected,'permitió limpiar job inválido');
 await retainImportIssue(issue);
 assert((await importIssues()).find(i=>i.key===operationId)?.retained,'no retuvo revisión');
 assert(JSON.stringify(await readRecord('jobs',operationId))===JSON.stringify(job),'eliminó/modificó bad job');
 assert(JSON.stringify(await readRecord('settings',proofKey))===JSON.stringify(proof),'amplió propiedad');
 assert(String(await readRecord('chunks',[storageKey,0]))===String(chunk),'limpió bytes inconsistentes');
 }
});
(window as unknown as {pulsoRestoredTracks:unknown}).pulsoRestoredTracks={passed:results.length===12&&results.every(r=>r.startsWith('PASS')),results};
