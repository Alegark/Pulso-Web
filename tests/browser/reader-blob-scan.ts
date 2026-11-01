import {boundedBlobSources,releaseBlobSources,MAX_BLOB_ASSET} from '../../src/playback/blob-source';
import {assetDirectory,generationLock,openAssetReader} from '../../src/storage/asset-reader';
import {openDatabase,writeRecord} from '../../src/storage/database';
import {fail,issuedFailure} from '../../src/errors/app-failure';
import type {LocalAsset} from '../../src/library/library';
interface Probe {
 enabled:boolean;assets:number;chunks:number;opens:number;ranges:number;hashes:number;digests:number;releases:number;verifies:number;
 onOpen?:()=>Promise<void>;onRead?:()=>void;afterRead?:()=>void;onDigest?:()=>void;manifest?:(value:unknown)=>unknown;
}
declare global {var blobScanProbe:Probe;var readerBlobScanReport:unknown;}
const p=globalThis.blobScanProbe={enabled:false,assets:0,chunks:0,opens:0,ranges:0,hashes:0,digests:0,releases:0,verifies:0} as Probe;
const params=new URLSearchParams(location.search),backend=params.get('backend')==='opfs'?'opfs':'idb',name=params.get('case')!;
function assert(ok:unknown,message:string):asserts ok{if(!ok)throw Error(message);}
function reset(){Object.assign(p,{enabled:true,assets:0,chunks:0,opens:0,ranges:0,hashes:0,digests:0,releases:0,verifies:0});}
function counts(){const {assets,chunks,opens,ranges,hashes,digests,releases,verifies}=p;return {assets,chunks,opens,ranges,hashes,digests,releases,verifies};}
async function fixture(){
 const bytes=Uint8Array.from({length:2*65536+37},(_,i)=>(i*17+3)%251);
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const asset:LocalAsset={id:crypto.randomUUID(),namespace:'local',storageKey:crypto.randomUUID(),backend,bytes:bytes.length,sha256,mime:'audio/wav',chunks:3,state:'complete',revision:1,chunkSize:65536,retention:'kept'};
 await changeBytes(asset,bytes);await writeRecord('assets',asset.id,asset);return {asset,bytes};
}
async function changeBytes(asset:LocalAsset,bytes:Uint8Array<ArrayBuffer>){
 if(backend==='opfs'){const handle=await(await assetDirectory()).getFileHandle(asset.storageKey,{create:true});const writer=await handle.createWritable();await writer.write(bytes);await writer.close();}
 else for(let i=0;i<asset.chunks;i++)await writeRecord('chunks',[asset.storageKey,i],bytes.slice(i*65536,(i+1)*65536));
}
async function unlocked(asset:LocalAsset){const c=new AbortController(),timer=setTimeout(()=>c.abort(),3000);try{await navigator.locks.request(generationLock(asset),{mode:'exclusive',signal:c.signal},()=>{});}finally{clearTimeout(timer);}}
async function held(asset:LocalAsset){assert(!(await navigator.locks.request(generationLock(asset),{mode:'exclusive',ifAvailable:true},lock=>Boolean(lock))),'reader lock released early');}
let hostileTouches=0;
const hostile=()=>new Proxy({}, {get(){hostileTouches++;throw Error('PRIVATE_CANARY');},getPrototypeOf(){hostileTouches++;throw Error('PRIVATE_CANARY');}});
async function code(work:()=>Promise<unknown>,expected:string){let error:unknown;try{await work();}catch(e){error=e;}assert(issuedFailure(error)?.code===expected,`expected ${expected}, got ${issuedFailure(error)?.code}`);return issuedFailure(error);}
const cases:Record<string,()=>Promise<unknown>>={};
cases['scan-valid']=async()=>{
 const {asset,bytes}=await fixture();reset();let fileOpens=0;const get=FileSystemFileHandle.prototype.getFile;
 FileSystemFileHandle.prototype.getFile=async function(){fileOpens++;return get.call(this);};
 const reader=await openAssetReader(asset);let chunks=0,total=0;const consumptionLocks:Promise<unknown>[]=[];
 try{const result=await reader.verifyDetailed(true,{check(){assert(p.releases===0,'released in check');},onChunk(chunk){chunks++;total+=chunk.length;consumptionLocks.push(held(asset));}});assert(result.state==='valid','scan invalid');await Promise.all(consumptionLocks);await held(asset);}
 finally{reader.release();FileSystemFileHandle.prototype.getFile=get;}
 assert(chunks===3&&total===bytes.length,'consumption count');assert(p.ranges===3&&p.hashes===1&&p.digests===1,'extra pass/hash');assert(fileOpens===(backend==='opfs'?1:0),'file reopened');await unlocked(asset);return {...counts(),fileOpens,chunks,total};
};
for(const mode of ['guard-issued-corrupt','consumer-issued-corrupt','guard-unknown','guard-cancel','consumer-unknown','consumer-hostile','consumer-dom','late-cancel','final-cancel','presence-callback','presence-check'])cases[mode]=async()=>{
 const {asset}=await fixture();const reader=await openAssetReader(asset);reset();let consumed=0;
 try{
 const result=await reader.verifyDetailed(!mode.startsWith('presence'),{
 check(){if(mode==='guard-issued-corrupt')fail('read','integrity','asset-missing',backend);if(mode==='guard-unknown')throw hostile();if(mode==='guard-cancel'||mode==='late-cancel'&&consumed===1||mode==='final-cancel'&&p.digests===1)fail('verify','cancelled','cancelled',backend);},
 ...mode==='presence-check'?{}:{onChunk(){consumed++;if(mode==='consumer-issued-corrupt')fail('read','integrity','digest-mismatch',backend);if(mode==='consumer-unknown')throw Error('PRIVATE_CANARY');if(mode==='consumer-hostile')throw hostile();if(mode==='consumer-dom')throw new DOMException('PRIVATE_CANARY','NotFoundError');}}
 });
 const expected=mode==='presence-check'?null:mode==='presence-callback'?'input-invalid':mode.includes('cancel')?'cancelled':'unknown';
 assert(expected?result.state==='unknown'&&result.failure.code===expected:result.state==='valid','callback result incorrect');
 await held(asset);assert(p.releases===0,'released on scan outcome');
 if(mode==='presence-callback')assert(p.ranges===0,'presence callback read bytes');
 if(mode==='late-cancel')assert(consumed===1&&p.ranges===1,'late cancellation continued');
 if(mode==='guard-cancel'||mode==='guard-unknown')assert(p.ranges===0,'initial guard ignored');
 return {...counts(),consumed,result};
 }finally{reader.release();await unlocked(asset);}
};
cases['legacy-default-boolean']=async()=>{
 const {asset,bytes}=await fixture();let reader=await openAssetReader(asset);reset();
 try{assert(await reader.verify()===true,'SW call-shape verify() lost valid boolean');assert(p.hashes===1&&p.digests===1&&p.ranges===3,'legacy default not single-pass integrity');await held(asset);}finally{reader.release();}
 await unlocked(asset);bytes[0]^=1;await changeBytes(asset,bytes);reader=await openAssetReader(asset);
 try{assert(await reader.verify()===false,'SW call-shape verify() lost corrupt false');await held(asset);}finally{reader.release();}
 await unlocked(asset);return {call:'reader.verify()',valid:true,corrupt:false,actualServiceWorkerRun:false};
};
const proof=`pulso-web:local:owner:${crypto.randomUUID()}`;
const owner=(work:()=>Promise<unknown>)=>navigator.locks.request('pulso-web:local:playback',()=>navigator.locks.request(proof,work));
for(const mode of ['blob-valid','blob-occurrences','blob-missing','blob-short','blob-long','blob-corrupt','manifest-missing','manifest-invalid','manifest-mismatch','manifest-hostile','io-unknown','io-denied','generation-changed','budget-file','budget-queue','current-before','current-read','current-digest','current-url','current-manifest','url-failure','blob-failure','owner-invalid','owner-mismatch','current-open','native-io-unknown','native-io-denied','current-throw','current-hostile'])cases[mode]=async()=>{
 const {asset,bytes}=await fixture();let active=true;let touched=0;const original=URL.createObjectURL,revoke=URL.revokeObjectURL,BlobNative=Blob;
 const previous=original(new Blob(['previous']));const created:string[]=[],revoked:string[]=[];
 URL.createObjectURL=function(blob){if(mode==='url-failure'&&created.length===1)throw hostile();const url=original(blob);created.push(url);if(mode==='current-url')active=false;return url;};
 URL.revokeObjectURL=function(url){revoked.push(url);revoke(url);};
 if(mode==='blob-failure')globalThis.Blob=new Proxy(Blob,{construct(){throw new DOMException('PRIVATE_CANARY','InvalidStateError');}});
 if(mode==='blob-missing'){
 if(backend==='opfs')await(await assetDirectory()).removeEntry(asset.storageKey);
 else {const db=await openDatabase();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('chunks','readwrite');tx.objectStore('chunks').delete([asset.storageKey,1]);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();}
 }
 if(mode==='blob-short'||mode==='blob-long'){const next=new Uint8Array(bytes.length+(mode==='blob-long'?1:-1));next.set(bytes.subarray(0,next.length));await changeBytes(asset,next);}
 if(mode==='blob-corrupt'){bytes[0]^=1;await changeBytes(asset,bytes);}
 if(mode==='manifest-invalid')await writeRecord('assets',asset.id,{...asset,backend:'bad'});
 if(mode==='manifest-mismatch')await writeRecord('assets',asset.id,{...asset,id:crypto.randomUUID()});
 if(mode==='manifest-hostile')p.manifest=()=>Object.defineProperty({...asset},'backend',{get(){touched++;throw hostile();}});
 if(mode==='manifest-missing')p.manifest=()=>undefined;
 if(mode==='budget-file'||mode==='budget-queue')await writeRecord('assets',asset.id,{...asset,bytes:mode==='budget-file'?MAX_BLOB_ASSET+1:MAX_BLOB_ASSET,chunks:Math.ceil((mode==='budget-file'?MAX_BLOB_ASSET+1:MAX_BLOB_ASSET)/65536)});
 if(mode==='io-unknown'||mode==='io-denied')p.onRead=()=>{throw mode==='io-unknown'?hostile():new DOMException('PRIVATE_CANARY','SecurityError');};
 if(mode==='current-read')p.afterRead=()=>{active=false;};
 if(mode==='current-digest')p.onDigest=()=>{active=false;};
 if(mode==='current-manifest')p.manifest=value=>{active=false;return value;};
 if(mode==='generation-changed')p.onOpen=async()=>{await writeRecord('assets',asset.id,{...asset,revision:2});};
 const nativeGet=IDBObjectStore.prototype.get,nativeBuffer=BlobNative.prototype.arrayBuffer,nativeQuery=navigator.locks.query;
 if(mode.startsWith('native-io-')){
 const fault=()=>{throw mode==='native-io-unknown'?hostile():new DOMException('PRIVATE_CANARY','SecurityError');};
 if(backend==='idb')IDBObjectStore.prototype.get=function(...args){if(this.name==='chunks')fault();return nativeGet.apply(this,args);};
 else BlobNative.prototype.arrayBuffer=async function(){return fault();};
 }
 if(mode==='current-open')p.onOpen=async()=>{active=false;};
 if(mode==='owner-mismatch')navigator.locks.query=async()=>{const snapshot=await nativeQuery.call(navigator.locks);return {...snapshot,held:snapshot.held?.map(lock=>lock.name===proof?{...lock,clientId:'other-client'}:lock)};};
 reset();let writes=0,fileWrites=0;const tx=IDBDatabase.prototype.transaction,writable=FileSystemFileHandle.prototype.createWritable;
 FileSystemFileHandle.prototype.createWritable=function(...args){fileWrites++;return writable.apply(this,args);};
 IDBDatabase.prototype.transaction=function(...args:Parameters<IDBDatabase['transaction']>){if(args[1]==='readwrite')writes++;return tx.apply(this,args);};
 try{
 if(mode==='current-before')active=false;
 const ids=Array.from({length:mode==='budget-queue'?4:mode==='blob-occurrences'?3:mode==='url-failure'?2:1},()=>asset.id);
 const work=()=>boundedBlobSources(ids,mode==='owner-invalid'?'absent':proof,()=>{if(mode==='current-throw')throw Error('PRIVATE_CANARY');if(mode==='current-hostile')throw hostile();return active;});
 if(mode==='blob-valid'||mode==='blob-occurrences'){
 const urls=await owner(work) as string[];assert(urls.length===ids.length,'occurrences lost');
 for(const url of urls){const received=new Uint8Array(await(await fetch(url)).arrayBuffer());assert(received.length===bytes.length&&received.every((v,i)=>v===bytes[i]),'URL bytes differ');const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',received)),b=>b.toString(16).padStart(2,'0')).join('');assert(digest===asset.sha256,'URL hash differs');}
 assert(p.verifies===ids.length&&p.hashes===ids.length&&p.digests===ids.length&&p.ranges===3*ids.length,'extra materialization pass');releaseBlobSources(urls);
 }else{
 const expected=mode==='current-throw'||mode==='current-hostile'?'unknown':mode.startsWith('current-')||(mode==='owner-invalid'||mode==='owner-mismatch')?'owner-unavailable':mode.startsWith('budget-')?'limit-exceeded':mode==='blob-missing'||mode==='manifest-missing'?'asset-missing':mode==='blob-short'||mode==='blob-long'?'length-mismatch':mode==='blob-corrupt'?'digest-mismatch':mode.startsWith('manifest-')?'local-corrupt':(mode==='io-denied'||mode==='native-io-denied')?'storage-denied':mode==='generation-changed'?'asset-changed':mode==='blob-failure'?'storage-unavailable':'unknown';
 const failure=await code(()=>owner(work),expected);
 if(mode.startsWith('native-io-'))assert(failure?.phase==='read'&&failure.backend===backend,'native IO boundary lost');
 if(mode==='url-failure'||mode==='blob-failure')assert(failure?.phase==='transport'&&failure.backend==='none','materialization called storage corruption');
 assert(created.every(url=>revoked.includes(url)),'failed attempt URL leaked');
 if(mode.startsWith('budget-')||mode.startsWith('manifest-'))assert(p.ranges===0&&p.opens===0,'preflight read bytes');
 if(mode==='current-read')assert(p.ranges===1,'continued after ownership loss');
 }
 assert(!revoked.includes(previous),'previous URL revoked');assert(await(await fetch(previous)).text()==='previous','previous source changed');assert(touched===0,'hostile getter read');
 assert(writes===(mode==='generation-changed'?1:0)&&fileWrites===0,'read-only flow wrote storage');assert(p.opens===p.releases,'reader leak');await unlocked(asset);return {...counts(),writes,fileWrites,created:created.length,revoked:revoked.length};
 }finally{IDBDatabase.prototype.transaction=tx;FileSystemFileHandle.prototype.createWritable=writable;IDBObjectStore.prototype.get=nativeGet;BlobNative.prototype.arrayBuffer=nativeBuffer;navigator.locks.query=nativeQuery;URL.createObjectURL=original;URL.revokeObjectURL=revoke;globalThis.Blob=BlobNative;revoke(previous);created.forEach(revoke);}
};
try{assert(cases[name],'unknown test case');const details=await cases[name]();assert(hostileTouches===0,'hostile cause inspected');globalThis.readerBlobScanReport={name,backend,passed:true,details};}
catch(error){globalThis.readerBlobScanReport={name,backend,passed:false,error:error instanceof Error?error.message:'unknown test failure',counts:counts()};}
document.querySelector('#results')!.textContent=JSON.stringify(globalThis.readerBlobScanReport,null,2);
