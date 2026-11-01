import {assertDatabaseTransport,reportDatabaseTransportNotice} from './database-transport';
import {AppFailure,makeFailure,nativeDOMName,fromKnownError,issuedFailure} from '../errors/app-failure';
import {boundedBlobSources,prepareBoundedBlobSources,blobSourceProvenance,blobCleanupUncertain} from './blob-source';
import {readRecord,subscribeDatabaseLifecycle} from '../storage/database';
import {openAssetReader,type AssetReader} from '../storage/asset-reader';
import {copySourceAsset,copySourceAssets,copySourceReply,sameSourceAsset,copySourceIds,sourceProof,type PreparedLocalSources,type PreparedLocalSource,type SourceReply,type PinnedRequest,type ReleaseRequest,type SourceAllocation,type SourcePreparationControl,type LocalSourcePreparation,type SourcePreparationResult} from './local-source-protocol';
export type {PreparedLocalSources,PreparedLocalSource,SourcePreparationControl,LocalSourcePreparation,SourcePreparationResult,NewSourceBundle} from './local-source-protocol';
export let transportNotice='';
let workerUnavailable=false;
const capabilityChecks=new WeakMap<ServiceWorker,Promise<boolean>>();
function supportsLocalAssets(controller:ServiceWorker):Promise<boolean>{
 let check=capabilityChecks.get(controller);if(check)return check;
 check=new Promise(resolve=>{
 const channel=new MessageChannel();const finish=(supported:boolean)=>{clearTimeout(timer);channel.port1.close();resolve(supported);};
 const timer=window.setTimeout(()=>finish(false),1500);
 channel.port1.onmessage=event=>{const m=event.data;finish(m?.version===1&&m.type==='transport-capabilities'&&m.readerProtocol==='local-assets-v1'&&Array.isArray(m.backends)&&['idb','opfs'].every(backend=>m.backends.includes(backend)));};
 try{controller.postMessage({version:1,type:'transport-capabilities'},[channel.port2]);}catch{finish(false);}
 });capabilityChecks.set(controller,check);return check;
}
type TicketReply={tokens:string[]}|{status:403|503;notice:unknown};
function copyTicketReply(value:unknown,count:number):TicketReply|null {
 try{
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return null;
 const descriptors=Object.getOwnPropertyDescriptors(value),m:Record<string,unknown>={};
 for(const key of Reflect.ownKeys(descriptors)){if(typeof key!=='string'||!('value'in descriptors[key]))return null;m[key]=descriptors[key].value;}
 if(m.version!==1)return null;
 if(Object.keys(m).length===2&&Array.isArray(m.tokens)&&m.tokens.length===count&&m.tokens.every((token:unknown)=>typeof token==='string'&&/^[a-f0-9-]{36}$/.test(token)))return {tokens:[...m.tokens]};
 if(typeof m.error!=='string'||Object.keys(m).some(key=>!['version','error','status','notice'].includes(key))||m.status!==undefined&&m.status!==403&&m.status!==503)return null;
 return {status:m.status===403?403:503,notice:m.notice};
 }catch{return null;}
}
async function localController(check:()=>void,strict=false):Promise<ServiceWorker|null> {
 transportNotice='';
 if(workerUnavailable||!navigator.serviceWorker){transportNotice='Modo compatible para archivos pequeños. El inicio sin conexión no está disponible en este enlace.';return null;}
 let registration=await navigator.serviceWorker.getRegistration();
 check();
 if(!registration){try{registration=await navigator.serviceWorker.register('/sw.js',{type:'module'});}catch(error){check();if(strict&&['SecurityError','NotAllowedError'].includes(nativeDOMName(error)??''))throw AppFailure.create(fromKnownError(error,{phase:'transport',backend:'none'}));workerUnavailable=true;transportNotice='Modo compatible para archivos pequeños. El inicio sin conexión no está disponible en este enlace.';return null;}}
 check();await navigator.serviceWorker.ready;check();
 if(!navigator.serviceWorker.controller)await new Promise<void>((resolve,reject)=>{
 const handler=()=>{clearTimeout(timer);resolve();};const timer=window.setTimeout(()=>{navigator.serviceWorker.removeEventListener('controllerchange',handler);reject(new Error('Recarga para activar el transporte local.'));},10000);navigator.serviceWorker.addEventListener('controllerchange',handler,{once:true});
 });
 const controller=navigator.serviceWorker.controller!;
 const supported=await supportsLocalAssets(controller);check();
 if(controller!==navigator.serviceWorker.controller)throw new Error('El transporte local cambió.');
 if(!supported){
 // An old/temporarily unavailable controller cannot attest to the new storage contract.
 // Request an ordinary update; activation still waits for existing clients to close.
 void registration?.update().catch(()=>{});
 transportNotice='Modo compatible para archivos pequeños. Cierra las otras pestañas de Pulso y vuelve a abrir para intentar la versión actualizada. El inicio sin conexión no está comprobado en este modo.';
 return null;
 }
 return controller;
}
export async function localTickets(assetIds:string[],ownerProof:string,current:()=>boolean=()=>true):Promise<string[]> {
 const check=()=>{assertDatabaseTransport();if(!current())throw new Error('El control de reproducción cambió.');};check();
 const blob=()=>boundedBlobSources(assetIds,ownerProof,()=>{assertDatabaseTransport();return current();});
 const controller=await localController(check);if(!controller)return blob();
 check();const channel=new MessageChannel();
 return new Promise((resolve,reject)=>{
 const timer=window.setTimeout(()=>{channel.port1.close();reject(new Error('El transporte local no responde.'));},10000);
 channel.port1.onmessage=event=>{
 clearTimeout(timer);channel.port1.close();channel.port2.close();
 if(!current()||controller!==navigator.serviceWorker.controller){reject(new Error('El control de reproducción cambió.'));return;}
 const reply=copyTicketReply(event.data,assetIds.length);
 if(!reply){reject(AppFailure.create(makeFailure('transport','internal','worker-protocol','none')));return;}
 if('notice'in reply)reportDatabaseTransportNotice(reply.notice);
 try{check();}catch(error){reject(error);return;}
 if('tokens'in reply)resolve(reply.tokens.map(token=>new URL(`/_pulso/media/${token}`,location.origin).href));
 else reject(AppFailure.create(makeFailure('open',reply.status===403?'internal':'storage-unavailable',reply.status===403?'owner-unavailable':'storage-unavailable','idb')));
 };
 try{controller.postMessage({version:1,type:'fixture-tickets',ownerProof,assetIds},[channel.port2]);}catch{clearTimeout(timer);channel.port1.close();channel.port2.close();reject(new Error('El transporte local no responde.'));}
 });
}

/** Root owns queue admission; these snapshots describe only this bundle. */
export async function prepareLocalSources(assetIds:string[],ownerProof:string,current:()=>boolean=()=>true,control?:SourcePreparationControl):Promise<PreparedLocalSources> {
 if(control){
  const ids=copySourceIds(assetIds);if(!ids||!sourceProof(ownerProof))throw AppFailure.create(makeFailure('validate','internal','input-invalid','none'));
  const expected=[];
  for(const id of ids){
   assertDatabaseTransport();if(!current()||control.signal.aborted||!control.current())throw AppFailure.create(makeFailure('transport','cancelled','cancelled','none'));
   const asset=copySourceAsset(await readRecord<unknown>('assets',id));
   if(!asset||asset.id!==id)throw AppFailure.create(makeFailure('read','integrity','asset-missing','idb'));expected.push(asset);
  }
  const attempt=startLocalSourcePreparation(expected,ownerProof,{...control,current:()=>current()&&control.current()});
  const result=await attempt.result;
  if(result.kind==='prepared')return result.prepared.bundle;
  await attempt.settled;
  throw AppFailure.create(result.kind==='failed'?result.failure:makeFailure('transport','cancelled','cancelled','none'));
 }

 const ids=copySourceIds(assetIds);if(!ids||!sourceProof(ownerProof))throw AppFailure.create(makeFailure('validate','internal','input-invalid','none'));
 assetIds=ids;
 let stale=false;const container=navigator.serviceWorker;let claimed=!!container?.controller;
 const change=()=>{if(claimed)stale=true;claimed=true;};const unsubscribe=subscribeDatabaseLifecycle(()=>{stale=true;});
 const watching=!!container;if(watching)container.addEventListener('controllerchange',change);
 const check=()=>{assertDatabaseTransport();if(stale||!current())throw AppFailure.create(makeFailure('transport','internal','owner-unavailable','none'));};
 try{
 check();const controller=await localController(check,true);check();
 if(!controller)return await prepareBoundedBlobSources(assetIds,ownerProof,()=>{check();return true;});
 // Initial claim is allowed. ANY subsequent event invalidates even A -> B -> A.

 const supported=await new Promise<boolean>((resolve,reject)=>{
 const channel=new MessageChannel();let settled=false;
 const finish=(result:boolean,error?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);channel.port1.close();channel.port2.close();error?reject(error):resolve(result);};
 const timer=window.setTimeout(()=>finish(false),1500);
 channel.port1.onmessage=event=>{try{check();if(controller!==container.controller)throw new Error('El transporte local cambió.');const m=event.data;finish(m?.version===1&&m.type==='transport-capabilities'&&m.physicalSources===1);}catch(error){finish(false,error);}};
 try{controller.postMessage({version:1,type:'transport-capabilities'},[channel.port2]);}catch(error){finish(false,error);}
 });check();if(controller!==container.controller)throw new Error('El transporte local cambió.');
 if(!supported)return await prepareBoundedBlobSources(assetIds,ownerProof,()=>{check();return true;});
 const expected:NonNullable<ReturnType<typeof copySourceAsset>>[]=[];
 for(const id of assetIds){check();const record=await readRecord<unknown>('assets',id);check();const asset=copySourceAsset(record);if(!asset||asset.id!==id)throw AppFailure.create(makeFailure('read','integrity',record===undefined?'asset-missing':'local-corrupt','idb'));expected.push(asset);}
 const requestId=crypto.randomUUID(),tokens=assetIds.map(()=>crypto.randomUUID());
 const release=async()=>{const reply=await physicalSourceRPC(controller,{version:1,type:'release-local-sources',requestId,ownerProof,tokens});if(!('released'in reply))throw AppFailure.create(makeFailure('transport','internal','worker-protocol','none'));};
 try{
 const reply=await physicalSourceRPC(controller,{version:1,type:'pinned-local-sources',requestId,ownerProof,expected,tokens});
 if('notice'in reply)reportDatabaseTransportNotice(reply.notice);
 check();if(controller!==container.controller)throw new Error('El transporte local cambió.');
 if('status'in reply)throw AppFailure.create(makeFailure('transport',reply.cause==='worker-protocol'||reply.cause==='owner-unavailable'?'internal':reply.status===409?'integrity':'storage-unavailable',reply.cause,'idb'));
 if(!('assets'in reply)||!sameTokens(reply.tokens,tokens)||reply.assets.length!==expected.length||reply.assets.some((asset,i)=>!sameSourceAsset(asset,expected[i])))throw AppFailure.create(makeFailure('transport','internal','worker-protocol','none'));
 const sources:PreparedLocalSource[]=reply.assets.map((asset,i)=>Object.freeze({url:new URL(`/_pulso/media/${tokens[i]}`,location.origin).href,protection:'pinned',asset}));
 let released:Promise<void>|undefined;const bundle=Object.freeze({sources:Object.freeze(sources),release:()=>released??=(release())});
 attestSW(bundle,()=>released===undefined);return bundle;
 }catch(error){await release();throw error;}
 }finally{unsubscribe();if(watching)container.removeEventListener('controllerchange',change);}
}
function sameTokens(a:string[],b:string[]):boolean {return a.length===b.length&&a.every((token,i)=>token===b[i]);}

const swProvenance=new WeakMap<PreparedLocalSources,Readonly<{allocations:readonly SourceAllocation[];current():boolean}>>();
function attestSW(bundle:PreparedLocalSources,current:()=>boolean){
 swProvenance.set(bundle,Object.freeze({allocations:Object.freeze(bundle.sources.map((s,i)=>Object.freeze({sourceIndex:i,allocationId:s.url,kind:'sw' as const,bytes:0}))),current}));
}
/** A lookup only. No caller-supplied JSON can attest an allocation or bundle. */
export function preparedSourceProvenance(bundle:PreparedLocalSources){return swProvenance.get(bundle)??blobSourceProvenance(bundle);}

/** Physical RPC retains its receiving channel until a valid terminal reply. No
 * clock closes a possibly live pin request. Unknown replies cannot prove absence
 * of tickets; the document conservatively retains custody in that case. */
function physicalSourceRPC(controller:ServiceWorker,message:PinnedRequest|ReleaseRequest):Promise<SourceReply>{
 return new Promise((resolve,reject)=>{
  const channel=new MessageChannel();let terminal=false;
  channel.port1.onmessage=event=>{
   if(terminal)return;
   const reply=copySourceReply(event.data,message.type,message.requestId);if(!reply)return;
   if(message.type==='pinned-local-sources'&&'assets'in reply&&(!sameTokens(reply.tokens,message.tokens)||reply.assets.length!==message.expected.length||reply.assets.some((a,i)=>!sameSourceAsset(a,message.expected[i]))))return;
   terminal=true;channel.port1.close();channel.port2.close();resolve(reply);
  };
  try{controller.postMessage(message,[channel.port2]);}
  catch(error){terminal=true;channel.port1.close();channel.port2.close();reject(error);}
 });
}

/** Logical result and native settlement deliberately have separate lifetimes. */
export function startLocalSourcePreparation(values:readonly Readonly<import('../library/library').LocalAsset>[],ownerProof:string,control:SourcePreparationControl):LocalSourcePreparation {
 const expected=copySourceAssets(values);
 const abort=new AbortController();let logical=false,physical=false,pinning=false,stale=false;
 let resolveResult!:(result:SourcePreparationResult)=>void,resolveSettled!:()=>void;
 const result=new Promise<SourcePreparationResult>(r=>{resolveResult=r;}),settled=new Promise<void>(r=>{resolveSettled=r;});
 const container=navigator.serviceWorker;let claimed=!!container?.controller;
 const change=()=>{if(claimed)stale=true;claimed=true;};
 const unwatch=subscribeDatabaseLifecycle(()=>{stale=true;});container?.addEventListener('controllerchange',change);
 const finishResult=(r:SourcePreparationResult)=>{if(logical)return;logical=true;resolveResult(r);};
 const state=()=>pinning?'uncertain' as const:'settling' as const;
 const cancel=()=>{abort.abort();finishResult({kind:'cancelled',resourceState:physical?'settled':state()});};
 const onAbort=()=>cancel();control.signal.addEventListener('abort',onAbort,{once:true});
 const deadline=Number.isFinite(control.deadlineAt)?Math.max(0,Math.min(30000,control.deadlineAt-performance.now())):0;
 const timer=globalThis.setTimeout(cancel,deadline);
 let rpcTimer:ReturnType<typeof setTimeout>|undefined;
 const current=()=>{try{return !abort.signal.aborted&&!control.signal.aborted&&!stale&&performance.now()<control.deadlineAt&&control.current();}catch{return false;}};
 const check=()=>{assertDatabaseTransport();if(!current()){const cancelled=abort.signal.aborted||control.signal.aborted;throw AppFailure.create(makeFailure('transport',cancelled?'cancelled':'internal',cancelled?'cancelled':'owner-unavailable','none'));}};
 const finishPhysical=()=>{
  if(physical)return;physical=true;clearTimeout(timer);clearTimeout(rpcTimer);
  control.signal.removeEventListener('abort',onAbort);container?.removeEventListener('controllerchange',change);unwatch();resolveSettled();
 };
 if(control.signal.aborted)cancel();
 void (async()=>{
  let bundle:PreparedLocalSources|null=null,cleanupUncertain=false;
  try{
   if(!expected||!expected.length||!sourceProof(ownerProof))throw AppFailure.create(makeFailure('validate','internal','input-invalid','none'));
   check();const controller=await localController(check,true);check();
   let supported=false;
   if(controller){
    supported=await new Promise<boolean>((resolve,reject)=>{
     const channel=new MessageChannel();let done=false;
     const finish=(value:boolean,error?:unknown)=>{if(done)return;done=true;clearTimeout(timeout);channel.port1.close();channel.port2.close();error?reject(error):resolve(value);};
     const timeout=setTimeout(()=>finish(false),1500);
     channel.port1.onmessage=event=>{try{check();if(controller!==container.controller)throw new Error('controller changed');const m=event.data;finish(m?.version===1&&m.type==='transport-capabilities'&&m.physicalSources===1);}catch(error){finish(false,error);}};
     try{controller.postMessage({version:1,type:'transport-capabilities'},[channel.port2]);}catch(error){finish(false,error);}
    });check();
   }
   if(!controller||!supported){
    // No legacy fixture tickets: they can revoke previous legacy sources.
    const credit=control.reserveBlob(expected);if(!credit)throw AppFailure.create(makeFailure('admit','internal','limit-exceeded','none'));
    bundle=await prepareBoundedBlobSources(expected.map(a=>a.id),ownerProof,()=>{check();return true;},{expected,signal:abort.signal,deadlineAt:control.deadlineAt,credit});
   }else{
    // Tickets attest a physical manifest, not its bytes. Verify each unique
    // source once before publishing any ticket, keeping its shared generation
    // lock through the native pin reply. Blob already hashes while composing.
    const readers:AssetReader[]=[],verifiedSnapshots=new Set<string>();
    try{
    for(const asset of expected){
     const key=JSON.stringify(asset);if(verifiedSnapshots.has(key))continue;
     check();const reader=await openAssetReader(asset,true,{signal:abort.signal});readers.push(reader);check();
     const verified=await reader.verifyDetailed(true,{check});
     if(verified.state!=='valid')throw AppFailure.create(verified.failure);check();
     verifiedSnapshots.add(key);
    }
    // Manifest equality is fixed before IO and rechecked by the native worker.
    const requestId=crypto.randomUUID(),tokens=expected.map(()=>crypto.randomUUID());
    pinning=true;
    rpcTimer=setTimeout(()=>{finishResult({kind:'failed',failure:makeFailure('transport','internal','worker-protocol','none'),resourceState:'uncertain'});abort.abort();},10000);
    const reply=await physicalSourceRPC(controller,{version:1,type:'pinned-local-sources',requestId,ownerProof,expected,tokens});
    clearTimeout(rpcTimer);
    if('notice'in reply)reportDatabaseTransportNotice(reply.notice);
    if('status'in reply){
     // Even an error may follow a committed pin (for example owner loss after
     // transaction completion). Its terminal ACK allows exact cleanup now.
     try{const release=await physicalSourceRPC(controller,{version:1,type:'release-local-sources',requestId,ownerProof,tokens});if(!('released'in release))throw new Error('cleanup not acknowledged');}
     catch{cleanupUncertain=true;}
     throw AppFailure.create(makeFailure('transport',reply.cause==='worker-protocol'||reply.cause==='owner-unavailable'?'internal':reply.status===409?'integrity':'storage-unavailable',reply.cause,'idb'));}
    if(!('assets'in reply))throw AppFailure.create(makeFailure('transport','internal','worker-protocol','none'));
    const sources:PreparedLocalSource[]=reply.assets.map((asset,i)=>Object.freeze({url:new URL(`/_pulso/media/${tokens[i]}`,location.origin).href,protection:'pinned',asset}));
    let releasing:Promise<void>|null=null;
    bundle=Object.freeze({sources:Object.freeze(sources),release:()=>releasing??=(async()=>{
     const released=await physicalSourceRPC(controller,{version:1,type:'release-local-sources',requestId,ownerProof,tokens});
     if(!('released'in released))throw AppFailure.create(makeFailure('transport','internal','worker-protocol','none'));
    })()});attestSW(bundle,()=>releasing===null);
    }finally{for(const reader of readers)reader.release();}
   }
   // Every URL is now in custody, before checking guards that can reject it.
   check();
   const provenance=preparedSourceProvenance(bundle)!;
   finishResult({kind:'prepared',prepared:Object.freeze({bundle,allocations:provenance.allocations})});bundle=null;
  }catch(error){
   if(cleanupUncertain){finishResult({kind:'failed',failure:issuedFailure(error)??makeFailure('transport','internal','worker-protocol','none'),resourceState:'uncertain'});return;}
   if(bundle){
    try{await bundle.release();}catch{
     // Cleanup failure remains uncertain. No settled promise or second producer.
     finishResult({kind:'failed',failure:issuedFailure(error)??makeFailure('transport','internal','unknown','none'),resourceState:'uncertain'});return;
    }
   }
   finishResult(abort.signal.aborted||control.signal.aborted?{kind:'cancelled',resourceState:blobCleanupUncertain(error)?'uncertain':'settled'}:{kind:'failed',failure:issuedFailure(error)??fromKnownError(error,{phase:'transport',backend:'none'}),resourceState:blobCleanupUncertain(error)?'uncertain':'settled'});
  }
  finishPhysical();
 })();
 return Object.freeze({result,settled,cancel});
}
