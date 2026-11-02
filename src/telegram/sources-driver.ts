import type {tl} from '@mtcute/core';
import {SOURCES_BOUNDS as B,copyEnvelope,isUuid,parseAccountBinding,parseSourcesCommand,parseSourcesReply,utf8Bytes,type AccountBinding,type Envelope,type Folder,type SourceRow,type SourcesError,type SourcesReply} from './sources-protocol';
import {projectSourcesPage,ProjectionLimit,type PageAnchor,type ProjectedCandidate} from './sources-page';
/** Worker-private, deliberately no generic call/resolve/search capability. */
export interface DialogsRequest {readonly folderId:0|1;readonly excludePinned:boolean;readonly offsetId:number;readonly offsetDate:number;readonly offsetPeer:tl.TypeInputPeer;readonly limit:25}
export interface SourcesDependency {getDialogs(request:DialogsRequest,signal:AbortSignal):Promise<unknown>;invalidateSession():void}
export interface SourcesContext {readonly signal:AbortSignal;readonly current:()=>boolean}
export interface SourcesDriver {
 getSaved():SourceRow|null;
 handle(raw:unknown,context:SourcesContext):Promise<SourcesReply|null>;
 close():void;
 /** Abort and purge locally; true only when the active read actually settled. No remote logout. */
 quiesce():Promise<boolean>;
 /** Snapshot of the last read's actual settlement/forced-close result; does not cancel. */
 whenSettled():Promise<boolean>;
}
export interface SourcesClock {now():number;setTimeout(fn:()=>void,ms:number):ReturnType<typeof setTimeout>;clearTimeout(timer:ReturnType<typeof setTimeout>):void}
const clock:SourcesClock={now:()=>Date.now(),setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:t=>clearTimeout(t)};
interface Failure {error:SourcesError;retryAt:number|null;retryBlocked:boolean}
const failure=(error:SourcesError):Failure=>({error,retryAt:null,retryBlocked:false});
/** Reads only own data fields of an error, including SDK RpcError's normalized text/seconds. */
export function sourcesFailure(error:unknown,now:number):Failure {
 const field=(key:string):unknown=>error&&typeof error==='object'?Object.getOwnPropertyDescriptor(error,key)?.value:undefined;
 const text=field('text')??field('errorMessage')??field('message');
 if(typeof text!=='string'||text.length>512)return failure('network');
 if(/^FLOOD_(?:PREMIUM_)?WAIT(?:_|$)/.test(text)){
  const match=/_(\d+)$/.exec(text);const seconds=match?Number(match[1]):field('seconds');
  const until=typeof seconds==='number'&&Number.isSafeInteger(seconds)&&seconds>=0?now+Math.max(1,seconds)*1000:NaN;
  const retryAt=Number.isSafeInteger(until)&&until>now&&until<=8640000000000000?until:null;
  return {error:'rate-limit',retryAt,retryBlocked:retryAt===null};
 }
 if(/^(AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED|USER_DEACTIVATED_BAN)$/.test(text))return failure('session-expired');
 if(/^(CHANNEL_PRIVATE|CHAT_FORBIDDEN|USER_BANNED_IN_CHANNEL|CHAT_ADMIN_REQUIRED)$/.test(text))return failure('access');
 return failure('network');
}
/** Construct only after actual auth User validation. No IO occurs until an explicit page command.
 * The caller must supply its original non-reviving authority capture in context.current.
 * Returned replies still require a receiving guard; an envelope is correlation, not authority.
 */
export function createSourcesDriver(bindingInput:AccountBinding,sessionId:string,dependency:SourcesDependency,time:SourcesClock=clock):SourcesDriver {
 const binding=parseAccountBinding(bindingInput);if(!binding||!isUuid(sessionId))throw Error('protocol');
 let closed=false,invalidated=false,epoch=0,operation='',folder:Folder='main',calls=0,accepted=0,revision=0;
 let cooldown:Failure|null=null,idle:ReturnType<typeof setTimeout>|undefined,idleUntil:number|null=null;
 let cursor:{ref:string;anchor:PageAnchor;until:number}|null=null;
 let saved:SourceRow|null=null;const offered=new Map<string,{row:SourceRow;candidate:ProjectedCandidate}>();const identities=new Map<string,string>();let selected:readonly string[]=Object.freeze([]);
 const requests=new Set<string>(),anchors=new Set<string>();
 type Flight={request:string;abort:AbortController;cause:Failure|null;settled:Promise<boolean>;release:()=>void;stop:(cause:Failure)=>void};let flight:Flight|null=null;let settlement=Promise.resolve(true);
 const uuid=()=>crypto.randomUUID();
 const purge=()=>{cursor=null;anchors.clear();offered.clear();identities.clear();selected=Object.freeze([]);saved=null;};
 const close=()=>{if(closed)return;closed=true;if(idle!==undefined)time.clearTimeout(idle);idle=undefined;idleUntil=null;purge();requests.clear();cooldown=null;flight?.stop(failure('cancelled'));};
 const invalidate=()=>{close();if(!invalidated){invalidated=true;dependency.invalidateSession();}};
 const resetSaved=()=>{saved=Object.freeze({peerRef:uuid(),kind:'saved',name:'Mensajes guardados'});offered.set(saved.peerRef,{row:saved,candidate:Object.freeze({key:'saved',kind:'saved',name:saved.name,peer:{_: 'inputPeerSelf' as const}})});};
 // Timers are cleanup aids; a suspended callback must never extend a reference's authority.
 const expire=()=>{if(idleUntil!==null&&time.now()>=idleUntil){if(idle!==undefined)time.clearTimeout(idle);idle=undefined;idleUntil=null;purge();}};
 const touch=()=>{if(idle!==undefined)time.clearTimeout(idle);idleUntil=time.now()+B.idleMs;idle=time.setTimeout(()=>{idle=undefined;expire();},B.idleMs);};
 resetSaved();touch();
 function response(e:Envelope,reason:Failure):SourcesReply{return Object.freeze({...copyEnvelope(e),type:'sources.error',error:reason.error,retryAt:reason.retryAt,retryBlocked:reason.retryBlocked});}
 function live(ctx:SourcesContext):boolean {try{return !closed&&!ctx.signal.aborted&&ctx.current();}catch{return false;}}
 const retained=(next:readonly ProjectedCandidate[]):number=>{
  // Conservative serialization accounting (not JS heap); include private peers and RAM indexes.
  // Long is converted by a controlled replacer only for our own copied projection values.
  const encode=(v:unknown)=>JSON.stringify(v,(_k,x)=>typeof x==='bigint'?String(x):x);
  let size=offered.size*256+selected.length*80+requests.size*80+anchors.size*160+1024;
  for(const v of offered.values())size+=utf8Bytes(encode(v));
  for(const v of next)size+=utf8Bytes(encode(v))+512;
  return size;
 };
 const driver:SourcesDriver={
  getSaved(){expire();return closed?null:saved;},
  close,
  quiesce(){close();return settlement;},
  whenSettled(){return settlement;},
  async handle(raw,ctx){
   const command=parseSourcesCommand(raw);if(!command)return null;const e=copyEnvelope(command);
   if(closed||command.sessionId!==sessionId||command.accountRef!==binding.accountRef||command.accountEpoch!==binding.accountEpoch)return response(e,failure('session-expired'));
   if(!live(ctx)){invalidate();return response(e,failure('cancelled'));}
   expire();
   if(requests.has(command.requestId))return response(e,failure('expired'));
   if(requests.size>=B.requestIds){invalidate();return response(e,failure('limit'));}requests.add(command.requestId);
   if(command.type==='sources.cancel'){
    if(command.listEpoch!==epoch||command.operationId!==operation||!flight||flight.request!==command.targetRequestId)return response(e,failure('expired'));
    cursor=null;flight.stop(failure('cancelled'));
    return Object.freeze({...e,type:'sources.cancelled',targetRequestId:command.targetRequestId});
   }
   if(flight)return response(e,failure('access'));
   const fresh=command.type==='sources.page'&&command.cursor===null;
   if(fresh||epoch===0){
    if(command.listEpoch<=epoch||command.operationId===operation||(!fresh&&command.type!=='sources.select'&&command.type!=='sources.clear'))return response(e,failure('expired'));
    epoch=command.listEpoch;operation=command.operationId;
    if(fresh){purge();resetSaved();folder=command.folder;}
   }else if(command.listEpoch!==epoch||command.operationId!==operation)return response(e,failure('expired'));
   if(!saved){if(!fresh)return response(e,failure('expired'));resetSaved();}
   touch();
   if(command.type==='sources.select'){
    if(command.peerRefs.some(ref=>!offered.has(ref)))return response(e,failure('expired'));
    // ACK is produced only after both parsing and the captured current guard succeed.
    if(!live(ctx)){invalidate();return response(e,failure('cancelled'));}
    selected=Object.freeze(command.peerRefs.slice());return Object.freeze({...e,type:'sources.selected',revision:++revision,peerRefs:selected});
   }
   if(command.type==='sources.clear'){selected=Object.freeze([]);return Object.freeze({...e,type:'sources.cleared',revision:++revision});}
   if(cooldown&&(cooldown.retryBlocked||(cooldown.retryAt!==null&&cooldown.retryAt>time.now())))return response(e,cooldown);
   cooldown=null;
   let anchor:PageAnchor|null=null;
   if(command.cursor!==null){
    const held=cursor;cursor=null;
    if(command.folder!==folder||!held||held.ref!==command.cursor||held.until<=time.now())return response(e,failure('expired'));
    anchor=held.anchor;
   }
   if(calls>=B.calls||accepted>=B.dialogs){cursor=null;return response(e,failure('limit'));}
   calls++;
   const abort=new AbortController();let wake!:(v:Failure)=>void;const stopped=new Promise<Failure>(resolve=>{wake=resolve;});
   let settle!:(value:boolean)=>void;const settled=new Promise<boolean>(resolve=>{settle=resolve;});
   let grace:ReturnType<typeof setTimeout>|undefined;
   const f:Flight={request:command.requestId,abort,cause:null,settled,release(){},stop(cause){if(f.cause)return;f.cause=cause;cursor=null;wake(cause);abort.abort();grace=time.setTimeout(()=>{if(flight===f){invalidate();f.release();settle(false);if(flight===f)flight=null;}},B.settlementMs);}};
   flight=f;settlement=settled;
   const onAbort=()=>f.stop(failure('cancelled'));ctx.signal.addEventListener('abort',onAbort,{once:true});
   const deadline=time.now()+B.timeoutMs;
   const timer=time.setTimeout(()=>f.stop(failure('timeout')),B.timeoutMs);
   f.release=()=>{ctx.signal.removeEventListener('abort',onAbort);time.clearTimeout(timer);if(grace!==undefined)time.clearTimeout(grace);};
   const observeFailure=(error:unknown):Failure=>{
    const cause=sourcesFailure(error,time.now());if(!f.cause)f.cause=cause;
    // Session lifecycle is independent of the first visible cause of this attempt.
    if(cause.error==='session-expired')invalidate();
    else if(!closed&&cause.error==='rate-limit')cooldown=cause;
    return f.cause;
   };
   // The RPC promise remains observed after cancellation. No second RPC before settlement.
   const request:DialogsRequest=Object.freeze({folderId:folder==='main'?0:1,excludePinned:anchor!==null,offsetId:anchor?.offsetId??0,offsetDate:anchor?.offsetDate??0,offsetPeer:anchor?.offsetPeer??{_: 'inputPeerEmpty' as const},limit:25});
   const rpc=Promise.resolve().then(()=>{
    if(!live(ctx)||f.cause){f.stop(failure('cancelled'));return {ok:false as const,cause:f.cause!};}
    return dependency.getDialogs(request,abort.signal).then(raw=>({ok:true as const,raw}),error=>({ok:false as const,cause:observeFailure(error)}));
   }).catch(error=>({ok:false as const,cause:observeFailure(error)})).finally(()=>{
    settle(true);f.release();if(flight===f)flight=null;
   });
   const outcome=await Promise.race([rpc,stopped.then(cause=>({ok:false as const,cause}))]);
   if(!outcome.ok){if(outcome.cause.error==='session-expired')invalidate();return response(e,outcome.cause);}
   if(f.cause)return response(e,f.cause);
   if(!live(ctx)){invalidate();return response(e,failure('cancelled'));}
   if(time.now()>=deadline){cursor=null;return response(e,failure('timeout'));}
   try{
    const page=projectSourcesPage(outcome.raw,anchor,folder);accepted+=page.dialogs;
    const next=page.candidates.filter(c=>!identities.has(c.key));
    if(accepted>B.dialogs||offered.size+next.length>B.candidates||retained(next)>B.retainedBytes)throw new ProjectionLimit();
    const items:SourceRow[]=[];if(fresh&&saved)items.push(saved);
    for(const c of next){const row:SourceRow=Object.freeze({peerRef:uuid(),kind:c.kind,name:c.name});offered.set(row.peerRef,{row,candidate:c});identities.set(c.key,row.peerRef);items.push(row);}
    let end:Extract<SourcesReply,{type:'sources.page'}>['end']=page.end;
    if(end==='more'&&page.anchor){if(anchors.has(page.anchor.key))end='cursor-unavailable';else anchors.add(page.anchor.key);}
    if(end==='more'&&(calls>=B.calls||accepted>=B.dialogs))end='limit';
    cursor=end==='more'&&page.anchor?{ref:uuid(),anchor:page.anchor,until:time.now()+B.cursorMs}:null;
    const reply:SourcesReply=Object.freeze({...e,type:'sources.page',folder:command.folder,items:Object.freeze(items),cursor:cursor?.ref??null,end});
    if(!parseSourcesReply(reply,e))throw new ProjectionLimit();return reply;
   }catch(error){invalidate();return response(e,failure(error instanceof ProjectionLimit?'limit':'internal'));}
  },
 };
 return Object.freeze(driver);
}
