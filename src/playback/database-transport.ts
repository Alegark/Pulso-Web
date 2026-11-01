import {copyRealmControl,REALM_PROTOCOL} from '../storage/database-realm-protocol';
import type {DatabaseLifecycleState} from '../storage/database';
import {AppFailure,makeFailure} from '../errors/app-failure';
const protocol=REALM_PROTOCOL;
let closed:DatabaseLifecycleState|null=null;
let lifecycleRevision=0;
const listeners=new Set<(state:DatabaseLifecycleState)=>void>();
const failure=()=>AppFailure.create(makeFailure('open','storage-unavailable','storage-unavailable','idb'));
export function databaseTransportNotice(value:unknown):DatabaseLifecycleState|null {
 const m=copyRealmControl(value);return m?.type==='sw-anomaly'?m.state:null;
}
export function reportDatabaseTransportNotice(value:unknown):void {
 const state=databaseTransportNotice(value);if(!state)return;
 lifecycleRevision++;
 if(closed==='versionchange'||closed==='version-incompatible')return;
 closed=state;
 for(const listener of [...listeners])try{listener(state);}catch{/* A UI observer cannot reopen transport. */}
}
export function assertDatabaseTransport():void {if(closed)throw failure();}
/** A controller change only changes the source to observe; it never clears a gate. */
export function attachDatabaseTransportLifecycle(listener:(state:DatabaseLifecycleState)=>void,captureCurrent:()=>boolean=()=>true):()=>void {
 if(!navigator.serviceWorker)return ()=>{};
 const container=navigator.serviceWorker;let controller=container.controller;
 const observe=(state:DatabaseLifecycleState)=>{if(captureCurrent())listener(state);};listeners.add(observe);
 const change=()=>{controller=container.controller;};
 const message=(event:MessageEvent)=>{
 if(!controller||controller!==container.controller||event.source!==controller||event.origin!==location.origin)return;
 reportDatabaseTransportNotice(event.data);
 };
 container.addEventListener('controllerchange',change);container.addEventListener('message',message);
 return ()=>{listeners.delete(observe);container.removeEventListener('controllerchange',change);container.removeEventListener('message',message);};
}
async function supportsLifecycle(controller:ServiceWorker):Promise<boolean>{
 return new Promise(resolve=>{
 const channel=new MessageChannel();let settled=false;
 const finish=(value:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);channel.port1.close();channel.port2.close();resolve(value);};
 const timer=window.setTimeout(()=>finish(false),1500);
 channel.port1.onmessage=event=>{const m=event.data;finish(m?.version===1&&m.type==='transport-capabilities'&&m.idbLifecycle===1);};
 try{controller.postMessage({version:1,type:'transport-capabilities'},[channel.port2]);}catch{finish(false);}
 });
}
export async function revalidateDatabaseTransport(ownerProof:string,current:()=>boolean):Promise<void> {
 if(!current())throw failure();
 if(closed==='versionchange'||closed==='version-incompatible')throw failure();
 const controller=navigator.serviceWorker?.controller;
 if(!controller){if(closed)throw failure();return;}
 const supported=await supportsLifecycle(controller);
 if(!current()||controller!==navigator.serviceWorker.controller)throw failure();
 if(!supported){if(closed)throw failure();return;}
 const observed=lifecycleRevision;
 const channel=new MessageChannel();const requestId=crypto.randomUUID();
 await new Promise<void>((resolve,reject)=>{
 let settled=false;
 const finish=(error?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);channel.port1.close();channel.port2.close();error?reject(error):resolve();};
 const timer=window.setTimeout(()=>finish(failure()),10000);
 channel.port1.onmessage=event=>{
 if(!current()||controller!==navigator.serviceWorker.controller){finish(failure());return;}
 const m=copyRealmControl(event.data);
 if(m?.type!=='revalidated'||m.requestId!==requestId){finish(failure());return;}
 if(m.state!=='ready'){reportDatabaseTransportNotice({protocol,version:1,type:'sw-anomaly',state:m.state});finish(failure());return;}
 // The caller still owns DOM readback and the root gate. This clears only transport.
 if(lifecycleRevision!==observed||closed==='versionchange'||closed==='version-incompatible'){finish(failure());return;}
 closed=null;finish();
 };
 try{controller.postMessage({protocol,version:1,type:'revalidate',requestId,ownerProof},[channel.port2]);}catch{finish(failure());}
 });
}
