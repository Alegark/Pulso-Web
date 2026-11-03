import Long from 'long';
import type {tl} from '@mtcute/core';
import {assertRawBudget} from './sources-page';
import {dataArray,isUuid,parseAccountBinding,positive,sourceName,type AccountBinding} from './sources-protocol';
import {BOT_PROVIDERS_BOUNDS as B,copyBotEnvelope,copyBotRow,parseBotProvidersCommand,parseBotUsername,type BotEnvelope,type BotProviderRow,type BotProvidersError,type BotProvidersReply,type BotProvidersSnapshot} from './bot-providers-protocol';
/** Worker-private. This dependency cannot send, start, search, enumerate chats or read history. */
export interface BotProvidersDependency {resolveIdentity(username:string,signal:AbortSignal):Promise<unknown>;invalidateSession():void}
export interface BotProvidersContext {readonly signal:AbortSignal;readonly current:()=>boolean}
export interface BotProvidersClock {now():number;setTimeout(fn:()=>void,ms:number):ReturnType<typeof setTimeout>;clearTimeout(timer:ReturnType<typeof setTimeout>):void}
/** Worker-private authority: never serialize this capture or expose it through session DTOs.
 * Pure capture/accessors do no IO. Only a fresh exact identity can yield an approved peer. */
export interface BotSearchProviderCapture {
 readonly username:string;
 current():boolean;
 verifyIdentity(raw:unknown):{readonly botId:number;readonly peer:tl.TypeInputPeer}|null;
}
export interface BotProvidersDriver {
 captureSearchProvider(providerRef:string,expectedRevision:number):BotSearchProviderCapture|null;
 getSnapshot():BotProvidersSnapshot|null;
 handle(raw:unknown,context:BotProvidersContext):Promise<BotProvidersReply|null>;
 close():void;
 quiesce():Promise<boolean>;
 whenSettled():Promise<boolean>;
}
const clock:BotProvidersClock={now:()=>Date.now(),setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:t=>clearTimeout(t)};
interface Failure {error:BotProvidersError;retryAt:number|null;retryBlocked:boolean}
const fail=(error:BotProvidersError):Failure=>({error,retryAt:null,retryBlocked:false});
const own=(v:unknown,k:string):unknown=>v&&typeof v==='object'?Object.getOwnPropertyDescriptor(v,k)?.value:undefined;
/** SDK errors are not DTOs; own normalized text only, protected against hostile shapes. */
export function botProvidersFailure(error:unknown,now:number):Failure {
 try{
  const text=own(error,'text')??own(error,'errorMessage')??own(error,'message');
  if(typeof text!=='string'||text.length>512)return fail('network');
  if(/^(AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED|USER_DEACTIVATED_BAN)$/.test(text))return fail('session-expired');
  if(/^FLOOD_(?:PREMIUM_)?WAIT(?:_|$)/.test(text)){
   const match=/_(\d+)$/.exec(text),seconds=match?Number(match[1]):own(error,'seconds');
   const until=typeof seconds==='number'&&Number.isSafeInteger(seconds)&&seconds>=0?now+Math.max(1,seconds)*1000:NaN;
   const retryAt=Number.isSafeInteger(until)&&until>now&&until<=8640000000000000?until:null;
   return {error:'rate-limit',retryAt,retryBlocked:retryAt===null};
  }
  return fail(/^(USERNAME_INVALID|USERNAME_NOT_OCCUPIED|PEER_ID_INVALID)$/.test(text)?'unsupported':'network');
 }catch{return fail('network');}
}
interface Identity {id:number;hash:Long;label:string}
/** Post-decoder budget only, not SDK/network/peak-heap accounting. No hooks or getters.
 * Copies only an exact matching complete bot and a usable signed SDK Long. */
function identity(raw:unknown,username:string):Identity|null {
 assertRawBudget(raw);
 if(own(raw,'_')!=='contacts.resolvedPeer')return null;
 const peer=own(raw,'peer'),id=own(peer,'userId');if(own(peer,'_')!=='peerUser'||!positive(id))return null;
 const users=dataArray(own(raw,'users'),64),chats=dataArray(own(raw,'chats'),64);if(!users||!chats)return null;
 const matches=users.filter(u=>own(u,'id')===id);if(matches.length!==1)return null;const u=matches[0];
 if(own(u,'_')!=='user'||own(u,'bot')!==true||own(u,'min')!==undefined&&own(u,'min')!==false||own(u,'deleted')!==undefined&&own(u,'deleted')!==false)return null;
 const hash=own(u,'accessHash');if(!hash||typeof hash!=='object'||Object.getPrototypeOf(hash)!==Long.prototype)return null;
 const lo=own(hash,'low'),hi=own(hash,'high'),unsigned=own(hash,'unsigned');
 if(typeof lo!=='number'||!Number.isInteger(lo)||lo< -2147483648||lo>2147483647||typeof hi!=='number'||!Number.isInteger(hi)||hi< -2147483648||hi>2147483647||unsigned!==false||lo===0&&hi===0)return null;
 let active=typeof own(u,'username')==='string'&&parseBotUsername(own(u,'username'))===username;
 const aliases=own(u,'usernames');if(aliases!==undefined){const a=dataArray(aliases,64);if(!a)return null;for(const alias of a){if(own(alias,'_')!=='username')return null;if(own(alias,'active')===true&&parseBotUsername(own(alias,'username'))===username)active=true;}}
 if(!active)return null;
 const first=own(u,'firstName'),last=own(u,'lastName');if(typeof first!=='string'||first.length>8192||last!==undefined&&(typeof last!=='string'||last.length>8192))return null;
 return {id,hash:new Long(lo,hi,false),label:sourceName(`${first}${typeof last==='string'?' '+last:''}`)};
}
/** Session RAM only, initially empty, no IO on construction/access/order/profile metadata.
 * current MUST be the caller's original non-reviving capture, never recaptured after await.
 * It includes root review/foreign mutation/Activity/proof/scope/DB/worker guards as applicable.
 * A reply is correlation only and needs that same receiving guard before UI publication.
 */
export function createBotProvidersDriver(bindingInput:AccountBinding,sessionId:string,dependency:BotProvidersDependency,time:BotProvidersClock=clock):BotProvidersDriver {
 const binding=parseAccountBinding(bindingInput);if(!binding||!isUuid(sessionId))throw Error('protocol');
 let closed=false,invalidated=false,revision=0;let selected:string[]=[];
 const offers=new Map<string,{row:BotProviderRow;identity:Identity;revision:number}>();
 // Lifetime username pins detect transfer rather than silently replacing an approved identity.
 const usernames=new Map<string,number>(),requests=new Set<string>(),steps=new Set<string>();
 let cooldown:Failure|null=null,settlement=Promise.resolve(true);
 type Flight={request:string;operation:string;cause:Failure|null;stop:(cause:Failure)=>void};let flight:Flight|null=null;
 const close=()=>{if(closed)return;closed=true;selected=[];offers.clear();usernames.clear();requests.clear();steps.clear();cooldown=null;flight?.stop(fail('cancelled'));};
 const invalidate=()=>{close();if(!invalidated){invalidated=true;dependency.invalidateSession();}};
 const live=(ctx:BotProvidersContext)=>{try{return !closed&&!ctx.signal.aborted&&ctx.current();}catch{return false;}};
 const response=(e:BotEnvelope,f:Failure):BotProvidersReply=>Object.freeze({...copyBotEnvelope(e),type:'bots.error',error:f.error,retryAt:f.retryAt,retryBlocked:f.retryBlocked});
 const snapshot=():BotProvidersSnapshot=>Object.freeze({revision,providers:Object.freeze(selected.map(ref=>copyBotRow(offers.get(ref)!.row)))});
 return Object.freeze({
  getSnapshot(){return closed?null:snapshot();},close,
  captureSearchProvider(providerRef:string,expectedRevision:number){
   const offer=offers.get(providerRef);
   if(closed||flight||expectedRevision!==revision||!selected.includes(providerRef)||!offer||offer.revision!==revision)return null;
   const capturedRevision=revision,held=offer;
   const current=()=>!closed&&revision===capturedRevision&&selected.includes(providerRef)&&offers.get(providerRef)===held;
   return Object.freeze({username:held.row.username,current,verifyIdentity(raw:unknown){
    if(!current())return null;let fresh:Identity|null;try{fresh=identity(raw,held.row.username);}catch{return null;}
    if(!fresh)return null;
    if(fresh.id!==held.identity.id||fresh.hash.low!==held.identity.hash.low||fresh.hash.high!==held.identity.hash.high){invalidate();return null;}
    return current()?Object.freeze({botId:fresh.id,peer:Object.freeze({_: 'inputPeerUser' as const,userId:fresh.id,accessHash:new Long(fresh.hash.low,fresh.hash.high,false)})}):null;
   }});
  },
  quiesce(){close();return settlement;},whenSettled(){return settlement;},
  async handle(raw:unknown,ctx:BotProvidersContext):Promise<BotProvidersReply|null>{
   // Capture the guard function and signal once; callers must capture monotonic root epochs.
   ctx=Object.freeze({signal:ctx.signal,current:ctx.current});
   const c=parseBotProvidersCommand(raw);if(!c)return null;const e=copyBotEnvelope(c);
   if(closed||c.sessionId!==sessionId||c.accountRef!==binding.accountRef||c.accountEpoch!==binding.accountEpoch)return response(e,fail('session-expired'));
   if(!live(ctx))return response(e,fail('cancelled'));
   if(requests.has(c.requestId))return response(e,fail('expired'));
   if(requests.size>=B.commandIds){invalidate();return response(e,fail('limit'));}requests.add(c.requestId);
   if(c.providerRevision!==revision)return response(e,fail('expired'));
   if(c.type==='bots.cancel'){
    if(!flight||flight.request!==c.targetRequestId||flight.operation!==c.operationId)return response(e,fail('expired'));
    flight.stop(fail('cancelled'));return Object.freeze({...e,type:'bots.cancelled',targetRequestId:c.targetRequestId});
   }
   if(flight)return response(e,fail('busy'));
   const step=`${c.operationId}:${c.type}`;if(steps.has(step))return response(e,fail('expired'));steps.add(step);
   if(c.type==='bots.setOrder'){
    const held=c.providerRefs.map(ref=>offers.get(ref));
    if(held.some(x=>!x||x.revision!==revision))return response(e,fail('expired'));
    if(new Set(held.map(x=>x!.identity.id)).size!==held.length)return response(e,fail('unsupported'));
    if(!live(ctx))return response(e,fail('cancelled'));
    const changed=selected.length!==c.providerRefs.length||selected.some((ref,i)=>ref!==c.providerRefs[i]);
    if(changed){if(!Number.isSafeInteger(revision+1)){invalidate();return response(e,fail('limit'));}revision++;selected=c.providerRefs.slice();for(const [ref,o] of offers){if(selected.includes(ref))o.revision=revision;else offers.delete(ref);}}
    return Object.freeze({...e,type:'bots.ordered',changed,...snapshot()});
   }
   if(cooldown&&(cooldown.retryBlocked||cooldown.retryAt!==null&&time.now()<cooldown.retryAt))return response(e,cooldown);
   cooldown=null;
   if(offers.size>=B.offers||usernames.size>=B.offers)return response(e,fail('limit'));
   const username=parseBotUsername(c.input)!;
   const abort=new AbortController(),deadline=time.now()+B.timeoutMs;
   let wake!:(f:Failure)=>void;const stopped=new Promise<Failure>(r=>{wake=r;});
   let settle!:(ok:boolean)=>void;settlement=new Promise<boolean>(r=>{settle=r;});
   let grace:ReturnType<typeof setTimeout>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
   let done=false;
   const finish=(ok:boolean)=>{if(done)return;done=true;ctx.signal.removeEventListener('abort',onAbort);if(timer!==undefined)time.clearTimeout(timer);if(grace!==undefined)time.clearTimeout(grace);if(flight===f)flight=null;settle(ok);};
   const f:Flight={request:c.requestId,operation:c.operationId,cause:null,stop(cause){if(f.cause)return;f.cause=cause;wake(cause);abort.abort();grace=time.setTimeout(()=>{invalidate();finish(false);},B.settlementMs);}};
   const onAbort=()=>f.stop(fail('cancelled'));
   flight=f;ctx.signal.addEventListener('abort',onAbort,{once:true});timer=time.setTimeout(()=>f.stop(fail('timeout')),B.timeoutMs);
   const observe=(error:unknown)=>{
    const cause=botProvidersFailure(error,time.now());if(!f.cause)f.cause=cause;
    // Late revocation invalidates exact session even when cancellation won the UI result.
    if(cause.error==='session-expired')invalidate();else if(!closed&&cause.error==='rate-limit')cooldown=cause;
    return f.cause;
   };
   const rpc=Promise.resolve().then(async()=>{
    if(!live(ctx)||f.cause){f.stop(fail('cancelled'));return {ok:false as const,cause:f.cause!};}
    if(time.now()>=deadline){f.stop(fail('timeout'));return {ok:false as const,cause:f.cause!};}
    try{return {ok:true as const,raw:await dependency.resolveIdentity(username,abort.signal)};}catch(error){return {ok:false as const,cause:observe(error)};}
   }).finally(()=>finish(true));
   const result=await Promise.race([rpc,stopped.then(cause=>({ok:false as const,cause}))]);
   if(!result.ok)return response(e,result.cause);
   if(f.cause)return response(e,f.cause);
   if(!live(ctx))return response(e,fail('cancelled'));
   if(time.now()>=deadline)return response(e,fail('timeout'));
   if(c.providerRevision!==revision)return response(e,fail('expired'));
   let found:Identity|null;try{found=identity(result.raw,username);}catch{return response(e,fail('unsupported'));}
   if(!live(ctx))return response(e,fail('cancelled'));
   if(time.now()>=deadline)return response(e,fail('timeout'));
   if(!found)return response(e,fail('unsupported'));
   const previous=usernames.get(username);if(previous!==undefined&&previous!==found.id){invalidate();return response(e,fail('identity-changed'));}
   usernames.set(username,found.id);
   const existing=Array.from(offers.values()).find(o=>o.identity.id===found.id&&o.revision===revision);
   if(existing)return Object.freeze({...e,type:'bots.validated',offer:copyBotRow(existing.row)});
   const row:BotProviderRow=Object.freeze({providerRef:crypto.randomUUID(),username,label:found.label,status:'verified-profile',compatibility:'unverified'});
   offers.set(row.providerRef,{row,identity:found,revision});
   return Object.freeze({...e,type:'bots.validated',offer:copyBotRow(row)});
  },
 });
}
