import type {LocalAsset} from '../library/library';
import {makeFailure,type FailureV1} from '../errors/app-failure';
import {closedObject,copySourceAsset,sameSourceAsset} from './local-source-protocol';

export type CopyRemovalRuntimeReason='invalid-target'|'stale'|'runtime-unknown'|'runtime-unsupported';
export interface CopyRemovalRuntime {
 current(target:Readonly<LocalAsset>):boolean;
 release():void;
}
export type CopyRemovalRuntimeResult=
 | {readonly kind:'ready';readonly runtime:CopyRemovalRuntime}
 | {readonly kind:'blocked';readonly reason:CopyRemovalRuntimeReason;readonly failure:FailureV1|null};
const LIMIT=8*1024*1024;
const DEADLINE=1500;
function supported(value:unknown):boolean {
 const m=closedObject(value,['version','type','readerProtocol','backends','idbLifecycle','physicalSources']);
 if(!m||m.version!==1||m.type!=='transport-capabilities'||m.readerProtocol!=='local-assets-v1'||m.idbLifecycle!==1||m.physicalSources!==1)return false;
 // Bound the array before reading its data fields; never execute supplied accessors.
 try{
 if(!Array.isArray(m.backends))return false;
 const fields:Record<string,PropertyDescriptor>=Object.getOwnPropertyDescriptors(m.backends) as unknown as Record<string,PropertyDescriptor>;
 if(Reflect.ownKeys(fields).length!==3||fields.length?.value!==2)return false;
 const a=fields['0'],c=fields['1'];
 return !!a&&!!c&&'value'in a&&'value'in c&&((a.value==='idb'&&c.value==='opfs')||(a.value==='opfs'&&c.value==='idb'));
 }catch{return false;}
}

/** A private readiness observation, never a storage/ownership attestation.
 * The root must hold its exact reservation and supply a fresh admission guard.
 * No registration, activation, tickets, file reads, or player cleanup occurs here.
 */
export async function prepareCopyRemovalRuntime(target:Readonly<LocalAsset>,current:()=>boolean):Promise<CopyRemovalRuntimeResult> {
 const asset=copySourceAsset(target);
 const blocked=(reason:CopyRemovalRuntimeReason):CopyRemovalRuntimeResult=>Object.freeze({kind:'blocked',reason,failure:makeFailure('transport','internal',reason==='invalid-target'?'input-invalid':reason==='stale'?'owner-unavailable':'worker-protocol','none')});
 if(!asset||asset.namespace!=='local'||asset.bytes>LIMIT)return blocked('invalid-target');
 let stale=false,watching=false;
 let container:ServiceWorkerContainer|undefined,controller:ServiceWorker|null=null,absent=false;
 let cancelPending:(()=>void)|undefined;
 const cleanup=()=>{if(watching){watching=false;container!.removeEventListener('controllerchange',changed);}cancelPending?.();};
 const invalidate=()=>{stale=true;cleanup();};
 const changed=()=>invalidate();
 const valid=():boolean=>{
 if(stale)return false;
 try{
 if(current()!==true||stale|| (absent?('serviceWorker'in navigator):navigator.serviceWorker!==container||container!.controller!==controller)){invalidate();return false;}
 return true;
 }catch{invalidate();return false;}
 };
 try{
 absent=!('serviceWorker'in navigator);
 if(!absent){container=navigator.serviceWorker;if(!container)return blocked('runtime-unknown');controller=container.controller;container.addEventListener('controllerchange',changed);watching=true;}
 if(!valid()){cleanup();return blocked('stale');}
 if(controller){
 const capable=await new Promise<boolean>(resolve=>{
 let channel:MessageChannel|undefined,timer:ReturnType<typeof setTimeout>|undefined,settled=false;
 const finish=(ok:boolean)=>{if(settled)return;settled=true;if(timer!==undefined)clearTimeout(timer);if(channel){channel.port1.onmessage=null;channel.port1.onmessageerror=null;channel.port1.close();channel.port2.close();}cancelPending=undefined;resolve(ok);};
 cancelPending=()=>finish(false);
 timer=setTimeout(()=>finish(false),DEADLINE);
 try{channel=new MessageChannel();channel.port1.onmessage=event=>finish(valid()&&supported(event.data));channel.port1.onmessageerror=()=>finish(false);controller!.postMessage({version:1,type:'transport-capabilities'},[channel.port2]);}catch{finish(false);}
 });
 if(!valid()){cleanup();return blocked('stale');}
 if(!capable){invalidate();return blocked('runtime-unsupported');}
 }else if(!absent){
 // A registration can activate in another realm without claiming this page or
 // emitting controllerchange. A past getRegistration() absence cannot support
 // this synchronous lifetime guard. Require a verified controller whenever the
 // API is present; only actual API absence permits the bounded path.
 invalidate();return blocked('runtime-unknown');
 }
 if(!valid()){cleanup();return blocked('stale');}
 const runtime:CopyRemovalRuntime=Object.freeze({current:(candidate:Readonly<LocalAsset>)=>{
 if(!valid())return false;
 const snapshot=copySourceAsset(candidate);
 if(!snapshot||!sameSourceAsset(asset,snapshot)){invalidate();return false;}
 return valid();
 },release:invalidate});
 return Object.freeze({kind:'ready',runtime});
 }catch{invalidate();return blocked('runtime-unknown');}
}
