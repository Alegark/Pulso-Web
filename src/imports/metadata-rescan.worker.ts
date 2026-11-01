/// <reference lib="webworker" />
import {installWorkerDatabaseRealm,bindWorkerRealm,workerDatabaseRealmCurrent} from '../storage/database-realms';
import {admittedTransaction,closeDatabase,openDatabase,readRecord} from '../storage/database';
import {transactionDone} from '../storage/transaction-done';
import {openAssetReader,type AssetReader} from '../storage/asset-reader';
import {AppFailure,fail,fromKnownError} from '../errors/app-failure';
import {copyAsset,sameAsset} from '../library/local-copy-protocol';
import {copyMetadataRescanRequest,METADATA_RESCAN_LIMIT,type MetadataRescanWorkerReply} from '../library/metadata-rescan-protocol';
import {inspectLocalAlbumFile} from './inspect-local-album';
const scope=globalThis as unknown as DedicatedWorkerGlobalScope;
let identity:{requestId:string;token:string}|null=null,reader:AssetReader|null=null,state:'idle'|'working'|'ack'|'done'='idle';
function check(){if(state==='done'||!workerDatabaseRealmCurrent())fail('read','internal','owner-unavailable','none');}
function send(body:unknown){scope.postMessage({version:1,...identity,...body as object} satisfies Partial<MetadataRescanWorkerReply>);}
function cleanup(){state='done';reader?.release();reader=null;}
function failure(error:unknown){if(state==='done')return;try{send({type:'failure',failure:fromKnownError(error,{phase:'read',backend:'none'})});}finally{cleanup();}}
async function run(asset:NonNullable<ReturnType<typeof copyAsset>>){
 try{
 check();if(asset.bytes>METADATA_RESCAN_LIMIT)fail('validate','internal','limit-exceeded',asset.backend);
 const current=async()=>{check();const a=copyAsset(await readRecord('assets',asset.id));check();if(!a||!sameAsset(a,asset))fail('verify','integrity','asset-changed',asset.backend);};
 await current();reader=await openAssetReader(asset);check();await current();
 if(asset.backend==='idb'){
 const db=await openDatabase();try{
 const tx=admittedTransaction(db,'chunks'),done=transactionDone(tx);let count=0;
 try{await new Promise<void>((resolve,reject)=>{const r=tx.objectStore('chunks').openKeyCursor(IDBKeyRange.bound([asset.storageKey],[asset.storageKey,[]]));r.onerror=()=>reject(r.error);r.onsuccess=()=>{try{check();const c=r.result;if(!c){if(count!==asset.chunks)fail('verify','integrity','asset-missing','idb');resolve();return;}const k=c.key;if(!Array.isArray(k)||k.length!==2||!Number.isSafeInteger(k[1])||count>=asset.chunks)fail('verify','integrity','length-mismatch','idb');if(k[1]!==count)fail('verify','integrity','asset-missing','idb');count++;c.continue();}catch(e){reject(e);try{tx.abort();}catch{/* settled */}}};});await done;}catch(e){try{tx.abort();}catch{/* settled */}await done.catch(()=>{});throw e;}
 }finally{closeDatabase(db);}
 }
 let raw:Uint8Array<ArrayBuffer>|null=new Uint8Array(asset.bytes),bytes=0,last=0;
 const verified=await reader.verifyDetailed(true,{check,onChunk:chunk=>{raw!.set(chunk,bytes);bytes+=chunk.byteLength;const now=performance.now();if(bytes===asset.bytes||now-last>=100){last=now;send({type:'progress',bytes,total:asset.bytes});}}});
 check();if(verified.state!=='valid'){if(verified.failure.family==='integrity')await current();throw AppFailure.create(verified.failure);}if(bytes!==asset.bytes)fail('verify','integrity','length-mismatch',asset.backend);await current();
 send({type:'parsing'});const file=new File([raw],'local-audio',{type:asset.mime});raw=null;
 const localAlbum=await inspectLocalAlbumFile(file,asset.mime as 'audio/mpeg'|'audio/mp4'|'audio/wav',check);await current();check();
 state='ack';send({type:'candidate',asset,localAlbum});
 // Reader's shared generation lock belongs to the DOM transaction settlement.
 // Only terminal ACK or termination releases it; candidate is not settlement.
 }catch(error){failure(error);}
}
installWorkerDatabaseRealm('copies');
scope.onmessage=event=>{
 if(bindWorkerRealm('copies',event))return;
 try{
 const m=copyMetadataRescanRequest(event.data);if(!m)fail('transport','internal','worker-protocol','none');
 if(state==='idle'){check();if(m.type!=='inspect')fail('transport','internal','worker-protocol','none');identity={requestId:m.requestId,token:m.token};state='working';void run(m.asset);return;}
 if(state==='done')return;
 if(m.requestId!==identity?.requestId||m.token!==identity.token)fail('transport','internal','worker-protocol','none');
 if(m.type==='cancel'){cleanup();return;}
 if(m.type!=='ack'||state!=='ack')fail('transport','internal','worker-protocol','none');cleanup();
 }catch(error){failure(error);}
};
