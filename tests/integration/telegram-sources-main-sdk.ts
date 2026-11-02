/** TESTONLY NoTelegram. Replaces ONLY temporary-sdk at build resolution.
 * Auth is fictional; real sources-driver/projector and real session.worker remain.
 * HTTP below is a bounded loopback fixture barrier, never Telegram transport.
 */
import {createSourcesDriver,type SourcesDriver} from './sources-driver';
const nativeFetch=globalThis.fetch.bind(globalThis);
let external=0;
globalThis.fetch=((input:RequestInfo|URL,init?:RequestInit)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
 if(url.origin!==location.origin){external++;void event('blocked-external',{external});throw Error('TESTONLY external fetch denied');}
 return nativeFetch(input,init);
}) as typeof fetch;
// Defense in worker realm, not a replacement for Playwright's context routing.
Object.defineProperty(globalThis,'WebSocket',{value:class {constructor(){external++;void event('blocked-websocket',{external});throw Error('TESTONLY sockets denied');}}});
async function event(type:string,detail:object={}){await nativeFetch('/__r124/event',{method:'POST',body:JSON.stringify({type,...detail})});}
export async function openTemporaryTelegram(_identity:unknown,signal:AbortSignal){
 await event('open');signal.throwIfAborted();
 let binding:{accountRef:string;accountEpoch:number}|null=null,core:SourcesDriver|undefined,closed=false;
 const close=async()=>{if(closed)return;closed=true;binding=null;core?.close();await event('close');};
 signal.addEventListener('abort',()=>{void close();},{once:true});
 return {
  async begin(_phone:string,s:AbortSignal){s.throwIfAborted();await event('begin');return 'app' as const;},
  async code(_phone:string,_code:string,s:AbortSignal){s.throwIfAborted();await event('code');throw {errorMessage:'SESSION_PASSWORD_NEEDED'};},
  async password(_password:string,s:AbortSignal){s.throwIfAborted();await event('password');binding={accountRef:crypto.randomUUID(),accountEpoch:1};},
  async logout(s:AbortSignal){s.throwIfAborted();if(closed)throw Error('TESTONLY already closed');await event('logout');await close();},
  close,
  getAccountBinding(){return binding;},
  createSources(sessionId:string){
   if(!binding||closed)throw Error('TESTONLY no validated fictional auth');
   if(core)return core;
   core=createSourcesDriver(binding,sessionId,{
    invalidateSession(){binding=null;void close();},
    async getDialogs(request,s){
     await event('getDialogs',{folderId:request.folderId,limit:request.limit,excludePinned:request.excludePinned,offsetId:request.offsetId,offsetDate:request.offsetDate});
     // Deliberately ignore AbortSignal at HTTP barrier: tests control actual SDK
     // settlement independently from cancellation, including late terminal errors.
     const aborted=()=>{void event('read-abort');};s.addEventListener('abort',aborted,{once:true});
     try{
      const response=await nativeFetch('/__r124/dialogs',{method:'POST',body:JSON.stringify({folderId:request.folderId,offsetId:request.offsetId})});
      const result=await response.json();await event('read-settled');
      if(result.error)throw result.error;
      // JSON has no TL Long prototype: fixture raw uses basic chat peers and bigint
      // hashes for excluded users only. Product projection remains unchanged.
      for(const c of result.raw.chats)if(c._==='channel'&&c.accessHash==='124')c.accessHash=124n;return result.raw;
     }finally{s.removeEventListener('abort',aborted);}
    },
   });return core;
  },
 };
}
