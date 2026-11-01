// Owned synthetic audio, real IDB/OPFS and production worker; no main/UI claims.
import {authorizeRealmFixture,initializeRealmFixture} from './realm-fixture';
import {beginWorkerAttempt} from '../../src/storage/database-realms';
import {importFile} from '../../src/imports/import-file';
import {copyImportResult,copyWorkerResponse} from '../../src/imports/import-protocol';
import {all,verifiedAsset,type Track,type Playlist} from '../../src/library/library';
import {readRecord,writeRecord,openDatabase,closeDatabase} from '../../src/storage/database';
import {transactionDone} from '../../src/storage/transaction-done';
import {importOperation,recoverImportOperation,validImportOperation} from '../../src/storage/import-operations';
import {exportOrganization,previewOrganization,applyOrganization,inspectOrganizationApply} from '../../src/library/organization-backup';
import {parseOrganization,serializeOrganization} from '../../src/library/organization-format';
import {copyLocalAlbumMetadata,unknownLocalAlbum} from '../../src/library/album-metadata';
import {groupAlbums,orderAlbumRows} from '../../src/library/groups';
const release=authorizeRealmFixture();await initializeRealmFixture();
const results:string[]=[];
function assert(v:unknown,m:string):asserts v {if(!v)throw Error(m);}
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
async function check(name:string,fn:()=>Promise<void>){try{await reset();await fn();results.push('PASS '+name);}catch(e){results.push(`FAIL ${name}: ${e instanceof Error?e.message:String(e)}`);}document.querySelector('#results')!.textContent=results.join('\n');}
async function reset(){const db=await openDatabase();try{const tx=db.transaction([...db.objectStoreNames],'readwrite'),done=transactionDone(tx);for(const n of [...db.objectStoreNames])tx.objectStore(n).clear();await done;}finally{closeDatabase(db);}}
const text=(s:string)=>new TextEncoder().encode(s);
const join=(...parts:Uint8Array[])=>{const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){b.set(p,o);o+=p.length;}return b;};
const n32=(n:number,le=false)=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n,le);return b;};
const read32=(b:Uint8Array,p:number)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(p);
const ascii=(b:Uint8Array,p:number,n:number)=>String.fromCharCode(...b.subarray(p,p+n));
const box=(name:string,body:Uint8Array)=>join(n32(body.length+8),text(name),body);
const sync=(n:number)=>new Uint8Array([n>>>21&127,n>>>14&127,n>>>7&127,n&127]);
const frame=(id:string,value:string)=>{const b=join(new Uint8Array([3]),text(value));return join(text(id),sync(b.length),new Uint8Array(2),b);};
const tag=(...frames:Uint8Array[])=>{const b=join(...frames);return join(text('ID3'),new Uint8Array([4,0,0]),sync(b.length),b);};
const tags=(ordinal='300/512')=>tag(frame('TRCK',ordinal),frame('TPOS','2/3'),frame('TPE2','Taller Δ'),frame('TCMP','1'),frame('TALB','Luz propia'),frame('TPE1','Intérprete propio'));
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
const m4a=()=>withIlst(join(atom('trkn',pair(300,512)),atom('disk',pair(2,3)),atom('aART',text('Taller Δ'),1),atom('cpil',new Uint8Array([1]),21)));
const hash=async(b:Blob)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');
const local=(f:File,backend:'idb'|'opfs'='idb',operationId?:string)=>importFile(f,new AbortController().signal,()=>{},{backend,operationId});
async function workerImport(file:File){const worker=new Worker(new URL('../../src/imports/import.worker.ts',import.meta.url),{type:'module'});let realm:Awaited<ReturnType<typeof beginWorkerAttempt>>|undefined;
 try{realm=await beginWorkerAttempt('import',worker,()=>true);return await new Promise<NonNullable<ReturnType<typeof copyImportResult>>>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('worker timeout')),15000);worker.onerror=()=>{clearTimeout(timer);reject(Error('worker error'));};worker.onmessage=e=>{if(e.data.type==='progress')return;clearTimeout(timer);const response=copyWorkerResponse(e.data);if(response?.type==='complete')resolve(response.result);else reject(Error('worker result '+JSON.stringify(e.data)));};worker.postMessage({version:2,type:'import',operationId:crypto.randomUUID(),file});});}finally{worker.terminate();realm?.closeAfterSettlement();}}
function verifySource(t:Track,kind:string){const s=t.localAlbum?.source;assert(s?.track.state==='known'&&s.track.value.current===300&&s.track.value.total===512,'track highbyte '+JSON.stringify(s));assert(s.disc.state==='known'&&s.disc.value.current===2&&s.disc.value.total===3,'disc');assert(s.albumArtist.state==='known'&&s.albumArtist.value==='Taller Δ','albumArtist');assert(s.compilation.state==='known'&&s.compilation.value,'compilation');assert(s.track.evidence.kind===kind,'evidence');}
for(const [name,file,kind,backend] of [['MP3',mp3(tags()),'embedded-id3','idb'],['WAV-ID3',wav(tags()),'embedded-riff-id3','opfs'],['M4A16',m4a(),'embedded-mp4','idb']] as const)await check(`${name}: real import worker/IDB/OPFS, highbytes, reopen and original hash`,async()=>{
 const r=name==='MP3'?await workerImport(file):await local(file,backend);verifySource(r.track,kind);assert(copyImportResult(r),'DTO');const reopened=await readRecord<Track>('tracks',r.track.id);assert(reopened&&equal(reopened.localAlbum,r.track.localAlbum),'reopen');const asset=await verifiedAsset(r.track.assetId,true);assert(asset&&asset.sha256===await hash(file)&&asset.bytes===file.size,'original hash');
});
await check('invalid, conflicting tags and binary zero semantics keep verified audio',async()=>{
 const files=[mp3(tag(frame('TRCK','2abc'))),wav(tag(frame('TRCK','2'),frame('TRCK','3'))),withIlst(atom('trkn',pair(0,512))),withIlst(atom('trkn',new Uint8Array([0,1,1,44,2,0,0,0])))];
 for(const [i,f] of files.entries()){const r=await local(f),s=r.track.localAlbum!.source.track;assert(i===2?s.state==='known'&&s.value.current===null&&s.value.total===512:s.state==='unknown'&&s.reason===(i===1?'conflict':'invalid'),'invalid/conflict '+i+JSON.stringify(s));assert(await verifiedAsset(r.track.assetId,true),'audio '+i);}
});
await check('optional global tag limits and malformed retry do not poison audio',async()=>{
 const many=tag(...Array.from({length:129},()=>frame('TRCK','1'))),large=tag(frame('TPE2','x'.repeat(2*1024*1024)));
 for(const f of [mp3(many),mp3(large),wav(many,2),wav(large,3),withIlst(join(...Array.from({length:130},()=>atom('trkn',pair(1,2)))))]){const r=await local(f);assert(r.track.localAlbum!.source.track.state==='unknown','budget source');assert(await verifiedAsset(r.track.assetId,true),'valid audio');}
});
await check('new grouping and stable repeated occurrence ordering are local provisional',async()=>{
 const a=(await local(wav(tags('2/3'),4))).track,b=(await local(wav(tags('1/3'),5))).track;const groups=groupAlbums([a,b,a]);assert(groups.length===1&&equal(groups[0].trackIds,[a.id,b.id,a.id])&&groups[0].completeness==='unknown','group');assert(equal(orderAlbumRows([{track:a,key:'a'},{track:b,key:'b'},{track:a,key:'a2'}]).map(r=>r.key),['b','a','a2']),'order');
});
for(const backend of ['idb','opfs'] as const)await check(`v2 ${backend}: preview/apply/reopen, placeholders and exact reimport preserve all IDs/legacy/organization`,async()=>{
 const f=wav(tags(),backend==='idb'?6:7),r=await local(f,backend),original:Track={...r.track,title:'Título histórico',favorite:true,manualOverrides:{title:'Título histórico',artist:r.track.artist,album:r.track.album}};await writeRecord('tracks',original.id,original);
 const p:Playlist={id:crypto.randomUUID(),name:'Propia',revision:1,entries:[{id:crypto.randomUUID(),trackId:original.id}]};await writeRecord('playlists',p.id,p);
 const blob=await exportOrganization(),dto=parseOrganization(await blob.text());assert(dto.version===2&&equal(dto.tracks[0].localAlbum,original.localAlbum),'export v2');
 await reset();const preview=await previewOrganization(blob);await applyOrganization(preview.planId);assert((await inspectOrganizationApply(preview.operationId)).state==='committed','receipt reopen');const restored=(await all<Track>('tracks'))[0];assert(restored.id===original.id&&restored.assetId===null&&restored.favorite&&equal(restored.localAlbum,original.localAlbum),'placeholder');
 const second:Track={...restored,id:crypto.randomUUID(),organizationRef:{libraryId:crypto.randomUUID(),id:crypto.randomUUID()}};await writeRecord('tracks',second.id,second);
 const imported=await local(f,backend),tracks=await all<Track>('tracks');assert(imported.duplicate&&tracks.length===2&&tracks.every(t=>t.assetId===imported.track.assetId&&equal(t.localAlbum,original.localAlbum)&&equal(t.manualOverrides,original.manualOverrides)),'relink overwrote source');assert((await readRecord<Playlist>('playlists',p.id))?.entries[0].id===p.entries[0].id,'playlist IDs');
 const v2=parseOrganization(await(await exportOrganization()).text());assert(v2.version===2&&v2.tracks.every(t=>equal(t.localAlbum,original.localAlbum)),'reexport');
});
await check('v1 explicit loss conflict, default keep-local, use-backup, stale CAS and future rejection atomic',async()=>{
 const r=await local(wav(tags(),8)),saved=parseOrganization(await(await exportOrganization()).text());assert(saved.version===2,'v2');const {localAlbum:_,...legacy}=saved.tracks[0];const v1={...saved,version:1 as const,tracks:[legacy]},blob=new Blob([serializeOrganization(v1)]);
 const preview=await previewOrganization(blob);assert(preview.conflicts.length===1&&preview.conflicts[0].losesLocalAlbum&&preview.conflicts[0].choice==='keep-local','loss flag');await applyOrganization(preview.planId);assert(equal((await readRecord<Track>('tracks',r.track.id))?.localAlbum,r.track.localAlbum),'default lost source');
 const choice={[preview.conflicts[0].key]:'use-backup' as const};const stale=await previewOrganization(blob,choice);const before=await readRecord<Track>('tracks',r.track.id);await writeRecord('tracks',r.track.id,{...before!,favorite:true,revision:before!.revision+1});let rejected=false;try{await applyOrganization(stale.planId);}catch{rejected=true;}assert(rejected&&(await readRecord<Track>('tracks',r.track.id))?.localAlbum,'partial CAS loss');
 const fresh=await previewOrganization(blob,choice);await applyOrganization(fresh.planId);assert(!Object.hasOwn((await readRecord<Track>('tracks',r.track.id))!,'localAlbum'),'explicit use-backup did not clear');
 const placeholder={...r.track,assetId:null,audioFingerprint:null,localAlbum:r.track.localAlbum};await writeRecord('tracks',r.track.id,placeholder);const enriched=await previewOrganization(blob);await applyOrganization(enriched.planId);const enrichedTrack=await readRecord<Track>('tracks',r.track.id);assert(enrichedTrack?.audioFingerprint?.sha256===r.track.audioFingerprint!.sha256&&equal(enrichedTrack.localAlbum,r.track.localAlbum),'R9 fingerprint independent of metadata keep-local');
 const snapshot=JSON.stringify(await all('tracks'));for(const bad of [{...v1,version:3},{...v1,tracks:saved.tracks},{...saved,tracks:[legacy]}]){let failed=false;try{await previewOrganization(new Blob([JSON.stringify(bad)]));}catch{failed=true;}assert(failed&&JSON.stringify(await all('tracks'))===snapshot,'invalid version wrote');}
});
await check('recovery lost OPFS close ACK, dedup conservative and invalid DTO/job shape',async()=>{
 const file=wav(tags(),9),id=crypto.randomUUID(),close=FileSystemWritableFileStream.prototype.close;
 FileSystemWritableFileStream.prototype.close=async function(){await close.call(this);throw Error('TESTONLY lost ACK');};try{await local(file,'opfs',id);}catch{}finally{FileSystemWritableFileStream.prototype.close=close;}
 const job=await importOperation(id);assert(job?.state==='uncertain'&&job.track?.localAlbum,'uncertain source retained');const recovered=await recoverImportOperation(id,job.revision,'resume');assert(recovered.result&&validImportOperation(recovered,id),'recovery');verifySource(recovered.result.track,'embedded-riff-id3');
 const existing:Track={...recovered.result.track,localAlbum:unknownLocalAlbum('legacy'),manualOverrides:{title:'Histórico'},title:'Histórico'};await writeRecord('tracks',existing.id,existing);const duplicate=await local(file);assert(duplicate.duplicate&&equal(duplicate.track.localAlbum,existing.localAlbum),'overwrote existing');
 delete existing.localAlbum;await writeRecord('tracks',existing.id,existing);assert(!(await local(file)).track.localAlbum,'implicit legacy backfill');
 const bad={...recovered,track:{...recovered.track,localAlbum:{...recovered.track!.localAlbum,manual:{}}}};assert(!validImportOperation(bad,id),'job accepted manual');
 assert(!validImportOperation({...recovered,result:{...recovered.result,track:{...recovered.result.track,localAlbum:unknownLocalAlbum('absent')},duplicate:false}},id),'nonduplicate incoherent source');assert(!copyImportResult({track:bad.track,duplicate:false}),'DTO accepted manual');const huge={...unknownLocalAlbum('absent'),...Object.fromEntries(Array.from({length:10000},(_,i)=>['bad'+i,0]))};assert(!copyLocalAlbumMetadata(huge),'corrupt keys accepted');
});
release();(window as unknown as {pulsoAlbumSource:unknown}).pulsoAlbumSource={passed:results.length===10&&results.every(x=>x.startsWith('PASS')),results};
