import {BaseTelegramClient} from '@mtcute/core/client.js';
import {WebPlatform,WebSocketTransport,MemoryStorage} from '@mtcute/web';
import {LogManager} from '@mtcute/core/utils.js';
import {sendCode,signIn,checkPassword} from '@mtcute/core/methods.js';
import {getWasmUrl} from '@mtcute/wasm';
import type {User} from '@mtcute/core';
import Long from 'long';
import {createSourcesDriver,type SourcesDriver} from './sources-driver';
import {botProvidersFailure,createBotProvidersDriver,type BotProvidersDriver} from './bot-providers-driver';
import type {AccountBinding} from './sources-protocol';
import {isUuid} from './sources-protocol';
import type {TelegramApiIdentity} from './api-identity';
import type {Delivery} from './session-protocol';
import {openCrypto} from './crypto-provider';
let nextAccountEpoch=0;
/** Worker-private account wait: no account identity, peers or raw SDK errors. */
export interface TelegramAccountCooldown {readonly retryAt:number|null;readonly retryBlocked:boolean}
export interface TemporaryTelegramDriver {
 begin(phone:string,signal:AbortSignal):Promise<Delivery|null>;
 code(phone:string,challengeCode:string,signal:AbortSignal):Promise<void>;
 password(password:string,signal:AbortSignal):Promise<void>;
 logout(signal:AbortSignal):Promise<void>;
 close():Promise<void>;
 getAccountBinding():AccountBinding|null;
 getAccountCooldown?():TelegramAccountCooldown|null;
 createSources(sessionId:string):SourcesDriver;
 createBotProviders(sessionId:string):BotProvidersDriver;
}
/** RAM-only storage is explicit: the SDK's default client.session database is never used. */
export async function openTemporaryTelegram(identity:TelegramApiIdentity,signal:AbortSignal):Promise<TemporaryTelegramDriver>{
 const wasm=await fetch(getWasmUrl(),{signal,cache:'no-cache'});if(!wasm.ok)throw Error('configuration');
 const module=await WebAssembly.compile(await wasm.arrayBuffer());if(signal.aborted)throw Error('cancelled');
 const crypto=await openCrypto(module);if(signal.aborted)throw Error('cancelled');
 const platform=new WebPlatform();platform.log=()=>{};platform.getDefaultLogLevel=()=>LogManager.OFF;platform.getDeviceModel=()=> 'Pulso Web';
 const client=new BaseTelegramClient({apiId:identity.apiId,apiHash:identity.apiHash,storage:new MemoryStorage(),platform,crypto,transport:new WebSocketTransport(),updates:false,disableUpdates:true,storageOptions:{peers:{updatesWriteInterval:0}},logLevel:LogManager.OFF,initConnectionOptions:{appVersion:'Pulso Web 0.1',deviceModel:'Pulso Web',systemVersion:'Web',langCode:'es',systemLangCode:'es'}});
 // Disable automatic RPC retries/flood sleeps. DC migration remains SDK-managed.
 const call=client.call.bind(client);client.call=(message,params)=>call(message,{floodSleepThreshold:0,maxRetryCount:0,timeout:30000,...params});
 let closed=false,phone='',challenge='',closing:Promise<void>|undefined;
 let accountKey='',binding:AccountBinding|null=null,sources:SourcesDriver|undefined,sourcesSession='';
 let botProviders:BotProvidersDriver|undefined,botProvidersSession='';
 let accountCooldown:TelegramAccountCooldown|null=null;
 const getAccountCooldown=():TelegramAccountCooldown|null=>{
  if(closed||signal.aborted)return null;
  if(accountCooldown&&!accountCooldown.retryBlocked&&accountCooldown.retryAt!==null&&Date.now()>=accountCooldown.retryAt)accountCooldown=null;
  return accountCooldown;
 };
 const observeAccountWait=(error:unknown)=>{
  if(closed||signal.aborted)return;
  const f=botProvidersFailure(error,Date.now());if(f.error!=='rate-limit')return;
  const previous=getAccountCooldown();
  const retryBlocked=!!previous?.retryBlocked||f.retryBlocked;
  accountCooldown=Object.freeze({retryAt:retryBlocked?null:Math.max(previous?.retryAt??0,f.retryAt??0),retryBlocked});
 };
 const admitAccountRead=()=>{
  const wait=getAccountCooldown();if(!wait)return;
  // SDK-like data only; drivers retain their original first cause independently.
  throw {text:'FLOOD_WAIT',seconds:wait.retryBlocked?undefined:Math.max(1,Math.ceil((wait.retryAt!-Date.now())/1000))};
 };
 const accountRead:typeof client.call=async(message,params)=>{
  admitAccountRead();
  try{return await client.call(message,params);}catch(error){observeAccountWait(error);throw error;}
 };
 const sourceLifetimeAbort=()=>{void close().catch(()=>{});};
 const close=()=>{if(closing)return closing;closed=true;phone=challenge='';signal.removeEventListener('abort',sourceLifetimeAbort);sources?.close();sources=undefined;sourcesSession='';botProviders?.close();botProviders=undefined;botProvidersSession='';binding=null;accountKey='';accountCooldown=null;closing=client.destroy();void closing.catch(()=>{});return closing;};
 const current=(abort:AbortSignal)=>{if(closed||signal.aborted||abort.aborted)throw Error('cancelled');};
 const authorized=(user:User)=>{if(user.type!=='user'||!user.isSelf||user.isBot||!Number.isSafeInteger(user.id)||user.id<=0)throw Error('unsupported');
  const key=`telegram-user:${user.id}`;
  if(accountKey&&accountKey!==key){void close().catch(()=>{});throw Error('unsupported');}
  if(!binding){if(!Number.isSafeInteger(nextAccountEpoch+1))throw Error('unsupported');accountKey=key;binding=Object.freeze({accountRef:globalThis.crypto.randomUUID(),accountEpoch:++nextAccountEpoch});}
  phone=challenge='';};
 try{await client.prepare();current(signal);}catch(error){await close().catch(()=>{});throw error;}
 return Object.freeze({
  async begin(number:string,abort:AbortSignal){current(abort);phone=number;const value=await sendCode(client,{phone,abortSignal:abort});current(abort);if(value.type==='user'){authorized(value);return null;}if(!['app','sms','call','email'].includes(value.type))throw Error('unsupported');challenge=value.phoneCodeHash;return value.type as Delivery;},
  async code(_number:string,code:string,abort:AbortSignal){current(abort);if(!phone||!challenge)throw Error('unsupported');const user=await signIn(client,{phone,phoneCodeHash:challenge,phoneCode:code,abortSignal:abort});current(abort);authorized(user);},
  async password(value:string,abort:AbortSignal){current(abort);const user=await checkPassword(client,{password:value,abortSignal:abort});current(abort);authorized(user);},
  async logout(abort:AbortSignal){current(abort);if(botProviders){const settled=await botProviders.quiesce();current(abort);if(!settled)throw Error('logout-unconfirmed');}if(sources){const settled=await sources.quiesce();current(abort);if(!settled)throw Error('logout-unconfirmed');}await client.call({_: 'auth.logOut'},{abortSignal:abort});current(abort);await close();},
  getAccountBinding(){return closed||signal.aborted?null:binding;},
  getAccountCooldown,
  createSources(sessionId:string){
   current(signal);if(!binding||!isUuid(sessionId)||botProvidersSession&&botProvidersSession!==sessionId)throw Error('unsupported');
   if(sources){if(sourcesSession!==sessionId)throw Error('unsupported');return sources;}
   sourcesSession=sessionId;
   signal.addEventListener('abort',sourceLifetimeAbort,{once:true});
   sources=createSourcesDriver(binding,sessionId,{
    async getDialogs(request,abort){
     current(abort);
     // No invocation at auth/accessor time. Fixed policy options are last.
     const result=await accountRead({_: 'messages.getDialogs',folderId:request.folderId,excludePinned:request.excludePinned,offsetDate:request.offsetDate,offsetId:request.offsetId,offsetPeer:request.offsetPeer,limit:25,hash:Long.ZERO},{abortSignal:abort,timeout:15000,floodSleepThreshold:0,maxRetryCount:0});
     current(abort);return result;
    },
    invalidateSession(){void close().catch(()=>{});},
   });
   return sources;
  },
  createBotProviders(sessionId:string){
   current(signal);if(!binding||!isUuid(sessionId)||sourcesSession&&sourcesSession!==sessionId)throw Error('unsupported');
   if(botProviders){if(botProvidersSession!==sessionId)throw Error('unsupported');return botProviders;}
   botProvidersSession=sessionId;
   signal.addEventListener('abort',sourceLifetimeAbort,{once:true});
   botProviders=createBotProvidersDriver(binding,sessionId,{
    async resolveIdentity(username,abort){
     current(abort);
     const result=await accountRead({_: 'contacts.resolveUsername',username},{abortSignal:abort,timeout:15000,floodSleepThreshold:0,maxRetryCount:0});
     // The driver independently observes terminal errors, including after cancellation.
     current(abort);return result;
    },
    invalidateSession(){void close().catch(()=>{});},
   });
   return botProviders;
  },
  close,
 });
}
