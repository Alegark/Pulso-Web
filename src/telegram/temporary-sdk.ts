import {BaseTelegramClient} from '@mtcute/core/client.js';
import {WebPlatform,WebSocketTransport,MemoryStorage} from '@mtcute/web';
import {LogManager} from '@mtcute/core/utils.js';
import {sendCode,signIn,checkPassword} from '@mtcute/core/methods.js';
import {getWasmUrl} from '@mtcute/wasm';
import type {User} from '@mtcute/core';
import type {TelegramApiIdentity} from './api-identity';
import type {Delivery} from './session-protocol';
import {openCrypto} from './crypto-provider';
export interface TemporaryTelegramDriver {
 begin(phone:string,signal:AbortSignal):Promise<Delivery|null>;
 code(phone:string,challengeCode:string,signal:AbortSignal):Promise<void>;
 password(password:string,signal:AbortSignal):Promise<void>;
 logout(signal:AbortSignal):Promise<void>;
 close():Promise<void>;
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
 const close=()=>{if(closing)return closing;closed=true;phone=challenge='';closing=client.destroy();void closing.catch(()=>{});return closing;};
 const current=(abort:AbortSignal)=>{if(closed||signal.aborted||abort.aborted)throw Error('cancelled');};
 const authorized=(user:User)=>{if(user.type!=='user'||!user.isSelf||user.isBot||!Number.isSafeInteger(user.id)||user.id<=0)throw Error('unsupported');phone=challenge='';};
 try{await client.prepare();current(signal);}catch(error){await close().catch(()=>{});throw error;}
 return Object.freeze({
  async begin(number:string,abort:AbortSignal){current(abort);phone=number;const value=await sendCode(client,{phone,abortSignal:abort});current(abort);if(value.type==='user'){authorized(value);return null;}if(!['app','sms','call','email'].includes(value.type))throw Error('unsupported');challenge=value.phoneCodeHash;return value.type as Delivery;},
  async code(_number:string,code:string,abort:AbortSignal){current(abort);if(!phone||!challenge)throw Error('unsupported');const user=await signIn(client,{phone,phoneCodeHash:challenge,phoneCode:code,abortSignal:abort});current(abort);authorized(user);},
  async password(value:string,abort:AbortSignal){current(abort);const user=await checkPassword(client,{password:value,abortSignal:abort});current(abort);authorized(user);},
  async logout(abort:AbortSignal){current(abort);await client.call({_: 'auth.logOut'},{abortSignal:abort});current(abort);await close();},
  close,
 });
}
