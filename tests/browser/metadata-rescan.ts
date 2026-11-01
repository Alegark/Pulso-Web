// TESTONLY synthetic audio and native storage/worker parser. No main/UI acceptance.
import {rescanLocalAlbum,inspectMetadataRescan,readMetadataRescanPending,type MetadataRescanReference,type MetadataRescanContext} from '../../src/library/metadata-rescan';
import {readRecord,writeRecord,openDatabase,closeDatabase} from '../../src/storage/database';
import {transactionDone} from '../../src/storage/transaction-done';
import {activeDatabaseWorkerAttempts,revokeDatabaseWorkerAttempts,beginWorkerAttempt} from '../../src/storage/database-realms';
import {copyLocalAlbumMetadata,unknownLocalAlbum} from '../../src/library/album-metadata';
import {issuedFailure} from '../../src/errors/app-failure';
import {generationLock,ASSET_DIRECTORY,WRITER_LOCK,openAssetReader} from '../../src/storage/asset-reader';
import type {Track,LocalAsset} from '../../src/library/library';
// TESTONLY native IO instrumentation runs in a Blob bootstrap that imports the
// unchanged production worker bundle. No production source hooks or mock reader.
const {authorizeRealmFixture,initializeRealmFixture}=await import('./realm-fixture');
const NativeWorker=globalThis.Worker;let workerFault='normal';
const workerStats:{chunkReads:number;keyCursors:number;opfsReads:number;opfsBytes:number;createTrue:number}[]=[];
const bootstrap=String.raw`let state={chunkReads:0,keyCursors:0,opfsReads:0,opfsBytes:0,createTrue:0};
const get=IDBObjectStore.prototype.get;IDBObjectStore.prototype.get=function(key){if(this.name==='chunks'){state.chunkReads++;if(mode==='read-io')throw new DOMException('TESTONLY worker read denied','SecurityError');}return get.call(this,key);};
const cursor=IDBObjectStore.prototype.openKeyCursor;IDBObjectStore.prototype.openKeyCursor=function(...args){if(this.name==='chunks')state.keyCursors++;return cursor.apply(this,args);};
const persisted=new WeakSet(),parsed=new WeakSet();
const getFile=FileSystemFileHandle.prototype.getFile;FileSystemFileHandle.prototype.getFile=async function(){const f=await getFile.call(this);persisted.add(f);return f;};
const handle=FileSystemDirectoryHandle.prototype.getFileHandle;FileSystemDirectoryHandle.prototype.getFileHandle=function(name,options){if(options?.create)state.createTrue++;return handle.call(this,name,options);};
const slice=Blob.prototype.slice;Blob.prototype.slice=function(...args){const part=slice.apply(this,args);if(persisted.has(this))persisted.add(part);if(parsed.has(this)||this instanceof File&&this.name==='local-audio')parsed.add(part);return part;};
const arrayBuffer=Blob.prototype.arrayBuffer;Blob.prototype.arrayBuffer=function(){if(persisted.has(this)){state.opfsReads++;state.opfsBytes+=this.size;}if(parsed.has(this)&&mode==='parse-fail')throw Error('TESTONLY native parser input failed');return arrayBuffer.call(this);};
const post=self.postMessage.bind(self);self.postMessage=m=>{if(m&&['candidate','failure'].includes(m.type))post({TESTONLY:'stats',stats:state});post(m);};
const queued=[];const buffer=e=>{queued.push(e);e.stopImmediatePropagation();};self.addEventListener('message',buffer);
await import(workerURL);self.removeEventListener('message',buffer);for(const e of queued)self.onmessage.call(self,e);`;
globalThis.Worker=class extends NativeWorker {
 constructor(url:string|URL,options?:WorkerOptions){
 const own=String(url).includes('metadata-rescan.worker');const target=own?URL.createObjectURL(new Blob(['const mode='+JSON.stringify(workerFault)+';const workerURL='+JSON.stringify(String(url))+';'+bootstrap],{type:'text/javascript'})):url;
 super(target,options);if(own){URL.revokeObjectURL(String(target));this.addEventListener('message',e=>{if(e.data?.TESTONLY==='stats'){workerStats.push(e.data.stats);e.stopImmediatePropagation();}});}
 }
};
const release=authorizeRealmFixture();await initializeRealmFixture();
const results:string[]=[],rawErrors:unknown[]=[];
function assert(v:unknown,m:string):asserts v {if(!v)throw Error(m);}
const ordered=(v:unknown):unknown=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,ordered(x)])):Array.isArray(v)?v.map(ordered):v;
const equal=(a:unknown,b:unknown)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
async function reset(){const db=await openDatabase();try{const tx=db.transaction([...db.objectStoreNames],'readwrite'),done=transactionDone(tx);for(const n of [...db.objectStoreNames])tx.objectStore(n).clear();await done;}finally{closeDatabase(db);}const root=await navigator.storage.getDirectory();try{await root.removeEntry(ASSET_DIRECTORY,{recursive:true});}catch(e){if(!(e instanceof DOMException&&e.name==='NotFoundError'))throw e;}}
const r76Only=new URLSearchParams(location.search).has('r76');
async function check(name:string,fn:()=>Promise<void>){if(r76Only&&!name.startsWith('R76'))return;try{await reset();await fn();assert(activeDatabaseWorkerAttempts()===0,'worker token leaked');results.push('PASS '+name);}catch(e){rawErrors.push({group:name,name:e instanceof Error?e.name:typeof e,message:e instanceof Error?e.message:String(e),stack:e instanceof Error?e.stack:null});results.push(`FAIL ${name}: ${e instanceof Error?e.message:String(e)}`);}document.querySelector('#results')!.textContent=results.join('\n');}
const text=(s:string)=>new TextEncoder().encode(s);
const join=(...parts:Uint8Array[])=>{const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){b.set(p,o);o+=p.length;}return b;};
const n32=(n:number,le=false)=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n,le);return b;};
const read32=(b:Uint8Array,p:number)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(p);
const ascii=(b:Uint8Array,p:number,n:number)=>String.fromCharCode(...b.subarray(p,p+n));
const box=(name:string,body:Uint8Array)=>join(n32(body.length+8),text(name),body);
const sync=(n:number)=>new Uint8Array([n>>>21&127,n>>>14&127,n>>>7&127,n&127]);
const frame=(id:string,value:string)=>{const b=join(new Uint8Array([3]),text(value));return join(text(id),sync(b.length),new Uint8Array(2),b);};
const tag=(...frames:Uint8Array[])=>{const b=join(...frames);return join(text('ID3'),new Uint8Array([4,0,0]),sync(b.length),b);};
const tags=(ordinal='1/12')=>tag(frame('TRCK',ordinal),frame('TPOS','2/3'),frame('TPE2','Taller Δ'),frame('TCMP','0'),frame('TALB','Luz propia'),frame('TPE1','Intérprete propio'));
const chunk=(name:string,b:Uint8Array)=>join(text(name),n32(b.length,true),b,new Uint8Array(b.length%2));
const wav=(id3?:Uint8Array,seed=1)=>{const pcm=new Uint8Array(3200),view=new DataView(pcm.buffer);for(let p=0;p<pcm.length;p+=2)view.setInt16(p,Math.round(3000*Math.sin(p*seed/20)),true);const fmt=join(new Uint8Array([1,0,1,0]),n32(8000,true),n32(16000,true),new Uint8Array([2,0,16,0]));const body=join(text('WAVE'),chunk('fmt ',fmt),...(id3?[chunk('ID3 ',id3)]:[]),chunk('data',pcm));return new File([join(text('RIFF'),n32(body.length,true),body)],'propio.wav',{type:'audio/wav'});};
const mp3base=new Uint8Array(await(await fetch('/fixtures/A.mp3')).arrayBuffer());
let mp3offset=0;while(ascii(mp3base,mp3offset,3)==='ID3'){const p=mp3offset+6;mp3offset+=10+mp3base[p]*2097152+mp3base[p+1]*16384+mp3base[p+2]*128+mp3base[p+3];}
const mp3=(id3:Uint8Array)=>new File([new Uint8Array(id3),mp3base.slice(mp3offset)],'propio.mp3',{type:'audio/mpeg'});
const base=new Uint8Array(await(await fetch('/fixtures/B.m4a')).arrayBuffer());
let moov=-1,mdat=-1;for(let p=0;p<base.length;p+=read32(base,p)){if(ascii(base,p+4,4)==='moov')moov=p;if(ascii(base,p+4,4)==='mdat')mdat=p;}
assert(moov>mdat&&mdat>=0&&moov+read32(base,moov)===base.length,'fixture offsets');
const moovParts:Uint8Array[]=[];for(let p=moov+8;p<base.length;p+=read32(base,p))if(ascii(base,p+4,4)!=='udta')moovParts.push(base.slice(p,p+read32(base,p)));
const withIlst=(ilst:Uint8Array)=>new File([base.slice(0,moov),box('moov',join(...moovParts,box('udta',box('meta',join(new Uint8Array(4),box('ilst',ilst))))))],'propio.m4a',{type:'audio/mp4'});
const atom=(name:string,b:Uint8Array,kind=0)=>box(name,box('data',join(n32(kind),n32(0),b)));
const pair=(current:number,total:number)=>new Uint8Array([0,0,current>>>8,current&255,total>>>8,total&255,0,0]);
const m4a=()=>withIlst(join(atom('trkn',pair(65535,65535)),atom('disk',pair(2,3)),atom('aART',text('Taller Δ'),1),atom('cpil',new Uint8Array([0]),21)));
const hash=async(b:Blob)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');
async function seed(file:File,backend:'idb'|'opfs'='idb'){
 const id=crypto.randomUUID(),key=crypto.randomUUID(),asset:LocalAsset={id,namespace:'local',storageKey:key,bytes:file.size,sha256:await hash(file),mime:file.type,chunks:Math.ceil(file.size/65536),state:'complete',revision:1,chunkSize:65536,retention:'kept',backend};
 const track:Track={id:crypto.randomUUID(),assetId:id,title:'Título conservado',artist:'Artista',album:'Álbum',duration:0.2,favorite:true,revision:7,createdAt:'2026-10-31T00:00:00.000Z',manualOverrides:{title:'Título conservado',album:'Álbum'},organizationRef:{libraryId:crypto.randomUUID(),id:crypto.randomUUID()}};
 await writeRecord('assets',id,asset);await writeRecord('tracks',track.id,track);
 if(backend==='idb'){const b=new Uint8Array(await file.arrayBuffer());const db=await openDatabase();try{const tx=db.transaction('chunks','readwrite'),done=transactionDone(tx);for(let i=0;i<asset.chunks;i++)tx.objectStore('chunks').put(b.slice(i*65536,Math.min(b.length,(i+1)*65536)),[key,i]);await done;}finally{closeDatabase(db);}}
 else {const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle(ASSET_DIRECTORY,{create:true}),w=await(await dir.getFileHandle(key,{create:true})).createWritable();await w.write(file);await w.close();}
 return {track,asset,file};
}
const controller=()=>new AbortController();
const context=(abort=controller(),extra:Partial<MetadataRescanContext>={}):MetadataRescanContext=>({signal:abort.signal,current:()=>true,onPending:()=>{},...extra});
const scan=(t:Track,c=context())=>rescanLocalAlbum({operationId:crypto.randomUUID(),trackId:t.id,expectedRevision:t.revision},c);
const reread=(t:Track)=>readRecord<Track>('tracks',t.id);
const ref=(s:unknown)=>{assert(s&&typeof s==='object','reference');return s as MetadataRescanReference;};
const setSlot=(value:unknown)=>writeRecord('settings','metadata-rescan:v1:slot',value);
await check('F01 real parser MP3/WAV-ID3/M4A on IDB+OPFS; false/Unicode/16bit; reopen and audio preserved',async()=>{
 for(const backend of ['idb','opfs'] as const)for(const [name,file,kind] of [['MP3',mp3(tags()),'embedded-id3'],['WAV',wav(tags()),'embedded-riff-id3'],['M4A',m4a(),'embedded-mp4']] as const){
 const {track,asset}=await seed(file,backend);const result=await scan(track);assert(result.state==='committed'&&result.effect==='updated',name+backend+JSON.stringify(result));
 const after=(await reread(track))!,s=after.localAlbum!.source;assert(s.track.state==='known'&&s.track.value.current===(name==='M4A'?65535:1),'ordinal '+JSON.stringify(s));assert(s.disc.state==='known'&&s.disc.value.current===2&&s.disc.value.total===3,'disc');assert(s.albumArtist.state==='known'&&s.albumArtist.value==='Taller Δ','Unicode');assert(s.compilation.state==='known'&&s.compilation.value===false,'false');assert(s.track.evidence.kind===kind,'provenance');
 const {localAlbum:_,revision:__,...rest}=after;const {revision:___,...original}=track;assert(equal(rest,original),'whole Track preservation');assert(equal(await readRecord('assets',asset.id),asset),'manifest mutated');assert((await inspectMetadataRescan(result.reference,context())).state==='committed','historical receipt');assert(await readMetadataRescanPending(context())===null,'terminal pending');
 }
});
await check('F02 monotonic known/restored evidence, no-change revision; known conflict and corrupt old container zero Track writes',async()=>{
 const {track}=await seed(wav(tags())),r=await scan(track);assert(r.state==='committed','first');const known=(await reread(track))!;
 const nochange=await scan(known);assert(nochange.state==='committed'&&nochange.effect==='no-change'&&nochange.trackRevision===known.revision,'revision bumped '+JSON.stringify(nochange));assert(equal(await reread(track),known),'known evidence changed');
 const conflict={...known,localAlbum:copyLocalAlbumMetadata(known.localAlbum)!};conflict.localAlbum.source.track={state:'known',value:{current:9,total:12},evidence:{kind:'embedded-id3',tag:'TRCK'}};await writeRecord('tracks',track.id,conflict);const stopped=await scan(conflict);assert(stopped.state==='not-applied'&&stopped.reason==='conflict','conflict');assert(equal(await reread(track),conflict),'conflict wrote');
 const invalid={...known,localAlbum:{version:1,source:{}}};await writeRecord('tracks',track.id,invalid);const bad=await scan(known);assert(bad.state==='not-applied'&&bad.reason==='conflict','corrupt old');assert(equal(await reread(track),invalid),'repaired corrupt');
 const absent=await seed(wav(undefined,4));await writeRecord('tracks',absent.track.id,{...absent.track,localAlbum:known.localAlbum});const preserved=await scan(absent.track);assert(preserved.state==='committed'&&preserved.effect==='no-change','known degraded by absent');
});
await check('F03 absent, invalid ordinal, duplicate conflict, omitted tags and parser/container failure',async()=>{
 for(const [file,wanted] of [[wav(undefined,5),'absent'],[mp3(tag(frame('TRCK','1x'))),'invalid'],[wav(tag(frame('TRCK','1'),frame('TRCK','2')),6),'conflict'],[mp3(tag(...Array.from({length:129},()=>frame('TRCK','1')))),'omitted']] as const){const {track}=await seed(file);const r=await scan(track);assert(r.state==='committed','parse '+JSON.stringify(r));const s=r.localAlbum.source.track;assert(s.state==='unknown'&&s.reason===wanted,'coverage '+JSON.stringify(s));}
 const f=new File([new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WAVEbad')],'bad.wav',{type:'audio/wav'}),{track}=await seed(f),r=await scan(track);assert(r.state==='not-applied'&&r.reason==='not-inspected','parser false committed '+JSON.stringify(r));assert(equal(await reread(track),track),'parse failure wrote');
});
await check('F04 exact 8MiB accepted; +1 before Worker/IO, no-local-copy; full Track fingerprint coherence',async()=>{
 const small=new Uint8Array(await wav(tags(),7).arrayBuffer()),padding=chunk('JUNK',new Uint8Array(8388608-small.length-8));new DataView(small.buffer).setUint32(4,8388608-8,true);const padded=new File([small,padding],'large.wav',{type:'audio/wav'});for(const backend of ['idb','opfs'] as const){const a=await seed(padded,backend);const r=await scan(a.track);assert(r.state==='committed','exact8MiB '+JSON.stringify(r));const counts=workerStats.at(-1)!;assert(counts.createTrue===0,'create count '+JSON.stringify(counts));assert(backend==='idb'?counts.chunkReads===128&&counts.keyCursors===1&&counts.opfsReads===0:counts.chunkReads===0&&counts.opfsReads===128&&counts.opfsBytes===8388608,'persistent reread '+JSON.stringify(counts));}
 const b=await seed(wav(tags(),8)),WorkerOriginal=globalThis.Worker;let created=0;globalThis.Worker=class extends WorkerOriginal{constructor(...args:ConstructorParameters<typeof Worker>){super(...args);created++;}};
 try{await writeRecord('assets',b.asset.id,{...b.asset,bytes:8388609,chunks:129});const over=await scan(b.track);assert(over.state==='not-applied'&&over.reason==='limit'&&created===0,'+1 allocated worker');await writeRecord('tracks',b.track.id,{...b.track,assetId:null});const none=await scan(b.track);assert(none.state==='not-applied'&&none.reason==='no-local-copy'&&created===0,'no copy IO');}finally{globalThis.Worker=WorkerOriginal;}
 await writeRecord('assets',b.asset.id,b.asset);await writeRecord('tracks',b.track.id,{...b.track,audioFingerprint:{algorithm:'sha256',sha256:'0'.repeat(64),bytes:b.asset.bytes}});const incoherent=await scan(b.track);assert(incoherent.state==='not-applied'&&incoherent.reason==='corrupt','fingerprint');
});
await check('F05 IDB missing/extra/corrupt bytes and OPFS missing; no create, no Track/audio mutation',async()=>{
 for(const fault of ['missing','extra','corrupt','opfs-missing'] as const){const {track,asset}=await seed(wav(tags(),9),fault==='opfs-missing'?'opfs':'idb');
 if(fault==='opfs-missing'){const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle(ASSET_DIRECTORY);await dir.removeEntry(asset.storageKey);}
 else if(fault==='extra')await writeRecord('chunks',[asset.storageKey,asset.chunks],new Uint8Array([1]));
 else if(fault==='corrupt'){const b=await readRecord<Uint8Array>('chunks',[asset.storageKey,0]);b![b!.length-1]^=1;await writeRecord('chunks',[asset.storageKey,0],b);}
 else {const db=await openDatabase();try{const tx=db.transaction('chunks','readwrite'),done=transactionDone(tx);tx.objectStore('chunks').delete([asset.storageKey,0]);await done;}finally{closeDatabase(db);}}
 const r=await scan(track);assert(r.state==='not-applied'&&r.reason===(fault==='missing'||fault==='opfs-missing'?'missing':'corrupt'),fault+JSON.stringify(r));assert(equal(await reread(track),track),'failure wrote Track');
 if(fault==='opfs-missing'){let exists=false;try{await(await(await navigator.storage.getDirectory()).getDirectoryHandle(ASSET_DIRECTORY)).getFileHandle(asset.storageKey);exists=true;}catch{}assert(!exists,'recreated audio');}
 }
 const io=await seed(wav(tags(),18));workerFault='read-io';try{const r=await scan(io.track);assert(r.state==='not-applied'&&r.reason==='storage'&&r.failure?.code==='storage-denied','IO misclassified '+JSON.stringify(r));assert(equal(await reread(io.track),io.track),'IO wrote');}finally{workerFault='normal';}
});
await check('F06 full Track/asset CAS and no fanout: favorite without bump, overrides, organization ref, asset generation',async()=>{
 for(const change of ['favorite','override','organizationRef','asset'] as const){const {track,asset}=await seed(wav(tags(),10));const second={...track,id:crypto.randomUUID()};await writeRecord('tracks',second.id,second);let mutation:Promise<unknown>|null=null;
 const r=await scan(track,context(controller(),{onProgress:p=>{if(p.phase==='parse'&&!mutation)mutation=change==='asset'?writeRecord('assets',asset.id,{...asset,revision:2}):writeRecord('tracks',track.id,{...track,...(change==='favorite'?{favorite:false}:change==='override'?{manualOverrides:{title:'Cambio'}}:{organizationRef:{libraryId:crypto.randomUUID(),id:crypto.randomUUID()}})});}}));await mutation;
 assert(r.state==='not-applied'&&r.reason==='changed',change+JSON.stringify(r));assert(!(await reread(track))!.localAlbum,'CAS wrote');assert(equal(await reread(second),second),'fanout by hash');
 }
});
await check('F07 cancel/read/parse/before put, old guard; commit winner survives cancel and ACK failure; quota primary preserved',async()=>{
 for(const phase of ['verify','parse','commit'] as const){const {track}=await seed(wav(tags(),11)),abort=controller();const r=await scan(track,context(abort,{onProgress:p=>{if(p.phase===phase)abort.abort();}}));assert(r.state==='not-applied'&&r.reason==='cancelled',phase+JSON.stringify(r));assert(equal(await reread(track),track),'cancel put');}
 const parse=await seed(wav(tags(),19));workerFault='parse-fail';try{const r=await scan(parse.track);assert(r.state==='not-applied'&&r.reason==='not-inspected'&&r.failure?.phase==='parse','parser fail committed '+JSON.stringify(r));assert(equal(await reread(parse.track),parse.track),'parser fail wrote');}finally{workerFault='normal';}
 const old=await seed(wav(tags(),12));let current=true;const revoked=await scan(old.track,context(controller(),{current:()=>current,onProgress:p=>{if(p.phase==='parse')current=false;}}));assert(revoked.state==='not-applied'&&revoked.reason==='changed','old guard');
 const quota=await seed(wav(tags(),13)),abort=controller(),put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='tracks'){queueMicrotask(()=>abort.abort());throw new DOMException('TESTONLY native quota','QuotaExceededError');}return put.apply(this,args);};try{const r=await scan(quota.track,context(abort));assert(r.state==='not-applied'&&r.failure?.code==='quota-exceeded','quota masked '+JSON.stringify(r));}finally{IDBObjectStore.prototype.put=put;}
 const winner=await seed(wav(tags(),14)),cancel=controller(),post=Worker.prototype.postMessage;
 IDBObjectStore.prototype.put=function(...args){if(this.name==='tracks')this.transaction.addEventListener('complete',()=>cancel.abort());return put.apply(this,args);};Worker.prototype.postMessage=function(...args){if(args[0]?.type==='ack')throw Error('TESTONLY lost terminal ACK');return Reflect.apply(post,this,args);};
 try{const r=await scan(winner.track,context(cancel));assert(r.state==='committed'&&(await inspectMetadataRescan(r.reference,context())).state==='committed','winner cancelled '+JSON.stringify(r));}finally{IDBObjectStore.prototype.put=put;Worker.prototype.postMessage=post;}
});
await check('F08 journal prepared/terminal/reopen, strict corrupt and incarnation loss, historical receipt, replacement unknown',async()=>{
 const {track}=await seed(wav(tags(),15));let pending:MetadataRescanReference|null=null;const r=await scan(track,context(controller(),{onPending:p=>pending=p}));assert(r.state==='committed'&&pending,'pending reference');
 const oldSlot=await readRecord<Record<string,unknown>>('settings','metadata-rescan:v1:slot');await writeRecord('tracks',track.id,{...track,revision:99});assert((await inspectMetadataRescan(ref(pending),context())).state==='committed','historical Track assertion');
 const {afterRevision:_,effect:__,...header}=oldSlot!;await setSlot({...header,state:'prepared'});assert(equal(await readMetadataRescanPending(context()),pending),'reopen prepared');assert((await inspectMetadataRescan(ref(pending),context())).state==='not-committed','prepared must prove under locks');assert((await readRecord<any>('settings','metadata-rescan:v1:slot')).state==='not-committed','inspect failed to settle interrupted intent');const resumed=await scan({...track,revision:99});assert(resumed.state==='committed','inspection left future explicit attempt blocked '+JSON.stringify(resumed));
 await setSlot({...header,state:'not-committed'});assert((await inspectMetadataRescan(ref(pending),context())).state==='not-committed','terminal aborted');
 await setSlot({...header,state:'prepared',extra:'bad'});let thrown=false;try{await readMetadataRescanPending(context());}catch(e){thrown=issuedFailure(e)?.code==='local-corrupt';}assert(thrown,'slot corrupt returned null');assert((await inspectMetadataRescan(ref(pending),context())).state==='uncertain','corrupt inference');
 await setSlot(oldSlot);await writeRecord('settings','metadata-rescan:v1:incarnation',crypto.randomUUID());const lost=await inspectMetadataRescan(ref(pending),context());assert(lost.state==='uncertain'&&lost.reason==='original-library-unavailable','incarnation recreated');await writeRecord('settings','metadata-rescan:v1:incarnation',ref(pending).incarnation);await setSlot({...oldSlot,operationId:crypto.randomUUID()});assert((await inspectMetadataRescan(ref(pending),context())).state==='uncertain','replaced receipt false notcommitted');
});
await check('F09 rescan/writer ifAvailable locks; inspect while active is busy; reader held to commit settlement',async()=>{
 const {track,asset}=await seed(wav(tags(),16));let unlock!:()=>void,ready!:()=>void;const started=new Promise<void>(r=>ready=r);const held=navigator.locks.request('pulso-web:local:metadata-rescan:v1',async()=>{ready();await new Promise<void>(r=>unlock=r);});await started;
 try{const r=await scan(track);assert(r.state==='not-applied'&&r.reason==='busy','queued rescan');}finally{unlock();await held;}
 let inspection:Promise<unknown>|null=null,lockHeld=false,writerFree=false;const r=await scan(track,context(controller(),{onProgress:p=>{if(p.phase==='commit'){inspection=navigator.locks.query().then(q=>{lockHeld=q.held?.some(l=>l.name===generationLock(asset)&&l.mode==='shared')===true;writerFree=!q.held?.some(l=>l.name===WRITER_LOCK);});}}}));await inspection;assert(r.state==='committed'&&lockHeld&&writerFree,'reader lifetime/writer held while parse');
 const current=(await reread(track))!,abort=controller();let busy:Promise<unknown>|null=null;const attempt=await scan(current,context(abort,{onPending:p=>{busy=inspectMetadataRescan(p,context());},onProgress:p=>{if(p.phase==='parse')abort.abort();}}));const inspected=await busy as any;assert(attempt.state==='not-applied'&&inspected?.state==='uncertain'&&inspected.reason==='busy','busy inspection inferred absence');
});
await check('F10 worker lifecycle/bind, revoke during read; onPending throw and unresolved journal prevent any retry',async()=>{
 const {track}=await seed(wav(tags(),17));const r=await scan(track,context(controller(),{onProgress:p=>{if(p.phase==='verify')revokeDatabaseWorkerAttempts();}}));assert(r.state==='not-applied'&&r.reason==='changed','revoked worker accepted');assert(equal(await reread(track),track),'revocation wrote');
 const next=await scan(track,context(controller(),{onPending:()=>{throw Error('TESTONLY onPending persistence failure');}}));assert(next.state==='not-applied'&&equal(await reread(track),track),'throwing observer mutated');
 const id=crypto.randomUUID(),inc=crypto.randomUUID(),slot={version:1,operationId:id,incarnation:inc,trackId:track.id,trackRevision:track.revision,assetId:track.assetId,assetRevision:1,state:'prepared'};await writeRecord('settings','metadata-rescan:v1:incarnation',inc);await setSlot(slot);const blocked=await scan(track);assert(blocked.state==='not-applied'&&blocked.reason==='busy','replayed prepared');assert(equal(await readRecord('settings','metadata-rescan:v1:slot'),slot),'overwrote unresolved');
 const worker=new Worker(new URL('../../src/imports/metadata-rescan.worker.ts',import.meta.url),{type:'module'});try{const a=await beginWorkerAttempt('copies',worker,()=>true);a.revoke();assert(!a.current(),'guard revived');a.closeAfterSettlement();}finally{worker.terminate();}
});

// R76 TESTONLY wrappers retain real native requests/transactions. Faults are
// confined to DOM; production Worker/parser/reader and realm bind are unchanged.
const r76Observations:unknown[]=[];
async function intact(a:Awaited<ReturnType<typeof seed>>,expected:Track=a.track){
 assert(equal(await reread(a.track),expected),'whole Track/favorite/overrides/organization changed');
 assert(equal(await readRecord('assets',a.asset.id),a.asset),'asset changed');
 const reader=await openAssetReader(a.asset);try{assert((await reader.verifyDetailed(true)).state==='valid','reader bytes/hash');}finally{await reader.release();}
 await navigator.locks.request(generationLock(a.asset),{mode:'exclusive'},()=>{});
 assert(activeDatabaseWorkerAttempts()===0,'attempt leaked');
}
function cancelled(r:Awaited<ReturnType<typeof scan>>){assert(r.state==='not-applied'&&r.reason==='cancelled'&&r.failure?.family==='cancelled'&&r.failure.code==='cancelled','cancel classification '+JSON.stringify(r));}
await check('R76-01 pending native intent and commit requests; retry and locks IDB+OPFS',async()=>{
 for(const backend of ['idb','opfs'] as const)for(const target of [2,3]){
 const a=await seed(wav(tags()),backend),abort=controller(),get=IDBObjectStore.prototype.get;let gets=0,at=0;
 IDBObjectStore.prototype.get=function(...args){const r=get.apply(this,args);if(this.name==='tracks'&&++gets===target)queueMicrotask(()=>{at=gets;abort.abort();});return r;};
 let r;try{r=await scan(a.track,context(abort));}finally{IDBObjectStore.prototype.get=get;}
 cancelled(r);assert(at===target,'native pending barrier');await intact(a);
 const journal=await readRecord<any>('settings','metadata-rescan:v1:slot');assert(target===3?journal?.state==='not-committed':journal===undefined||journal.state==='committed','journal settlement');
 r76Observations.push({backend,target,result:r,journal:journal?.state??'absent'});
 const retry=await scan(a.track);assert(retry.state==='committed','new explicit attempt/lock release');await intact(a,(await reread(a.track))!);
 }
});
await check('R76-02 cancel before transaction; no writes, pending or worker IDB+OPFS',async()=>{
 for(const backend of ['idb','opfs'] as const){const a=await seed(wav(tags()),backend),abort=controller();abort.abort();let pending=false;
 const r=await scan(a.track,context(abort,{onPending:()=>{pending=true;}}));cancelled(r);assert(!pending,'early pending');await intact(a);
 const later=controller(),beforeCommit=await scan(a.track,context(later,{onProgress:p=>{if(p.phase==='commit')later.abort();}}));cancelled(beforeCommit);await intact(a);}
});
await check('R76-03 foreign native abort with no own abort; late signal cannot relabel first cause',async()=>{
 for(const lateCancel of [false,true]){const a=await seed(wav(tags())),abort=controller(),get=IDBObjectStore.prototype.get;let gets=0;
 IDBObjectStore.prototype.get=function(...args){const r=get.apply(this,args);if(this.name==='tracks'&&++gets===3){this.transaction.abort();if(lateCancel)queueMicrotask(()=>abort.abort());}return r;};
 let r;try{r=await scan(a.track,context(abort));}finally{IDBObjectStore.prototype.get=get;}
 assert(r.state==='not-applied'&&r.reason==='storage'&&r.failure?.code==='transaction-aborted','foreign abort masked '+JSON.stringify(r));await intact(a);r76Observations.push({lateCancel,result:r});}
});
await check('R76-04 quota and IO first cause survive later own cancel IDB+OPFS',async()=>{
 for(const backend of ['idb','opfs'] as const)for(const [name,code] of [['QuotaExceededError','quota-exceeded'],['SecurityError','storage-denied']] as const){
 const a=await seed(wav(tags()),backend),abort=controller(),put=IDBObjectStore.prototype.put;let injected=false;
 IDBObjectStore.prototype.put=function(...args){if(this.name==='tracks'){injected=true;queueMicrotask(()=>abort.abort());throw new DOMException('R76 TESTONLY primary write fault',name);}return put.apply(this,args);};
 let r;try{r=await scan(a.track,context(abort));}finally{IDBObjectStore.prototype.put=put;}
 assert(injected&&r.state==='not-applied'&&r.reason==='storage'&&r.failure?.code===code&&r.secondary===null,'first cause masked '+JSON.stringify(r));await intact(a);r76Observations.push({backend,name,result:r});}
});
await check('R76-05 native commit winner, late cancel/lost ACK, single bound termination',async()=>{
 for(const backend of ['idb','opfs'] as const){const a=await seed(wav(tags()),backend),abort=controller(),put=IDBObjectStore.prototype.put,post=Worker.prototype.postMessage,terminate=NativeWorker.prototype.terminate;let terminations=0;
 NativeWorker.prototype.terminate=function(){terminations++;return terminate.call(this);};
 IDBObjectStore.prototype.put=function(...args){if(this.name==='tracks')this.transaction.addEventListener('complete',()=>abort.abort());return put.apply(this,args);};
 Worker.prototype.postMessage=function(...args){if(args[0]?.type==='ack')throw Error('R76 TESTONLY lost ACK');return Reflect.apply(post,this,args);};
 let r;try{r=await scan(a.track,context(abort));}finally{IDBObjectStore.prototype.put=put;Worker.prototype.postMessage=post;NativeWorker.prototype.terminate=terminate;}
 assert(r.state==='committed'&&(await inspectMetadataRescan(r.reference,context())).state==='committed','winner lost '+JSON.stringify(r));assert(terminations===1,'bound worker termination ownership '+terminations);
 await intact(a,(await reread(a.track))!);const again=await scan((await reread(a.track))!);assert(again.state==='committed'&&again.effect==='no-change','next no-change');r76Observations.push({backend,result:r,terminations});}
});
await check('R76-06 jobs, canaries, related Track and organization survive native cancel',async()=>{
 for(const backend of ['idb','opfs'] as const){const a=await seed(wav(tags()),backend),neighbor={...a.track,id:crypto.randomUUID()},job={version:1,operationId:crypto.randomUUID(),owner:crypto.randomUUID(),revision:1,state:'discarded',backend,storageKey:crypto.randomUUID(),bytes:0,expectedBytes:1},playlist={TESTONLY:'R76 list',trackIds:[a.track.id,neighbor.id]},canary={TESTONLY:'R76 canary'};
 await writeRecord('tracks',neighbor.id,neighbor);await writeRecord('jobs',job.operationId,job);await writeRecord('settings',['asset-ownership',backend,job.storageKey],{operationId:job.operationId,owner:job.owner,everPublished:false});await writeRecord('playlists','R76-playlist',playlist);await writeRecord('settings','R76-canary',canary);
 const abort=controller(),get=IDBObjectStore.prototype.get;let gets=0;
 IDBObjectStore.prototype.get=function(...args){const r=get.apply(this,args);if(this.name==='tracks'&&++gets===3)queueMicrotask(()=>abort.abort());return r;};
 try{cancelled(await scan(a.track,context(abort)));}finally{IDBObjectStore.prototype.get=get;}
 await intact(a);assert(equal(await reread(neighbor),neighbor),'neighbor');assert(equal(await readRecord('jobs',job.operationId),job),'job');assert(equal(await readRecord('playlists','R76-playlist'),playlist),'playlist');assert(equal(await readRecord('settings','R76-canary'),canary),'canary');}
});

try{await reset();}finally{release();globalThis.Worker=NativeWorker;}
(window as unknown as {pulsoMetadataRescan:unknown}).pulsoMetadataRescan={passed:results.length===(r76Only?6:16)&&results.every(x=>x.startsWith('PASS')),results,rawErrors,workerStats,r76Observations,scope:'R71 standalone native core; no main/P0/iPhone acceptance'};
