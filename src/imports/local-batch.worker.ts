import {installWorkerDatabaseRealm,bindWorkerRealm,workerDatabaseRealmCurrent} from '../storage/database-realms';
/// <reference lib="webworker" />
import {openAssetReader,type AssetReader} from '../storage/asset-reader';
import {readRecord,assertDatabaseUse} from '../storage/database';
import {validAsset} from '../library/library';
import {fail,fromKnownError,makeFailure,type FailureV1} from '../errors/app-failure';
import {plain,type Result} from '../diagnostics/contract';
import {featureObservation,panelFailure,panelSuccess,type FeatureObservationV1} from '../diagnostics/panel-mapping';
import {
 LOCAL_BATCH_LOCK,batchDomainError,batchErrorObservation,localBatchUUID,localBatchProgress,
 readLocalBatch,sameLocalAsset,updateLocalBatch,
 type LocalBatch,type LocalEntryState,
} from '../library/local-batches';

interface Session {
 requestId:string;jobId:string;cancelled:boolean;batch:LocalBatch|null;terminal:boolean;
 invalidated:AbortController;io:AbortController;cancelTask:Promise<void>|null;readBytes:number;
 primary:Readonly<Result>|null;cleanup:Readonly<Result>|null;
}
let active:Session|null=null;
const send=(s:Session,type:string,payload:object={})=>{if(!s.terminal){if(type==='done'||type==='error')s.terminal=true;self.postMessage({version:2,requestId:s.requestId,jobId:s.jobId,type,...payload});}};
const stopped=(s:Session)=>{assertDatabaseUse('read');if(s.cancelled||s.io.signal.aborted)fail('verify','cancelled','cancelled','none');};
const progress=(s:Session,bytes?:number)=>{if(s.batch&&!s.cancelled)send(s,'progress',{progress:localBatchProgress(s.batch,bytes)});};
const remember=(s:Session,f:FailureV1)=>{s.primary??=panelFailure(f);};
const secondary=(s:Session,error:unknown)=>{const o=batchErrorObservation(error);s.cleanup=o.cleanup??o.primary;};
function observation(s:Session):FeatureObservationV1 {
 const state=s.batch?.state;
 const outcome:Result['outcome']=state==='complete'?(s.primary?'recovered':'succeeded'):state==='cancelled'?'cancelled':state==='incomplete'?'partial':'failed';
 const primary=s.primary?{...s.primary,outcome}:state==='complete'?panelSuccess():panelFailure(makeFailure(state==='cancelled'?'verify':'reconcile',state==='cancelled'?'cancelled':'internal',state==='cancelled'?'cancelled':'unknown','none'),outcome);
 return featureObservation(primary,s.cleanup);
}
async function manifest(id:string) {
 try{return await readRecord<unknown>('assets',id);}catch(error){throw manifestError(error);}
}
async function cancel(s:Session) {
 // Invalidate before any await; durable cancellation precedes aborting byte IO.
 s.cancelled=true;s.invalidated.abort();
 if(s.cancelTask)return s.cancelTask;
 if(!s.batch)return;
 s.cancelTask=(async()=>{
 let resolved=false;
 for(let i=0;i<3;i++){
 const b=await readLocalBatch(s.jobId);
 // Preserve this attempt's committed result, never consume a subsequent retry.
 if(b&&b.attempt===s.batch!.attempt&&b.state==='complete'&&b.revision>=s.batch!.revision){s.batch=b;resolved=true;break;}
 if(!b||b.state!=='verifying'||b.owner!==s.batch!.owner||b.operationId!==s.batch!.operationId)break;
 try{s.batch=await updateLocalBatch(b,next=>{next.state='cancelled';next.bytesRead=s.readBytes;next.operationId=null;next.owner=null;for(const e of next.entries)if(e.state==='verifying')e.state='pending';});resolved=true;break;}
 catch(error){if(batchErrorObservation(error).primary.code!=='conflict')throw error;}
 }
 if(!resolved&&s.batch?.state!=='complete'&&s.batch?.state!=='cancelled')throw batchDomainError('storage','reconcile');
 s.io.abort();
 })();
 // Message handler and execute may both await this task; always attach a handler immediately.
 void s.cancelTask.catch(()=>{});return s.cancelTask;
}
async function verify(s:Session,index:number):Promise<LocalEntryState> {
 const a=s.batch!.entries[index].asset;
 let reader:AssetReader|undefined;
 try {
 const now=await manifest(a.id);
 if(now===undefined){remember(s,makeFailure('read','integrity','asset-missing','idb'));return 'missing';}
 const fields=plain(now,Object.keys(a));
 if(fields?.id===a.id&&fields.state==='staged'){remember(s,makeFailure('read','integrity','asset-changed','idb'));return 'changed';}
 if(!validAsset(now)){remember(s,makeFailure('read','integrity','local-corrupt','idb'));return 'invalid';}
 if(!sameLocalAsset(now,a)){remember(s,makeFailure('read','integrity','asset-changed','idb'));return 'changed';}
 stopped(s);reader=await openAssetReader(a);stopped(s);
 const verified=await reader.verifyDetailed(true,{check:()=>stopped(s),onChunk:bytes=>{s.readBytes+=bytes.length;progress(s,s.readBytes);}});
 if(verified.state==='valid'){stopped(s);return 'ready';}
 remember(s,verified.failure);stopped(s);
 if(verified.failure.code==='asset-changed')return 'changed';
 return verified.state==='missing'?'missing':verified.state==='corrupt'?'invalid':'failed';
 }catch(error){
 // manifest() uses a private local wrapper, never inspect arbitrary thrown objects.
 const f=(typeof error==='object'&&error!==null?manifestFailures.get(error):undefined)??fromKnownError(error,{phase:'verify',backend:a.backend});
 remember(s,f);stopped(s);
 return f.code==='asset-changed'?'changed':f.code==='asset-missing'?'missing':['length-mismatch','digest-mismatch','local-corrupt'].includes(f.code)?'invalid':'failed';
 }finally{reader?.release();}
}
const manifestFailures=new WeakMap<object,FailureV1>();
// No recursive cause inspection; the native boundary above alone grants provenance.
function manifestError(error:unknown):Error {const e=new Error('No se pudo leer el manifiesto.');manifestFailures.set(e,fromKnownError(error,{phase:'read',backend:'idb'}));return e;}
function recordRevalidation(s:Session,b:LocalBatch) {
 const first=b.entries.find(e=>e.state==='missing'||e.state==='changed');
 if(first)remember(s,makeFailure('read','integrity',first.state==='missing'?'asset-missing':'asset-changed','idb'));
}
async function execute(s:Session,expectedRevision:number) {
 if(!workerDatabaseRealmCurrent())throw batchDomainError('storage','admit');
 if(!navigator.locks)throw batchDomainError('busy');
 await navigator.locks.request(LOCAL_BATCH_LOCK,{ifAvailable:true},async lock=>{
 if(!lock)throw batchDomainError('busy');
 const initial=await readLocalBatch(s.jobId);
 if(!initial)throw batchDomainError('not-found');
 if(initial.revision!==expectedRevision)throw batchDomainError('conflict');
 if(initial.state!=='queued')throw batchDomainError('retry-required');
 s.batch=await updateLocalBatch(initial,b=>{
 b.attempt++;b.bytesRead=0;b.state=s.cancelled?'cancelled':'verifying';
 b.operationId=s.cancelled?null:crypto.randomUUID();b.owner=s.cancelled?null:crypto.randomUUID();
 });
 if(s.cancelled){await cancel(s);return;}
 progress(s);
 try{
 const verified=new Map<string,LocalEntryState>();
 for(let i=0;i<s.batch.entries.length;i++){
 stopped(s);const asset=s.batch.entries[i].asset;
 s.batch=await updateLocalBatch(s.batch,b=>{b.entries[i].state='verifying';},false,s.invalidated.signal);progress(s);
 let result=verified.get(asset.id);
 if(result===undefined){result=await verify(s,i);verified.set(asset.id,result);}
 stopped(s);const state=result;
 s.batch=await updateLocalBatch(s.batch,b=>{b.entries[i].state=state;b.bytesRead=s.readBytes;},true,s.invalidated.signal);
 recordRevalidation(s,s.batch);progress(s);
 }
 stopped(s);
 s.batch=await updateLocalBatch(s.batch,b=>{b.state=b.entries.every(e=>e.state==='ready')?'complete':'incomplete';b.owner=null;b.operationId=null;},true,s.invalidated.signal);
 recordRevalidation(s,s.batch);progress(s);
 }catch(error){
 if(s.cancelled){const o=batchErrorObservation(error),f=o.primary;if(f.code!=='cancelled'&&f.code!=='transaction-aborted'&&f.code!=='unknown')s.primary??=f;s.cleanup??=o.cleanup;await cancel(s);return;}
 const original=batchErrorObservation(error);s.primary??=original.primary;s.cleanup??=original.cleanup;
 try{
 const current=await readLocalBatch(s.jobId);
 if(current?.state==='verifying'&&current.owner===s.batch?.owner&&current.operationId===s.batch?.operationId){
 s.batch=await updateLocalBatch(current,b=>{b.state='failed';b.bytesRead=s.readBytes;b.owner=null;b.operationId=null;for(const e of b.entries)if(e.state==='verifying')e.state='failed';});
 }else if(current?.state==='complete'&&current.attempt===s.batch?.attempt&&current.revision>=s.batch.revision){s.batch=current;}
 else throw batchDomainError('storage','reconcile');
 }catch(reconcile){secondary(s,reconcile);throw error;}
 }
 });
 if(s.cancelTask)await s.cancelTask;
 send(s,'done',{batch:s.batch,observation:observation(s)});
}
installWorkerDatabaseRealm('batch');
self.onmessage=event=>{if(bindWorkerRealm('batch',event))return;
 const start=plain(event.data,['version','type','requestId','jobId','expectedRevision']);
 const m=start??plain(event.data,['version','type','requestId','jobId']);
 if(!m||m.version!==2||!localBatchUUID(m.requestId)||!localBatchUUID(m.jobId))return;
 if(m.type==='cancel'&&!start){
 const current=active;
 if(current&&current.requestId===m.requestId&&current.jobId===m.jobId)void cancel(current).catch(error=>{secondary(current,error);});
 return;
 }
 if(m.type!=='start'||!start||active||!Number.isSafeInteger(m.expectedRevision)||Number(m.expectedRevision)<=0)return;
 const s:Session={requestId:m.requestId,jobId:m.jobId,cancelled:false,batch:null,terminal:false,invalidated:new AbortController(),io:new AbortController(),cancelTask:null,readBytes:0,primary:null,cleanup:null};active=s;
 void execute(s,Number(m.expectedRevision)).catch(error=>{
 const observed=batchErrorObservation(error);s.primary??=observed.primary;s.cleanup??=observed.cleanup;
 const code=s.primary.code==='owner-unavailable'?'busy':s.primary.code==='conflict'?'conflict':s.primary.code==='retry-required'?'retry-required':'storage';
 send(s,'error',{code,observation:featureObservation({...s.primary,outcome:s.batch?.state==='verifying'?'uncertain':s.primary.outcome},s.cleanup)});
 }).finally(()=>{if(active===s)active=null;});
};
