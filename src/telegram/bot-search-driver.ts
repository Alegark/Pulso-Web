import Long from 'long';
import type {tl} from '@mtcute/core';
import type {BaseTelegramClient} from '@mtcute/core/client.js';
import {botProvidersFailure,type BotProvidersClock,type BotSearchProviderCapture,type BotProvidersDriver} from './bot-providers-driver';
import {isUuid,parseAccountBinding,type AccountBinding} from './sources-protocol';
import {BOT_SEARCH_BOUNDS as B,copyBotSearchEnvelope,formatBotSearchQuery,parseBotSearchCommand,type BotSearchEnvelope,type BotSearchReply,type BotSearchError,type BotSearchDelivery} from './bot-search-protocol';
import {assertBotSearchRawBudget,botSearchAck,botSearchBaseline,BotSearchProjectionError,projectBotSearchPage,type BotSearchPrivateRef} from './bot-search-page';
/** Inject only inside the worker. No generic RPC, root peers or arbitrary message identifiers. */
export interface BotSearchDependency {
 captureProvider(ref:string,revision:number):BotSearchProviderCapture|null;
 resolveIdentity(username:string,signal:AbortSignal,timeoutMs:number):Promise<unknown>;
 readHistory(peer:tl.TypeInputPeer,minId:number,limit:1|20,signal:AbortSignal,timeoutMs:number):Promise<unknown>;
 sendQuery(peer:tl.TypeInputPeer,query:string,randomId:Long,signal:AbortSignal,timeoutMs:number):Promise<unknown>;
 invalidateSession():void;
 getAccountCooldown?():{readonly retryAt:number|null;readonly retryBlocked:boolean}|null;
}
export interface BotSearchContext {readonly signal:AbortSignal;readonly current:()=>boolean;readonly publish?:(reply:BotSearchReply)=>void}
export interface BotSearchDriver {
 handle(raw:unknown,context:BotSearchContext):Promise<BotSearchReply|null>;
 whenSettled():Promise<boolean>;
 quiesce():Promise<boolean>;
 close():void;
}
const clock:BotProvidersClock={now:()=>Date.now(),setTimeout:(f,n)=>setTimeout(f,n),clearTimeout:t=>clearTimeout(t)};
interface Failure {error:BotSearchError;retryAt:number|null;retryBlocked:boolean}
const fail=(error:BotSearchError):Failure=>({error,retryAt:null,retryBlocked:false});
const randomLong=()=>{const a=crypto.getRandomValues(new Int32Array(2));return new Long(a[0],a[1],false);};
/** One flight including original RPC settlement; no queue/retry/fallback. Neither a cancel ACK
 * nor an early result retires its physical lane. false settlement quarantines the exact session.
 * Final DTOs also require the receiving root's original non-reviving authority before UI use. */
export function createBotSearchDriver(bindingInput:AccountBinding,sessionId:string,dependency:BotSearchDependency,time:BotProvidersClock=clock):BotSearchDriver {
 const binding=parseAccountBinding(bindingInput);if(!binding||!isUuid(sessionId))throw Error('protocol');
 let closed=false,invalidated=false,settlement=Promise.resolve(true),cooldown:Failure|null=null;
 const requests=new Set<string>(),queries=new Set<string>();
 // Future selection is intentionally unavailable. These bounded opaque handles have no public accessor.
 let retained:ReadonlyMap<string,BotSearchPrivateRef>=new Map(),retainedUntil=0;
 type Flight={e:BotSearchEnvelope;delivery:BotSearchDelivery;cause:Failure|null;stop(f:Failure):void};let flight:Flight|null=null;
 const close=()=>{if(closed)return;closed=true;retained=new Map();retainedUntil=0;requests.clear();queries.clear();flight?.stop(fail('cancelled'));};
 const invalidate=()=>{close();if(!invalidated){invalidated=true;dependency.invalidateSession();}};
 const live=(ctx:BotSearchContext,capture?:BotSearchProviderCapture)=>{try{return !closed&&!ctx.signal.aborted&&ctx.current()&&(!capture||capture.current());}catch{return false;}};
 const response=(e:BotSearchEnvelope,f:Failure,delivery:BotSearchDelivery):BotSearchReply=>Object.freeze({...copyBotSearchEnvelope(e),type:'bot-search.error',...f,delivery});
 return Object.freeze({close,quiesce(){close();return settlement;},whenSettled(){return settlement;},
  async handle(raw:unknown,context:BotSearchContext):Promise<BotSearchReply|null>{
   const ctx=Object.freeze({signal:context.signal,current:context.current,publish:context.publish});
   const c=parseBotSearchCommand(raw);if(!c)return null;const e=copyBotSearchEnvelope(c);
   if(closed||e.sessionId!==sessionId||e.accountRef!==binding.accountRef||e.accountEpoch!==binding.accountEpoch)return response(e,fail('session-expired'),'not-dispatched');
   if(!live(ctx))return response(e,fail('cancelled'),'not-dispatched');
   if(requests.has(c.requestId))return response(e,fail('expired'),'not-dispatched');
   if(requests.size>=B.requestIds){invalidate();return response(e,fail('limit'),'not-dispatched');}requests.add(c.requestId);
   if(c.type==='bot-search.cancel'){
    if(!flight||flight.e.requestId!==c.targetRequestId||flight.e.queryId!==c.queryId||flight.e.providerRevision!==c.providerRevision)return response(e,fail('expired'),'not-dispatched');
    flight.stop(fail('cancelled'));return Object.freeze({...e,type:'bot-search.cancelled',targetRequestId:c.targetRequestId});
   }
   if(flight)return response(e,fail('busy'),'not-dispatched');
   if(queries.has(c.queryId))return response(e,fail('expired'),'not-dispatched');queries.add(c.queryId);
   // Expiry is absolute and cannot be revived by reuse/reorder; no retained raw chat transcript.
   if(time.now()>=retainedUntil||retained.size){retained=new Map();retainedUntil=0;}
   const capture=dependency.captureProvider(c.providerRef,c.providerRevision);
   if(!capture)return response(e,fail('expired'),'not-dispatched');
   if(capture.username!=='ivkmbot')return response(e,fail('unsupported'),'not-dispatched');
   const query=formatBotSearchQuery(c);if(!query)return response(e,fail('limit'),'not-dispatched');
   const shared=dependency.getAccountCooldown?.();
   if(shared)return response(e,{error:'rate-limit',...shared},'not-dispatched');
   if(cooldown&&(cooldown.retryBlocked||cooldown.retryAt!==null&&time.now()<cooldown.retryAt))return response(e,cooldown,'not-dispatched');
   const abort=new AbortController(),deadline=time.now()+B.timeoutMs;
   let wake!:(v:BotSearchReply)=>void;const stopped=new Promise<BotSearchReply>(r=>{wake=r;});
   let settle!:(v:boolean)=>void;settlement=new Promise<boolean>(r=>{settle=r;});
   let timer:ReturnType<typeof setTimeout>|undefined,grace:ReturnType<typeof setTimeout>|undefined,delay:ReturnType<typeof setTimeout>|undefined,delayWake:(()=>void)|undefined,finished=false;
   const finish=(ok:boolean)=>{if(finished)return;finished=true;ctx.signal.removeEventListener('abort',onAbort);if(timer!==undefined)time.clearTimeout(timer);if(grace!==undefined)time.clearTimeout(grace);if(delay!==undefined)time.clearTimeout(delay);if(flight===f)flight=null;settle(ok);};
   const f:Flight={e,delivery:'not-dispatched',cause:null,stop(cause){
    if(f.cause)return;if(cause.error==='timeout'&&f.delivery==='uncertain')cause=fail('uncertain');
    f.cause=cause;retained=new Map();retainedUntil=0;wake(response(e,cause,f.delivery));abort.abort();delayWake?.();
    grace=time.setTimeout(()=>{finish(false);invalidate();},B.settlementMs);
   }};
   const onAbort=()=>f.stop(fail('cancelled'));
   flight=f;ctx.signal.addEventListener('abort',onAbort,{once:true});timer=time.setTimeout(()=>f.stop(fail('timeout')),B.timeoutMs);
   let decoded=0;
   const check=()=>{if(f.cause)throw f.cause;if(!live(ctx,capture)){f.stop(fail('cancelled'));throw f.cause;}if(time.now()>=deadline){f.stop(fail('timeout'));throw f.cause;}};
   const budget=(v:unknown)=>{decoded+=assertBotSearchRawBudget(v);if(decoded>B.rawBytes)throw new BotSearchProjectionError('limit');};
   const observe=(error:unknown):Failure=>{
    if(error instanceof BotSearchProjectionError)return fail(error.code);
    // SDK late failures are observed independently of a winning cancel/deadline cause.
    const cause=botProvidersFailure(error,time.now());
    if(cause.error==='session-expired'){if(!f.cause)f.cause=cause;invalidate();}
    if(cause.error==='rate-limit'){
     const blocked=!!cooldown?.retryBlocked||cause.retryBlocked;
     cooldown={error:'rate-limit',retryAt:blocked?null:Math.max(cooldown?.retryAt??0,cause.retryAt??0),retryBlocked:blocked};
    }
    return cause.error==='network'&&f.delivery==='uncertain'?fail('uncertain'):cause;
   };
   const rpc=async(fn:(ms:number)=>Promise<unknown>)=>{check();try{const v=await fn(Math.max(1,deadline-time.now()));check();budget(v);check();return v;}catch(error){
    if(error===f.cause)throw error;const cause=observe(error);if(!f.cause)f.cause=cause;throw f.cause;
   }};
   const work=Promise.resolve().then(async():Promise<BotSearchReply>=>{
    try{
     check();const identity=await rpc(ms=>dependency.resolveIdentity(capture.username,abort.signal,ms));
     const approved=capture.verifyIdentity(identity);if(!approved){if(!capture.current())throw fail('identity-changed');throw fail('unsupported');}check();
     const baseline=botSearchBaseline(await rpc(ms=>dependency.readHistory(approved.peer,0,1,abort.signal,ms)),approved.botId);check();
     const randomId=randomLong();check();
     f.delivery='uncertain';
     // Progress is advisory only, guarded immediately; it contains neither query nor peer.
     if(ctx.publish&&live(ctx,capture)){try{ctx.publish(Object.freeze({...e,type:'bot-search.sending',delivery:'uncertain'}));}catch{/* UI observers cannot change authority. */}}
     const ack=botSearchAck(await rpc(ms=>dependency.sendQuery(approved.peer,query,randomId,abort.signal,ms)),approved.botId,randomId);
     if(!ack||ack<=baseline)throw fail('uncertain');f.delivery='acknowledged';check();
     for(let reads=0;reads<B.reads;reads++){
      const page=projectBotSearchPage(await rpc(ms=>dependency.readHistory(approved.peer,baseline,20,abort.signal,ms)),approved.botId,baseline,ack);check();
      if(page.concurrent)throw fail('uncertain');
      if(page.rows.length){retained=page.refs;retainedUntil=time.now()+B.resultTtlMs;check();
       return Object.freeze({...e,type:'bot-search.result',delivery:'acknowledged',rows:page.rows,expiresAt:retainedUntil,expectedTarget:c.target??null});
      }
      if(page.unrecognized)throw fail('unsupported');
      await new Promise<void>(resolve=>{delayWake=resolve;delay=time.setTimeout(()=>{delay=undefined;delayWake=undefined;resolve();},Math.min(B.pollMs,Math.max(0,deadline-time.now())));});check();
     }
     throw fail('timeout');
    }catch(error){
     // Internally constructed causes are data-only; SDK errors were normalized in rpc.
     const known=error&&typeof error==='object'&&Object.getPrototypeOf(error)===Object.prototype&&Object.getOwnPropertyDescriptor(error,'error')?.value;
     const cause=f.cause??(typeof known==='string'?error as Failure:observe(error));
     if(!f.cause)f.cause=cause;return response(e,cause,f.delivery);
    }
   }).finally(()=>finish(true));
   return Promise.race([work,stopped]);
  },
 });
}

/** Production SDK observation boundary. A UI abort must NOT invoke mtcute's
 * _cancelRpc: it removes pendingMessages and discards late FLOOD/revocation.
 * timeout:0 disables the SDK's local cancellation timer (installed sendRpc checks
 * truthiness). The driver owns its 15s deadline + 2s settlement grace, then closes
 * the exact session with settlement=false if the original RPC remains unresolved.
 * This is never an unlimited admission: no next driver RPC runs after local revocation.
 * Injectable call is worker-private, never a root/session API. */
export function createBotSearchSdkDriver(binding:AccountBinding,sessionId:string,sdk:{
 readonly call:BaseTelegramClient['call'];readonly providers:BotProvidersDriver;
 readonly current:(signal:AbortSignal)=>void;readonly invalidateSession:()=>void;
 readonly getAccountCooldown:NonNullable<BotSearchDependency['getAccountCooldown']>;
},time?:BotProvidersClock):BotSearchDriver {
 return createBotSearchDriver(binding,sessionId,{
  captureProvider:(ref,revision)=>sdk.providers.captureSearchProvider(ref,revision),
  async resolveIdentity(username,abort,_timeout){sdk.current(abort);const r=await sdk.call({_: 'contacts.resolveUsername',username},{timeout:0,floodSleepThreshold:0,maxRetryCount:0});sdk.current(abort);return r;},
  async readHistory(peer,minId,limit,abort,_timeout){sdk.current(abort);const r=await sdk.call({_: 'messages.getHistory',peer,offsetId:0,offsetDate:0,addOffset:0,limit,maxId:0,minId,hash:Long.ZERO},{timeout:0,floodSleepThreshold:0,maxRetryCount:0});sdk.current(abort);return r;},
  async sendQuery(peer,query,randomId,abort,_timeout){sdk.current(abort);const r=await sdk.call({_: 'messages.sendMessage',peer,message:query,randomId,noWebpage:true},{timeout:0,floodSleepThreshold:0,maxRetryCount:0});sdk.current(abort);return r;},
  getAccountCooldown:sdk.getAccountCooldown,invalidateSession:sdk.invalidateSession,
 },time);
}
