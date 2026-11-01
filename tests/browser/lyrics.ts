import {readLyrics,setManualLyrics,LYRICS_PREFIX,LyricsError,parseLyrics} from '../../src/library/lyrics';
import {openDatabase,readRecord,writeRecord} from '../../src/storage/database';
import {importFile} from '../../src/imports/import-file';
import {all,type Track} from '../../src/library/library';
const results:string[]=[];
function assert(v:unknown,m:string):asserts v{if(!v)throw new Error(m);}
async function check(name:string,fn:()=>Promise<void>){try{await fn();results.push('PASS '+name);}catch(e){results.push('FAIL '+name+': '+(e instanceof Error?e.message:String(e)));}document.querySelector('#results')!.textContent=results.join('\n');}
async function rejects(fn:()=>Promise<unknown>,code:string){let e:unknown;try{await fn();}catch(error){e=error;}assert(e instanceof LyricsError&&e.code===code,'expected '+code);}
function wav(){const data=new Uint8Array(44144),v=new DataView(data.buffer);const put=(o:number,s:string)=>{for(let i=0;i<s.length;i++)data[o+i]=s.charCodeAt(i);};put(0,'RIFF');v.setUint32(4,data.length-8,true);put(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,22050,true);v.setUint32(28,44100,true);v.setUint16(32,2,true);v.setUint16(34,16,true);put(36,'data');v.setUint32(40,44100,true);return new File([data],'letras-original.wav',{type:'audio/wav'});}
const reopening=sessionStorage.getItem('lyrics-reopen');
if(reopening){
 sessionStorage.removeItem('lyrics-reopen');
 const prior=JSON.parse(reopening) as {trackId:string;revision:string;results:string[]};results.push(...prior.results);
 await check('recarga real del documento conserva revisión/texto en nueva instancia',async()=>{const r=await readLyrics(prior.trackId);assert(r.state==='ready'&&r.revision===prior.revision&&r.lyrics.kind==='plain'&&r.lyrics.text==='Fixed','document reopen');});
 (window as unknown as {pulsoLyrics:unknown}).pulsoLyrics={passed:results.length===12&&results.every(s=>s.startsWith('PASS')),results};
}else{
let track:Track;let revision:string|0=0;
await check('ausencia inicial, texto Unicode/inyección inerte y reapertura IDB',async()=>{
 track=(await importFile(wav(),new AbortController().signal,()=>{},{backend:'idb'})).track;
 assert(JSON.stringify(await readLyrics(track.id))===JSON.stringify({state:'absent',revision:0}),'initial');
 const text='Niño 😀\r\n<script>globalThis.lyricsInjected=true</script>\njavascript:alert(1)';
 const written=await setManualLyrics(track.id,text,'plain',0);assert(written.state==='ready'&&written.lyrics.kind==='plain','plain');revision=written.revision!;
 const db=await openDatabase();db.close();const r=await readLyrics(track.id);assert(r.state==='ready'&&r.lyrics.kind==='plain'&&r.lyrics.text===text.replace(/\r\n/g,'\n')&&r.revision===revision,'reopen');
 const node=document.createElement('div');node.textContent=r.lyrics.text;document.body.append(node);assert(!node.querySelector('script')&&!('lyricsInjected'in globalThis),'executed text');
});
await check('LRC explícito/offset/multiples y ausencia manual versionada',async()=>{
 const r=await setManualLyrics(track.id,'[offset:+100]\n[00:02][00:01.25]Propio','lrc',revision);assert(r.state==='ready'&&r.lyrics.kind==='timed'&&r.lyrics.cues[0].timeMs===1350,'timed');revision=r.revision!;
 const a=await setManualLyrics(track.id,null,'plain',revision);assert(a.state==='absent'&&typeof a.revision==='string'&&a.revision!==revision,'absence');revision=a.revision;
 const again=await readLyrics(track.id);assert(again.state==='absent'&&again.revision===revision,'persistent absence');
});
await check('límites/truncados fallan sin mutar; formato explícito',async()=>{
 const before=JSON.stringify(await readRecord('settings',LYRICS_PREFIX+track.id));
 for(const [text,format,code]of [['a'.repeat(131073),'plain','size'],['\n'.repeat(4000),'plain','lines'],['[00:01','lrc','timestamp'],['[00:60]bad','lrc','timestamp'],['[offset:600001]\n[00:01]a','lrc','offset']]as const)await rejects(()=>setManualLyrics(track.id,text,format,revision),code);
 assert(before===JSON.stringify(await readRecord('settings',LYRICS_PREFIX+track.id)),'mutated on invalid');assert(parseLyrics('[00:01]dato','plain').kind==='plain','guessed timing');
});
await check('pista inválida/ausente y conflictos CAS entre escritores',async()=>{
 for(const id of ['bad',crypto.randomUUID()]){const r=await readLyrics(id);assert(r.state==='unavailable'&&r.failureCode==='track'&&r.revision===null,'invalid track read');await rejects(()=>setManualLyrics(id,'dato','plain',0),'track');}
 const writes=await Promise.allSettled([setManualLyrics(track.id,'A','plain',revision),setManualLyrics(track.id,'B','plain',revision)]);
 assert(writes.filter(r=>r.status==='fulfilled').length===1,'CAS double write');const failed=writes.find(r=>r.status==='rejected');assert(failed?.status==='rejected'&&failed.reason instanceof LyricsError&&failed.reason.code==='conflict','race error');const current=await readLyrics(track.id);assert(current.state==='ready','current');const oldRevision=revision;revision=current.revision;
 await rejects(()=>setManualLyrics(track.id,'stale','plain',oldRevision),'conflict');
});
await check('cuota inyectada y abort preservan registro anterior y audio',async()=>{
 const before=JSON.stringify(await readRecord('settings',LYRICS_PREFIX+track.id));const put=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(value,key){if(this.name==='settings'&&String(key).startsWith(LYRICS_PREFIX))throw new DOMException('synthetic quota','QuotaExceededError');return put.call(this,value,key);};
 try{await rejects(()=>setManualLyrics(track.id,'quota','plain',revision),'quota');}finally{IDBObjectStore.prototype.put=put;}
 assert(before===JSON.stringify(await readRecord('settings',LYRICS_PREFIX+track.id)),'lost record');
 IDBObjectStore.prototype.put=function(value,key){const req=put.call(this,value,key);if(this.name==='settings'&&String(key).startsWith(LYRICS_PREFIX))this.transaction.abort();return req;};
 try{await rejects(()=>setManualLyrics(track.id,'abort','plain',revision),'storage');}finally{IDBObjectStore.prototype.put=put;}
 assert(before===JSON.stringify(await readRecord('settings',LYRICS_PREFIX+track.id)),'abort mutated');assert(await readRecord('assets',track.assetId),'audio missing');
});
await check('corrupción preservada: null revision, reparación CAS y token obsoleto',async()=>{
 for(const bad of [undefined,null,{version:99,revision:0,text:'roto'},{version:1,revision:Number.MAX_SAFE_INTEGER,text:'roto'}]){
 await writeRecord('settings',LYRICS_PREFIX+track.id,bad);const r=await readLyrics(track.id);assert(r.state==='unavailable'&&r.revision===null&&r.repairToken,'repair missing');
 assert(JSON.stringify(await readRecord('settings',LYRICS_PREFIX+track.id))===JSON.stringify(bad),'corrupt erased');await rejects(()=>setManualLyrics(track.id,'dato','plain',0),'corrupt');
 await writeRecord('settings',LYRICS_PREFIX+track.id,{changed:true});await rejects(()=>setManualLyrics(track.id,'dato','plain',null,r.repairToken),'conflict');
 const fresh=await readLyrics(track.id);assert(fresh.state==='unavailable'&&fresh.repairToken,'fresh repair');const fixed=await setManualLyrics(track.id,'Reparado','plain',null,fresh.repairToken);assert(fixed.state==='ready'&&typeof fixed.revision==='string','repair');revision=fixed.revision!;
 }
});
await check('corrupción no acotable/Blob rechazada sin lectura IO ni reparación',async()=>{
 const bad={blob:new Blob(['never read'])};await writeRecord('settings',LYRICS_PREFIX+track.id,bad);
 const r=await readLyrics(track.id);assert(r.state==='unavailable'&&r.revision===null&&!r.repairToken,'unsafe repair');
 await rejects(()=>setManualLyrics(track.id,'repair','plain',0),'corrupt');assert((await readRecord<{blob:Blob}>('settings',LYRICS_PREFIX+track.id))?.blob.size===10,'preservation');
 const db=await openDatabase();const tx=db.transaction('settings','readwrite');tx.objectStore('settings').delete(LYRICS_PREFIX+track.id);await new Promise<void>((r,j)=>{tx.oncomplete=()=>r();tx.onabort=()=>j(tx.error);});db.close();revision=0;
});
await check('manual sobrevive reimportación sin cambios en audio, metadata ni cola',async()=>{
 const tracks=JSON.stringify(await all('tracks')),assets=JSON.stringify(await all('assets')),chunks=JSON.stringify(await all('chunks'));
 await writeRecord('settings','queue-lyrics-test',{entries:[track.id],paused:true});const queue=JSON.stringify(await readRecord('settings','queue-lyrics-test'));
 await setManualLyrics(track.id,'Corrección propia','plain',revision);assert(JSON.stringify(await all('tracks'))===tracks&&JSON.stringify(await all('assets'))===assets&&JSON.stringify(await all('chunks'))===chunks,'lyrics modified audio or metadata');
 const reimport=await importFile(wav(),new AbortController().signal,()=>{},{backend:'idb'});assert(reimport.track.id===track.id,'dedup identity');
 const r=await readLyrics(track.id);assert(r.state==='ready'&&r.lyrics.text==='Corrección propia','manual lost');assert(JSON.stringify(await readRecord('settings','queue-lyrics-test'))===queue,'queue modified');assert(JSON.stringify(await all('chunks'))===chunks,'reimport changed audio');
});
await check('V11: parser fuera de transacción; ningún IO Blob/hash; reparación evita ABA',async()=>{
 const transaction=IDBDatabase.prototype.transaction,encode=TextEncoder.prototype.encode,buffer=Blob.prototype.arrayBuffer;
 const live=new Set<IDBTransaction>();let encodes=0,blobReads=0;
 IDBDatabase.prototype.transaction=function(...args:Parameters<IDBDatabase['transaction']>){const tx=transaction.apply(this,args);live.add(tx);tx.addEventListener('complete',()=>live.delete(tx),{once:true});tx.addEventListener('abort',()=>live.delete(tx),{once:true});return tx;};
 TextEncoder.prototype.encode=function(input){encodes++;assert(live.size===0,'parser dentro IDB');return encode.call(this,input);};
 Blob.prototype.arrayBuffer=function(){blobReads++;throw new Error('lyrics Blob IO');};
 try{
 const before=await readLyrics(track.id);assert(before.state==='ready','before');
 const saved=await setManualLyrics(track.id,'[00:01]Original','lrc',before.revision);assert(saved.state==='ready','saved');
 const corrupt={version:1,trackId:track.id,manual:true,format:'lrc',text:'[00:',revision:saved.revision};await writeRecord('settings',LYRICS_PREFIX+track.id,corrupt);
 const bad=await readLyrics(track.id);assert(bad.state==='unavailable'&&bad.repairToken&&bad.revision===null,'bad');
 const fixed=await setManualLyrics(track.id,'Fixed','plain',null,bad.repairToken);assert(fixed.state==='ready'&&fixed.revision!==saved.revision,'ABA revision reuse');
 await rejects(()=>setManualLyrics(track.id,'stale','plain',saved.revision),'conflict');
 assert(encodes>=4&&blobReads===0&&live.size===0,'V11 probes');
 }finally{IDBDatabase.prototype.transaction=transaction;TextEncoder.prototype.encode=encode;Blob.prototype.arrayBuffer=buffer;}
});
await check('cuota asíncrona inyectada en transacción aborta CAS y conserva elección',async()=>{
 const before=await readLyrics(track.id);assert(before.state==='ready','before async quota');
 const saved=JSON.stringify(await readRecord('settings',LYRICS_PREFIX+track.id));const put=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(value,key){const req=put.call(this,value,key);if(this.name==='settings'&&String(key)===LYRICS_PREFIX+track.id){const tx=this.transaction;queueMicrotask(()=>{Object.defineProperty(tx,'error',{value:new DOMException('async quota','QuotaExceededError')});tx.abort();});}return req;};
 try{await rejects(()=>setManualLyrics(track.id,'No guardar','plain',before.revision),'quota');}finally{IDBObjectStore.prototype.put=put;}
 assert(saved===JSON.stringify(await readRecord('settings',LYRICS_PREFIX+track.id)),'async quota committed');
});
await check('corrupción 100000 claves corta enumeración y no ordena fuera de cota, también en CAS',async()=>{
 const saved=await readRecord('settings',LYRICS_PREFIX+track.id);const wide:Record<string,number>={};for(let i=0;i<100000;i++)wide['field'+i]=i;
 await writeRecord('settings',LYRICS_PREFIX+track.id,wide);const sort=Array.prototype.sort;let maximumSorted=0;
 Array.prototype.sort=function(...args:Parameters<typeof sort>){maximumSorted=Math.max(maximumSorted,this.length);return sort.apply(this,args);};
 try{const r=await readLyrics(track.id);assert(r.state==='unavailable'&&!r.repairToken,'wide unsafe repair');assert(maximumSorted<=32,'sorted entire corrupt object');}finally{Array.prototype.sort=sort;}
 await writeRecord('settings',LYRICS_PREFIX+track.id,saved);const before=await readLyrics(track.id);assert(before.state==='ready','restored');const get=IDBObjectStore.prototype.get;maximumSorted=0;
 IDBObjectStore.prototype.get=function(query){const req=get.call(this,query);if(this.name==='settings'&&query===LYRICS_PREFIX+track.id&&this.transaction.mode==='readwrite')req.addEventListener('success',()=>Object.defineProperty(req,'result',{value:wide}),{once:true});return req;};
 Array.prototype.sort=function(...args:Parameters<typeof sort>){maximumSorted=Math.max(maximumSorted,this.length);return sort.apply(this,args);};
 try{await rejects(()=>setManualLyrics(track.id,'No guardar','plain',before.revision),'corrupt');assert(maximumSorted<=32,'CAS sorted unbounded keys');}finally{IDBObjectStore.prototype.get=get;Array.prototype.sort=sort;}
 assert(JSON.stringify(await readRecord('settings',LYRICS_PREFIX+track.id))===JSON.stringify(saved),'corrupt CAS mutated');
});
const persisted=await readLyrics(track!.id);
sessionStorage.setItem('lyrics-reopen',JSON.stringify({trackId:track!.id,revision:persisted.revision,results}));
location.reload();
}
