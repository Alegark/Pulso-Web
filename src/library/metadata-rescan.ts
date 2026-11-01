import {plain} from '../diagnostics/contract';
import {AppFailure,fail,fromKnownError,makeFailure,type FailureV1} from '../errors/app-failure';
import {admittedTransaction,assertDatabaseUse,closeDatabase,openExistingDatabase,request} from '../storage/database';
import {transactionDone} from '../storage/transaction-done';
import {assertImportsResolved} from '../storage/import-operations';
import {WRITER_LOCK} from '../storage/asset-reader';
import {beginWorkerAttempt,type RealmAttempt} from '../storage/database-realms';
import {copyAsset,sameAsset} from './local-copy-protocol';
import {validAudioFingerprint,type Track,type LocalAsset} from './library';
import {copyLocalAlbumMetadata,unknownLocalAlbum,type LocalAlbumMetadataV1} from './album-metadata';
import {METADATA_RESCAN_LIMIT,metadataRescanUUID as uuid,copyMetadataRescanReference,copyMetadataRescanReply,type MetadataRescanReference,type MetadataRescanContext,type MetadataRescanRequest,type MetadataRescanResult,type MetadataRescanReason,type MetadataRescanInspection,type MetadataRescanProgress} from './metadata-rescan-protocol';
export {copyMetadataRescanReference} from './metadata-rescan-protocol';
export type {MetadataRescanReference,MetadataRescanContext,MetadataRescanRequest,MetadataRescanResult,MetadataRescanReason,MetadataRescanInspection,MetadataRescanProgress} from './metadata-rescan-protocol';
const RESCAN_LOCK='pulso-web:local:metadata-rescan:v1',INCARNATION='metadata-rescan:v1:incarnation',SLOT='metadata-rescan:v1:slot';
type Guard=Pick<MetadataRescanContext,'signal'|'current'>;
type Header={version:1;operationId:string;incarnation:string;trackId:string;trackRevision:number;assetId:string;assetRevision:number};
type Slot=Header&({state:'prepared'}|{state:'committed';afterRevision:number;effect:'updated'|'no-change'}|{state:'not-committed'});
type Snapshot={track:Track;asset:LocalAsset;canonical:string};
const positive=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>0;
class Stop extends Error {constructor(readonly reason:MetadataRescanReason,readonly failure:FailureV1){super('Revisión local detenida.');}}
function stop(reason:MetadataRescanReason,code:FailureV1['code']='conflict'):never {
 const family=code==='asset-missing'||code==='asset-changed'||code==='local-corrupt'||code==='metadata-invalid'?'integrity':code==='cancelled'?'cancelled':code==='storage-unavailable'?'storage-unavailable':'internal';
 throw new Stop(reason,makeFailure('validate',family,code,'idb'));
}
function check(c:Guard){if(c.signal.aborted)stop('cancelled','cancelled');let live=false;try{live=c.current()===true;}catch{/* closed */}if(!live)stop('changed','owner-unavailable');assertDatabaseUse('read');}
function progress(c:MetadataRescanContext,p:MetadataRescanProgress){try{c.onProgress?.(p);}catch{/* observer */}}
function cause(e:unknown):FailureV1{return e instanceof Stop?e.failure:fromKnownError(e,{phase:'commit',backend:'idb'});}
function reason(e:unknown,f:FailureV1):MetadataRescanReason {
 if(e instanceof Stop)return e.reason;
 switch(f.code){case 'cancelled':return 'cancelled';case 'asset-missing':return 'missing';case 'asset-changed':case 'owner-unavailable':return 'changed';case 'digest-mismatch':case 'length-mismatch':case 'local-corrupt':return 'corrupt';case 'limit-exceeded':return 'limit';case 'metadata-invalid':case 'worker-failed':case 'worker-protocol':case 'format-unsupported':return 'not-inspected';case 'conflict':return 'conflict';default:return f.phase==='parse'?'not-inspected':'storage';}
}
async function locked<T>(name:string,fn:()=>Promise<T>):Promise<T>{return navigator.locks.request(name,{ifAvailable:true},lock=>{if(!lock)stop('busy','owner-unavailable');return fn();});}
/** Fresh common connection, but never create/upgrade even in a DOM realm. */
async function existingDatabase(){return openExistingDatabase();}
async function transaction<T>(stores:string[],mode:IDBTransactionMode,fn:(tx:IDBTransaction)=>Promise<T>,c?:Guard):Promise<T>{
 const db=await existingDatabase();try{
 if(c)check(c);const tx=admittedTransaction(db,stores,mode),done=transactionDone(tx);
 let cancelledTransaction=false;
 const cancel=()=>{try{tx.abort();cancelledTransaction=true;}catch{/* committed winner or already aborted elsewhere */}};c?.signal.addEventListener('abort',cancel,{once:true});
 try{const value=await fn(tx);await done;return value;}catch(error){try{tx.abort();}catch{/* settled */}try{await done;}catch{/* original cause retained */}const failure=fromKnownError(error,{phase:mode==='readwrite'?'commit':'read',backend:'idb',cancelRequested:cancelledTransaction});if(cancelledTransaction&&failure.code==='cancelled')throw AppFailure.create(failure);throw error;}finally{c?.signal.removeEventListener('abort',cancel);}
 }finally{closeDatabase(db);}
}
/** Descriptor is bounded data only. Missing properties remain different from null.
 * IDB native clone already occurred; these bounds are acceptance, not heap promises. */
function canonical(value:unknown):string {
 let nodes=0;const active=new Set<object>();
 function walk(v:unknown,depth:number):unknown {
 if(++nodes>128||depth>6)stop('corrupt','local-corrupt');
 if(v===null||typeof v==='boolean')return v;
 if(typeof v==='string'){if(v.length>16384)stop('corrupt','local-corrupt');return v;}
 if(typeof v==='number'&&Number.isFinite(v)&&!Object.is(v,-0))return v;
 if(!v||typeof v!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(v))||active.has(v))stop('corrupt','local-corrupt');
 const keys=Reflect.ownKeys(v);if(keys.length>32||keys.some(k=>typeof k!=='string'))stop('corrupt','local-corrupt');active.add(v);
 const out:Record<string,unknown>=Object.create(null);
 for(const key of (keys as string[]).sort()){const d=Object.getOwnPropertyDescriptor(v,key);if(!d||!('value'in d))stop('corrupt','local-corrupt');out[key]=walk(d.value,depth+1);}active.delete(v);return out;
 }
 const s=JSON.stringify(walk(value,0));if(new TextEncoder().encode(s).length>16384)stop('corrupt','local-corrupt');return s;
}
function snapshot(track:unknown,asset:unknown,id:string,revision:number):Snapshot {
 if(track===undefined)stop('changed','asset-changed');const descriptor=canonical(track),t=track as Track;
 if(t.id!==id||!uuid(t.id)||!positive(t.revision)||t.revision!==revision)stop('changed','asset-changed');
 if(t.assetId===null)stop('no-local-copy','asset-missing');if(!uuid(t.assetId))stop('corrupt','local-corrupt');
 if(typeof t.title!=='string'||!t.title.trim()||t.title.length>300||!(t.artist===null||typeof t.artist==='string'&&t.artist.length<=300)||!(t.album===null||typeof t.album==='string'&&t.album.length<=300)||typeof t.duration!=='number'||t.duration<=0||typeof t.favorite!=='boolean'||typeof t.createdAt!=='string'||!t.manualOverrides||typeof t.manualOverrides!=='object')stop('corrupt','local-corrupt');
 if(Object.hasOwn(t,'localAlbum')&&!copyLocalAlbumMetadata(t.localAlbum))stop('conflict','metadata-invalid');
 const a=copyAsset(asset);if(!a||a.id!==t.assetId)stop(asset===undefined?'missing':'corrupt',asset===undefined?'asset-missing':'local-corrupt');
 if(t.audioFingerprint!==undefined&&t.audioFingerprint!==null&&(!validAudioFingerprint(t.audioFingerprint)||t.audioFingerprint.sha256!==a.sha256||t.audioFingerprint.bytes!==a.bytes))stop('corrupt','local-corrupt');
 return {track:t,asset:{...a},canonical:descriptor};
}
async function captured(tx:IDBTransaction,id:string,revision:number):Promise<Snapshot>{
 const t=await request<Track|undefined>(tx.objectStore('tracks').get(id));
 // Do not dereference untrusted Track before the data-only acceptance check.
 if(t===undefined)stop('changed','asset-changed');canonical(t);if(t.assetId!==null&&!uuid(t.assetId))stop('corrupt','local-corrupt');const a=t.assetId===null?undefined:await request(tx.objectStore('assets').get(t.assetId));
 return snapshot(t,a,id,revision);
}
function sameSnapshot(a:Snapshot,b:Snapshot){if(a.canonical!==b.canonical||!sameAsset(a.asset,b.asset))stop('changed','asset-changed');}
function slot(value:unknown):Slot|null {
 try{
 if(!value||typeof value!=='object'||Reflect.ownKeys(value).length>10)return null;const p=plain(value,Object.keys(value));if(!p)return null;
 const keys=['version','operationId','incarnation','trackId','trackRevision','assetId','assetRevision','state'];
 if(p.state==='committed')keys.push('afterRevision','effect');else if(p.state!=='prepared'&&p.state!=='not-committed')return null;
 if(!plain(value,keys)||p.version!==1||!uuid(p.operationId)||!uuid(p.incarnation)||!uuid(p.trackId)||!uuid(p.assetId)||!positive(p.trackRevision)||!positive(p.assetRevision))return null;
 if(p.state==='committed'&&(!positive(p.afterRevision)||!['updated','no-change'].includes(p.effect as string)||p.afterRevision!==(p.effect==='updated'?Number(p.trackRevision)+1:p.trackRevision)))return null;
 if(new TextEncoder().encode(JSON.stringify(p)).length>2048)return null;return {...p} as Slot;
 }catch{return null;}
}
const matches=(s:Slot,r:MetadataRescanReference)=>s.operationId===r.operationId&&s.incarnation===r.incarnation;
async function journal(tx:IDBTransaction){const store=tx.objectStore('settings');const [inc,raw]=await Promise.all([request<unknown>(store.get(INCARNATION)),request<unknown>(store.get(SLOT))]);return {inc,raw,s:slot(raw)};}
function receipt(r:MetadataRescanReference,j:Awaited<ReturnType<typeof journal>>):MetadataRescanInspection {
 if(j.inc!==r.incarnation)return {state:'uncertain',reference:r,reason:'original-library-unavailable',failure:null};
 if(!j.s||!matches(j.s,r))return {state:'uncertain',reference:r,reason:'receipt-unavailable',failure:null};
 if(j.s.state==='committed')return {state:'committed',reference:r,effect:j.s.effect,trackRevision:j.s.afterRevision};
 return {state:'not-committed',reference:r};
}
/** No candidate is accepted from callers. This merge is private to a bound attempt. */
function merge(old:LocalAlbumMetadataV1|undefined,next:LocalAlbumMetadataV1):LocalAlbumMetadataV1 {
 const result=old===undefined?unknownLocalAlbum('legacy'):copyLocalAlbumMetadata(old);if(!result)stop('conflict','metadata-invalid');
 for(const key of ['track','disc','albumArtist','compilation'] as const){
 const a=result.source[key],b=next.source[key];
 if(a.state==='known'){if(b.state==='known'&&JSON.stringify(a.value)!==JSON.stringify(b.value))stop('conflict','conflict');}
 else if(b.state==='known'||a.reason==='legacy'||a.reason==='not-inspected')Object.assign(result.source,{[key]:b});
 }
 return copyLocalAlbumMetadata(result)!;
}
interface Bridge {candidate:Promise<LocalAlbumMetadataV1>;check():void;finish():FailureV1|null}
function bridge(asset:LocalAsset,c:MetadataRescanContext):Bridge {
 let realm:RealmAttempt|null=null,worker:Worker|null=null,ended=false,received=false,parsing=false,bytes=0,first:unknown=null;
 const requestId=crypto.randomUUID(),token=crypto.randomUUID();let resolve!:(m:LocalAlbumMetadataV1)=>void,reject!:(e:unknown)=>void;
 const candidate=new Promise<LocalAlbumMetadataV1>((a,b)=>{resolve=a;reject=b;});void candidate.catch(()=>{});
 const failed=(e:unknown)=>{if(first===null)first=e;if(!received)reject(first);};
 const valid=()=>{if(first!==null)throw first;check(c);if(!realm?.current())stop('changed','owner-unavailable');};
 const cancel=()=>failed(new Stop('cancelled',makeFailure('read','cancelled','cancelled','none')));
 const watch=setInterval(()=>{if(ended)return;try{check(c);if(realm&&!realm.current())stop('changed','owner-unavailable');}catch(e){failed(e);}},25);
 const deadline=setTimeout(()=>failed(new Stop('timeout',makeFailure('read','internal','worker-failed','none'))),30000);
 c.signal.addEventListener('abort',cancel,{once:true});
 try{
 worker=new Worker(new URL('../imports/metadata-rescan.worker.ts',import.meta.url),{type:'module'});
 worker.onerror=e=>{e.preventDefault();failed(AppFailure.create(makeFailure('transport','internal','worker-failed','none')));};worker.onmessageerror=()=>failed(AppFailure.create(makeFailure('transport','internal','worker-protocol','none')));
 worker.onmessage=e=>{try{
 valid();const m=copyMetadataRescanReply(e.data);if(!m||m.requestId!==requestId||m.token!==token||received)fail('transport','internal','worker-protocol','none');
 if(m.type==='failure')throw AppFailure.create(m.failure);
 if(m.type==='progress'){if(parsing||m.total!==asset.bytes||m.bytes<=bytes)fail('transport','internal','worker-protocol','none');bytes=m.bytes;progress(c,{phase:'verify',bytes,total:asset.bytes});}
 else if(m.type==='parsing'){if(parsing||bytes!==asset.bytes)fail('transport','internal','worker-protocol','none');parsing=true;progress(c,{phase:'parse'});}
 else {if(!parsing||!sameAsset(asset,m.asset))fail('transport','internal','worker-protocol','none');valid();received=true;clearTimeout(deadline);resolve(m.localAlbum);}
 }catch(error){failed(error);}};
 // The existing host captures caller ownership synchronously here, before bind await.
 void beginWorkerAttempt('copies',worker,()=>!ended&&c.current()&&!c.signal.aborted).then(a=>{
 if(ended){a.closeAfterSettlement();return;}realm=a;a.onTransportFailure(code=>failed(AppFailure.create(makeFailure('transport','internal',code,'none'))));
 try{valid();worker!.postMessage({version:1,type:'inspect',requestId,token,asset});}catch(e){failed(e);}
 },failed);
 }catch(e){failed(e);}
 return {candidate,check:valid,finish(){if(ended)return null;ended=true;clearInterval(watch);clearTimeout(deadline);c.signal.removeEventListener('abort',cancel);let secondary:FailureV1|null=null;
 try{if(received)worker?.postMessage({version:1,type:'ack',requestId,token});}catch(e){secondary=fromKnownError(e,{phase:'transport',backend:'none'});}
 if(worker){worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;if(!realm)worker.terminate();}realm?.closeAfterSettlement();return secondary;
 }};
}

export async function rescanLocalAlbum(value:MetadataRescanRequest,c:MetadataRescanContext):Promise<MetadataRescanResult> {
 let reference:MetadataRescanReference|null=null,prepared=false,worker:Bridge|null=null,committedAlbum:LocalAlbumMetadataV1|null=null;
 try{
 const p=plain(value,['operationId','trackId','expectedRevision']);if(!p||!uuid(p.operationId)||!uuid(p.trackId)||!positive(p.expectedRevision))fail('validate','internal','input-invalid','none');
 const req={operationId:p.operationId,trackId:p.trackId,expectedRevision:p.expectedRevision};check(c);
 return await locked(RESCAN_LOCK,async()=>{
 try{
 const before=await transaction(['tracks','assets','settings'],'readonly',tx=>captured(tx,req.trackId,req.expectedRevision),c);check(c);
 if(before.asset.bytes>METADATA_RESCAN_LIMIT)stop('limit','limit-exceeded');
 await locked(WRITER_LOCK,async()=>{
 check(c);await assertImportsResolved();check(c);
 await transaction(['tracks','assets','settings'],'readwrite',async tx=>{
 const now=await captured(tx,req.trackId,req.expectedRevision);sameSnapshot(before,now);const j=await journal(tx);check(c);
 if(j.raw!==undefined&&(!j.s||!uuid(j.inc)||j.s.incarnation!==j.inc))stop('storage','local-corrupt');
 if(j.s?.state==='prepared')stop('busy','owner-unavailable');if(j.s?.operationId===req.operationId)fail('validate','internal','input-invalid','none');if(j.inc!==undefined&&!uuid(j.inc))stop('storage','local-corrupt');
 const incarnation=j.inc===undefined?crypto.randomUUID():j.inc as string;
 reference=Object.freeze({version:1,operationId:req.operationId,incarnation});
 // Two UUIDs reach the caller before ANY mutation. A throwing observer aborts.
 c.onPending(reference);check(c);
 const intent:Slot={...reference,trackId:req.trackId,trackRevision:before.track.revision,assetId:before.asset.id,assetRevision:before.asset.revision,state:'prepared'};
 if(j.inc===undefined)tx.objectStore('settings').put(incarnation,INCARNATION);check(c);tx.objectStore('settings').put(intent,SLOT);
 },c);prepared=true;
 });
 check(c);worker=bridge(before.asset,c);const next=await worker.candidate;worker.check();const merged=merge(before.track.localAlbum,next);
 committedAlbum=merged;const changed=JSON.stringify(copyLocalAlbumMetadata(before.track.localAlbum))!==JSON.stringify(merged);progress(c,{phase:'commit'});worker.check();
 const result=await locked(WRITER_LOCK,async()=>{
 check(c);await assertImportsResolved();worker!.check();
 return transaction(['tracks','assets','settings'],'readwrite',async tx=>{
 const now=await captured(tx,req.trackId,req.expectedRevision);sameSnapshot(before,now);const j=await journal(tx);
 if(j.inc!==reference!.incarnation||!j.s||!matches(j.s,reference!)||j.s.state!=='prepared'||j.s.trackId!==req.trackId||j.s.trackRevision!==before.track.revision||j.s.assetId!==before.asset.id||j.s.assetRevision!==before.asset.revision)stop('changed','asset-changed');
 worker!.check();check(c);assertDatabaseUse('write');if(changed&&now.track.revision===Number.MAX_SAFE_INTEGER)stop('limit','limit-exceeded');
 const trackRevision=now.track.revision+(changed?1:0),effect=changed?'updated' as const:'no-change' as const;
 if(changed)tx.objectStore('tracks').put({...now.track,localAlbum:merged,revision:trackRevision},req.trackId);
 check(c);tx.objectStore('settings').put({...j.s,state:'committed',effect,afterRevision:trackRevision},SLOT);
 return {state:'committed' as const,reference:reference!,effect,trackRevision,localAlbum:merged};
 },c);
 });
 // Native transaction completion wins over a later cancel or lost ACK.
 worker.finish();worker=null;return result;
 }catch(error){
 const primary=cause(error),why=reason(error,primary);let secondary:FailureV1|null=null;
 if(reference&&prepared){
 try{
 // We still own RESCAN_LOCK. Reconciliation never depends on a revoked UI guard.
 const inspected=await locked(WRITER_LOCK,()=>transaction(['settings'],'readwrite',async tx=>{
 const j=await journal(tx),r=receipt(reference!,j);
 if(r.state==='not-committed'&&j.s?.state==='prepared')tx.objectStore('settings').put({...j.s,state:'not-committed'},SLOT);
 return r;
 }));
 if(inspected.state==='committed'){
 // A lost acknowledgement cannot erase the atomic committed receipt.
 if(committedAlbum)return {...inspected,localAlbum:committedAlbum};
 return {state:'uncertain',reference,failure:makeFailure('reconcile','write-uncertain','commit-uncertain','idb'),secondary:primary};
 }
 if(inspected.state==='uncertain')return {state:'uncertain',reference,failure:primary,secondary:inspected.failure};
 }catch(e){secondary=cause(e);return {state:'uncertain',reference,failure:primary,secondary};}
 }
 return {state:'not-applied',reference,reason:why,failure:primary,secondary};
 }finally{worker?.finish();worker=null;}
 });
 }catch(error){const f=cause(error);return {state:'not-applied',reference,reason:reason(error,f),failure:f,secondary:null};}
}

export async function inspectMetadataRescan(value:MetadataRescanReference,c:Guard):Promise<MetadataRescanInspection> {
 const r=copyMetadataRescanReference(value);if(!r)fail('validate','internal','input-invalid','none');
 try{check(c);return await locked(RESCAN_LOCK,()=>locked(WRITER_LOCK,()=>transaction(['settings'],'readwrite',async tx=>{const j=await journal(tx);check(c);const result=receipt(r,j);if(result.state==='not-committed'&&j.s?.state==='prepared'){assertDatabaseUse('write');tx.objectStore('settings').put({...j.s,state:'not-committed'},SLOT);}return result;},c)));}
 catch(error){const f=cause(error);return {state:'uncertain',reference:r,reason:error instanceof Stop&&error.reason==='busy'?'busy':'storage',failure:f};}
}

export async function readMetadataRescanPending(c:Guard):Promise<MetadataRescanReference|null> {
 check(c);return transaction(['settings'],'readonly',async tx=>{
 const j=await journal(tx);check(c);
 if(j.raw===undefined){if(j.inc!==undefined&&!uuid(j.inc))fail('reconcile','integrity','local-corrupt','idb');return null;}
 if(!j.s||!uuid(j.inc)||j.inc!==j.s.incarnation)fail('reconcile','integrity','local-corrupt','idb');
 return j.s.state==='prepared'?copyMetadataRescanReference({version:1,operationId:j.s.operationId,incarnation:j.s.incarnation}):null;
 },c);
}
