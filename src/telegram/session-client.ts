import type {Activity,ActivityToken} from '../playback/ownership';
import {initialSessionState,parseSessionCommand,parseSessionReply,type SessionCommand,type SessionError,type SessionState} from './session-protocol';
export interface SessionWorker {onmessage:((event:MessageEvent)=>void)|null;onerror:((event:ErrorEvent)=>void)|null;onmessageerror:((event:MessageEvent)=>void)|null;postMessage(message:SessionCommand):void;terminate():void}
interface Pending {request:string;token:ActivityToken;timer:ReturnType<typeof setTimeout>}
/** One RAM-only session/worker, created only by an explicit valid phone submission. */
export class TelegramSessionClient {
 private worker:SessionWorker|null=null;private session='';private pending:Pending|null=null;private guard:()=>boolean=()=>false;private state:SessionState=initialSessionState();private stopped=false;
 constructor(private activity:Activity,private captureCurrent:()=>()=>boolean,private changed:(state:SessionState)=>void,private factory:()=>SessionWorker=()=>new Worker(new URL('./session.worker.ts',import.meta.url),{type:'module'}),private timeoutMs=45000){}
 snapshot():SessionState{return {...this.state};}
 private current(){try{return !this.stopped&&this.guard();}catch{return false;}}
 private publish(state:SessionState){this.state={...state};this.changed(this.snapshot());}
 private drop(){const w=this.worker;this.worker=null;if(w){w.onmessage=w.onerror=w.onmessageerror=null;w.terminate();}if(this.pending){clearTimeout(this.pending.timer);this.pending.token.end();this.pending=null;}this.session='';this.guard=()=>false;}
 stop(error:SessionError|null='cancelled'){this.drop();if(!this.stopped)this.publish(error?{...initialSessionState(),phase:'error',error}:initialSessionState());}
 dispose(){this.stopped=true;this.drop();}
 revalidate(){if(this.worker&&!this.current())this.stop('cancelled');}
 begin(phone:string){
  if(this.stopped||this.pending||this.worker||this.state.retryAt!==null&&Date.now()<this.state.retryAt)return;
  const current=this.captureCurrent();let valid=false;try{valid=current();}catch{/* Denied. */}if(!valid)return;
  const session=crypto.randomUUID(),request=crypto.randomUUID();const command=parseSessionCommand({version:1,session,request,type:'begin',value:phone});
  if(!command){this.publish({...initialSessionState(),phase:'error',error:'phone-invalid'});return;}
  const token=this.activity.begin();if(!token)return;
  this.guard=()=>current()&&token.current();this.session=session;
  try{const worker=this.factory();this.worker=worker;const live=()=>this.worker===worker&&this.session===session;worker.onmessage=event=>{if(live())this.receive(event.data);};worker.onerror=event=>{if(live()){event.preventDefault?.();this.stop(this.state.phase==='disconnecting'?'logout-unconfirmed':'network');}};worker.onmessageerror=()=>{if(live())this.stop(this.state.phase==='disconnecting'?'logout-unconfirmed':'protocol');};this.send(command,token,'sending-code');}catch{token.end();this.stop('internal');}
 }
 submit(type:'code'|'password',value:string){
  if(!this.worker||this.pending||!this.current()||this.state.retryAt!==null&&Date.now()<this.state.retryAt)return;
  if(type==='code'&&this.state.phase!=='code'||type==='password'&&this.state.phase!=='password')return;
  const command=parseSessionCommand({version:1,session:this.session,request:crypto.randomUUID(),type,value});if(!command)return;
  const token=this.activity.begin();if(!token)return;this.send(command,token,'authorizing');
 }
 logout(){if(!this.worker||this.pending||!this.current()||this.state.phase!=='connected')return;const token=this.activity.begin();if(!token)return;this.send({version:1,session:this.session,request:crypto.randomUUID(),type:'logout',value:''},token,'disconnecting');}
 private send(command:SessionCommand,token:ActivityToken,phase:SessionState['phase']){
  if(!this.current()){token.end();this.stop('cancelled');return;}
  const timer=setTimeout(()=>this.stop(command.type==='logout'?'logout-unconfirmed':'timeout'),this.timeoutMs);
  this.pending={request:command.request,token,timer};this.publish({...this.state,phase,error:null});
  try{this.worker!.postMessage(command);}catch{this.stop(command.type==='logout'?'logout-unconfirmed':'protocol');}
 }
 private receive(raw:unknown){
  const pending=this.pending;if(!pending||!this.worker)return;
  if(!this.current()){this.stop('cancelled');return;}
  const reply=parseSessionReply(raw,this.session,pending.request);if(!reply){this.stop('protocol');return;}
  clearTimeout(pending.timer);pending.token.end();this.pending=null;
  if(reply.phase==='error'||reply.phase==='disconnected'){this.drop();}
  this.publish({phase:reply.phase,error:reply.error,retryAt:reply.retryAt,delivery:reply.delivery});
 }
}
