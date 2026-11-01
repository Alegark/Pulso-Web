import {assertDatabaseTransport,reportDatabaseTransportNotice} from './database-transport';
import {AppFailure,makeFailure,nativeDOMName,fromKnownError} from '../errors/app-failure';
import {boundedBlobSources,prepareBoundedBlobSources,releaseBlobSources} from './blob-source';
import {readRecord,subscribeDatabaseLifecycle} from '../storage/database';
import {copySourceAsset,copySourceReply,sameSourceAsset,copySourceIds,sourceProof,type PreparedLocalSources,type PreparedLocalSource,type SourceReply,type PinnedRequest,type ReleaseRequest} from './local-source-protocol';
export type {PreparedLocalSources,PreparedLocalSource} from './local-source-protocol';
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
export async function prepareLocalSources(assetIds:string[],ownerProof:string,current:()=>boolean=()=>true):Promise<PreparedLocalSources> {
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
 if(!supported){
 // Never read a later manifest to invent protection for a legacy URL.
 const urls=await localTickets(assetIds,ownerProof,()=>{check();return true;});try{check();}catch(error){releaseBlobSources(urls);throw error;}
 const sources=urls.map(url=>Object.freeze({url,protection:'unknown' as const,asset:null}));
 let released=false;return Object.freeze({sources:Object.freeze(sources),release:async()=>{if(released)return;released=true;releaseBlobSources(urls);}});
 }
 const expected:NonNullable<ReturnType<typeof copySourceAsset>>[]=[];
 for(const id of assetIds){check();const record=await readRecord<unknown>('assets',id);check();const asset=copySourceAsset(record);if(!asset||asset.id!==id)throw AppFailure.create(makeFailure('read','integrity',record===undefined?'asset-missing':'local-corrupt','idb'));expected.push(asset);}
 const requestId=crypto.randomUUID(),tokens=assetIds.map(()=>crypto.randomUUID());
 const release=async()=>{try{await sourceRPC(controller,{version:1,type:'release-local-sources',requestId,ownerProof,tokens});}catch{/* Best effort metadata cleanup, not data retraction. */}};
 try{
 const reply=await sourceRPC(controller,{version:1,type:'pinned-local-sources',requestId,ownerProof,expected,tokens});
 if('notice'in reply)reportDatabaseTransportNotice(reply.notice);
 check();if(controller!==container.controller)throw new Error('El transporte local cambió.');
 if('status'in reply)throw AppFailure.create(makeFailure('transport',reply.cause==='worker-protocol'||reply.cause==='owner-unavailable'?'internal':reply.status===409?'integrity':'storage-unavailable',reply.cause,'idb'));
 if(!('assets'in reply)||!sameTokens(reply.tokens,tokens)||reply.assets.length!==expected.length||reply.assets.some((asset,i)=>!sameSourceAsset(asset,expected[i])))throw AppFailure.create(makeFailure('transport','internal','worker-protocol','none'));
 const sources:PreparedLocalSource[]=reply.assets.map((asset,i)=>Object.freeze({url:new URL(`/_pulso/media/${tokens[i]}`,location.origin).href,protection:'pinned',asset}));
 let released:Promise<void>|undefined;return Object.freeze({sources:Object.freeze(sources),release:()=>released??=(release())});
 }catch(error){await release();throw error;}
 }finally{unsubscribe();if(watching)container.removeEventListener('controllerchange',change);}
}
function sameTokens(a:string[],b:string[]):boolean {return a.length===b.length&&a.every((token,i)=>token===b[i]);}
function sourceRPC(controller:ServiceWorker,message:PinnedRequest|ReleaseRequest):Promise<SourceReply> {
 return new Promise((resolve,reject)=>{
 const channel=new MessageChannel();let settled=false;
 const finish=(reply:SourceReply|null)=>{if(settled)return;settled=true;clearTimeout(timer);channel.port1.close();channel.port2.close();reply?resolve(reply):reject(AppFailure.create(makeFailure('transport','internal','worker-protocol','none')));};
 const timer=window.setTimeout(()=>finish(null),10000);
 channel.port1.onmessage=event=>finish(copySourceReply(event.data,message.type,message.requestId));
 try{controller.postMessage(message,[channel.port2]);}catch{finish(null);}
 });
}
