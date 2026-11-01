import {beginWorkerAttempt,type RealmAttempt} from '../storage/database-realms';
import {AppFailure,fail,fromKnownError,makeFailure} from '../errors/app-failure';
import {checkCopyContext,type CopyContext,type ExportProgress} from './local-copy-inventory';
import {COPY_LIMITS,parseWorkerReply,type WorkerRequest,type RawInventory,type CopyVerificationV1} from './local-copy-protocol';
import type {LocalAsset} from './library';
type Result={kind:'inventory';inventory:RawInventory}|{kind:'verified';result:CopyVerificationV1}|{kind:'export';blob:Blob};
/** One worker per attempt. The module has no Player, ticket or URL ownership. */
export function runCopyWorker(type:'inventory'|'verify'|'export',asset:LocalAsset|null,context:CopyContext & {onProgress?:(progress:ExportProgress)=>void}):Promise<Result> {
 checkCopyContext(context);
 return new Promise((resolve,reject)=>{
 let realm:RealmAttempt|null=null;
 const requestId=crypto.randomUUID(),token=crypto.randomUUID();let worker:Worker|null=null,settled=false,state:'initial'|'chunks'|'materialized'='initial',offset=0,verifiedOffset=0,blob:Blob|null=null;const chunks:ArrayBuffer[]=[];
 const stop=()=>{clearInterval(watch);context.signal.removeEventListener('abort',cancel);if(worker){worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();worker=null;}realm?.closeAfterSettlement();chunks.length=0;};
 const failed=(error:unknown)=>{if(settled)return;settled=true;stop();reject(AppFailure.create(fromKnownError(error,{phase:'read',backend:asset?.backend??'none'})));};
 const cancel=()=>failed(AppFailure.create(makeFailure('read','cancelled','cancelled','none')));
 // Scope can change without an AbortSignal. Poll only this attempt; every message
 // and final publication also rechecks synchronously. No timer owns user data.
 const watch=setInterval(()=>{try{checkCopyContext(context);}catch(error){failed(error);}},25);
 const post=(message:WorkerRequest)=>{worker!.postMessage(message);};
 const control=(kind:'credit'|'ack')=>post({version:1,requestId,token,type:kind,offset});
 const protocol=():never=>fail('read','internal','worker-protocol','none');
 const progress=(phase:'verify'|'compose',bytes:number,total:number)=>{try{context.onProgress?.({phase,bytes,total});}catch{/* Observer has no authority over result or resources. */}};
 context.signal.addEventListener('abort',cancel,{once:true});
 try{
 worker=new Worker(new URL('../imports/local-copy.worker.ts',import.meta.url),{type:'module'});
 worker.onerror=event=>{event.preventDefault();failed(AppFailure.create(makeFailure('read','internal','worker-failed','none')));};
 worker.onmessageerror=()=>failed(AppFailure.create(makeFailure('read','internal','worker-protocol','none')));
 worker.onmessage=event=>{if(settled)return;try{
 checkCopyContext(context);if(!realm?.current())throw AppFailure.create(makeFailure('read','storage-unavailable','storage-unavailable','idb'));const message=parseWorkerReply(event.data);if(!message||message.requestId!==requestId||message.token!==token)throw AppFailure.create(makeFailure('read','internal','worker-protocol','none'));
 switch(message.type){
 case 'failure':throw AppFailure.create(message.failure);
 case 'inventory':if(type!=='inventory'||state!=='initial')protocol();settled=true;stop();resolve({kind:'inventory',inventory:message.inventory});break;
 case 'verified':if(type!=='verify'||state!=='initial'||message.result.bytes!==asset!.bytes)protocol();settled=true;stop();resolve({kind:'verified',result:message.result});break;
 case 'progress':if(type==='inventory'||state!=='initial'||message.total!==asset!.bytes||message.bytes<=verifiedOffset)protocol();verifiedOffset=message.bytes;progress('verify',message.bytes,message.total);break;
 case 'start':if(type!=='export'||state!=='initial'||message.bytes!==asset!.bytes||message.mime!==asset!.mime||verifiedOffset!==asset!.bytes)protocol();state='chunks';control('credit');break;
 case 'chunk':if(type!=='export'||state!=='chunks'||message.offset!==offset||message.buffer.byteLength!==Math.min(COPY_LIMITS.chunkBytes,asset!.bytes-offset))protocol();chunks.push(message.buffer);offset+=message.buffer.byteLength;progress('compose',offset,asset!.bytes);checkCopyContext(context);control('credit');break;
 case 'materialize':if(type!=='export'||state!=='chunks'||offset!==asset!.bytes||message.bytes!==offset)protocol();blob=new Blob(chunks,{type:asset!.mime});chunks.length=0;if(blob.size!==offset)protocol();state='materialized';checkCopyContext(context);control('ack');break;
 case 'ready':if(type!=='export'||state!=='materialized'||!blob)protocol();checkCopyContext(context);settled=true;stop();resolve({kind:'export',blob:blob!});break;
 }
 }catch(error){failed(error);}};
 void beginWorkerAttempt('copies',worker,()=>!settled&&!context.signal.aborted&&context.current()).then(attempt=>{
 if(settled){attempt.closeAfterSettlement();return;}realm=attempt;realm.onTransportFailure(code=>failed(AppFailure.create(makeFailure('transport','internal',code,'none'))));
 try{checkCopyContext(context);if(!realm.current())throw AppFailure.create(makeFailure('read','storage-unavailable','storage-unavailable','idb'));if(type==='inventory')post({version:1,requestId,token,type});else post({version:1,requestId,token,type,asset:asset!});}catch(error){failed(error);}
 },failed);
 }catch(error){failed(error);}
 });
}
