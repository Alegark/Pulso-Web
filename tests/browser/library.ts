import {importFile as importCore} from '../../src/imports/import-file';
// These legacy regressions intentionally exercise IDB-specific fault injection.
const importFile:typeof importCore=(file,signal,progress,options)=>importCore(file,signal,progress,{...options,backend:'idb'});
import {all,createPlaylist,changePlaylist,editTrack,verifiedAsset,type Track,type LocalAsset,type Playlist} from '../../src/library/library';
import {readRecord,writeRecord} from '../../src/storage/database';
import {FixtureStore} from '../../src/storage/assets';
import {fixtures} from '../../src/fixtures';
import {importIssues,retainImportIssue} from '../../src/storage/import-operations';
const results:string[]=[];
function assert(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
async function check(name:string,fn:()=>Promise<void>){try{await fn();results.push(`PASS ${name}`);}catch(e){results.push(`FAIL ${name}: ${e instanceof Error?e.message:String(e)}`);}document.querySelector('#results')!.textContent=results.join('\n');}
const bytes=await(await fetch('/fixtures/A.mp3')).arrayBuffer();const file=new File([bytes],'Áudio propio 🎵.mp3',{type:'audio/mpeg'});
let id='';let assetId='';
await check('importa audio verificado sin confundir fixture legacy de huella idéntica',async()=>{
 const store=new FixtureStore();await store.save(fixtures[0],new ReadableStream({start(controller){controller.enqueue(new Uint8Array(bytes));controller.close();}}),new AbortController().signal);
 for(const issue of await importIssues())if(!issue.retained)await retainImportIssue(issue);
 const result=await importFile(file,new AbortController().signal);id=result.track.id;assetId=result.track.assetId;const asset=await verifiedAsset(assetId);assert(asset,'asset');assert(assetId!==fixtures[0].id,'reutilizó identidad de fixture');assert(asset.bytes===file.size,'longitud');assert(result.track.duration>0,'duración');assert(await store.verify(fixtures[0]),'fixture original alterada');
});
await check('reimportación binaria no duplica pista ni asset publicado',async()=>{const before=(await all<Track>('tracks')).length;const result=await importFile(file,new AbortController().signal);assert(result.duplicate&&result.track.id===id,'identidad');assert((await all<Track>('tracks')).length===before,'duplicado');});
await check('metadatos y favorito sobreviven reimportación',async()=>{const before=await readRecord<Track>('tracks',id);assert(before,'track');await editTrack(id,before.revision,{title:'Título manual Unicode ñ',artist:'Artista local',album:'Álbum local',favorite:true});await importFile(file,new AbortController().signal);const after=await readRecord<Track>('tracks',id);assert(after?.title==='Título manual Unicode ñ'&&after.favorite&&after.manualOverrides.title===after.title,'override perdido');});
await check('rechaza MIME falso y cancelación sin publicar',async()=>{const count=(await all<Track>('tracks')).length;let rejected=false;try{await importFile(new File(['<script>bad()</script>'],'fake.mp3',{type:'audio/mpeg'}),new AbortController().signal);}catch{rejected=true;}assert(rejected,'MIME falso aceptado');const abort=new AbortController();abort.abort();try{await importFile(file,abort.signal);}catch{}assert((await all<Track>('tracks')).length===count,'publicó cancelado');});
await check('playlist evita duplicado y borrar no toca bytes ni pista',async()=>{const list=await createPlaylist('Lista prueba');await changePlaylist(list.id,list.revision,{type:'add',trackId:id});let current=await readRecord<Playlist>('playlists',list.id);assert(current,'playlist');await changePlaylist(current.id,current.revision,{type:'add',trackId:id});current=await readRecord<Playlist>('playlists',list.id);assert(current?.entries.length===1,'duplicado');await changePlaylist(current.id,current.revision,{type:'rename',name:'Renombrada'});current=await readRecord<Playlist>('playlists',list.id);assert(current?.name==='Renombrada','rename');await changePlaylist(current.id,current.revision,{type:'delete'});assert(!await readRecord('playlists',current.id),'no borró playlist');assert(await readRecord('tracks',id),'borró track');assert(await verifiedAsset(assetId),'borró bytes');});
await check('asset permanece íntegro tras múltiples conexiones independientes',async()=>{const manifest=await readRecord<LocalAsset>('assets',assetId);assert(manifest,'manifest');const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');assert(manifest.sha256===hash,'hash');assert(await verifiedAsset(assetId),'reopen 1');assert(await verifiedAsset(assetId),'reopen 2');});
await check('reimportación repara bytes corruptos conservando identidad y corrección',async()=>{
 const before=await readRecord<LocalAsset>('assets',assetId);assert(before,'asset');const key=[before.storageKey,0];const original=await readRecord<Uint8Array>('chunks',key);assert(original,'chunk');const corrupt=original.slice();corrupt[0]^=255;await writeRecord('chunks',key,corrupt);
 assert(await verifiedAsset(assetId,true)===null,'corrupción no detectada');const result=await importFile(file,new AbortController().signal);assert(result.track.id===id&&result.track.assetId===assetId,'identidad cambió');assert(result.track.title==='Título manual Unicode ñ','override perdido');assert(await verifiedAsset(assetId,true),'no reparado');
});
await check('reimportación idéntica elimina solo su staging no publicado',async()=>{
 const before=(await all('chunks')).length;await importFile(file,new AbortController().signal);assert((await all('chunks')).length===before,'staging duplicado acumulado');assert(await verifiedAsset(assetId,true),'original eliminado');
});
await check('cancelación durante escritura no publica pista ni pierde original',async()=>{
 const abort=new AbortController();const originalPut=IDBObjectStore.prototype.put;let copied=false;const before=(await all('tracks')).length;
 IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){const result=originalPut.apply(this,args);if(this.name==='chunks'&&!copied){copied=true;this.transaction.addEventListener('complete',()=>abort.abort(),{once:true});}return result;};
 let rejected=false;try{await importFile(file,abort.signal);}catch{rejected=true;}finally{IDBObjectStore.prototype.put=originalPut;}
 assert(copied&&rejected,'cancelación no ejercitada');assert((await all('tracks')).length===before,'publicación parcial');assert(await verifiedAsset(assetId,true),'original perdido');
});
await check('cuota simulada en copia no publica pista ni elimina bytes conservados',async()=>{
 const originalPut=IDBObjectStore.prototype.put;const before=(await all('tracks')).length;let rejected=false;
 IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){if(this.name==='chunks')throw new DOMException('cuota simulada','QuotaExceededError');return originalPut.apply(this,args);};
 try{await importFile(file,new AbortController().signal);}catch{rejected=true;}finally{IDBObjectStore.prototype.put=originalPut;}
 assert(rejected,'cuota no ejercitada');assert((await all('tracks')).length===before,'publicación parcial');assert(await verifiedAsset(assetId,true),'original perdido');
});
(window as unknown as {pulsoLibrary:unknown}).pulsoLibrary={results,passed:results.every(x=>x.startsWith('PASS')),userAgent:navigator.userAgent};document.querySelector('#results')!.textContent+='\nCOMPLETADO';
