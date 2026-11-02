import type {Activity,ActivityToken} from '../playback/ownership';
import {initialSessionState,parseSessionCommand,parseSessionReply,type SessionCommand,type SessionError,type SessionState} from './session-protocol';
import {SOURCES_BOUNDS,parseSourcesCommand,type AccountBinding,type SourceRow,type SourcesCommand,type Folder,type PageEnd,type SourcesError} from './sources-protocol';
import {parseSourcesBridgeReply} from './sources-bridge-protocol';
export interface SourcesSnapshot {binding:AccountBinding|null;rows:readonly SourceRow[];selected:readonly string[];revision:number;pending:boolean;reading:boolean;cancelling:boolean;folder:Folder|null;end:PageEnd|null;error:SourcesError|null;retryAt:number|null;retryBlocked:boolean;listEpoch:number;operationId:string}
const emptySources=():SourcesSnapshot=>({binding:null,rows:[],selected:[],revision:0,pending:false,reading:false,cancelling:false,folder:null,end:null,error:null,retryAt:null,retryBlocked:false,listEpoch:0,operationId:''});
interface SourcesPending {command:SourcesCommand;token:ActivityToken;current:()=>boolean;timer:ReturnType<typeof setTimeout>;cancelled:boolean}
export interface SessionWorker {onmessage:((event:MessageEvent)=>void)|null;onerror:((event:ErrorEvent)=>void)|null;onmessageerror:((event:MessageEvent)=>void)|null;postMessage(message:SessionCommand|SourcesCommand):void;terminate():void}
interface Pending {request:string;token:ActivityToken;timer:ReturnType<typeof setTimeout>}
/** One RAM-only session/worker, created only by an explicit valid phone submission. */
export class TelegramSessionClient {
 private sources:SourcesSnapshot=emptySources();private sourceRead:SourcesPending|null=null;private sourceControl:SourcesPending|null=null;private cursor:string|null=null;private retired=new Map<string,SourcesCommand>();private queuedLogout:SessionCommand|null=null;private sourcesIdle:ReturnType<typeof setTimeout>|null=null;
 private sourcesUntil:number|null=null;private projectionEpoch=0;private sourcesExpiryDirty=false;
 private worker:SessionWorker|null=null;private session='';private pending:Pending|null=null;private guard:()=>boolean=()=>false;private state:SessionState=initialSessionState();private stopped=false;
 constructor(private activity:Activity,private captureCurrent:()=>()=>boolean,private changed:(state:SessionState)=>void,private factory:()=>SessionWorker=()=>new Worker(new URL('./session.worker.ts',import.meta.url),{type:'module'}),private timeoutMs=45000,private sourcesChanged:(state:SourcesSnapshot)=>void=()=>{},private sourcesTimeoutMs=20000,private graceMs=2000){}
 sourcesSnapshot():SourcesSnapshot{this.expireSources();if(this.state.phase==='disconnecting')return emptySources();return {...this.sources,binding:this.sources.binding?{...this.sources.binding}:null,rows:this.sources.rows.map(r=>({...r})),selected:[...this.sources.selected]};}
 private publishSources(){const snapshot=this.sourcesSnapshot();this.sourcesExpiryDirty=false;this.sourcesChanged(snapshot);}
 /** Expiry can be discovered during a render-time capture: notify later, without render callbacks. */
 private expireSources(){if(this.sourcesUntil===null||Date.now()<this.sourcesUntil)return false;if(this.sourcesIdle!==null)clearTimeout(this.sourcesIdle);this.sourcesIdle=null;this.sourcesUntil=null;this.projectionEpoch++;this.cursor=null;this.sources={...this.sources,rows:[],selected:[],error:'expired'};this.sourcesExpiryDirty=true;const worker=this.worker,epoch=this.projectionEpoch;queueMicrotask(()=>{if(this.worker===worker&&this.projectionEpoch===epoch&&this.sourcesExpiryDirty)this.publishSources();});return true;}
 captureSessionCurrent():()=>boolean {const worker=this.worker,session=this.session,state=this.state,current=this.captureCurrent();return()=>!this.stopped&&this.worker===worker&&this.session===session&&this.state===state&&current();}
 captureLocalStop():()=>boolean {const worker=this.worker,session=this.session;return()=>{if(!worker||this.worker!==worker||this.session!==session)return false;this.stop('cancelled');return true;};}
 captureCancel():()=>void {const worker=this.worker,read=this.sourceRead;return()=>{if(read&&this.worker===worker&&this.sourceRead===read)this.cancel();};}
 snapshot():SessionState{return {...this.state};}
 private current(){try{return !this.stopped&&this.guard();}catch{return false;}}
 private publish(state:SessionState){this.state={...state};this.changed(this.snapshot());}
 private drop(){const w=this.worker;this.worker=null;if(w){w.onmessage=w.onerror=w.onmessageerror=null;w.terminate();}if(this.pending){clearTimeout(this.pending.timer);this.pending.token.end();this.pending=null;}this.queuedLogout=null;this.session='';this.guard=()=>false;for(const p of [this.sourceRead,this.sourceControl])if(p){clearTimeout(p.timer);p.token.end();}this.sourceRead=this.sourceControl=null;this.cursor=null;this.retired.clear();if(this.sourcesIdle!==null)clearTimeout(this.sourcesIdle);this.sourcesIdle=null;this.sourcesUntil=null;this.projectionEpoch++;this.sources=emptySources();this.publishSources();}
 stop(error:SessionError|null='cancelled'){this.drop();if(!this.stopped)this.publish(error?{...initialSessionState(),phase:'error',error}:initialSessionState());}
 dispose(){this.stopped=true;this.drop();}
 revalidate(){if(this.worker&&!this.current())this.stop('cancelled');else{this.expireSources();if(this.sourcesExpiryDirty)this.publishSources();}}
 begin(phone:string){
  if(this.stopped||this.pending||this.worker||this.state.retryAt!==null&&Date.now()<this.state.retryAt)return;
  const current=this.captureCurrent();let valid=false;try{valid=current();}catch{/* Denied. */}if(!valid)return;
  const session=crypto.randomUUID(),request=crypto.randomUUID();const command=parseSessionCommand({version:2,session,request,type:'begin',value:phone});
  if(!command){this.publish({...initialSessionState(),phase:'error',error:'phone-invalid'});return;}
  const token=this.activity.begin();if(!token)return;
  this.guard=()=>current()&&token.current();this.session=session;
  try{const worker=this.factory();this.worker=worker;const live=()=>this.worker===worker&&this.session===session;worker.onmessage=event=>{if(live())this.receive(event.data);};worker.onerror=event=>{if(live()){event.preventDefault?.();this.stop(this.state.phase==='disconnecting'?'logout-unconfirmed':'network');}};worker.onmessageerror=()=>{if(live())this.stop(this.state.phase==='disconnecting'?'logout-unconfirmed':'protocol');};this.send(command,token,'sending-code');}catch{token.end();this.stop('internal');}
 }
 submit(type:'code'|'password',value:string){
  if(!this.worker||this.pending||!this.current()||this.state.retryAt!==null&&Date.now()<this.state.retryAt)return;
  if(type==='code'&&this.state.phase!=='code'||type==='password'&&this.state.phase!=='password')return;
  const command=parseSessionCommand({version:2,session:this.session,request:crypto.randomUUID(),type,value});if(!command)return;
  const token=this.activity.begin();if(!token)return;this.send(command,token,'authorizing');
 }
 logout(){if(!this.worker||this.pending||!this.current()||this.state.phase!=='connected')return;const current=this.captureCurrent();if(!current())return;const token=this.activity.begin();if(!token)return;this.sources={...this.sources,rows:[],selected:[]};this.send({version:2,session:this.session,request:crypto.randomUUID(),type:'logout',value:''},token,'disconnecting');this.publishSources();}
 /** Capture on render/gesture; stale React closures cannot act on a replacement session or list. */
 captureSourcesCurrent():()=>boolean {this.expireSources();const worker=this.worker,session=this.session,binding=this.sources.binding,epoch=this.sources.listEpoch,operation=this.sources.operationId,revision=this.sources.revision,projectionEpoch=this.projectionEpoch,current=this.captureCurrent();return()=>{this.expireSources();return this.worker===worker&&this.session===session&&this.current()&&current()&&this.projectionEpoch===projectionEpoch&&(this.sourcesUntil===null||Date.now()<this.sourcesUntil)&&!!binding&&this.sources.binding?.accountRef===binding.accountRef&&this.sources.binding?.accountEpoch===binding.accountEpoch&&this.sources.listEpoch===epoch&&this.sources.operationId===operation&&this.sources.revision===revision;};}
 consult(folder:Folder,allowed:()=>boolean=this.captureSourcesCurrent()){if(!allowed()||!this.sourceReady()||this.sources.retryBlocked||this.sources.retryAt!==null&&Date.now()<this.sources.retryAt)return;this.sources={...this.sources,listEpoch:this.sources.listEpoch+1,operationId:crypto.randomUUID(),rows:[],selected:[],revision:0,folder,end:null};this.cursor=null;this.dispatchSource({type:'sources.page',folder,cursor:null});}
 more(allowed:()=>boolean=this.captureSourcesCurrent()){if(!allowed()||!this.sourceReady()||!this.cursor||!this.sources.folder)return;const cursor=this.cursor;this.cursor=null;this.dispatchSource({type:'sources.page',folder:this.sources.folder,cursor});}
 confirm(peerRefs:readonly string[],allowed:()=>boolean=this.captureSourcesCurrent()){if(!allowed()||!this.sourceReady()||peerRefs.length>20||new Set(peerRefs).size!==peerRefs.length||peerRefs.some(ref=>!this.sources.rows.some(row=>row.peerRef===ref)))return;this.dispatchSource({type:'sources.select',peerRefs});}
 clear(allowed:()=>boolean=this.captureSourcesCurrent()){if(allowed()&&this.sourceReady())this.dispatchSource({type:'sources.clear'});}
 cancel(){const read=this.sourceRead,worker=this.worker;if(!worker||!read||this.sourceControl||this.state.phase!=='connected')return;read.cancelled=true;this.cursor=null;clearTimeout(read.timer);read.timer=setTimeout(()=>{if(this.worker===worker&&this.sourceRead===read)this.stop(this.state.phase==='disconnecting'?'logout-unconfirmed':'timeout');},this.graceMs);this.dispatchSource({type:'sources.cancel',targetRequestId:read.command.requestId},true);}
 private touchSources(){if(this.sourcesIdle!==null)clearTimeout(this.sourcesIdle);const worker=this.worker;this.sourcesUntil=Date.now()+SOURCES_BOUNDS.idleMs;this.sourcesIdle=setTimeout(()=>{if(this.worker!==worker)return;if(!this.current()){this.stop('cancelled');return;}if(this.expireSources()||this.sourcesExpiryDirty)this.publishSources();},SOURCES_BOUNDS.idleMs);}
 private sourceReady(){this.expireSources();return !!this.worker&&!this.pending&&!this.sourceRead&&!this.sourceControl&&this.state.phase==='connected'&&this.current()&&!!this.sources.binding;}
 private dispatchSource(fields:{type:'sources.page';folder:Folder;cursor:string|null}|{type:'sources.select';peerRefs:readonly string[]}|{type:'sources.clear'}|{type:'sources.cancel';targetRequestId:string},cancel=false){
  const worker=this.worker,binding=this.sources.binding;if(!worker||!binding)return;
  const current=cancel?this.sourceRead!.current:this.captureSourcesCurrent();if(!cancel&&!current())return;
  const command=parseSourcesCommand({protocol:'pulso-sources',version:1,sessionId:this.session,...binding,listEpoch:this.sources.listEpoch,operationId:this.sources.operationId,requestId:crypto.randomUUID(),...fields});if(!command)return;
  const token=this.activity.begin();if(!token){if(cancel)this.stop('cancelled');return;}
  if(!cancel&&!current()){token.end();this.stop('cancelled');return;}
  const p:SourcesPending={command,token,current,cancelled:false,timer:setTimeout(()=>{
   if(this.worker!==worker||this.sourceRead!==p&&this.sourceControl!==p)return;
   if(command.type==='sources.page'){
    if(this.state.phase==='connected')this.cancel();else if(this.sourceRead===p)p.timer=setTimeout(()=>{if(this.worker===worker&&this.sourceRead===p)this.stop('logout-unconfirmed');},this.graceMs);
   }else this.stop(this.state.phase==='disconnecting'?'logout-unconfirmed':'timeout');
  },cancel?this.graceMs:this.sourcesTimeoutMs)};
  if(command.type==='sources.page')this.sourceRead=p;else this.sourceControl=p;
  this.sources={...this.sources,pending:true,reading:!!this.sourceRead,cancelling:cancel,error:null};this.publishSources();
  if(!cancel)this.touchSources();
  if(!cancel&&!current()){this.stop('cancelled');return;}
  try{worker.postMessage(command);}catch{this.stop('protocol');}
 }
 private receiveSources(raw:unknown):boolean {
  // Read only through the closed parser; a malformed reply is never interpreted as auth.
  const candidates=[this.sourceRead,this.sourceControl].filter((p):p is SourcesPending=>!!p);
  for(const p of candidates){
   const bridge=parseSourcesBridgeReply(raw,p.command);if(!bridge)continue;
   if(!this.current()||!p.current()||!p.token.current()){this.stop(this.state.phase==='disconnecting'?'logout-unconfirmed':'cancelled');return true;}
   const reply=bridge.reply,offeredSaved=this.sources.rows.find(row=>row.kind==='saved');
   if(bridge.saved&&offeredSaved&&bridge.saved.peerRef!==offeredSaved.peerRef&&!(p.command.type==='sources.page'&&p.command.cursor===null)){this.stop('protocol');return true;}
   clearTimeout(p.timer);p.token.end();this.retired.set(p.command.requestId,p.command);if(this.retired.size>256)this.retired.delete(this.retired.keys().next().value!);
   if(this.sourceRead===p)this.sourceRead=null;if(this.sourceControl===p)this.sourceControl=null;
   if(bridge.sessionClosed){this.stop(this.state.phase==='disconnecting'?'logout-unconfirmed':'cancelled');return true;}
   if(this.state.phase==='disconnecting'){if(!this.sourceControl&&this.queuedLogout){const command=this.queuedLogout;this.queuedLogout=null;try{this.worker!.postMessage(command);}catch{this.stop('logout-unconfirmed');}}return true;}
   if((reply.type==='sources.selected'||reply.type==='sources.cleared')&&reply.revision<=this.sources.revision){this.stop('protocol');return true;}
   if(reply.type==='sources.page'&&p.cancelled){this.cursor=null;this.sources={...this.sources,error:'cancelled'};}
   else if(reply.type==='sources.page'){
    this.cursor=reply.cursor;const rows=p.command.type==='sources.page'&&p.command.cursor===null?reply.items:[...this.sources.rows,...reply.items.filter(row=>!this.sources.rows.some(old=>old.peerRef===row.peerRef))];
    this.sources={...this.sources,rows,end:reply.end};
   }else if(reply.type==='sources.selected')this.sources={...this.sources,selected:reply.peerRefs,revision:reply.revision};
   else if(reply.type==='sources.cleared')this.sources={...this.sources,selected:[],revision:reply.revision};
   else if(reply.type==='sources.error'){this.cursor=null;this.sources={...this.sources,error:reply.error,retryAt:reply.retryAt,retryBlocked:reply.retryBlocked};}
   // Fresh list resets Saved even on an honest page error; never keep the obsolete bootstrap ref.
   if(!bridge.saved){this.cursor=null;this.sources={...this.sources,rows:[],selected:[],error:reply.type==='sources.error'?reply.error:'expired'};}
   if(bridge.saved&&!this.sources.rows.some(row=>row.peerRef===bridge.saved!.peerRef))this.sources={...this.sources,rows:[bridge.saved,...this.sources.rows.filter(row=>row.kind!=='saved')]};
   this.sources={...this.sources,pending:!!(this.sourceRead||this.sourceControl),reading:!!this.sourceRead,cancelling:!!this.sourceControl&&this.sourceControl.command.type==='sources.cancel'};this.publishSources();return true;
  }
  for(const command of this.retired.values())if(parseSourcesBridgeReply(raw,command))return true;
  return false;
 }
 private send(command:SessionCommand,token:ActivityToken,phase:SessionState['phase']){
  if(!this.current()){token.end();this.stop('cancelled');return;}
  const timer=setTimeout(()=>this.stop(command.type==='logout'?'logout-unconfirmed':'timeout'),this.timeoutMs);
  this.pending={request:command.request,token,timer};this.publish({...this.state,phase,error:null});
  if(command.type==='logout'&&this.sourceControl){this.queuedLogout=command;return;}
  try{this.worker!.postMessage(command);}catch{this.stop(command.type==='logout'?'logout-unconfirmed':'protocol');}
 }
 private receive(raw:unknown){
  if(!this.worker)return;
  if(this.receiveSources(raw))return;
  const pending=this.pending;if(!pending){this.stop('protocol');return;}
  if(!this.current()){this.stop('cancelled');return;}
  const reply=parseSessionReply(raw,this.session,pending.request);if(!reply){this.stop('protocol');return;}
  clearTimeout(pending.timer);pending.token.end();this.pending=null;
  if(reply.phase==='connected'){this.sources={...emptySources(),binding:reply.binding,rows:[reply.saved!],listEpoch:1,operationId:crypto.randomUUID()};this.touchSources();this.publishSources();}
  if(reply.phase==='error'||reply.phase==='disconnected'){this.drop();}
  this.publish({phase:reply.phase,error:reply.error,retryAt:reply.retryAt,delivery:reply.delivery});
 }
}
