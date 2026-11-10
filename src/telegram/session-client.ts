import {BOT_SEARCH_BOUNDS,parseBotSearchCommand,type BotSearchCommand,type BotSearchRow,type BotSearchTarget,type BotSearchError,type BotSearchDelivery,type BotDownloadedAudio} from './bot-search-protocol';
import {parseBotSearchBridgeReply} from './bot-search-bridge-protocol';
import {parseBotProvidersCommand,parseBotUsername,type BotProvidersCommand,type BotProviderRow,type BotProvidersReply} from './bot-providers-protocol';
import {parseBotProvidersBridgeReply} from './bot-providers-bridge-protocol';
import type {Activity,ActivityToken} from '../playback/ownership';
import {initialSessionState,parseSessionCommand,parseSessionReply,type SessionCommand,type SessionError,type SessionState} from './session-protocol';
import {SOURCES_BOUNDS,dataRecord,parseSourcesCommand,type AccountBinding,type SourceRow,type SourcesCommand,type Folder,type PageEnd,type SourcesError} from './sources-protocol';
import {parseSourcesBridgeReply} from './sources-bridge-protocol';
export interface SourcesSnapshot {binding:AccountBinding|null;rows:readonly SourceRow[];selected:readonly string[];revision:number;pending:boolean;reading:boolean;cancelling:boolean;folder:Folder|null;end:PageEnd|null;error:SourcesError|null;retryAt:number|null;retryBlocked:boolean;listEpoch:number;operationId:string}
const emptySources=():SourcesSnapshot=>({binding:null,rows:[],selected:[],revision:0,pending:false,reading:false,cancelling:false,folder:null,end:null,error:null,retryAt:null,retryBlocked:false,listEpoch:0,operationId:''});
interface SourcesPending {command:SourcesCommand;token:ActivityToken;current:()=>boolean;timer:ReturnType<typeof setTimeout>;cancelled:boolean}
export interface BotsSnapshot {binding:AccountBinding|null;providers:readonly BotProviderRow[];revision:number;scopeKey:string;pending:boolean;cancelling:boolean;error:string|null;notice:string|null;retryAt:number|null;retryBlocked:boolean}
const emptyBots=():BotsSnapshot=>({binding:null,providers:[],revision:0,scopeKey:'',pending:false,cancelling:false,error:null,notice:null,retryAt:null,retryBlocked:false});
interface BotPlan {worker:SessionWorker;command:BotProvidersCommand;refs:readonly string[];operationId:string;revision:number;epoch:number;token:ActivityToken;current:()=>boolean;timer:ReturnType<typeof setTimeout>;cancelled:boolean;cancelCommand:BotProvidersCommand|null;cancelAck:boolean;done:boolean;result:BotProvidersReply|null;until:number}
export interface BotSearchSnapshot {binding:AccountBinding|null;scopeKey:string;pending:boolean;cancelling:boolean;rows:readonly BotSearchRow[];queryId:string|null;providerRef:string|null;providerRevision:number;expectedTarget:BotSearchTarget|null;delivery:BotSearchDelivery;expiresAt:number|null;error:BotSearchError|null;retryAt:number|null;retryBlocked:boolean;available:boolean;providerNotice:string|null;downloadProgress?:{bytes:number;total:number}|null}
/** Cancellation receipt for this admitted plan only; never looks up a newer plan. */
export interface BotSearchAdmission {readonly queryId:string;readonly cancel:()=>void}
const emptySearch=():BotSearchSnapshot=>({binding:null,scopeKey:'',pending:false,cancelling:false,rows:[],queryId:null,providerRef:null,providerRevision:0,expectedTarget:null,delivery:'not-dispatched',expiresAt:null,error:null,retryAt:null,retryBlocked:false,available:false,providerNotice:null});
interface SearchPlan {worker:SessionWorker;command:Exclude<BotSearchCommand,{type:'bot-search.cancel'}>;token:ActivityToken;current:()=>boolean;timer:ReturnType<typeof setTimeout>;until:number;cancelCommand:BotSearchCommand|null;cancelAck:boolean;done:boolean;cancelled:boolean;resolveDownload?:(audio:BotDownloadedAudio|null)=>void;audio?:BotDownloadedAudio|null}
export interface SessionWorker {onmessage:((event:MessageEvent)=>void)|null;onerror:((event:ErrorEvent)=>void)|null;onmessageerror:((event:MessageEvent)=>void)|null;postMessage(message:SessionCommand|SourcesCommand|BotProvidersCommand|BotSearchCommand):void;terminate():void}
interface Pending {request:string;type:SessionCommand['type'];token:ActivityToken;timer:ReturnType<typeof setTimeout>}
/** One worker under owner authority. Credentials remain worker-private. */
export class TelegramSessionClient {
 private search:BotSearchSnapshot=emptySearch();private searchPlan:SearchPlan|null=null;private searchEpoch=0;private searchGuards=new WeakMap<()=>boolean,()=>boolean>();private retiredSearch=new Map<string,BotSearchCommand>();private searchExpiry:ReturnType<typeof setTimeout>|null=null;
 private bots:BotsSnapshot=emptyBots();private botBinding:AccountBinding|null=null;private botPlan:BotPlan|null=null;private botEpoch=0;private commandEpoch=0;
 private botGuards=new WeakMap<()=>boolean,()=>boolean>();private retiredBots=new Map<string,{command:BotProvidersCommand;refs:readonly string[]}>();
 private remoteRetryAt:number|null=null;private remoteRetryBlocked=false;
 private sources:SourcesSnapshot=emptySources();private sourceRead:SourcesPending|null=null;private sourceControl:SourcesPending|null=null;private cursor:string|null=null;private retired=new Map<string,SourcesCommand>();private queuedLogout:SessionCommand|null=null;private sourcesIdle:ReturnType<typeof setTimeout>|null=null;
 private sourcesUntil:number|null=null;private projectionEpoch=0;private sourcesExpiryDirty=false;
 private worker:SessionWorker|null=null;private session='';private pending:Pending|null=null;private guard:()=>boolean=()=>false;private state:SessionState=initialSessionState();private stopped=false;
 constructor(private activity:Activity,private captureCurrent:()=>()=>boolean,private changed:(state:SessionState)=>void,private factory:()=>SessionWorker=()=>new Worker(new URL('./session.worker.ts',import.meta.url),{type:'module'}),private timeoutMs=45000,private sourcesChanged:(state:SourcesSnapshot)=>void=()=>{},private sourcesTimeoutMs=20000,private graceMs=2000,private botsChanged:(state:BotsSnapshot)=>void=()=>{},private searchChanged:(state:BotSearchSnapshot)=>void=()=>{},private captureCommandCurrent:()=>()=>boolean=captureCurrent){}
 searchSnapshot():BotSearchSnapshot {this.expireSearch();if(this.state.phase==='disconnecting')return emptySearch();return {...this.search,binding:this.search.binding?{...this.search.binding}:null,rows:this.search.rows.map(r=>({...r})),expectedTarget:this.search.expectedTarget?{...this.search.expectedTarget}:null,pending:!!(this.searchPlan||this.botPlan||this.sourceRead||this.sourceControl),cancelling:!!this.searchPlan?.cancelled,retryAt:this.remoteRetryAt,retryBlocked:this.remoteRetryBlocked};}
 private readonly searchListeners=new Set<(snapshot:BotSearchSnapshot)=>void>();
 subscribeSearch(listener:(snapshot:BotSearchSnapshot)=>void):()=>void {this.searchListeners.add(listener);return()=>{this.searchListeners.delete(listener);};}
 private publishSearch(){const snapshot=this.searchSnapshot();this.searchChanged(snapshot);for(const listener of this.searchListeners){try{listener(this.searchSnapshot());}catch{/* Observers do not own transport. */}}}
 private invalidateSearch(){if(this.searchExpiry!==null)clearTimeout(this.searchExpiry);this.searchExpiry=null;this.searchEpoch++;this.search={...this.search,rows:[],queryId:null,providerRef:null,expectedTarget:null,expiresAt:null,error:null,delivery:'not-dispatched',providerNotice:null};}
 private expireSearch(){if(this.search.expiresAt===null||Date.now()<this.search.expiresAt)return;this.invalidateSearch();this.search={...this.search,error:'expired'};const epoch=this.searchEpoch,worker=this.worker;queueMicrotask(()=>{if(this.searchEpoch===epoch&&this.worker===worker)this.publishSearch();});}
 captureSearchCurrent():()=>boolean {this.expireSearch();const lifetime=this.captureBotLifetime(),epoch=this.searchEpoch,query=this.search.queryId;return()=>{this.expireSearch();return lifetime()&&this.state.phase==='connected'&&this.searchEpoch===epoch&&this.search.queryId===query;};}
 captureSearchActionCurrent():()=>boolean {this.expireSearch();const lifetime=this.captureBotLifetime(),admission=this.captureCommandCurrent(),epoch=this.searchEpoch,revision=this.bots.revision,commands=this.commandEpoch;const allowed=()=>{this.expireSearch();return lifetime()&&admission()&&this.state.phase==='connected'&&this.searchEpoch===epoch&&this.bots.revision===revision&&this.commandEpoch===commands;};this.searchGuards.set(allowed,()=>lifetime()&&admission());return allowed;}
 clearSearch(allowed:()=>boolean=this.captureSearchActionCurrent()){if(!this.searchGuards.has(allowed)||!allowed()||this.searchPlan)return;this.invalidateSearch();this.commandEpoch++;this.publishSearch();}
 searchBot(input:{providerRef:string;query:string;target?:BotSearchTarget;consent:true},allowed:()=>boolean=this.captureSearchActionCurrent(),started?:(admission:BotSearchAdmission)=>void){
  const root=this.searchGuards.get(allowed);if(!root||!allowed()||!this.botReady()||!this.remoteAllowed())return;
  let fields:Record<string,unknown>|null;try{fields=dataRecord(input);}catch{return;}if(!fields)return;
  const worker=this.worker!,binding=this.botBinding!;
  const command=parseBotSearchCommand({protocol:'pulso-bot-search',version:1,sessionId:this.session,...binding,providerRevision:this.bots.revision,queryId:crypto.randomUUID(),requestId:crypto.randomUUID(),type:'bot-search.search',...fields});
  if(!command||command.type!=='bot-search.search'||!this.bots.providers.some(r=>r.providerRef===command.providerRef))return;
  if(!allowed()||!root())return;const token=this.activity.begin();if(!token)return;
  this.invalidateSearch();this.commandEpoch++;const epoch=this.searchEpoch,session=this.session,revision=this.bots.revision;
  const p:SearchPlan={worker,command,token,current:()=>root()&&token.current()&&this.worker===worker&&this.session===session&&this.botBinding?.accountRef===binding.accountRef&&this.botBinding?.accountEpoch===binding.accountEpoch&&(this.state.phase==='disconnecting'||this.bots.revision===revision),timer:setTimeout(()=>{if(this.searchPlan===p)this.cancelSearch(p,true);},BOT_SEARCH_BOUNDS.timeoutMs),until:Date.now()+BOT_SEARCH_BOUNDS.timeoutMs,cancelCommand:null,cancelAck:false,done:false,cancelled:false};
  this.searchPlan=p;this.search={...this.search,binding:{...binding},queryId:command.queryId,providerRef:command.providerRef,providerRevision:revision,expectedTarget:command.target??null};this.publishSearch();this.publishBots();this.publishSources();
  if(!p.current()||this.searchEpoch!==epoch){this.stop('cancelled');return;}try{worker.postMessage(command);}catch{this.stop('protocol');return;}
  try{started?.(Object.freeze({queryId:command.queryId,cancel:()=>{if(this.searchPlan===p&&this.state.phase==='connected')this.cancelSearch(p);}}));}catch{/* Observing admission cannot change transport authority. */}
 }
 downloadBot(rowRef:string,allowed:()=>boolean,started?:(admission:BotSearchAdmission)=>void):Promise<BotDownloadedAudio|null> {
  const root=this.searchGuards.get(allowed);this.expireSearch();
  if(!root||!allowed()||!this.botReady()||!this.remoteAllowed()||!this.search.queryId||!this.search.providerRef||!this.search.expectedTarget||!this.search.rows.some(r=>r.rowRef===rowRef&&r.kind!=='message'))return Promise.resolve(null);
  const worker=this.worker!,binding=this.botBinding!,session=this.session,revision=this.bots.revision;
  const command=parseBotSearchCommand({protocol:'pulso-bot-search',version:1,sessionId:session,...binding,providerRevision:revision,queryId:this.search.queryId,requestId:crypto.randomUUID(),type:'bot-search.download',providerRef:this.search.providerRef,rowRef,target:this.search.expectedTarget,consent:true});
  if(command?.type!=='bot-search.download'||!root()||!allowed())return Promise.resolve(null);
  const token=this.activity.begin();if(!token)return Promise.resolve(null);
  this.searchEpoch++;this.commandEpoch++;
  let resolveDownload!:(audio:BotDownloadedAudio|null)=>void;const done=new Promise<BotDownloadedAudio|null>(r=>resolveDownload=r);
  const p:SearchPlan={worker,command,token,current:()=>root()&&token.current()&&this.worker===worker&&this.session===session&&this.botBinding?.accountRef===binding.accountRef&&this.botBinding?.accountEpoch===binding.accountEpoch&&(this.state.phase==='disconnecting'||this.bots.revision===revision),timer:setTimeout(()=>{if(this.searchPlan===p)this.cancelSearch(p,true);},BOT_SEARCH_BOUNDS.downloadMs),until:Date.now()+BOT_SEARCH_BOUNDS.downloadMs,cancelCommand:null,cancelAck:false,done:false,cancelled:false,resolveDownload};
  this.searchPlan=p;this.search={...this.search,error:null,delivery:'not-dispatched',expiresAt:null,providerNotice:null,downloadProgress:{bytes:0,total:0}};if(this.searchExpiry!==null)clearTimeout(this.searchExpiry);this.searchExpiry=null;
  this.publishSearch();this.publishBots();this.publishSources();
  if(!p.current()){this.stop('cancelled');return done;}try{worker.postMessage(command);}catch{this.stop('protocol');return done;}
  try{started?.(Object.freeze({queryId:command.queryId,cancel:()=>{if(this.searchPlan===p&&this.state.phase==='connected')this.cancelSearch(p);}}));}catch{/* Observing admission cannot change transport authority. */}
  return done;
 }
 captureSearchCancel():(()=>void)|undefined {const p=this.searchPlan;if(!p||p.cancelled)return undefined;return()=>{if(this.searchPlan===p&&this.state.phase==='connected')this.cancelSearch(p);};}
 private cancelSearch(p:SearchPlan,timeout=false){
  if(this.searchPlan!==p||p.cancelled||this.worker!==p.worker)return;if(!p.current()){this.quarantineSearch('cancelled');return;}
  const c=p.command,command=parseBotSearchCommand({protocol:c.protocol,version:c.version,sessionId:c.sessionId,accountRef:c.accountRef,accountEpoch:c.accountEpoch,providerRevision:c.providerRevision,queryId:c.queryId,requestId:crypto.randomUUID(),type:'bot-search.cancel',targetRequestId:c.requestId});if(!command){this.stop('protocol');return;}
  p.cancelled=true;p.cancelCommand=command;this.searchEpoch++;this.search={...this.search,rows:[],expiresAt:null,error:timeout?'timeout':'cancelled'};clearTimeout(p.timer);
  p.timer=setTimeout(()=>{if(this.searchPlan===p)this.quarantineSearch(this.state.phase==='disconnecting'?'logout-unconfirmed':timeout?'timeout':'cancelled');},this.graceMs);
  this.publishSearch();if(!p.current()){this.quarantineSearch('cancelled');return;}try{p.worker.postMessage(command);}catch{this.quarantineSearch('protocol');}
 }
 private quarantineSearch(error:SessionError){if(this.searchPlan)this.search={...this.search,delivery:'uncertain'};this.stop(error);}
 private finishSearch(p:SearchPlan){if(this.searchPlan!==p||!p.done||p.cancelCommand&&!p.cancelAck)return;clearTimeout(p.timer);p.token.end();this.searchPlan=null;this.retiredSearch.set(p.command.requestId,p.command);if(p.cancelCommand)this.retiredSearch.set(p.cancelCommand.requestId,p.cancelCommand);while(this.retiredSearch.size>256)this.retiredSearch.delete(this.retiredSearch.keys().next().value!);this.publishSearch();this.publishBots();this.publishSources();this.flushLogout();p.resolveDownload?.(p.cancelled?null:p.audio??null);}
 private receiveSearch(raw:unknown):boolean {
  const p=this.searchPlan;
  if(p)for(const command of [p.command,p.cancelCommand]){if(!command)continue;const bridge=parseBotSearchBridgeReply(raw,command);if(!bridge)continue;
   if(!this.current()||!p.current()){this.quarantineSearch(this.state.phase==='disconnecting'?'logout-unconfirmed':'cancelled');return true;}
   this.observeRemote(bridge);if(bridge.sessionClosed){this.quarantineSearch(this.state.phase==='disconnecting'?'logout-unconfirmed':'cancelled');return true;}
   const reply=bridge.reply;
   if(command===p.cancelCommand){p.cancelAck=true;this.finishSearch(p);return true;}
   if(p.done)return true;
   if(reply.type==='bot-search.error'&&reply.delivery==='not-dispatched'&&this.search.delivery!=='not-dispatched'){this.quarantineSearch('protocol');return true;}
   if(reply.type==='bot-search.provider-notice'){if(p.command.type!=='bot-search.download'||bridge.sessionClosed){this.quarantineSearch('protocol');return true;}if(!p.cancelled&&Date.now()<p.until&&this.search.providerNotice===null){this.search={...this.search,providerNotice:reply.text,delivery:'acknowledged'};this.publishSearch();}return true;}
   if(reply.type==='bot-search.sending'){this.search={...this.search,delivery:'uncertain'};this.publishSearch();return true;}
   if(reply.type==='bot-search.download-progress'){const prev=this.search.downloadProgress;if(prev&&reply.bytes<prev.bytes){this.quarantineSearch('protocol');return true;}this.search={...this.search,downloadProgress:{bytes:reply.bytes,total:reply.total}};this.publishSearch();return true;}
   p.done=true;
   if(reply.type==='bot-search.downloaded'){if(p.command.type!=='bot-search.download'){this.quarantineSearch('protocol');return true;}if(!p.cancelled&&Date.now()<p.until){p.audio=reply.audio;this.search={...this.search,error:null,rows:[],downloadProgress:null};}}
   if(this.state.phase==='connected'){
    if(reply.type==='bot-search.error')this.search={...this.search,delivery:reply.delivery,error:p.cancelled?this.search.error:reply.error};
    else if(reply.type==='bot-search.result'){
     const valid=!p.cancelled&&Date.now()<p.until&&Date.now()<reply.expiresAt&&reply.expiresAt<=Date.now()+BOT_SEARCH_BOUNDS.resultTtlMs;
     this.search={...this.search,delivery:reply.delivery,rows:valid?reply.rows:[],expiresAt:valid?reply.expiresAt:null,error:valid?null:p.cancelled?this.search.error:'expired'};
     if(valid){const epoch=this.searchEpoch;this.searchExpiry=setTimeout(()=>{if(this.searchEpoch===epoch)this.expireSearch();},Math.max(0,reply.expiresAt-Date.now()));}
    }
   }
   this.finishSearch(p);return true;
  }
  for(const command of this.retiredSearch.values())if(parseBotSearchBridgeReply(raw,command))return true;
  return false;
 }
 sourcesSnapshot():SourcesSnapshot{this.expireSources();if(this.state.phase==='disconnecting')return emptySources();return {...this.sources,pending:this.sources.pending||!!this.botPlan||!!this.searchPlan,retryAt:this.remoteRetryAt,retryBlocked:this.remoteRetryBlocked,binding:this.sources.binding?{...this.sources.binding}:null,rows:this.sources.rows.map(r=>({...r})),selected:[...this.sources.selected]};}
 botsSnapshot():BotsSnapshot {if(this.state.phase==='disconnecting')return emptyBots();return {...this.bots,providers:this.bots.providers.map(r=>({...r})),binding:this.bots.binding?{...this.bots.binding}:null,pending:!!(this.botPlan||this.searchPlan||this.sourceRead||this.sourceControl),cancelling:!!this.botPlan?.cancelled,retryAt:this.remoteRetryAt,retryBlocked:this.remoteRetryBlocked};}
 private publishBots(){this.botsChanged(this.botsSnapshot());this.publishSearch();}
 /** Focus authority survives this panel's own ACK; every worker lifetime has a fresh scopeKey. */
 private captureBotLifetime():()=>boolean {const worker=this.worker,session=this.session,binding=this.botBinding,root=this.captureCurrent();return()=>!!worker&&this.worker===worker&&this.session===session&&this.current()&&root()&&!!binding&&this.botBinding?.accountRef===binding.accountRef&&this.botBinding?.accountEpoch===binding.accountEpoch;}
 captureBotsCurrent():()=>boolean {const lifetime=this.captureBotLifetime();return()=>lifetime()&&this.state.phase==='connected';}
 captureBotActionCurrent():()=>boolean {const lifetime=this.captureBotLifetime(),admission=this.captureCommandCurrent(),revision=this.bots.revision,epoch=this.botEpoch,commands=this.commandEpoch;const allowed=()=>admission()&&lifetime()&&this.state.phase==='connected'&&this.bots.revision===revision&&this.botEpoch===epoch&&this.commandEpoch===commands;this.botGuards.set(allowed,()=>admission()&&lifetime());return allowed;}
 captureBotCancel():(()=>void)|undefined {const p=this.botPlan,command=p?.command;if(!p||p.cancelled||command?.type!=='bots.validate')return undefined;return()=>{if(this.botPlan===p&&p.command===command)this.cancelBot(p);};}
 private remoteAllowed(){return !this.remoteRetryBlocked&&(this.remoteRetryAt===null||Date.now()>=this.remoteRetryAt);}
 private observeRemote(reply:{retryAt:number|null;retryBlocked:boolean}) {this.remoteRetryBlocked ||=reply.retryBlocked;if(reply.retryAt!==null)this.remoteRetryAt=Math.max(this.remoteRetryAt??0,reply.retryAt);}
 private botReady(){return !!this.worker&&!this.pending&&!this.botPlan&&!this.searchPlan&&!this.sourceRead&&!this.sourceControl&&this.state.phase==='connected'&&this.current()&&!!this.bots.binding;}
 addBot(input:string,allowed:()=>boolean=this.captureBotActionCurrent()) {this.startBot({kind:'add',input},allowed);}
 moveBot(id:string,direction:'up'|'down',allowed:()=>boolean=this.captureBotActionCurrent()) {this.startBot({kind:'move',id,direction},allowed);}
 removeBot(id:string,allowed:()=>boolean=this.captureBotActionCurrent()) {this.startBot({kind:'remove',id},allowed);}
 private startBot(action:{kind:'add';input:string}|{kind:'move';id:string;direction:'up'|'down'}|{kind:'remove';id:string},allowed:()=>boolean){
  const root=this.botGuards.get(allowed);if(!root||!allowed()||!this.botReady())return;
  const worker=this.worker!,binding=this.bots.binding!,revision=this.bots.revision,refs=this.bots.providers.map(r=>r.providerRef),operationId=crypto.randomUUID();
  this.invalidateSearch();this.botEpoch++;this.commandEpoch++;const epoch=this.botEpoch;
  this.bots={...this.bots,error:null,notice:null};
  if(action.kind==='add'&&(!parseBotUsername(action.input)||refs.length>=5||!this.remoteAllowed())){this.bots={...this.bots,error:refs.length>=5?'Puedes elegir hasta 5 bots.':!parseBotUsername(action.input)?'Escribe un @usuario o enlace público válido.':'Telegram ha limitado las consultas. No se reintentará automáticamente.'};this.publishBots();return;}
  let next=refs.slice();
  if(action.kind!=='add') {const index=refs.indexOf(action.id);if(index<0)return;if(action.kind==='remove')next.splice(index,1);else{const target=index+(action.direction==='up'?-1:1);if(target>=0&&target<next.length)[next[index],next[target]]=[next[target],next[index]];}}
  const command=parseBotProvidersCommand({protocol:'pulso-bot-providers',version:1,sessionId:this.session,...binding,providerRevision:revision,operationId,requestId:crypto.randomUUID(),...(action.kind==='add'?{type:'bots.validate',input:action.input}:{type:'bots.setOrder',expectedRevision:revision,providerRefs:next})});if(!command)return;
  if(!root())return;const token=this.activity.begin();if(!token)return;
  const p:BotPlan={worker,command,refs,revision,operationId,epoch,token,current:()=>root()&&token.current()&&this.worker===worker,timer:setTimeout(()=>{if(this.botPlan!==p||this.worker!==worker)return;if(p.command.type==='bots.validate')this.cancelBot(p,true);else this.stop('timeout');},this.sourcesTimeoutMs),cancelled:false,cancelCommand:null,cancelAck:false,done:false,result:null,until:Date.now()+this.sourcesTimeoutMs};
  this.botPlan=p;this.publishBots();this.publishSources();
  if(!p.current()){this.stop('cancelled');return;}try{worker.postMessage(command);}catch{this.stop('protocol');}
 }
 private cancelBot(p:BotPlan,timeout=false){
  if(this.botPlan!==p||p.cancelled||this.state.phase!=='connected'||p.command.type!=='bots.validate'||p.cancelCommand||this.worker!==p.worker)return;
  p.cancelled=true;this.botEpoch++;
  const {input,...base}=p.command;void input;
  const cancel=parseBotProvidersCommand({...base,type:'bots.cancel',requestId:crypto.randomUUID(),targetRequestId:p.command.requestId});if(!cancel){this.stop('protocol');return;}
  p.cancelCommand=cancel;clearTimeout(p.timer);p.timer=setTimeout(()=>{if(this.worker===p.worker&&this.botPlan===p)this.stop(this.state.phase==='disconnecting'?'logout-unconfirmed':timeout?'timeout':'cancelled');},this.graceMs);
  this.publishBots();if(!p.current()){this.stop('cancelled');return;}try{p.worker.postMessage(cancel);}catch{this.stop('protocol');}
 }
 private finishBot(p:BotPlan){
  if(this.botPlan!==p||!p.done||p.cancelCommand&&!p.cancelAck)return;
  clearTimeout(p.timer);p.token.end();this.botPlan=null;
  this.bots={...this.bots,notice:p.cancelled?'Cambio detenido.':this.bots.notice};this.publishBots();this.publishSources();
  this.flushLogout();
 }
 private flushLogout(){if(this.queuedLogout&&!this.sourceControl&&!this.botPlan&&!this.searchPlan){const command=this.queuedLogout;this.queuedLogout=null;try{this.worker!.postMessage(command);}catch{this.stop('logout-unconfirmed');}}}
 private receiveBots(raw:unknown):boolean {
  const p=this.botPlan;
  if(p){for(const command of [p.command,p.cancelCommand]){if(!command)continue;const bridge=parseBotProvidersBridgeReply(raw,command,p.refs);if(!bridge)continue;
   if(!this.current()||!p.current()){this.stop(this.state.phase==='disconnecting'?'logout-unconfirmed':'cancelled');return true;}
   if(bridge.sessionClosed){this.stop(this.state.phase==='disconnecting'?'logout-unconfirmed':'cancelled');return true;}
   const reply=bridge.reply;if(reply.type==='bots.error')this.observeRemote(reply);
   this.retiredBots.set(command.requestId,{command,refs:p.refs});if(this.retiredBots.size>256)this.retiredBots.delete(this.retiredBots.keys().next().value!);
   if(command===p.cancelCommand){p.cancelAck=true;this.finishBot(p);return true;}
   if(p.done)return true;
   // A dispatched order may already have committed. Never keep an old local revision alive
   // after its ACK deadline; closing this exact worker purges both sides' RAM preferences.
   if(reply.type==='bots.ordered'&&this.state.phase==='connected'&&Date.now()>=p.until){this.stop('timeout');return true;}
   const continuation=Date.now()<p.until&&!p.cancelled&&this.botEpoch===p.epoch&&this.bots.revision===p.revision&&this.state.phase==='connected';
   if(reply.type==='bots.validated'&&continuation){
    if(p.refs.includes(reply.offer.providerRef)){this.bots={...this.bots,notice:'Este bot ya está añadido.'};p.done=true;this.finishBot(p);return true;}
    const {offer,...base}=reply;void offer;
    const next=parseBotProvidersCommand({...base,type:'bots.setOrder',requestId:crypto.randomUUID(),expectedRevision:p.revision,providerRefs:[...p.refs,reply.offer.providerRef]});
    if(!next||!p.current()||!continuation){this.stop('protocol');return true;}
    p.command=next;this.publishBots();if(!p.current()){this.stop('cancelled');return true;}try{p.worker.postMessage(next);}catch{this.stop('protocol');}return true;
   }
   if(reply.type==='bots.ordered'&&continuation)this.bots={...this.bots,revision:reply.revision,providers:reply.providers,error:null,notice:reply.changed?'Orden de bots confirmado.':'El orden ya estaba confirmado.'};
   else if(reply.type==='bots.error'&&continuation)this.bots={...this.bots,error:botErrorText(reply)};
   else if(this.state.phase==='connected'&&!p.cancelled&&Date.now()>=p.until)this.bots={...this.bots,error:'La comprobación no terminó a tiempo.'};
   p.result=reply;p.done=true;this.finishBot(p);return true;
  }}
  for(const old of this.retiredBots.values())if(parseBotProvidersBridgeReply(raw,old.command,old.refs))return true;
  return false;
 }
 private publishSources(){this.publishSearch();const snapshot=this.sourcesSnapshot();this.sourcesExpiryDirty=false;this.sourcesChanged(snapshot);}
 /** Expiry can be discovered during a render-time capture: notify later, without render callbacks. */
 private expireSources(){if(this.sourcesUntil===null||Date.now()<this.sourcesUntil)return false;if(this.sourcesIdle!==null)clearTimeout(this.sourcesIdle);this.sourcesIdle=null;this.sourcesUntil=null;this.projectionEpoch++;this.cursor=null;this.sources={...this.sources,rows:[],selected:[],error:'expired'};this.sourcesExpiryDirty=true;const worker=this.worker,epoch=this.projectionEpoch;queueMicrotask(()=>{if(this.worker===worker&&this.projectionEpoch===epoch&&this.sourcesExpiryDirty)this.publishSources();});return true;}
 captureSessionCurrent():()=>boolean {const worker=this.worker,session=this.session,state=this.state,current=this.captureCommandCurrent();return()=>!this.stopped&&this.worker===worker&&this.session===session&&this.state===state&&current();}
 captureLocalStop():()=>boolean {const worker=this.worker,session=this.session;return()=>{if(!worker||this.worker!==worker||this.session!==session)return false;this.stop('cancelled');return true;};}
 captureCancel():()=>void {const worker=this.worker,read=this.sourceRead;return()=>{if(read&&this.worker===worker&&this.sourceRead===read)this.cancel();};}
 snapshot():SessionState{return {...this.state};}
 private current(){try{return !this.stopped&&this.guard();}catch{return false;}}
 private publish(state:SessionState){this.state={...state};this.changed(this.snapshot());}
 private drop(){if(this.searchPlan){clearTimeout(this.searchPlan.timer);this.searchPlan.token.end();this.searchPlan.resolveDownload?.(null);this.searchPlan=null;}this.invalidateSearch();this.retiredSearch.clear();this.search=emptySearch();const w=this.worker;this.worker=null;if(w){w.onmessage=w.onerror=w.onmessageerror=null;w.terminate();}if(this.pending){clearTimeout(this.pending.timer);this.pending.token.end();this.pending=null;}this.queuedLogout=null;if(this.botPlan){clearTimeout(this.botPlan.timer);this.botPlan.token.end();this.botPlan=null;}this.botEpoch++;this.commandEpoch++;this.retiredBots.clear();this.remoteRetryAt=null;this.remoteRetryBlocked=false;this.bots=emptyBots();this.botBinding=null;this.publishBots();this.session='';this.guard=()=>false;for(const p of [this.sourceRead,this.sourceControl])if(p){clearTimeout(p.timer);p.token.end();}this.sourceRead=this.sourceControl=null;this.cursor=null;this.retired.clear();if(this.sourcesIdle!==null)clearTimeout(this.sourcesIdle);this.sourcesIdle=null;this.sourcesUntil=null;this.projectionEpoch++;this.sources=emptySources();this.publishSources();}
 stop(error:SessionError|null='cancelled'){const uncertain=!!this.searchPlan&&this.search.delivery!=='not-dispatched';this.drop();if(uncertain)this.search={...emptySearch(),delivery:'uncertain',error:'uncertain'};if(!this.stopped)this.publish(error?{...initialSessionState(),phase:'error',error}:initialSessionState());if(uncertain)this.publishSearch();}
 dispose(){this.stopped=true;this.drop();}
 revalidate(){if(this.worker&&!this.current())this.stop('cancelled');else{this.expireSearch();this.expireSources();if(this.sourcesExpiryDirty)this.publishSources();}}
 restore(){this.startAuthentication('restore','','restoring');}
 forgetSavedSession(){this.startAuthentication('forget','','disconnecting');}
 begin(phone:string){this.startAuthentication('begin',phone,'sending-code');}
 private startAuthentication(type:'begin'|'restore'|'forget',value:string,phase:'sending-code'|'restoring'|'disconnecting'){
  if(this.stopped||this.pending||this.worker||this.state.retryAt!==null&&Date.now()<this.state.retryAt)return;
  const current=this.captureCurrent(),admission=this.captureCommandCurrent();let valid=false;try{valid=current()&&admission();}catch{/* Denied. */}if(!valid)return;
  const session=crypto.randomUUID(),request=crypto.randomUUID();const command=parseSessionCommand({version:2,session,request,type,value});
  if(!command){this.publish({...initialSessionState(),phase:'error',error:'phone-invalid'});return;}
  const token=this.activity.begin();if(!token)return;
  this.guard=()=>current()&&token.current();this.session=session;
  try{const worker=this.factory();this.worker=worker;const live=()=>this.worker===worker&&this.session===session;worker.onmessage=event=>{if(live())this.receive(event.data);};worker.onerror=event=>{if(live()){event.preventDefault?.();this.stop(this.pending?.type==='forget'?'session-storage':this.state.phase==='disconnecting'?'logout-unconfirmed':'network');}};worker.onmessageerror=()=>{if(live())this.stop(this.pending?.type==='forget'?'session-storage':this.state.phase==='disconnecting'?'logout-unconfirmed':'protocol');};this.send(command,token,phase);}catch{token.end();this.stop('internal');}
 }
 submit(type:'code'|'password',value:string){
  if(!this.worker||this.pending||!this.current()||this.state.retryAt!==null&&Date.now()<this.state.retryAt)return;
  if(type==='code'&&this.state.phase!=='code'||type==='password'&&this.state.phase!=='password')return;
  const command=parseSessionCommand({version:2,session:this.session,request:crypto.randomUUID(),type,value});if(!command)return;
  if(!this.captureCommandCurrent()())return;const token=this.activity.begin();if(!token)return;this.send(command,token,'authorizing');
 }
 logout(){if(!this.worker||this.pending||!this.current()||this.state.phase!=='connected')return;const current=this.captureCommandCurrent();if(!current())return;const token=this.activity.begin();if(!token)return;if(this.searchPlan)this.cancelSearch(this.searchPlan);this.invalidateSearch();this.botEpoch++;if(this.botPlan)this.botPlan.cancelled=true;this.bots=emptyBots();this.publishBots();this.sources={...this.sources,rows:[],selected:[]};this.send({version:2,session:this.session,request:crypto.randomUUID(),type:'logout',value:''},token,'disconnecting');this.publishSources();}
 /** Capture on render/gesture; stale React closures cannot act on a replacement session or list. */
 captureSourcesCurrent():()=>boolean {this.expireSources();const worker=this.worker,session=this.session,binding=this.sources.binding,epoch=this.sources.listEpoch,operation=this.sources.operationId,revision=this.sources.revision,projectionEpoch=this.projectionEpoch,commands=this.commandEpoch,current=this.captureCommandCurrent();return()=>{this.expireSources();return this.worker===worker&&this.session===session&&this.current()&&current()&&this.projectionEpoch===projectionEpoch&&this.commandEpoch===commands&&(this.sourcesUntil===null||Date.now()<this.sourcesUntil)&&!!binding&&this.sources.binding?.accountRef===binding.accountRef&&this.sources.binding?.accountEpoch===binding.accountEpoch&&this.sources.listEpoch===epoch&&this.sources.operationId===operation&&this.sources.revision===revision;};}
 consult(folder:Folder,allowed:()=>boolean=this.captureSourcesCurrent()){if(!allowed()||!this.sourceReady()||!this.remoteAllowed())return;this.sources={...this.sources,listEpoch:this.sources.listEpoch+1,operationId:crypto.randomUUID(),rows:[],selected:[],revision:0,folder,end:null};this.cursor=null;this.dispatchSource({type:'sources.page',folder,cursor:null});}
 more(allowed:()=>boolean=this.captureSourcesCurrent()){if(!allowed()||!this.sourceReady()||!this.remoteAllowed()||!this.cursor||!this.sources.folder)return;const cursor=this.cursor;this.cursor=null;this.dispatchSource({type:'sources.page',folder:this.sources.folder,cursor});}
 confirm(peerRefs:readonly string[],allowed:()=>boolean=this.captureSourcesCurrent()){if(!allowed()||!this.sourceReady()||peerRefs.length>20||new Set(peerRefs).size!==peerRefs.length||peerRefs.some(ref=>!this.sources.rows.some(row=>row.peerRef===ref)))return;this.dispatchSource({type:'sources.select',peerRefs});}
 clear(allowed:()=>boolean=this.captureSourcesCurrent()){if(allowed()&&this.sourceReady())this.dispatchSource({type:'sources.clear'});}
 cancel(){const read=this.sourceRead,worker=this.worker;if(!worker||!read||this.sourceControl||this.state.phase!=='connected')return;read.cancelled=true;this.cursor=null;clearTimeout(read.timer);read.timer=setTimeout(()=>{if(this.worker===worker&&this.sourceRead===read)this.stop(this.state.phase==='disconnecting'?'logout-unconfirmed':'timeout');},this.graceMs);this.dispatchSource({type:'sources.cancel',targetRequestId:read.command.requestId},true);}
 private touchSources(){if(this.sourcesIdle!==null)clearTimeout(this.sourcesIdle);const worker=this.worker;this.sourcesUntil=Date.now()+SOURCES_BOUNDS.idleMs;this.sourcesIdle=setTimeout(()=>{if(this.worker!==worker)return;if(!this.current()){this.stop('cancelled');return;}if(this.expireSources()||this.sourcesExpiryDirty)this.publishSources();},SOURCES_BOUNDS.idleMs);}
 private sourceReady(){this.expireSources();return !!this.worker&&!this.pending&&!this.botPlan&&!this.searchPlan&&!this.sourceRead&&!this.sourceControl&&this.state.phase==='connected'&&this.current()&&!!this.sources.binding;}
 private dispatchSource(fields:{type:'sources.page';folder:Folder;cursor:string|null}|{type:'sources.select';peerRefs:readonly string[]}|{type:'sources.clear'}|{type:'sources.cancel';targetRequestId:string},cancel=false){
  const worker=this.worker,binding=this.sources.binding;if(!worker||!binding)return;
  if(!cancel){this.invalidateSearch();this.commandEpoch++;}const current=cancel?this.sourceRead!.current:this.captureSourcesCurrent();if(!cancel&&!current())return;
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
  this.sources={...this.sources,pending:true,reading:!!this.sourceRead,cancelling:cancel,error:null};this.publishSources();this.publishBots();
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
   const reply=bridge.reply;if(reply.type==='sources.error')this.observeRemote(reply);const offeredSaved=this.sources.rows.find(row=>row.kind==='saved');
   if(bridge.saved&&offeredSaved&&bridge.saved.peerRef!==offeredSaved.peerRef&&!(p.command.type==='sources.page'&&p.command.cursor===null)){this.stop('protocol');return true;}
   clearTimeout(p.timer);p.token.end();this.retired.set(p.command.requestId,p.command);if(this.retired.size>256)this.retired.delete(this.retired.keys().next().value!);
   if(this.sourceRead===p)this.sourceRead=null;if(this.sourceControl===p)this.sourceControl=null;
   if(bridge.sessionClosed){this.stop(this.state.phase==='disconnecting'?'logout-unconfirmed':'cancelled');return true;}
   if(this.state.phase==='disconnecting'){this.flushLogout();return true;}
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
   this.sources={...this.sources,pending:!!(this.sourceRead||this.sourceControl),reading:!!this.sourceRead,cancelling:!!this.sourceControl&&this.sourceControl.command.type==='sources.cancel'};this.publishSources();this.publishBots();return true;
  }
  for(const command of this.retired.values())if(parseSourcesBridgeReply(raw,command))return true;
  return false;
 }
 private send(command:SessionCommand,token:ActivityToken,phase:SessionState['phase']){
  if(!this.current()){token.end();this.stop('cancelled');return;}
  const timer=setTimeout(()=>this.stop(command.type==='forget'?'session-storage':command.type==='logout'?'logout-unconfirmed':'timeout'),this.timeoutMs);
  this.pending={request:command.request,type:command.type,token,timer};this.publish({...this.state,phase,error:null});
  if(command.type==='logout'&&(this.searchPlan||this.sourceControl||this.botPlan?.cancelCommand)){this.queuedLogout=command;return;}
  try{this.worker!.postMessage(command);}catch{this.stop(command.type==='logout'?'logout-unconfirmed':'protocol');}
 }
 private receive(raw:unknown){
  if(!this.worker)return;
  if(this.receiveSearch(raw)||this.receiveBots(raw)||this.receiveSources(raw))return;
  const pending=this.pending;if(!pending){this.stop('protocol');return;}
  if(!this.current()){this.stop('cancelled');return;}
  const reply=parseSessionReply(raw,this.session,pending.request);if(!reply){this.stop('protocol');return;}
  clearTimeout(pending.timer);pending.token.end();this.pending=null;
  if(reply.phase==='connected'){this.search={...emptySearch(),binding:reply.binding,scopeKey:crypto.randomUUID(),available:true};this.botBinding=reply.binding;this.bots={...emptyBots(),binding:reply.binding,providers:reply.bots??[],scopeKey:crypto.randomUUID()};this.botEpoch++;this.publishBots();this.sources={...emptySources(),binding:reply.binding,rows:[reply.saved!],listEpoch:1,operationId:crypto.randomUUID()};this.touchSources();this.publishSources();}
  if(reply.phase==='error'||reply.phase==='disconnected'){this.drop();}
  this.publish({phase:reply.phase,error:reply.error,retryAt:reply.retryAt,delivery:reply.delivery});
 }
}

function botErrorText(reply:Extract<BotProvidersReply,{type:'bots.error'}>):string {const errors={cancelled:'Cambio detenido.',timeout:'La comprobación no terminó a tiempo.',busy:'Hay otra consulta pendiente.',expired:'El cambio ya no está vigente. Vuelve a intentarlo.', 'session-expired':'La conexión temporal ha caducado.',limit:'Se alcanzó el límite de bots o de esta sesión.',unsupported:'No se pudo comprobar un perfil de bot válido.', 'identity-changed':'El identificador ha cambiado de propietario. Vuelve a conectar.', 'rate-limit':'Telegram ha limitado las consultas. No se reintentará automáticamente.',network:'No se pudo comprobar el perfil.'};return errors[reply.error];}
