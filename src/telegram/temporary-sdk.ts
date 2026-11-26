import {classifyTelegramFailure,cooldownDeadline} from './rpc-failure';
import {BaseTelegramClient} from '@mtcute/core/client.js';
import {WebPlatform,WebSocketTransport,MemoryStorage} from '@mtcute/web';
import {LogManager} from '@mtcute/core/utils.js';
import {sendCode,resendCode,signIn,checkPassword,getMe} from '@mtcute/core/methods.js';
import {getWasmUrl} from '@mtcute/wasm';
import type {tl,User} from '@mtcute/core';
import Long from 'long';
import {createBotSearchSdkDriver,type BotSearchDriver} from './bot-search-driver';
import {isBotWakeupUpdate} from './bot-wakeup-update';
import {createSourcesDriver,type SourcesDriver} from './sources-driver';
import {createBotProvidersDriver,type BotProvidersDriver} from './bot-providers-driver';
import type {AccountBinding} from './sources-protocol';
import {isUuid} from './sources-protocol';
import type {TelegramApiIdentity} from './api-identity';
import type {Delivery,CodeResend} from './session-protocol';
import {createQrLoginDriver} from './qr-login-driver';
import {prepareDefaultBotSelection} from './default-bot-selection';
import type {QrLoginChallenge} from './qr-login-protocol';
import {openCrypto} from './crypto-provider';
import {TelegramConnection} from './connection-lifecycle';
import {sessionLease,saveTelegramSession,loadTelegramSession,telegramSessionLeaseCurrent,clearTelegramSessionLease,loadTelegramBotSelection,saveTelegramBots,type SavedBot} from './saved-session';
let nextAccountEpoch=0;
/** Worker-private account wait: no account identity, peers or raw SDK errors. */
export interface TelegramAccountCooldown {readonly retryAt:number|null;readonly retryBlocked:boolean}
export interface TemporaryTelegramDriver {
 restore?(signal:AbortSignal):Promise<boolean>;
 forgetSavedAuthorization?(signal:AbortSignal):Promise<void>;
 begin(phone:string,signal:AbortSignal):Promise<Delivery|null>;
 getCodeResend?():CodeResend|null;
 resendCode?(signal:AbortSignal):Promise<Delivery>;
 beginQr?(signal:AbortSignal):Promise<QrLoginChallenge|null>;
 checkQr?(signal:AbortSignal):Promise<QrLoginChallenge|null>;
 code(phone:string,challengeCode:string,signal:AbortSignal):Promise<void>;
 password(password:string,signal:AbortSignal):Promise<void>;
 logout(signal:AbortSignal):Promise<void>;
 close():Promise<void>;
 suspendConnection?():Promise<void>;
 warmConnection?():void;
 connectForLogout?():Promise<void>;
 getAccountBinding():AccountBinding|null;
 getVaultGeneration?():string|null;
 getAccountCooldown?():TelegramAccountCooldown|null;
 prepareBotProviders?(sessionId:string,signal:AbortSignal):Promise<void>;
 createSources(sessionId:string):SourcesDriver;
 createBotProviders(sessionId:string):BotProvidersDriver;
 createBotSearch?(sessionId:string):BotSearchDriver;
}
/** SDK caches stay in RAM; only confirmed authorization is kept in the dedicated vault. */
export async function openTemporaryTelegram(identity:TelegramApiIdentity,signal:AbortSignal):Promise<TemporaryTelegramDriver>{
 const wasm=await fetch(getWasmUrl(),{signal,cache:'no-cache'});if(!wasm.ok)throw Error('configuration');
 const module=await WebAssembly.compile(await wasm.arrayBuffer());if(signal.aborted)throw Error('cancelled');
 const crypto=await openCrypto(module);if(signal.aborted)throw Error('cancelled');
 const platform=new WebPlatform();platform.log=()=>{};platform.getDefaultLogLevel=()=>LogManager.OFF;platform.getDeviceModel=()=> 'Pulso Web';
 const storage=new MemoryStorage();
 const createClient=()=>new BaseTelegramClient({apiId:identity.apiId,apiHash:identity.apiHash,storage,platform,crypto,transport:new WebSocketTransport(),updates:false,disableUpdates:false,storageOptions:{peers:{updatesWriteInterval:0}},logLevel:LogManager.OFF,initConnectionOptions:{appVersion:'Pulso Web 0.1',deviceModel:'Pulso Web',systemVersion:'Web',langCode:'es',systemLangCode:'es'}});
 let client=createClient(),call=client.call.bind(client);
 // Disable automatic RPC retries/flood sleeps. DC migration remains SDK-managed.
 const accountRead:typeof client.call=async(message,params)=>{
  if(!message._.startsWith('auth.')&&message._!=='account.getPassword')admitAccountRead();
  try{
   if(!connection.available)await connection.ensureAvailable();
   if(params?.abortSignal?.aborted)throw Error('cancelled');
   return await call(message,{floodSleepThreshold:0,maxRetryCount:0,timeout:30000,...params});
  }
  catch(error){
   const failure=classifyTelegramFailure(error);observeAccountWait(failure);
   if(failure.error==='session-expired'&&persisted&&lease){await clearTelegramSessionLease(lease);persisted=false;}
   throw error;
  }
 };
 client.call=accountRead;
 let closed=false,phone='',challenge='',closing:Promise<void>|undefined,lease='',persisted=false;
 let codeResend:CodeResend|null=null,resending=false;
 const rememberCode=(value:{type:string;phoneCodeHash:string;nextType:string;timeout:number})=>{
  if(!['app','sms','call','email'].includes(value.type))throw Error('unsupported');
  challenge=value.phoneCodeHash;
  codeResend=['sms','call'].includes(value.nextType)&&Number.isSafeInteger(value.timeout)&&value.timeout>=0&&value.timeout<=86400?Object.freeze({delivery:value.nextType as CodeResend['delivery'],availableAt:Date.now()+value.timeout*1000}):null;
  return value.type as Delivery;
 };
 const getCodeResend=():CodeResend|null=>{
  if(closed||signal.aborted||!challenge||!codeResend||resending)return null;
  const wait=getAccountCooldown();if(wait?.retryBlocked)return null;
  return Object.freeze({...codeResend,availableAt:Math.max(codeResend.availableAt,wait?.retryAt??0)});
 };
 let accountKey='',binding:AccountBinding|null=null,sources:SourcesDriver|undefined,sourcesSession='';
 let botProviders:BotProvidersDriver|undefined,botProvidersSession='';let savedBots:SavedBot[]=[],confirmedBots:SavedBot[]=[],confirmedBotRevision=0;
 let botSearch:BotSearchDriver|undefined,botSearchSession='';
 let accountCooldown:TelegramAccountCooldown|null=null;
 const getAccountCooldown=():TelegramAccountCooldown|null=>{
  if(closed||signal.aborted)return null;
  if(accountCooldown&&!accountCooldown.retryBlocked&&accountCooldown.retryAt!==null&&Date.now()>=accountCooldown.retryAt)accountCooldown=null;
  return accountCooldown;
 };
 const observeAccountWait=(f:ReturnType<typeof classifyTelegramFailure>)=>{
  if(closed||signal.aborted||f.error!=='rate-limit')return;
  const previous=getAccountCooldown();
  accountCooldown=Object.freeze({retryAt:Math.max(previous?.retryAt??0,cooldownDeadline(f)),retryBlocked:false});
 };
 const admitAccountRead=()=>{
  const wait=getAccountCooldown();if(!wait)return;
  // SDK-like data only; drivers retain their original first cause independently.
  throw {text:'FLOOD_WAIT',seconds:Math.ceil((wait.retryAt!-Date.now())/1000)};
 };
 const connectionAbort=new AbortController();
 const connection=new TelegramConnection(connectionAbort.signal,()=>client.destroy(),async()=>{
  const saved=await loadTelegramSession();
  current(connectionAbort.signal);
  const expired=():never=>{
   persisted=false;
   throw Error('session-expired');
  };
  if(!saved||saved.lease!==lease)return expired();
  // Disconnect tears down the SDK's DC-config subscriptions. Use a fresh
  // transport and keep the worker's WASM, drivers and auxiliary DC keys.
  const next=createClient();
  try{
   await next.importSession(saved.value);
   current(connectionAbort.signal);
   if(!await telegramSessionLeaseCurrent(lease))expired();
   current(connectionAbort.signal);
   await next.connect();
   current(connectionAbort.signal);
   call=next.call.bind(next);
   next.call=accountRead;
   client=next;
  }catch(error){
   await next.destroy();
   throw error;
  }
 },()=>getAccountCooldown()?.retryAt??null);
 const sourceLifetimeAbort=()=>{void close().catch(()=>{});};
 const close=()=>{if(closing)return closing;closed=true;connectionAbort.abort();phone=challenge='';codeResend=null;qr.close();signal.removeEventListener('abort',sourceLifetimeAbort);
  // Invalidate publication first; keep original settlement before destroying its client.
  const pendingSearch=botSearch,pendingProviders=botProviders;pendingSearch?.close();sources?.close();pendingProviders?.close();
  binding=null;accountKey='';
  closing=Promise.resolve().then(async()=>{if(pendingSearch)await pendingSearch.quiesce();if(pendingProviders)await pendingProviders.quiesce();await connection.suspend();}).finally(()=>{botSearch=undefined;botSearchSession='';sources=undefined;sourcesSession='';botProviders=undefined;botProvidersSession='';accountCooldown=null;});
  void closing.catch(()=>{});return closing;
 };
 const current=(abort:AbortSignal)=>{if(closed||signal.aborted||abort.aborted)throw Error('cancelled');};
 const authorized=(user:User,restored=false)=>{if(user.type!=='user'||!user.isSelf||user.isBot||!Number.isSafeInteger(user.id)||user.id<=0)throw Error('unsupported');
  const key=`telegram-user:${user.id}`;
  if(accountKey&&accountKey!==key){void close().catch(()=>{});throw Error('unsupported');}
  if(!binding){
   if(!Number.isSafeInteger(nextAccountEpoch+1))throw Error('unsupported');
   accountKey=key;binding=Object.freeze({accountRef:globalThis.crypto.randomUUID(),accountEpoch:++nextAccountEpoch});
   // The main connection requests state when it becomes usable. During a fresh
   // login that can happen before authorization, so repeat once for this session.
   if(!restored&&!getAccountCooldown())void client.call({_:'updates.getState'}).catch(()=>{});
  }
  phone=challenge='';codeResend=null;};
 const persist=async(abort:AbortSignal)=>{current(abort);let value:string;try{value=await client.exportSession();}catch{throw Error('session-storage');}current(abort);if(!await saveTelegramSession(lease,value))throw Error('session-storage');persisted=true;current(abort);};
 const qr=createQrLoginDriver({
  current:()=>!closed&&!signal.aborted,
  exportToken:abort=>client.call({_: 'auth.exportLoginToken',apiId:identity.apiId,apiHash:identity.apiHash,exceptIds:[]},{abortSignal:abort}),
  async importToken(dcId,token,abort){current(abort);await client.changePrimaryDc(dcId);current(abort);return client.call({_: 'auth.importLoginToken',token},{abortSignal:abort});},
  async authorize(abort){current(abort);const user=await getMe(client);current(abort);if(user.type!=='user'||!user.isSelf||user.isBot)throw Error('unsupported');await client.notifyLoggedIn(user.raw);current(abort);await persist(abort);authorized(user);},
 });
 try{await client.prepare();current(signal);}catch(error){await close().catch(()=>{});throw error;}
 return Object.freeze({
  suspendConnection:()=>connection.suspend(),
  warmConnection:()=>connection.warm(),
  connectForLogout:()=>connection.ensureAvailable(),
  async forgetSavedAuthorization(abort:AbortSignal){current(abort);await clearTelegramSessionLease(lease);persisted=false;current(abort);},
  async restore(abort:AbortSignal){current(abort);const saved=await loadTelegramSession();current(abort);if(!saved)return false;lease=saved.lease;persisted=true;try{await client.importSession(saved.value);current(abort);const user=await getMe(client);current(abort);if(!await telegramSessionLeaseCurrent(saved.lease))throw Error('session-expired');current(abort);const selection=await loadTelegramBotSelection(saved.lease);savedBots=selection.bots;confirmedBotRevision=selection.revision;current(abort);authorized(user,true);return true;}catch(error){if(classifyTelegramFailure(error).error==='session-expired'){if(persisted){await clearTelegramSessionLease(saved.lease);persisted=false;}throw Error('session-expired');}throw error;}},
  async begin(number:string,abort:AbortSignal){current(abort);lease=await sessionLease();current(abort);phone=number;const value=await sendCode(client,{phone,abortSignal:abort});current(abort);if(value.type==='user'){await persist(abort);authorized(value);return null;}return rememberCode(value);},
  getCodeResend,
  async beginQr(abort:AbortSignal){current(abort);lease=await sessionLease();current(abort);return qr.begin(abort);},
  async checkQr(abort:AbortSignal){current(abort);return qr.check(abort);},
  async resendCode(abort:AbortSignal){
   current(abort);const offered=getCodeResend();if(!phone||!offered||Date.now()<offered.availableAt)throw Error('unsupported');
   resending=true;try{const value=await resendCode(client,{phone,phoneCodeHash:challenge,abortSignal:abort});current(abort);return rememberCode(value);}finally{resending=false;}
  },
  async code(_number:string,code:string,abort:AbortSignal){current(abort);if(!phone||!challenge)throw Error('unsupported');const user=await signIn(client,{phone,phoneCodeHash:challenge,phoneCode:code,abortSignal:abort});current(abort);await persist(abort);authorized(user);},
  async password(value:string,abort:AbortSignal){current(abort);const user=await checkPassword(client,{password:value,abortSignal:abort});current(abort);await persist(abort);authorized(user);},
  async logout(abort:AbortSignal){current(abort);await clearTelegramSessionLease(lease);persisted=false;current(abort);if(botSearch){const settled=await botSearch.quiesce();current(abort);if(!settled)throw Error('logout-unconfirmed');}if(botProviders){const settled=await botProviders.quiesce();current(abort);if(!settled)throw Error('logout-unconfirmed');}if(sources){const settled=await sources.quiesce();current(abort);if(!settled)throw Error('logout-unconfirmed');}await client.call({_: 'auth.logOut'},{abortSignal:abort});current(abort);await close();},
  getAccountBinding(){return closed||signal.aborted?null:binding;},
  getVaultGeneration(){return !closed&&!signal.aborted&&binding&&persisted?lease:null;},
  getAccountCooldown,
  async prepareBotProviders(sessionId:string,abort:AbortSignal){
   current(abort);if(!binding||!isUuid(sessionId))throw Error('unsupported');
   const selection=await loadTelegramBotSelection(lease);current(abort);
   const result=await prepareDefaultBotSelection(binding,sessionId,selection,{
    async resolveIdentity(username,requestAbort){current(requestAbort);const result=await accountRead({_: 'contacts.resolveUsername',username},{abortSignal:requestAbort,timeout:7000,floodSleepThreshold:0,maxRetryCount:0});current(requestAbort);return result;},
    invalidateSession(){/* A lost preference CAS does not revoke the authorization. */},
    async saveSelection(bots){current(abort);return saveTelegramBots(lease,bots,selection.bots,selection.revision);},
   },abort,()=>!closed&&!signal.aborted&&!abort.aborted&&!!binding);
   current(abort);if(!result.settled){await close();throw Error('cancelled');}
   const latest=await loadTelegramBotSelection(lease);current(abort);
   savedBots=latest.bots;confirmedBotRevision=latest.revision;
  },
  createSources(sessionId:string){
   current(signal);if(!binding||!isUuid(sessionId)||botProvidersSession&&botProvidersSession!==sessionId||botSearchSession&&botSearchSession!==sessionId)throw Error('unsupported');
   if(sources){if(sourcesSession!==sessionId)throw Error('unsupported');return sources;}
   sourcesSession=sessionId;
   signal.addEventListener('abort',sourceLifetimeAbort,{once:true});
   sources=createSourcesDriver(binding,sessionId,{
    getAccountCooldown,
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
   current(signal);if(!binding||!isUuid(sessionId)||sourcesSession&&sourcesSession!==sessionId||botSearchSession&&botSearchSession!==sessionId)throw Error('unsupported');
   if(botProviders){if(botProvidersSession!==sessionId)throw Error('unsupported');return botProviders;}
   botProvidersSession=sessionId;
   signal.addEventListener('abort',sourceLifetimeAbort,{once:true});
   botProviders=createBotProvidersDriver(binding,sessionId,{
    getAccountCooldown,
    async resolveIdentity(username,abort){
     current(abort);
     const result=await accountRead({_: 'contacts.resolveUsername',username},{abortSignal:abort,timeout:15000,floodSleepThreshold:0,maxRetryCount:0});
     // The driver independently observes terminal errors, including after cancellation.
     current(abort);return result;
    },
    invalidateSession(){void close().catch(()=>{});},
    async saveSelection(bots){current(signal);const ok=await saveTelegramBots(lease,bots,confirmedBots,confirmedBotRevision);current(signal);if(ok){confirmedBots=bots.map(bot=>({...bot}));confirmedBotRevision++;}return ok;},
   },undefined,savedBots);
   confirmedBots=savedBots.map(bot=>({...bot}));savedBots=[];return botProviders;
  },
  createBotSearch(sessionId:string){
   current(signal);if(!binding||!isUuid(sessionId)||!botProviders||botProvidersSession!==sessionId||sourcesSession&&sourcesSession!==sessionId)throw Error('unsupported');
   if(botSearch){if(botSearchSession!==sessionId)throw Error('unsupported');return botSearch;}
   botSearchSession=sessionId;signal.addEventListener('abort',sourceLifetimeAbort,{once:true});
   botSearch=createBotSearchSdkDriver(binding,sessionId,{
    call:accountRead,providers:botProviders,current,getAccountCooldown,
    subscribeBotWakeup(botId,hint){
     const source=client;
     const onUpdate=(update:tl.TypeUpdates)=>{if(connection.available&&isBotWakeupUpdate(update,botId))hint();};
     source.onServerUpdate.add(onUpdate);
     return ()=>source.onServerUpdate.remove(onUpdate);
    },
    isOtherDc(dcId){try{return client.mt.network.getPrimaryDcId()!==dcId;}catch{return null;}},
    invalidateSession(){void close().catch(()=>{});},
   });return botSearch;
  },
  close,
 });
}
