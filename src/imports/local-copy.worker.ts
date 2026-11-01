import {installWorkerDatabaseRealm,bindWorkerRealm,workerDatabaseRealmCurrent} from '../storage/database-realms';
import {admittedTransaction,closeDatabase} from '../storage/database';
import {AppFailure,fail,fromKnownError,makeFailure,nativeDOMName} from '../errors/app-failure';
import {openAssetReader,type AssetReader,ASSET_DIRECTORY} from '../storage/asset-reader';
import {readRecord,openDatabase,committed} from '../storage/database';
import {checkCopyContext,readInventoryInWorker} from '../library/local-copy-inventory';
import {COPY_LIMITS,copyAsset,sameAsset,parseWorkerRequest,type WorkerReply,type WorkerRequest} from '../library/local-copy-protocol';
// This realm never creates/migrates a DB. Upgrade transaction aborts before schema
// writes; native v3 remains preserved by the common open's VersionError handling.

const scope=globalThis as unknown as DedicatedWorkerGlobalScope;
let identity:{requestId:string;token:string}|null=null,reader:AssetReader|null=null,offset=0,expected=0,state:'idle'|'working'|'credit'|'ack'|'done'='idle',raw:Uint8Array|null=null;
let waiter:{kind:'credit'|'ack';resolve:()=>void;reject:(e:unknown)=>void}|null=null;const abort=new AbortController();
const context={signal:abort.signal,current:()=>state!=='done'&&workerDatabaseRealmCurrent()};
function send(message:Omit<WorkerReply,'version'|'requestId'|'token'>,transfer:Transferable[]=[]){scope.postMessage({version:1,...identity,...message},transfer);}
function cleanup(){state='done';abort.abort();raw=null;reader?.release();reader=null;}
function failure(error:unknown){if(state==='done')return;send({type:'failure',failure:fromKnownError(error,{phase:'read',backend:'none'})} as Omit<WorkerReply,'version'|'requestId'|'token'>);waiter?.reject(error);waiter=null;cleanup();}
function wait(kind:'credit'|'ack'){state=kind;return new Promise<void>((resolve,reject)=>{waiter={kind,resolve,reject};});}
async function run(message:Extract<WorkerRequest,{type:'inventory'}>|Extract<WorkerRequest,{asset:unknown}>){
 identity={requestId:message.requestId,token:message.token};state='working';
 try{
 if(message.type==='inventory'){const inventory=await readInventoryInWorker(context);checkCopyContext(context);send({type:'inventory',inventory} as Omit<WorkerReply,'version'|'requestId'|'token'>);cleanup();return;}
 const asset=message.asset;
 const current=async()=>{checkCopyContext(context);const now=copyAsset(await readRecord('assets',asset.id));if(!now||!sameAsset(asset,now))fail('verify','integrity','asset-changed',asset.backend);checkCopyContext(context);};
 await current();if(message.type==='export'&&asset.bytes>COPY_LIMITS.exportBytes)fail('validate','internal','limit-exceeded',asset.backend);
 // Observe the existing directory/file before acquiring a reader. The reader
 // also opens with create:false after acquiring its generation lock.
 if(asset.backend==='opfs')try{await(await(await navigator.storage.getDirectory()).getDirectoryHandle(ASSET_DIRECTORY,{create:false})).getFileHandle(asset.storageKey,{create:false});}catch(error){if(nativeDOMName(error)==='NotFoundError')fail('verify','integrity','asset-missing','opfs');throw error;}
 reader=await openAssetReader(asset);await current();
 if(asset.backend==='idb'){
 const db=await openDatabase();try{const tx=admittedTransaction(db,'chunks');const done=committed(tx);void done.catch(()=>{});let count=0;
 await new Promise<void>((resolve,reject)=>{const req=tx.objectStore('chunks').openKeyCursor(IDBKeyRange.bound([asset.storageKey],[asset.storageKey,[]]));req.onerror=()=>reject(req.error);req.onsuccess=()=>{try{checkCopyContext(context);const c=req.result;if(!c){if(count!==asset.chunks)fail('verify','integrity','asset-missing','idb');resolve();return;}const k=c.key;if(!Array.isArray(k)||k.length!==2||!Number.isSafeInteger(k[1])||count>=asset.chunks)fail('verify','integrity','length-mismatch','idb');if(k[1]!==count)fail('verify','integrity','asset-missing','idb');count++;c.continue();}catch(error){reject(error);try{tx.abort();}catch{/* settled */}}};});await done;
 }finally{closeDatabase(db);}
 }
 let bytes=0;
 if(message.type==='export')raw=new Uint8Array(asset.bytes);
 const result=await reader.verifyDetailed(true,{check:()=>checkCopyContext(context),onChunk:chunk=>{raw?.set(chunk,bytes);bytes+=chunk.byteLength;send({type:'progress',bytes,total:asset.bytes} as Omit<WorkerReply,'version'|'requestId'|'token'>);}});
 await current();
 if(message.type==='verify'){
 const reply=result.state==='valid'?{availability:'present' as const,integrity:'verified' as const,bytes:asset.bytes,failure:null}:{availability:result.failure.code==='asset-changed'?'changed' as const:result.state,integrity:result.state==='corrupt'?'invalid' as const:'unknown' as const,bytes:asset.bytes,failure:result.failure};
 send({type:'verified',result:reply} as Omit<WorkerReply,'version'|'requestId'|'token'>);cleanup();return;
 }
 if(result.state!=='valid')throw AppFailure.create(result.failure);
 if(bytes!==asset.bytes)fail('verify','integrity','length-mismatch',asset.backend);expected=asset.bytes;offset=0;
 // The single synchronous scan above cannot await. Retain <=8MiB verified bytes,
 // then transfer precisely one 64KiB owned buffer per matching credit.
 let credit=wait('credit');send({type:'start',bytes:expected,mime:asset.mime} as Omit<WorkerReply,'version'|'requestId'|'token'>);await credit;
 while(offset<expected){checkCopyContext(context);const buffer=raw!.slice(offset,Math.min(offset+65536,expected)).buffer;const start=offset;offset+=buffer.byteLength;credit=wait('credit');send({type:'chunk',offset:start,buffer} as Omit<WorkerReply,'version'|'requestId'|'token'>,[buffer]);await credit;}
 raw=null;const ack=wait('ack');send({type:'materialize',bytes:expected} as Omit<WorkerReply,'version'|'requestId'|'token'>);await ack;
 // Keep reader shared lock until Window has constructed the Blob and ACKed it,
 // then revalidate every manifest field before exposing ready.
 state='working';await current();send({type:'ready'});cleanup();
 }catch(error){
 // A failure about bytes is valid only for the captured manifest. A concurrent
 // field change or unreadable end check cannot be relabelled as missing.
 if(message.type!=='inventory'&&!abort.signal.aborted){
 try{checkCopyContext(context);const now=copyAsset(await readRecord('assets',message.asset.id));if(!now||!sameAsset(message.asset,now))error=AppFailure.create(makeFailure('verify','integrity','asset-changed',message.asset.backend));checkCopyContext(context);}catch(endError){error=endError;}
 }
 if(message.type==='verify'&&!abort.signal.aborted){
 const f=fromKnownError(error,{phase:'verify',backend:message.asset.backend});
 send({type:'verified',result:{availability:f.code==='asset-missing'?'missing':f.code==='asset-changed'?'changed':['length-mismatch','digest-mismatch','local-corrupt'].includes(f.code)?'corrupt':'unknown',integrity:['length-mismatch','digest-mismatch','local-corrupt'].includes(f.code)?'invalid':'unknown',bytes:message.asset.bytes,failure:f}} as Omit<WorkerReply,'version'|'requestId'|'token'>);cleanup();
 }else failure(error);
 }
}
installWorkerDatabaseRealm('copies');
scope.onmessage=event=>{if(bindWorkerRealm('copies',event))return;try{const message=parseWorkerRequest(event.data);if(!message)fail('read','internal','worker-protocol','none');
 if(state==='idle'){if(!['inventory','verify','export'].includes(message.type))fail('read','internal','worker-protocol','none');void run(message as Extract<WorkerRequest,{type:'inventory'}>|Extract<WorkerRequest,{asset:unknown}>);return;}
 if(state==='done')return;
 if(message.requestId!==identity?.requestId||message.token!==identity.token)fail('read','internal','worker-protocol','none');
 if(message.type==='cancel'){failure(AppFailure.create(makeFailure('read','cancelled','cancelled','none')));return;}
 if((message.type!=='credit'&&message.type!=='ack')||!waiter||waiter.kind!==message.type||message.offset!==offset||state!==message.type)fail('read','internal','worker-protocol','none');
 const waiting=waiter;waiter=null;state='working';waiting.resolve();
 }catch(error){failure(error);}};
