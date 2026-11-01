import {AppFailure,makeFailure} from '../errors/app-failure';
import {registerDatabaseAdmissionPolicy,retireDatabaseRealm,subscribeDatabaseLifecycle,type DatabaseLifecycleState} from './database';
import {copyRealmControl,isRealmLifecycle,realmControl,type RealmKind} from './database-realm-protocol';
export type {RealmKind} from './database-realm-protocol';
export interface RealmCapture {
 current():boolean;
 onLifecycle(state:DatabaseLifecycleState):void;
 end():void;
}
export interface RealmHost {
 capture(kind:RealmKind,callerCurrent:()=>boolean):RealmCapture|null;
 /** Validated directed SW notice; observation only, never authority. */
 onLifecycle?(state:DatabaseLifecycleState):void;
}
export type RealmTransportFailure='worker-protocol'|'worker-failed';
export interface RealmAttempt {current():boolean;revoke():void;closeAfterSettlement():void;onTransportFailure(listener:(code:RealmTransportFailure)=>void):()=>void}
let host:RealmHost|null=null;
const attempts=new Set<RealmAttempt>();
const live=(check:()=>boolean)=>{try{return check()===true;}catch{return false;}};
function protocolFailure():AppFailure{return AppFailure.create(makeFailure('transport','internal','worker-protocol','none'));}
function unavailable():AppFailure{return AppFailure.create(makeFailure('admit','storage-unavailable','storage-unavailable','idb'));}
export function registerDatabaseRealmHost(value:RealmHost):()=>void {
 if(host)throw protocolFailure();host=value;
 return ()=>{if(host!==value)return;host=null;revokeDatabaseWorkerAttempts();};
}
export function activeDatabaseWorkerAttempts():number{return attempts.size;}
export function revokeDatabaseWorkerAttempts(state?:DatabaseLifecycleState):void {
 if(state!==undefined&&!isRealmLifecycle(state))return;
 for(const attempt of [...attempts])attempt.revoke();
}
export function reportDatabaseRealmLifecycle(state:DatabaseLifecycleState):void {
 if(!isRealmLifecycle(state))return;
 revokeDatabaseWorkerAttempts(state);
 try{host?.onLifecycle?.(state);}catch{/* Notice cannot grant or prevent revocation. */}
}
/** Capture is synchronous before the first await. No host means no domain IO. */
export async function beginWorkerAttempt(kind:RealmKind,worker:Worker,callerCurrent:()=>boolean):Promise<RealmAttempt> {
 const capturedHost=host;
 if(!capturedHost||!live(callerCurrent))throw unavailable();
 const capture=capturedHost.capture(kind,callerCurrent);
 if(!capture)throw unavailable();
 let channel:MessageChannel;
 try{channel=new MessageChannel();}catch(error){try{capture.end();}catch{/* release once */}throw error;}
 const id=crypto.randomUUID();let admitted=true,closed=false,bound=false,sequence=0,received=0;
 let firstTransportFailure:RealmTransportFailure|null=null;const failureListeners=new Set<(code:RealmTransportFailure)=>void>();
 let resolveBind:()=>void=()=>{},rejectBind:(error:unknown)=>void=()=>{};
 const binding=new Promise<void>((resolve,reject)=>{resolveBind=resolve;rejectBind=reject;});
 void binding.catch(()=>{}); // Synchronous postMessage failure can settle before the await attaches.
 const attempt:RealmAttempt={
  onTransportFailure(listener){if(closed)return ()=>{};failureListeners.add(listener);if(firstTransportFailure)try{listener(firstTransportFailure);}catch{/* isolated */}return ()=>{failureListeners.delete(listener);};},
  current:()=>!closed&&admitted&&bound&&host===capturedHost&&live(callerCurrent)&&live(capture.current),
  revoke(){
   if(!admitted||closed)return;admitted=false;
   try{channel.port1.postMessage(realmControl({type:'revoke',attempt:id,sequence:++sequence}));}catch{/* Transport settlement belongs to domain caller. */}
   if(!bound)rejectBind(unavailable());
  },
  closeAfterSettlement(){
   if(closed)return;attempt.revoke();closed=true;clearTimeout(timer);clearInterval(watch);attempts.delete(attempt);
   channel.port1.onmessage=null;channel.port1.onmessageerror=null;channel.port1.close();channel.port2.close();
   worker.removeEventListener('error',transportEvent);worker.removeEventListener('messageerror',transportEvent);failureListeners.clear();
   worker.terminate();try{capture.end();}catch{/* Resource end is exactly once, even stale. */}
  },
 };
 const transportFailure=(code:RealmTransportFailure='worker-protocol')=>{attempt.revoke();if(!bound)rejectBind(protocolFailure());if(firstTransportFailure)return;firstTransportFailure=code;for(const listener of [...failureListeners])try{listener(code);}catch{/* isolated */}};
 const transportEvent=(event:Event)=>transportFailure(event.type==='error'?'worker-failed':'worker-protocol');
 const timer=setTimeout(()=>{attempt.revoke();rejectBind(protocolFailure());},10000);
 const watch=setInterval(()=>{if(!bound&&(!live(callerCurrent)||!live(capture.current)||host!==capturedHost))attempt.revoke();},25);
 attempts.add(attempt);
 channel.port1.onmessage=event=>{
  if(closed)return;
  // A foreign attempt is ignored; malformed matching/private-port control closes admission.
  let identity:unknown;
  try{const d=event.data&&typeof event.data==='object'?Object.getOwnPropertyDescriptor(event.data,'attempt'):undefined;identity=d&&'value'in d?d.value:undefined;}catch{/* malformed */}
  if(identity!==undefined&&identity!==id)return;
  const message=copyRealmControl(event.data);
  if(!message||!('attempt'in message)||message.attempt!==id){transportFailure();return;}
  if(message.type==='bound'){
   if(bound){transportFailure();return;}
   bound=true;clearTimeout(timer);
   if(!admitted||host!==capturedHost||!live(callerCurrent)||!live(capture.current)){attempt.revoke();rejectBind(unavailable());return;}
   resolveBind();return;
  }
  if(message.type==='anomaly'||message.type==='retired'){
   if(!bound||message.sequence<=received){transportFailure();return;}received=message.sequence;
   // Consume matching lifecycle even if the business publication guard is stale.
   if(message.type==='anomaly'){
    attempt.revoke();revokeDatabaseWorkerAttempts(message.state);
    try{capture.onLifecycle(message.state);}catch{/* Local root observers are isolated. */}
   }
   return;
  }
  if(message.type==='not-ready'){attempt.revoke();if(!bound)rejectBind(unavailable());return;}
  transportFailure();
 };
 channel.port1.onmessageerror=transportEvent;channel.port1.start();
 worker.addEventListener('error',transportEvent);worker.addEventListener('messageerror',transportEvent);
 try{
  if(!live(callerCurrent)||!live(capture.current))throw unavailable();
  worker.postMessage(realmControl({type:'bind',attempt:id,kind}),[channel.port2]);
  await binding;if(!attempt.current())throw unavailable();return attempt;
 }catch(error){attempt.closeAfterSettlement();throw error;}
}

interface WorkerRealm {kind:RealmKind;bound:boolean;active:boolean;port:MessagePort|null;attempt:string;sent:number;received:number;notReady:boolean}
let workerRealm:WorkerRealm|null=null;
/** Called at entrypoint evaluation, before any domain handler/dynamic import. */
export function installWorkerDatabaseRealm(kind:RealmKind):void {
 if(workerRealm)throw protocolFailure();
 const realm:WorkerRealm={kind,bound:false,active:false,port:null,attempt:'',sent:0,received:0,notReady:false};workerRealm=realm;
 registerDatabaseAdmissionPolicy({
  open(phase){
   if(phase==='upgrade'){
    realm.active=false;retireDatabaseRealm();
    if(!realm.notReady&&realm.port){realm.notReady=true;try{realm.port.postMessage(realmControl({type:'not-ready',attempt:realm.attempt,reason:'schema-not-ready'}));}catch{/* Domain outcome settles. */}}
    return false;
   }
   return realm.bound&&realm.active;
  },
  use:use=>realm.bound&&realm.active&&(realm.kind!=='copies'||use==='read'),
 });
 subscribeDatabaseLifecycle(state=>{
  realm.active=false;retireDatabaseRealm();
  if(realm.port)try{realm.port.postMessage(realmControl({type:'anomaly',attempt:realm.attempt,sequence:++realm.sent,state}));}catch{/* Never reopen on transport failure. */}
 });
}
export function workerDatabaseRealmCurrent():boolean{return workerRealm?.active===true&&workerRealm.bound;}
/** true consumes control; false leaves the unchanged business protocol to its handler. */
export function bindWorkerRealm(kind:RealmKind,event:MessageEvent):boolean {
 if(!workerRealm)installWorkerDatabaseRealm(kind);
 const realm=workerRealm!;
 const message=copyRealmControl(event.data);
 if(message?.type!=='bind'){
  if(event.ports.length){realm.active=false;retireDatabaseRealm();for(const port of event.ports)port.close();return true;}
  return false;
 }
 if(realm.bound||realm.kind!==kind||message.kind!==kind||event.ports.length!==1){
  realm.active=false;retireDatabaseRealm();for(const port of event.ports)port.close();return true;
 }
 realm.bound=true;realm.active=true;realm.port=event.ports[0];realm.attempt=message.attempt;
 realm.port.onmessage=control=>{
  let identity:unknown;try{const d=Object.getOwnPropertyDescriptor(control.data,'attempt');identity=d&&'value'in d?d.value:undefined;}catch{/* fail closed below */}
  if(identity!==undefined&&identity!==realm.attempt)return;
  const m=copyRealmControl(control.data);
  if(!m||m.type!=='revoke'||m.attempt!==realm.attempt||m.sequence<=realm.received){realm.active=false;retireDatabaseRealm();return;}
  realm.received=m.sequence;realm.active=false;retireDatabaseRealm();
  try{realm.port!.postMessage(realmControl({type:'retired',attempt:realm.attempt,sequence:++realm.sent}));}catch{/* No restoration. */}
 };
 realm.port.onmessageerror=()=>{realm.active=false;retireDatabaseRealm();};realm.port.start();
 try{realm.port.postMessage(realmControl({type:'bound',attempt:realm.attempt}));}catch{realm.active=false;retireDatabaseRealm();}
 return true;
}
