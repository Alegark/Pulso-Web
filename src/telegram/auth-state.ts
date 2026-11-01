import {account,parseCommand,parseReply,parseSafeError,parseScope,sameScope,uuid,type AuthCommand,type AuthReply,type AuthScope,type SafeAuthError,type SafeAuthState} from './auth-protocol';
import {AuthStorageError,type AuthScopeStore} from './auth-scope-store';
/** Trusted internal capability, never received through postMessage. No SDK implementation here. */
export interface OfflineAuthDriver {
 begin(phone:string,signal:AbortSignal):Promise<AuthDriverResult>;
 code(phone:string,challenge:string,code:string,signal:AbortSignal):Promise<AuthDriverResult>;
 password(password:string,signal:AbortSignal):Promise<AuthDriverResult>;
 close():Promise<void>;
}
export type AuthDriverResult = {kind:'challenge';challenge:string}|{kind:'verified-user';accountId:string;isBot:false}|{kind:'password-needed'};
interface Attempt {id:string;controller:AbortController;phone:string|null;challenge:string|null;pending:boolean;deadline:number;scope:AuthScope}
export class AuthCoordinator {
 private state:SafeAuthState;
 private attempt:Attempt|null=null;
 private closed=false;
 private quarantine=false;
 private driverClose:Promise<boolean>|null=null;
 private driverCloseFailed=false;
 private retryAt=0;
 private readonly used=new Set<string>();
 constructor(scope:AuthScope,private readonly store:AuthScopeStore,private readonly driver?:OfflineAuthDriver,private readonly now:()=>number=Date.now,private readonly id:()=>string=()=>crypto.randomUUID()){
  const valid=parseScope(scope);if(!valid||valid.accountId!==null)throw new Error('scope');
  this.state={phase:driver?'disconnected':'disabled',remote:'unavailable',revocation:'not-requested',localSession:'absent',scope:valid};
 }
 snapshot():SafeAuthState {return {...this.state,scope:{...this.state.scope}};}
 private next():string {const id=this.id();if(!uuid(id))throw new Error('invalid');return id;}
 private invalidate():void {const old=this.attempt;this.attempt=null;this.state.scope={...this.state.scope,generation:this.next()};if(old){old.phone=null;old.challenge=null;old.controller.abort();}}
 /** Invalidate admission synchronously. true confirms driver.close resolved, false means
  * rejection; an unresolved driver leaves this pending. Never deletes/logs out.
  * Safe to ignore the returned promise: driver errors are observed internally. */
 close():Promise<boolean> {
  if(!this.closed){this.closed=true;this.state.phase='cancelled';this.state.remote='unavailable';this.invalidate();}
  return this.releaseDriver();
 }
 /** Explicit retry after a rejected close; never reopens admission or overlaps a pending close. */
 retryClose():Promise<boolean> {this.close();return this.releaseDriver(true);}
 private releaseDriver(retry=false):Promise<boolean> {
  if(this.driverClose&&!(retry&&this.driverCloseFailed))return this.driverClose;
  this.driverCloseFailed=false;
  this.driverClose=Promise.resolve().then(()=>this.driver?.close()).then(()=>true,()=>{this.driverCloseFailed=true;return false;});
  return this.driverClose;
 }
 private reply(c:AuthCommand):AuthReply {return {version:1,requestId:c.requestId,operationId:c.operationId,scope:c.scope,type:'state',state:this.snapshot()};}
 private error(c:AuthCommand,error:SafeAuthError):AuthReply {return {version:1,requestId:c.requestId,operationId:c.operationId,scope:c.scope,type:'error',error};}
 /** Explicit clock-driven expiry; no timer at import/construction and no ownership lease. */
 expire():void {if(this.attempt?.pending&&this.now()>=this.attempt.deadline){this.invalidate();this.state.phase='failed';this.state.remote='unavailable';}}
 async handle(input:unknown):Promise<AuthReply|null>{
  if(this.closed)return null;
  const c=parseCommand(input);input=null;if(!c){this.close();return null;}
  if(!sameScope(c.scope,this.state.scope))return this.error(c,{family:'validation',code:'scope'});
  if(c.type==='status')return this.reply(c);
  if(c.type==='disconnect')return this.disconnect(c);
  if(this.quarantine)return this.error(c,{family:'cleanup-uncertain',code:'cleanup'});
  if(c.type==='cancel'){
   if(!this.attempt||this.attempt.id!==c.targetOperationId||c.operationId!==this.attempt.id)return this.error(c,{family:'validation',code:'operation'});
   this.invalidate();this.state.phase='cancelled';this.state.remote='unavailable';return this.reply(c);
  }
  if(!this.driver)return this.error(c,{family:'unsupported',code:'disabled'});
  if(this.now()<this.retryAt)return this.error(c,{family:'rate-limited',code:'rate-limit',retryAt:this.retryAt});
  let a:Attempt;
  if(c.type==='begin-phone'){
   // Once bound, a different account needs a fresh slot/coordinator. No implicit B inheritance.
   if(this.state.scope.accountId!==null)return this.error(c,{family:'validation',code:'scope'});
   if(this.used.has(c.operationId)||this.used.size>=128)return this.error(c,{family:'validation',code:'operation'});
   this.used.add(c.operationId);this.invalidate();
   a={id:c.operationId,controller:new AbortController(),phone:c.phone,challenge:null,pending:true,deadline:this.now()+30000,scope:{...this.state.scope}};this.attempt=a;
  }else{
   if(!this.attempt||this.attempt.id!==c.operationId||this.attempt.pending)return this.error(c,{family:'validation',code:'operation'});
   if((c.type==='submit-code'&&this.state.phase!=='waiting-code')||(c.type==='submit-password'&&this.state.phase!=='waiting-password'))return this.error(c,{family:'validation',code:'operation'});
   a=this.attempt;a.pending=true;a.deadline=this.now()+30000;
  }
  const current=()=>{if(this.attempt!==a)return false;this.expire();return !this.closed&&!this.quarantine&&this.attempt===a&&sameScope(a.scope,this.state.scope)&&!a.controller.signal.aborted;};
  this.state.phase='connecting';this.state.remote='connecting';
  try{
   if(c.type==='begin-phone'){await this.store.register(a.scope,current,a.controller.signal);if(!current())return null;}
   let task:Promise<AuthDriverResult>;
   if(c.type==='begin-phone'){task=this.driver.begin(c.phone,a.controller.signal);c.phone='';}
   else if(c.type==='submit-code'){task=this.driver.code(a.phone!,a.challenge!,c.code,a.controller.signal);c.code='';}
   else {task=this.driver.password(c.password,a.controller.signal);c.password='';}
   // Drop command references containing code/password after calling the trusted driver.
   const result=await task;
   if(!current())return null;
   if(this.now()>=a.deadline){this.expire();return null;}
   if(result.kind==='verified-user'){
    if(!account(result.accountId)||result.isBot!==false)throw {family:'internal',code:'internal'};
    const bound=await this.store.bind(a.scope,result.accountId,this.next(),current,a.controller.signal);if(!current())return null;
    this.invalidate();this.state.scope={...bound,generation:this.state.scope.generation};this.state.phase='ready';this.state.remote='connected';this.state.localSession='present';return this.reply(c);
   }
   if(result.kind==='challenge'&&c.type==='begin-phone'&&typeof result.challenge==='string'&&result.challenge.length>0&&result.challenge.length<=1024){a.challenge=result.challenge;this.state.phase='waiting-code';}
   else if(result.kind==='password-needed'&&c.type==='submit-code'){this.state.phase='waiting-password';}
   else throw {family:'unsupported',code:'unsupported'};
   this.state.remote='unavailable';return this.reply(c);
  }catch(raw:unknown){
   if(!current())return null;
   if(this.now()>=a.deadline){this.expire();return null;}
   const error=(raw instanceof AuthStorageError?{family:'storage-unavailable',code:'storage'} as SafeAuthError:parseSafeError(raw))??{family:'internal',code:'internal'} as SafeAuthError;
   if(error.code==='rate-limit'&&error.retryAt!==undefined){this.retryAt=Math.min(error.retryAt,this.now()+86400000);error.retryAt=this.retryAt;}
   if(error.code==='code-invalid'&&c.type==='submit-code')this.state.phase='waiting-code';
   else if(error.code==='password-needed'&&c.type==='submit-code')this.state.phase='waiting-password';
   else if(error.code==='password-invalid'&&c.type==='submit-password')this.state.phase='waiting-password';
   else {this.invalidate();this.state.phase=error.code==='expired'?'expired':'failed';}
   this.state.remote=error.code==='offline'?'offline':'unavailable';return this.error(c,error);
  }finally{if(c.type==='begin-phone')c.phone='';if(c.type==='submit-code')c.code='';if(c.type==='submit-password')c.password='';if(current())a.pending=false;}
 }
 private async disconnect(c:Extract<AuthCommand,{type:'disconnect'}>):Promise<AuthReply|null>{
  if(this.state.phase==='disconnecting')return this.error(c,{family:'cleanup-uncertain',code:'cleanup'});
  this.quarantine=true;this.invalidate();this.state.phase='disconnecting';this.state.remote='unavailable';
  this.state.revocation=c.mode==='remote-and-local'?'unconfirmed':'not-requested';this.state.localSession='cleanup-pending';
  const generation=this.state.scope.generation;
  try{
   // Start both independently: persistence failure must not leave the driver alive.
   // Deletion requires BOTH a durable tombstone and confirmed driver shutdown.
   const scope={...this.state.scope};
   const [marked,stopped]=await Promise.allSettled([
    Promise.resolve().then(()=>this.store.tombstone(scope)),
    this.releaseDriver(true),
   ]);
   if(this.closed||this.state.scope.generation!==generation)return null;
   if(marked.status==='rejected'||stopped.status==='rejected'||!stopped.value)throw new Error('cleanup');
   const deleted=await this.store.cleanup(this.state.scope);
   if(this.closed||this.state.scope.generation!==generation)return null;
   this.state.localSession=deleted?'absent':'cleanup-pending';this.state.phase=deleted?'disconnected':'failed';
   return this.reply(c);
  }catch{if(this.closed||this.state.scope.generation!==generation)return null;this.state.phase='failed';return this.error(c,{family:'cleanup-uncertain',code:'cleanup'});}
 }
}
const boundCoordinators=new WeakSet<AuthCoordinator>();
/** Bind exactly the app-created port. A second port cannot replace it.
 * stop closes admission/port synchronously; optionally await its safe close result. */
export function bindAuthPort(port:MessagePort,coordinator:AuthCoordinator):()=>Promise<boolean> {
 if(boundCoordinators.has(coordinator)){port.close();throw new Error('bound');}boundCoordinators.add(coordinator);
 let open=true;
 const stop=()=>{open=false;port.onmessage=null;port.onmessageerror=null;const pending=coordinator.close();port.close();return pending;};
 port.onmessage=event=>{
  if(event.ports.length){for(const extra of event.ports)extra.close();stop();return;}
  const command=parseCommand(event.data);if(!command){stop();return;}
  const pending=coordinator.handle(command);
  if(command.type==='submit-code')command.code='';
  if(command.type==='submit-password')command.password='';
  if(command.type==='begin-phone')command.phone='';
  const publishState=()=>{const reply:AuthReply={version:1,requestId:command.requestId,operationId:command.operationId,scope:command.scope,type:'state',state:coordinator.snapshot()};if(open&&parseReply(reply,command))port.postMessage(reply);};
  // Transition ACK makes the new generation available before a slow driver await.
  if(!sameScope(command.scope,coordinator.snapshot().scope))publishState();
  void pending.then(reply=>{if(open&&reply&&parseReply(reply,command)){if(reply.type==='error')publishState();port.postMessage(reply);}}).catch(stop);
 };
 port.onmessageerror=stop;port.start();return stop;
}
