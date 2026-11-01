import {beginWorkerAttempt,type RealmAttempt} from '../storage/database-realms';
import {admittedTransaction,closeDatabase} from '../storage/database';
import {fromKnownError,makeFailure,nativeDOMName,type FailureV1} from '../errors/app-failure';
import {plain,type Phase,type Result} from '../diagnostics/contract';
import {copyFeatureObservation,featureObservation,notifyFeature,panelFailure,panelSuccess,type FeatureObservationV1,type ObserveFeature} from '../diagnostics/panel-mapping';
import {openDatabase, request} from '../storage/database';
import {transactionDone} from '../storage/transaction-done';
import {validAsset, type LocalAsset, type Playlist, type Track} from './library';

export const LOCAL_BATCH_PREFIX = 'local-batch:v1:';
export const LOCAL_BATCH_LOCK = 'pulso-web:local:batch-verifier';
export type LocalEntryState = 'pending'|'verifying'|'ready'|'missing'|'invalid'|'changed'|'failed';
export type LocalBatchState = 'queued'|'verifying'|'complete'|'incomplete'|'cancelled'|'interrupted'|'failed';
export interface LocalBatchEntry {
 entryId:string; trackId:string; trackRevision:number;
 title:string; artist:string|null; album:string|null;
 asset:LocalAsset; state:LocalEntryState;
}
export type LocalBatchCounts = Record<LocalEntryState,number>;
export interface LocalBatch {
 version:1; id:string; namespace:'local'; revision:number;
 playlistId:string; playlistRevision:number; playlistName:string;
 entries:LocalBatchEntry[]; state:LocalBatchState;
 operationId:string|null; owner:string|null; attempt:number;
 bytesRead:number; createdAt:string;
}
export interface LocalBatchProgress {
 jobId:string; revision:number; state:LocalBatchState; counts:LocalBatchCounts;
 bytesRead:number; totalBytes:number; attempt:number; restartsVerification:true;
}
export type LocalBatchErrorCode = 'invalid-input'|'conflict'|'empty'|'invalid-relation'|'not-found'|'busy'|'retry-required'|'storage'|'worker';
export class LocalBatchError extends Error {
 constructor(readonly code:LocalBatchErrorCode, cause?:unknown, message?:string) { super(message??`Lote local: ${code}`,{cause}); this.name='LocalBatchError'; }
}
const observations=new WeakMap<object,FeatureObservationV1>();
const nativeCauses=new WeakMap<object,unknown>();
const codes={ 'invalid-input':['validate','internal','input-invalid'],conflict:['validate','internal','conflict'],empty:['validate','internal','empty-selection'],'invalid-relation':['validate','integrity','relations-invalid'],'not-found':['validate','internal','input-invalid'],busy:['admit','internal','owner-unavailable'],'retry-required':['validate','internal','retry-required'],storage:['validate','internal','unknown'],worker:['transport','internal','worker-failed']} as const;
export function batchDomainError(code:LocalBatchErrorCode,phase?:Phase,message?:string):LocalBatchError {
 const e=new LocalBatchError(code,undefined,message),[origin,family,safe]=codes[code];
 observations.set(e,featureObservation({phase:phase??origin,family,code:safe,outcome:code==='busy'?'blocked':'failed',backend:'none',transport:'none',count:0}));return e;
}
export function batchErrorObservation(error:unknown):FeatureObservationV1 {
 const own=(typeof error==='object'&&error!==null||typeof error==='function')?observations.get(error as object):undefined;
 return own??featureObservation(panelFailure(fromKnownError(error,{phase:'validate',backend:'unknown'})));
}
export function batchFailureError(failure:FailureV1,code:LocalBatchErrorCode='storage',cause?:unknown):LocalBatchError {
 const e=new LocalBatchError(code,cause);nativeCauses.set(e,cause);observations.set(e,featureObservation(panelFailure(failure)));return e;
}
function observedError(error:unknown,observation:FeatureObservationV1,code:LocalBatchErrorCode='storage') {
 const e=new LocalBatchError(code,error);observations.set(e,observation);return e;
}
async function io<T>(phase:Phase,work:()=>Promise<T>|T):Promise<T> {
 try{return await work();}catch(error){
 if(typeof error==='object'&&error!==null&&observations.has(error))throw error;
 const f=fromKnownError(error,{phase,backend:'idb'});throw batchFailureError(f.phase===null?makeFailure(phase,f.family,f.code,f.backend):f,'storage',error);
 }
}
async function abortFailedTransaction(tx:IDBTransaction,done:Promise<void>,error:unknown):Promise<never> {
 let cleanup:Readonly<Result>|null=null;
 try{tx.abort();}catch(abortError){
 // A settled native transaction normally rejects abort with InvalidStateError.
 if(nativeDOMName(abortError)!=='InvalidStateError')cleanup=panelFailure(fromKnownError(abortError,{phase:'cleanup',backend:'idb'}));
 }
 await done.catch(settlement=>{
 const secondary=batchErrorObservation(settlement).primary;
 const same=settlement===error||typeof error==='object'&&error!==null&&typeof settlement==='object'&&settlement!==null&&nativeCauses.has(error)&&nativeCauses.get(error)===nativeCauses.get(settlement);
 if(!same&&secondary.code!=='transaction-aborted'&&secondary.code!=='cancelled')cleanup??=secondary;
 });
 if(cleanup)throw observedError(error,featureObservation(batchErrorObservation(error).primary,cleanup));
 throw error;
}
function transaction(db:IDBDatabase,stores:string|string[],mode:IDBTransactionMode='readonly'):IDBTransaction {
 try{return admittedTransaction(db,stores,mode);}catch(error){throw batchFailureError(fromKnownError(error,{phase:'open',backend:'idb'}),'storage',error);}
}
function committed(tx:IDBTransaction):Promise<void> {const done=io('commit',()=>transactionDone(tx));void done.catch(()=>{});return done;}
export const localBatchUUID = (value:unknown):value is string => typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const positive=(n:unknown):n is number=>Number.isSafeInteger(n)&&(n as number)>0;
const entryStates:LocalEntryState[]=['pending','verifying','ready','missing','invalid','changed','failed'];
const batchStates:LocalBatchState[]=['queued','verifying','complete','incomplete','cancelled','interrupted','failed'];
const label=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max;
const optionalLabel=(v:unknown)=>v===null||label(v,300);
export function validLocalBatch(value:unknown):value is LocalBatch {
 if(!value||typeof value!=='object')return false;
 const b=value as LocalBatch;
 if(b.version!==1||!localBatchUUID(b.id)||b.namespace!=='local'||!positive(b.revision)||!localBatchUUID(b.playlistId)||!positive(b.playlistRevision)||!label(b.playlistName,100)||!b.playlistName.trim()||!batchStates.includes(b.state)||!Number.isSafeInteger(b.attempt)||b.attempt<0||!Number.isSafeInteger(b.bytesRead)||b.bytesRead<0||typeof b.createdAt!=='string'||!Array.isArray(b.entries)||!b.entries.length)return false;
 if(b.state==='verifying' ? !localBatchUUID(b.owner)||!localBatchUUID(b.operationId) : b.owner!==null||b.operationId!==null)return false;
 const ids=new Set<string>();const assets=new Map<string,LocalAsset>();const ready=new Set<string>();
 for(const e of b.entries){
 if(!e||!localBatchUUID(e.entryId)||ids.has(e.entryId)||!localBatchUUID(e.trackId)||!positive(e.trackRevision)||!label(e.title,300)||!optionalLabel(e.artist)||!optionalLabel(e.album)||!validAsset(e.asset)||!entryStates.includes(e.state))return false;
 const prior=assets.get(e.asset.id);if(prior&&!sameLocalAsset(prior,e.asset))return false;
 assets.set(e.asset.id,e.asset);if(e.state==='ready')ready.add(e.asset.id);
 ids.add(e.entryId);
 }
 const total=[...assets.values()].reduce((sum,a)=>sum+a.bytes,0);
 const readyBytes=[...ready].reduce((sum,id)=>sum+assets.get(id)!.bytes,0);
 if(!Number.isSafeInteger(total)||b.bytesRead>total||b.bytesRead<readyBytes)return false;
 if(b.state==='queued')return b.bytesRead===0&&b.entries.every(e=>e.state==='pending');
 if(b.attempt===0)return false;
 if(b.state!=='verifying'&&b.entries.some(e=>e.state==='verifying'))return false;
 if(b.state==='incomplete'&&b.entries.some(e=>e.state==='pending'||e.state==='verifying'))return false;
 return b.state!=='complete'||(b.bytesRead===total&&b.entries.every(e=>e.state==='ready'));
}
export function localBatchProgress(b:LocalBatch,bytesRead=b.bytesRead):LocalBatchProgress {
 const counts=Object.fromEntries(entryStates.map(s=>[s,0])) as LocalBatchCounts;
 const unique=new Map<string,number>();
 for(const e of b.entries){counts[e.state]++;unique.set(e.asset.id,e.asset.bytes);}
 return {jobId:b.id,revision:b.revision,state:b.state,counts,bytesRead,totalBytes:[...unique.values()].reduce((a,n)=>a+n,0),attempt:b.attempt,restartsVerification:true};
}
async function readLocalBatchImpl(id:string):Promise<LocalBatch|undefined> {
 if(!localBatchUUID(id))throw batchDomainError('invalid-input');
 const db=await io('open',()=>openDatabase());let value:unknown;
 try{
 const tx=transaction(db,'settings');const done=committed(tx);
 value=await io('read',()=>request<unknown>(tx.objectStore('settings').get(LOCAL_BATCH_PREFIX+id)));await done;
 }finally{closeDatabase(db);}
 if(value===undefined)return undefined;
 if(!validLocalBatch(value)||value.id!==id)throw batchDomainError('invalid-relation');
 return value;
}
async function listLocalBatchesImpl():Promise<LocalBatch[]> {
 const db=await io('open',()=>openDatabase());
 try {
 const tx=transaction(db,'settings');const done=committed(tx);
 // Artwork blobs share this store. Never materialize values outside this prefix.
 const range=IDBKeyRange.bound(LOCAL_BATCH_PREFIX,LOCAL_BATCH_PREFIX+'\uffff');
 const rows=await io('read',()=>request<unknown[]>(tx.objectStore('settings').getAll(range)));await done;
 return rows.filter(validLocalBatch);
 } finally {closeDatabase(db);}
}
async function createLocalBatchImpl(playlistId:string,expectedRevision:number):Promise<LocalBatch> {
 if(!localBatchUUID(playlistId)||!positive(expectedRevision))throw batchDomainError('invalid-input');
 const db=await io('open',()=>openDatabase());
 let tx:IDBTransaction;
 try{tx=transaction(db,['settings','playlists','tracks','assets'],'readwrite');}catch(error){closeDatabase(db);throw error;}
 const done=committed(tx);
 try {
 const p=await io('read',()=>request<Playlist|undefined>(tx.objectStore('playlists').get(playlistId)));
 if(!p||p.id!==playlistId||p.revision!==expectedRevision)throw batchDomainError('conflict');
 if(!Array.isArray(p.entries)||!p.entries.length)throw batchDomainError('empty');
 const entries:LocalBatchEntry[]=[];
 for(const e of p.entries){
 if(!e||!localBatchUUID(e.trackId)||!localBatchUUID(e.id))throw batchDomainError('invalid-relation');
 const t=await io('read',()=>request<Track|undefined>(tx.objectStore('tracks').get(e.trackId)));
 if(!t||t.id!==e.trackId||!positive(t.revision))throw batchDomainError('invalid-relation');
 if(t.assetId===null)throw batchDomainError('invalid-relation','validate','Falta importar el audio de una ficha restaurada. Importa el original y vuelve a crear el lote.');
 const a=await io('read',()=>request<LocalAsset|undefined>(tx.objectStore('assets').get(t.assetId!)));
 if(!validAsset(a)||a.id!==t.assetId)throw batchDomainError('invalid-relation');
 entries.push({entryId:e.id,trackId:t.id,trackRevision:t.revision,title:t.title,artist:t.artist,album:t.album,asset:a,state:'pending'});
 }
 const batch:LocalBatch={version:1,id:crypto.randomUUID(),namespace:'local',revision:1,playlistId:p.id,playlistRevision:p.revision,playlistName:p.name,entries,state:'queued',operationId:null,owner:null,attempt:0,bytesRead:0,createdAt:new Date().toISOString()};
 if(!validLocalBatch(batch))throw batchDomainError('invalid-relation');
 await io('write',()=>{tx.objectStore('settings').add(batch,LOCAL_BATCH_PREFIX+batch.id);});await done;return batch;
 } catch(error){return await abortFailedTransaction(tx,done,error);}
 finally {closeDatabase(db);}
}
export function sameLocalAsset(now:unknown,snapshot:LocalAsset):boolean {
 if(!validAsset(now))return false;
 return (Object.keys(snapshot) as (keyof LocalAsset)[]).every(k=>now[k]===snapshot[k]);
}
// Internal CAS used by the worker. Only synchronous decisions and IDB requests in tx.
async function updateLocalBatchImpl(expected:LocalBatch,change:(b:LocalBatch)=>void,validateAssets=false,signal?:AbortSignal):Promise<LocalBatch> {
 const db=await io('open',()=>openDatabase());let tx:IDBTransaction;
 try{tx=transaction(db,['settings','assets'],'readwrite');}catch(error){closeDatabase(db);throw error;}
 const done=committed(tx);
 try {
 const abort=()=>{try{tx.abort();}catch{/* settled */}};
 signal?.addEventListener('abort',abort,{once:true});
 void done.finally(()=>signal?.removeEventListener('abort',abort)).catch(()=>{});
 if(signal?.aborted)abort();
 const store=tx.objectStore('settings');const b=await io('read',()=>request<LocalBatch|undefined>(store.get(LOCAL_BATCH_PREFIX+expected.id)));
 if(!validLocalBatch(b)||b.id!==expected.id||b.revision!==expected.revision||b.owner!==expected.owner||b.operationId!==expected.operationId)throw batchDomainError('conflict','commit');
 change(b);
 if(validateAssets){for(const e of b.entries){if(e.state==='ready'||e.state==='verifying'){
 const now=await io('read',()=>request<unknown>(tx.objectStore('assets').get(e.asset.id)));
 if(!sameLocalAsset(now,e.asset))e.state=now===undefined?'missing':'changed';
 }}}
 if(b.state==='complete'&&!b.entries.every(e=>e.state==='ready'))b.state='incomplete';
 b.revision++;
 if(!validLocalBatch(b))throw batchDomainError('invalid-relation');
 await io('write',()=>{store.put(b,LOCAL_BATCH_PREFIX+b.id);});await done;return b;
 }catch(error){return await abortFailedTransaction(tx,done,error);}
 finally{closeDatabase(db);}
}
async function withLocalBatchLock<T>(fn:()=>Promise<T>):Promise<T> {
 if(!navigator.locks)throw batchDomainError('busy');
 return navigator.locks.request(LOCAL_BATCH_LOCK,{ifAvailable:true},lock=>{if(!lock)throw batchDomainError('busy');return fn();});
}
// Reopening never takes an active verifier. A free lock is proof that recovery is safe.
async function recoverLocalBatchImpl(id:string,expectedRevision:number):Promise<LocalBatch> {
 return withLocalBatchLock(async()=>{
 const b=await readLocalBatch(id);if(!b)throw batchDomainError('not-found');
 if(b.revision!==expectedRevision)throw batchDomainError('conflict');
 if(b.state!=='verifying')return b;
 return updateLocalBatch(b,next=>{next.state='interrupted';next.owner=null;next.operationId=null;for(const e of next.entries)if(e.state==='verifying')e.state='pending';});
 });
}
// Explicit retry always starts verification at zero, including previously ready entries.
async function retryLocalBatchImpl(id:string,expectedRevision:number):Promise<LocalBatch> {
 return withLocalBatchLock(async()=>{
 const b=await readLocalBatch(id);if(!b)throw batchDomainError('not-found');
 if(b.revision!==expectedRevision)throw batchDomainError('conflict');
 if(b.state==='verifying')throw batchDomainError('retry-required');
 return updateLocalBatch(b,next=>{next.state='queued';next.owner=null;next.operationId=null;next.bytesRead=0;for(const e of next.entries)e.state='pending';});
 });
}
async function runLocalBatchImpl(id:string,signal:AbortSignal,onProgress:(p:LocalBatchProgress)=>void=()=>{},observe?:ObserveFeature):Promise<LocalBatch> {
 let terminal:FeatureObservationV1|undefined;
 try {
 const b=await readLocalBatch(id);if(!b)throw batchDomainError('not-found');
 if(b.state!=='queued')throw batchDomainError('retry-required');
 const requestId=crypto.randomUUID();let worker:Worker;
 try{worker=new Worker(new URL('../imports/local-batch.worker.ts',import.meta.url),{type:'module'});}catch(error){throw batchFailureError(fromKnownError(error,{phase:'transport',backend:'none'}),'worker',error);}
 let realm:RealmAttempt|null=null;
 try {realm=await beginWorkerAttempt('batch',worker,()=>true);return await new Promise<LocalBatch>((resolve,reject)=>{
 let revision=b.revision,bytes=0;let finishing=false;
 const finish=()=>{finishing=true;signal.removeEventListener('abort',cancel);};
 const bad=(code:'worker-protocol'|'worker-failed')=>{
 if(finishing)return;finish();const e=batchFailureError(fromKnownError(null,{phase:'transport',backend:'none'}),'worker');
 const observation=featureObservation({phase:'transport',outcome:'uncertain',family:'internal',code,backend:'none',transport:'none',count:0});
 observations.set(e,observation);reject(e);
 };
 const cancel=()=>{try{worker.postMessage({version:2,type:'cancel',requestId,jobId:id});}catch{bad('worker-failed');}};
 signal.addEventListener('abort',cancel,{once:true});
 realm!.onTransportFailure(bad);worker.onerror=()=>bad('worker-failed');worker.onmessageerror=()=>bad('worker-protocol');
 worker.onmessage=event=>{
 if(finishing)return;
 // Read only data descriptors before the request gate, never arbitrary getters.
 const identity=wireIdentity(event.data);if(!identity)return bad('worker-protocol');
 if(identity.requestId!==requestId||identity.jobId!==id)return;
 const type=identity.type;
 const keys=type==='progress'?['progress']:type==='done'?['batch','observation']:type==='error'?['code','observation']:[];
 const m=plain(event.data,['version','type','requestId','jobId',...keys]);
 if(!m||m.version!==2||!keys.length)return bad('worker-protocol');
 if(type==='progress'){
 if(!realm!.current())return;
 const stale=plain(m.progress,['jobId','revision','state','counts','bytesRead','totalBytes','attempt','restartsVerification']);
 if(stale&&stale.jobId===id&&Number.isSafeInteger(stale.attempt)&&Number(stale.attempt)>=0&&Number.isSafeInteger(stale.revision)&&Number(stale.revision)>0&&(Number(stale.attempt)<b.attempt+1||Number(stale.revision)<revision))return;
 const p=copyBatchProgress(m.progress,b,b.revision,0);if(!p)return bad('worker-protocol');
 if(p.revision<revision||p.bytesRead<bytes||(p.revision===revision&&p.bytesRead===bytes))return;
 revision=p.revision;bytes=p.bytesRead;try{onProgress(p);}catch{/* Progress observer does not own verification. */}return;
 }
 const observation=copyFeatureObservation(m.observation);if(!observation)return bad('worker-protocol');
 if(type==='done'){
 const end=copyBatchSnapshot(m.batch);
 if(end&&end.id===id&&sameBatchSelection(end,b)&&(end.attempt<b.attempt+1||end.revision<revision))return;
 if(!end||end.id!==id||end.revision<=b.revision||end.attempt!==b.attempt+1||end.state==='queued'||end.state==='verifying'||end.bytesRead<bytes||!sameBatchSelection(end,b))return bad('worker-protocol');
 const allowed=end.state==='complete'?['succeeded','recovered']:end.state==='incomplete'?['partial']:end.state==='cancelled'?['cancelled']:['failed','uncertain'];
 if(!allowed.includes(observation.primary.outcome))return bad('worker-protocol');
 terminal=observation;finish();resolve(end);
 }else{
 if(typeof m.code!=='string'||!['busy','retry-required','conflict','not-found','storage','worker','invalid-input','invalid-relation','empty'].includes(m.code))return bad('worker-protocol');
 const e=observedError(undefined,observation,m.code as LocalBatchErrorCode);finish();reject(e);
 }
 };
 try{if(!realm!.current())throw batchDomainError('storage','admit');worker.postMessage({version:2,type:'start',requestId,jobId:id,expectedRevision:b.revision});if(signal.aborted)cancel();}catch{bad('worker-failed');}
 });}finally{worker.terminate();realm?.closeAfterSettlement();}
 }catch(error){terminal=batchErrorObservation(error);throw error;}
 finally{if(terminal)notifyFeature(observe,terminal);}
}
function wireIdentity(value:unknown):{requestId:unknown;jobId:unknown;type:unknown}|null {
 try{if(!value||typeof value!=='object')return null;
 const get=(key:string)=>{const d=Object.getOwnPropertyDescriptor(value,key);return d&&'value'in d?d.value:undefined;};
 return {requestId:get('requestId'),jobId:get('jobId'),type:get('type')};}catch{return null;}
}
// Snapshots are private business data; validate without invoking accessors, then clone.
export function copyBatchSnapshot(value:unknown):LocalBatch|null {
 try{
 const data=(v:unknown):boolean=>{if(v===null||typeof v!=='object')return typeof v!=='function'&&typeof v!=='symbol';
 if(!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)return false;
 return Reflect.ownKeys(v).every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return typeof k==='string'&&!!d&&'value'in d&&data(d.value);});};
 if(!data(value)||!validLocalBatch(value))return null;return structuredClone(value);
 }catch{return null;}
}
function sameBatchSelection(a:LocalBatch,b:LocalBatch):boolean {
 return a.playlistId===b.playlistId&&a.playlistRevision===b.playlistRevision&&a.playlistName===b.playlistName&&a.createdAt===b.createdAt&&a.entries.length===b.entries.length&&a.entries.every((e,i)=>{const old=b.entries[i];return e.entryId===old.entryId&&e.trackId===old.trackId&&e.trackRevision===old.trackRevision&&e.title===old.title&&e.artist===old.artist&&e.album===old.album&&sameLocalAsset(e.asset,old.asset);});
}
function copyBatchProgress(value:unknown,b:LocalBatch,revision:number,bytes:number):LocalBatchProgress|null {
 const p=plain(value,['jobId','revision','state','counts','bytesRead','totalBytes','attempt','restartsVerification']);
 if(!p)return null;const counts=plain(p.counts,entryStates),total=localBatchProgress(b).totalBytes;
 if(!counts||!Object.values(counts).every(n=>Number.isSafeInteger(n)&&Number(n)>=0)||Object.values(counts).reduce<number>((a,n)=>a+Number(n),0)!==b.entries.length||p.jobId!==b.id||!Number.isSafeInteger(p.revision)||Number(p.revision)<=b.revision||Number(p.revision)<revision||!batchStates.includes(p.state as LocalBatchState)||p.state==='queued'||p.attempt!==b.attempt+1||p.restartsVerification!==true||p.totalBytes!==total||!Number.isSafeInteger(p.bytesRead)||Number(p.bytesRead)<bytes||Number(p.bytesRead)>total)return null;
 if(p.state==='complete'&&(counts.ready!==b.entries.length||p.bytesRead!==total)||p.state!=='verifying'&&counts.verifying!==0)return null;
 return {...p,counts:{...counts}} as unknown as LocalBatchProgress;
}
function storageBoundary<A extends unknown[],R>(fn:(...args:A)=>Promise<R>):(...args:A)=>Promise<R> {
 return async(...args)=>{try{return await fn(...args);}catch(error){
 if(typeof error==='object'&&error!==null&&observations.has(error))throw error;
 throw observedError(error,batchErrorObservation(error));
 }};
}
function observed<A extends unknown[]>(fn:(...args:A)=>Promise<LocalBatch>,phase:Phase='commit') {
 return async(...args:[...A,ObserveFeature?]):Promise<LocalBatch>=>{
 const observe=args.pop() as ObserveFeature|undefined;
 try{const b=await fn(...args as unknown as A);notifyFeature(observe,featureObservation(panelSuccess(phase,phase==='reconcile'?'recovered':'succeeded')));return b;}
 catch(error){notifyFeature(observe,batchErrorObservation(error));throw error;}
 };
}
export const readLocalBatch=storageBoundary(readLocalBatchImpl);
export const listLocalBatches=storageBoundary(listLocalBatchesImpl);
export function createLocalBatch(id:string,revision:number,observe?:ObserveFeature){return observed(storageBoundary(createLocalBatchImpl))(id,revision,observe);}
export const updateLocalBatch=storageBoundary(updateLocalBatchImpl);
export function recoverLocalBatch(id:string,revision:number,observe?:ObserveFeature){return observed(storageBoundary(recoverLocalBatchImpl),'reconcile')(id,revision,observe);}
export function retryLocalBatch(id:string,revision:number,observe?:ObserveFeature){return observed(storageBoundary(retryLocalBatchImpl))(id,revision,observe);}
export const runLocalBatch=storageBoundary(runLocalBatchImpl);
