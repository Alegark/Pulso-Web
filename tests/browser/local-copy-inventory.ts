import {authorizeRealmFixture} from './realm-fixture';
authorizeRealmFixture();
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {DATABASE,openDatabase,committed,writeRecord,registerDatabaseOpenGuard} from '../../src/storage/database';
import {ASSET_DIRECTORY,generationLock} from '../../src/storage/asset-reader';
import type {LocalAsset,Track} from '../../src/library/library';
import {readLocalCopyInventory,verifyLocalCopy,prepareIndividualAudioExport,requestLocalPersistenceFromGesture,readLocalStorageStatus,localCopyFailureReason,COPY_LIMITS,type CopyContext,type CopyRef} from '../../src/library/local-copy-inventory';
import {parseWorkerReply,parseWorkerRequest} from '../../src/library/local-copy-protocol';
import {AppFailure,issuedFailure,makeFailure} from '../../src/errors/app-failure';
const assert:(value:unknown,message:string)=>asserts value=(value,message)=>{if(!value)throw Error(message);};
const eq=(a:unknown,b:unknown,label:string)=>assert(JSON.stringify(a)===JSON.stringify(b),`${label}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const ctx=():CopyContext=>({signal:new AbortController().signal,current:()=>true});
async function failure(work:()=>Promise<unknown>,code:string){try{await work();throw Error('expected failure');}catch(e){eq(issuedFailure(e)?.code,code,'safe code');}}
function bytesOf(size:number){const b=new Uint8Array(size);for(let i=0;i<size;i++)b[i]=(i*7+3)%251;return b;}
async function fixture(backend:'idb'|'opfs',size=131073){const data=bytesOf(size);const asset:LocalAsset={id:crypto.randomUUID(),storageKey:crypto.randomUUID(),namespace:'local',bytes:size,mime:'audio/wav',sha256:bytesToHex(sha256(data)),chunks:Math.ceil(size/65536),chunkSize:65536,retention:'kept',state:'complete',revision:1,backend};
 if(backend==='idb'){const db=await openDatabase();try{const tx=db.transaction('chunks','readwrite');const done=committed(tx);for(let offset=0;offset<size;offset+=65536)tx.objectStore('chunks').put(data.slice(offset,offset+65536),[asset.storageKey,offset/65536]);await done;}finally{db.close();}}
 else{const directory=await(await navigator.storage.getDirectory()).getDirectoryHandle(ASSET_DIRECTORY,{create:true});const f=await directory.getFileHandle(asset.storageKey,{create:true});const w=await f.createWritable();await w.write(data);await w.close();}
 await writeRecord('assets',asset.id,asset);const track:Track={id:crypto.randomUUID(),assetId:asset.id,title:'Sintético',artist:null,album:null,duration:1,favorite:true,revision:1,createdAt:'2026-10-31T00:00:00.000Z',manualOverrides:{}};await writeRecord('tracks',track.id,track);return {asset,track,data};}
async function inventory(){return readLocalCopyInventory({namespace:'local',...ctx()});}
async function ref(){const page=await inventory();const copy=page.rows.find(r=>r.copyRef)?.copyRef;assert(copy,'issued ref');return copy;}
async function mutateChunk(a:LocalAsset,kind:string){if(a.backend==='idb'){const db=await openDatabase();try{const tx=db.transaction('chunks','readwrite');const done=committed(tx);const s=tx.objectStore('chunks');if(kind==='missing')s.delete([a.storageKey,1]);else if(kind==='extra')s.put(new Uint8Array([1]),[a.storageKey,a.chunks]);else if(kind==='invalid')s.put('invalid',[a.storageKey,0]);else if(kind==='short')s.put(new Uint8Array(1),[a.storageKey,0]);else s.put(new Uint8Array(65536).fill(11),[a.storageKey,0]);await done;}finally{db.close();}}
 else {const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle(ASSET_DIRECTORY);if(kind==='missing')await dir.removeEntry(a.storageKey);else{const f=await dir.getFileHandle(a.storageKey);const w=await f.createWritable();await w.write(kind==='short'?new Uint8Array(1):new Uint8Array(a.bytes).fill(11));await w.close();}}}
async function lockFree(asset:LocalAsset){for(let i=0;i<30;i++){const free=await navigator.locks.request(generationLock(asset),{mode:'exclusive',ifAvailable:true},lock=>!!lock);if(free)return;await new Promise(r=>setTimeout(r,10));}throw Error('lock leaked');}
async function rawDatabase(version:number){return new Promise<IDBDatabase>((resolve,reject)=>{const q=indexedDB.open(DATABASE,version);q.onupgradeneeded=()=>{for(const store of ['assets','tracks','chunks','settings','jobs','playlists'])q.result.createObjectStore(store);q.transaction!.objectStore('settings').put('canary','canary');};q.onerror=()=>reject(q.error);q.onsuccess=()=>resolve(q.result);});}
async function dump(){const db=await openDatabase();try{const tx=db.transaction([...db.objectStoreNames]);const done=committed(tx);const result=await Promise.all([...db.objectStoreNames].map(name=>new Promise(resolve=>{const s=tx.objectStore(name);const keys=s.getAllKeys(),values=s.getAll();values.onsuccess=()=>resolve({name,keys:keys.result,values:values.result});})));await done;return JSON.stringify(result);}finally{db.close();}}
interface Probe {hashes:number;ranges:number;writes:number;creates:number}
const probes:{replyType:string;counts:Probe}[]=[];
let intercept:((data:Record<string,unknown>,worker:Worker)=>Promise<Record<string,unknown>|null>|Record<string,unknown>|null)|null=null;
const NativeWorker=Worker;
class ProbeWorker extends NativeWorker {
 override set onmessage(handler:((this:Worker,ev:MessageEvent)=>unknown)|null){
 super.onmessage=event=>{const data=event.data;if(data?.__localCopyProbe){probes.push({replyType:data.replyType,counts:data.__localCopyProbe});return;}
 if(!handler)return;const value=intercept?intercept(data,this):data;
 if(value instanceof Promise)void value.then(v=>{if(v)handler.call(this,new MessageEvent('message',{data:v}));});else if(value)handler.call(this,new MessageEvent('message',{data:value}));};
 }
}
(globalThis as unknown as {Worker:typeof Worker}).Worker=ProbeWorker;
async function run(name:string){const started=performance.now();const backend=name.endsWith('-opfs')?'opfs':'idb';const base=name.replace(/-(idb|opfs)$/,'');let details:Record<string,unknown>={};
 if(base==='readonly-legacy'||base==='readonly-future'||base==='readonly-absent'){
 if(base!=='readonly-absent'){const db=await rawDatabase(base==='readonly-legacy'?1:3);db.close();}
 await failure(()=>inventory(),base==='readonly-future'?'storage-unavailable':'database-blocked');if(base==='readonly-absent'){assert(!(await indexedDB.databases()).some(d=>d.name===DATABASE),'worker absent open rolled back');return {name,passed:true,ms:Math.round(performance.now()-started),details:{nativeCreationRolledBack:true}};}
 const q=indexedDB.open(DATABASE);const db=await new Promise<IDBDatabase>((resolve,reject)=>{q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
 eq(db.version,base==='readonly-future'?3:1,'native version preserved');{assert(!db.objectStoreNames.contains('tickets'),'no tickets schema write');const t=db.transaction('settings');const value=await new Promise(resolve=>{const r=t.objectStore('settings').get('canary');r.onsuccess=()=>resolve(r.result);});eq(value,'canary','canary');}db.close();
 }else if(base.startsWith('persist-')){
 let calls=0;const mode=base.slice(8);const storage=navigator.storage;let native:boolean|null=null;
 if(mode==='native')native=await storage.persisted();else Object.defineProperty(storage,'persist',{configurable:true,value:mode==='unsupported'?undefined:()=>{calls++;if(mode==='throw')throw new DOMException('fixture','SecurityError');if(mode==='reject')return Promise.reject(new DOMException('fixture','QuotaExceededError'));return Promise.resolve(mode==='grant');}});
 const pending=requestLocalPersistenceFromGesture();if(mode!=='native'&&mode!=='unsupported')eq(calls,1,'persist synchronous call');const result=await pending;eq(result.state,mode==='unsupported'?'unsupported':mode==='grant'?'granted':mode==='denial'?'denied':mode==='native'?result.state:'unknown','persist state');if(mode==='throw')eq(result.failure?.code,'storage-denied','safe denied');if(mode==='reject')eq(result.failure?.code,'quota-exceeded','safe quota');const before=calls;await readLocalStorageStatus();eq(calls,before,'status no implicit persist');details={result,native};
 }else if(base==='phase-guard'){
 const phases:string[]=[];const unregister=registerDatabaseOpenGuard(phase=>{phases.push(phase);return phase!=='upgrade';});await failure(()=>openDatabase(),'database-blocked');unregister();eq(phases,['open','upgrade'],'upgrade denied');const db=await openDatabase();db.close();const seen:string[]=[];const off=registerDatabaseOpenGuard(phase=>{seen.push(phase);return true;});const db2=await openDatabase();db2.close();off();eq(seen,['open','deliver'],'deliver phase');
 }else if(base==='protocol'){
 const id=crypto.randomUUID(),token=crypto.randomUUID();assert(parseWorkerRequest({version:1,requestId:id,token,type:'inventory'}),'inventory dto');for(const bad of [{version:1,requestId:id,token,type:'inventory',extra:1},{version:1,requestId:id,token,type:'credit',offset:-1},{version:1,requestId:id,token,type:'bogus'}])eq(parseWorkerRequest(bad),null,'closed request');let read=false;const hostile={get type(){read=true;throw Error('getter');}};eq(parseWorkerReply(hostile),null,'getter rejected');eq(read,false,'no getters');eq(parseWorkerReply({version:1,requestId:id,token,type:'ready',extra:1}),null,'closed reply');
 }else{
 const size=base==='export-exact'?8388608:base==='export-over'?8388609:base==='pagination'?1:131073;
 const {asset,track,data}=await fixture(backend,size);const before=await dump();
 if(base==='enumeration-delete'){
 let release!:()=>void,acquired!:()=>void;const held=new Promise<void>(resolve=>{acquired=resolve;});const exclusive=navigator.locks.request(generationLock(asset),{mode:'exclusive'},async()=>{acquired();await new Promise<void>(resolve=>{release=resolve;});});await held;probes.length=0;const pending=inventory();
 for(let i=0;i<300&&!probes.some(p=>p.replyType==='inventory-enumerated');i++)await new Promise(r=>setTimeout(r,10));assert(probes.some(p=>p.replyType==='inventory-enumerated'),'enumeration barrier observed');
 await mutateChunk(asset,'missing');release();await exclusive;const page=await pending;const row=page.rows[0];assert(row.availability==='missing'||row.availability==='unknown','post-enumeration disappearance not present');eq(row.observedBytes,null,'no stale observed bytes');eq(await dump(),before,'unchanged metadata');details={availability:row.availability,observedBytes:row.observedBytes};
 }else if(base==='invalid-bytes-observed'){
 await mutateChunk(asset,'invalid');const p=await inventory();eq(p.rows[0].availability,'corrupt','invalid payload corrupt');eq(p.rows[0].observedBytes,null,'unmeasurable bytes unknown');eq(p.observedBytes,null,'global bytes unknown');
 }else if(base==='hash-scan'||base==='inventory-no-hash'){
 const copy=await ref();probes.length=0;
 if(base==='hash-scan'){const exported=await prepareIndividualAudioExport(copy,ctx());exported.release();const last=probes.at(-1)!;eq(last.replyType,'ready','ready observed');eq(last.counts.hashes,1,'one hash');eq(last.counts.ranges,asset.chunks,'exactly N chunks');eq(last.counts.writes,0,'worker no writes');details={probe:last};}
 else {await inventory();const last=probes.at(-1)!;eq(last.counts.hashes,0,'inventory no hash');eq(last.counts.ranges,0,'inventory no reader scan');eq(last.counts.creates,0,'inventory no create');eq(last.counts.writes,0,'inventory readonly');if(backend==='idb'){let absent=false;try{await(await navigator.storage.getDirectory()).getDirectoryHandle(ASSET_DIRECTORY,{create:false});}catch{absent=true;}assert(absent,'inventory never created dedicated directory');}}
 }else if(base==='window-noio'){
 const copy=await ref();const open=indexedDB.open.bind(indexedDB),dir=navigator.storage.getDirectory.bind(navigator.storage);let windowIO=0;
 indexedDB.open=()=>{windowIO++;throw Error('Window IO forbidden');};navigator.storage.getDirectory=()=>{windowIO++;throw Error('Window IO forbidden');};
 try{await inventory();const newCopy=await ref();const exported=await prepareIndividualAudioExport(newCopy,ctx());exported.release();}finally{indexedDB.open=open;navigator.storage.getDirectory=dir;}eq(windowIO,0,'all scan/hash IO worker');void copy;
 }else if(base==='ack-lock'||base==='credit-offset'||base==='bad-token'||base==='bad-response'||base==='cancel-compose'||base==='manifest-final'||base==='unknown-io'||base==='denied-io'){
 const copy=await ref();let lockHeld=false,credits=0;const ac=new AbortController();
 const nativePost=Worker.prototype.postMessage;
 if(base==='credit-offset'||base==='bad-token')Worker.prototype.postMessage=function(message:unknown,options?:unknown){const m=message as Record<string,unknown>;if(m.type==='credit'&&++credits===1)message={...m,...(base==='bad-token'?{token:crypto.randomUUID()}:{offset:65536})};return (nativePost as (...args:unknown[])=>void).call(this,message,options);};
 intercept=async (message)=>{
 if(base==='bad-response'&&message.type==='start')return {...message,extra:true};
 if(base==='cancel-compose'&&message.type==='chunk')ac.abort();
 if(message.type==='materialize'){
 lockHeld=await navigator.locks.request(generationLock(asset),{mode:'exclusive',ifAvailable:true},lock=>!lock);
 if(base==='manifest-final')await writeRecord('assets',asset.id,{...asset,sha256:'0'.repeat(64)});
 }
 return message;
 };
 // Native worker failures are injected before request delivery through an actual
 // worker bootstrap URL query, consumed solely by isolated source transforms.
 if(base==='unknown-io'||base==='denied-io'){
 intercept=null;const newWorker=globalThis.Worker;class FaultWorker extends newWorker {constructor(url:string|URL,options?:WorkerOptions){const next=new URL(url.toString(),location.href);next.searchParams.set('localCopyFault',base);super(next,options);}}(globalThis as unknown as {Worker:typeof Worker}).Worker=FaultWorker;
 }
 try{if(base==='ack-lock'){const result=await prepareIndividualAudioExport(copy,ctx());assert(lockHeld,'shared lock held through materialization');result.release();}else if(base==='unknown-io'||base==='denied-io'){const result=await verifyLocalCopy({copyRef:copy,...ctx()});eq(result.availability,'unknown','IO never missing');eq(result.failure?.code,base==='denied-io'?'storage-denied':'unknown','safe IO failure');}else await failure(()=>prepareIndividualAudioExport(copy,{signal:ac.signal,current:()=>true}),base==='cancel-compose'?'cancelled':base==='manifest-final'?'asset-changed':'worker-protocol');}
 finally{intercept=null;Worker.prototype.postMessage=nativePost;}await lockFree(asset);details={lockHeld,credits};
 }else if(base==='inventory'){
 const page=await inventory(),row=page.rows[0];eq(row.availability,'present','present');eq(row.integrity,'not-checked','no implicit hash');eq(row.observedBytes,size,'observed');eq(row.logicalBytes,size,'logical');eq(row.references,{tracks:1,favorites:1,playlists:0,playlistEntries:0,queueOccurrences:0},'refs');eq(page.identity,'unknown','identity');eq(await dump(),before,'readonly');details={metadataBytes:page.metadataBytes,scannedRecords:page.scannedRecords};
 }else if(base==='invalid-track-ref'||base==='invalid-playlist-ref'||base==='invalid-queue-ref'||base==='sealed-result-not-truth'){
 if(base==='invalid-track-ref')await writeRecord('tracks',track.id,{...track,revision:0});
 else if(base==='invalid-playlist-ref'){const id=crypto.randomUUID();await writeRecord('playlists',id,{id,name:'list',revision:1,entries:[{id:crypto.randomUUID(),trackId:crypto.randomUUID()}]});}
 else if(base==='invalid-queue-ref')await writeRecord('settings','library-playback',{version:1,entries:[{id:crypto.randomUUID(),trackId:crypto.randomUUID()}],currentEntryId:null,position:0,repeat:'off',shuffleOrder:null});
 else await writeRecord('jobs',crypto.randomUUID(),{backend:asset.backend,storageKey:asset.storageKey,state:'sealed',result:{track:{...track,id:crypto.randomUUID()}}});
 const before=await dump(),p=await inventory();eq(await dump(),before,'invalid relations preserved');eq(p.referencesComplete,base==='sealed-result-not-truth','ref completeness');eq(p.rows[0].references.tracks,base==='sealed-result-not-truth'?1:null,'no historical-result or invalid refcounts');
 }else if(base==='references'||base==='alias'){
 const t2={...track,id:crypto.randomUUID(),favorite:false};await writeRecord('tracks',t2.id,t2);for(let i=0;i<2;i++){const id=crypto.randomUUID();await writeRecord('playlists',id,{id,name:'lista',revision:1,entries:[{id:crypto.randomUUID(),trackId:track.id},{id:crypto.randomUUID(),trackId:t2.id}]});}
 await writeRecord('settings','library-playback',{version:1,entries:[track.id,t2.id,track.id].map(trackId=>({id:crypto.randomUUID(),trackId})),currentEntryId:null,position:0,repeat:'off',shuffleOrder:null});
 if(base==='alias'){const a2={...asset,id:crypto.randomUUID()};await writeRecord('assets',a2.id,a2);}
 const page=await inventory(),row=page.rows[0];eq(page.rows.length,1,'physical dedup');eq(row.references,{tracks:2,favorites:1,playlists:2,playlistEntries:4,queueOccurrences:3},'semantic refs');eq(row.observedBytes,size,'physical once');eq(row.logicalBytes,size*(base==='alias'?2:1),'logical distinct');if(base==='alias')eq(row.copyRef,null,'alias action blocked');
 }else if(base==='old-kept'||base==='staging'||base==='invalid-legacy'){
 const db=await openDatabase();const tx=db.transaction('assets','readwrite');const done=committed(tx);tx.objectStore('assets').delete(asset.id);await done;db.close();if(base==='invalid-legacy')await writeRecord('jobs',crypto.randomUUID(),{legacy:true});else await writeRecord('settings',['asset-ownership',backend,asset.storageKey],{operationId:crypto.randomUUID(),owner:crypto.randomUUID(),everPublished:base==='old-kept'});
 const page=await inventory();const row=page.rows.find(r=>r.backend===backend)!;eq(row.classification,base==='old-kept'?'previous-kept':base==='staging'?'staging':'unclassified','provenance');eq(row.copyRef,null,'no current ref');if(base==='old-kept')eq(row.protection,'kept','kept protected');if(base==='invalid-legacy')assert(page.rows.some(r=>r.classification==='invalid'),'legacy retained visible');
 }else if(base==='missing'||base==='short'||base==='corrupt'||base==='invalid'||base==='extra'){
 await mutateChunk(asset,base);const copy=await ref();const result=await verifyLocalCopy({copyRef:copy,...ctx()});eq(result.availability,base==='missing'?'missing':'corrupt','verify negative');if(base!=='extra')await failure(()=>prepareIndividualAudioExport(copy,ctx()),base==='missing'?'asset-missing':base==='corrupt'?'digest-mismatch':base==='invalid'?'local-corrupt':'length-mismatch');await lockFree(asset);
 }else if(base==='changed'){
 const copy=await ref();await writeRecord('assets',asset.id,{...asset,revision:2});const result=await verifyLocalCopy({copyRef:copy,...ctx()});eq(result.availability,'changed','changed ref');await failure(()=>prepareIndividualAudioExport(copy,ctx()),'asset-changed');await lockFree(asset);
 }else if(base==='invalid-ref'){
 const copy=await ref();await failure(()=>verifyLocalCopy({copyRef:{} as CopyRef,...ctx()}),'asset-changed');await inventory();await failure(()=>verifyLocalCopy({copyRef:copy,...ctx()}),'asset-changed');
 }else if(base==='scope'||base==='cancel-preflight'){
 const copy=await ref();const ac=new AbortController();if(base==='cancel-preflight')ac.abort();await failure(()=>prepareIndividualAudioExport(copy,{signal:ac.signal,current:()=>base!=='scope'}),base==='scope'?'owner-unavailable':'cancelled');await lockFree(asset);
 }else if(base==='cancel-progress'||base==='scope-progress'||base==='observer-throw'||base==='export'||base==='export-exact'||base==='export-over'||base==='concurrent'){
 const copy=await ref(),ac=new AbortController();let live=true,calls=0;const progress:number[]=[];
 const operation=()=>prepareIndividualAudioExport(copy,{signal:ac.signal,current:()=>live,onProgress:p=>{calls++;progress.push(p.bytes);if(base==='cancel-progress')ac.abort();if(base==='scope-progress')live=false;if(base==='observer-throw')throw Error('observer');}});
 if(base==='export-over'){await failure(operation,'limit-exceeded');assert(localCopyFailureReason(AppFailure.create(makeFailure('validate','internal','limit-exceeded',backend))).includes('8 MiB'),'limit message');eq(calls,0,'preflight no chunks');}
 else if(base==='cancel-progress'||base==='scope-progress')await failure(operation,base==='cancel-progress'?'cancelled':'owner-unavailable');
 else{const prepared=await operation();eq(prepared.bytes,size,'prepared size');eq(prepared.mime,'audio/wav','safe mime');eq(bytesToHex(sha256(new Uint8Array(await prepared.blob.arrayBuffer()))),bytesToHex(sha256(data)),'actual export hash');if(base==='concurrent')await failure(operation,'conflict');prepared.release();prepared.release();if(base==='concurrent'){const again=await operation();again.release();}details={progressCalls:calls,progressMax:Math.max(...progress),bytes:size};}
 await lockFree(asset);eq(await dump(),before,'no DB writes');
 }else if(base==='verify'){
 const copy=await ref();const result=await verifyLocalCopy({copyRef:copy,...ctx()});eq(result.availability,'present','verified availability');eq(result.integrity,'verified','verified integrity');await lockFree(asset);eq(await dump(),before,'verify readonly');
 }else if(base==='pagination'){
 const db=await openDatabase();const tx=db.transaction('assets','readwrite');const done=committed(tx);for(let i=0;i<52;i++){const a={...asset,id:crypto.randomUUID(),storageKey:crypto.randomUUID()};tx.objectStore('assets').put(a,a.id);}await done;db.close();const first=await inventory();eq(first.rows.length,50,'bounded page');assert(first.nextCursor,'cursor');const second=await readLocalCopyInventory({namespace:'local',...ctx(),cursor:first.nextCursor});eq(second.snapshot,first.snapshot,'same snapshot');eq(second.rows.length,3,'page remainder');eq(second.nextCursor,null,'last page');
 }else if(base.startsWith('metadata-')&&base!=='metadata-budget'){
 const big='x'.repeat(4200000);let value:unknown;
 if(base==='metadata-map-budget')value=new Map([['key',big]]);
 else if(base==='metadata-set-budget')value=new Set([big]);
 else if(base==='metadata-sparse-budget')value=new Array(2000000);
 else if(base==='metadata-date')value=new Date('2026-10-31T00:00:00Z');
 else if(base==='metadata-cycle'){const cyclic:{self?:unknown;map?:Map<unknown,unknown>}={};cyclic.self=cyclic;cyclic.map=new Map([[cyclic,new Set([cyclic])]]);value=cyclic;}
 else value=1;
 const key=base==='metadata-key-budget'?big:'structured-value';await writeRecord('settings',key,value);
 const p=await inventory();eq(p.partial,!['metadata-date','metadata-cycle'].includes(base),'clone budget partial');assert(p.metadataBytes<=COPY_LIMITS.metadataBytes,'retained metadata charge bounded');if(p.partial){eq(p.referencesComplete,false,'overflow references unknown');eq(p.logicalBytes,null,'overflow no total');}details={metadataBytes:p.metadataBytes,scannedRecords:p.scannedRecords};
 }else if(base==='metadata-budget'){
 await writeRecord('settings','oversize',{data:'x'.repeat(4200000)});const p=await inventory();eq(p.partial,true,'partial metadata');eq(p.referencesComplete,false,'refs not complete');eq(p.logicalBytes,null,'no false total');assert(p.metadataBytes<=COPY_LIMITS.metadataBytes,'bounded retention');assert(p.rows.every(r=>r.references.tracks===null),'no false zero refs');
 }else if(base==='manifest-budget'){
 const db=await openDatabase();const tx=db.transaction('assets','readwrite');const done=committed(tx);for(let i=0;i<10000;i++)tx.objectStore('assets').put({bad:true},String(i));await done;db.close();const p=await inventory();eq(p.partial,true,'partial count');eq(p.referencesComplete,false,'incomplete refs');eq(p.logicalBytes,null,'total unknown');
 }else if(base==='playlist-budget'){
 const id=crypto.randomUUID();await writeRecord('playlists',id,{id,name:'list',revision:1,entries:Array.from({length:20001},()=>({id:crypto.randomUUID(),trackId:track.id}))});const p=await inventory();eq(p.partial,true,'partial entries');eq(p.referencesComplete,false,'refs incomplete');
 }else throw Error('unknown case '+base);
 }
 return {name,passed:true,ms:Math.round(performance.now()-started),details};
}
(window as unknown as {localCopyInventory:unknown}).localCopyInventory={run};
