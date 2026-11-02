/** R133 TESTONLY NoTelegram. Sole replacement: session.worker ./temporary-sdk.
 * Genuine sources/bot drivers; Long is imported in their same worker bundle.
 * No SDK constructor, MTProto, profile/music compatibility stub or root changes.
 */
import Long from 'long';
import {createSourcesDriver,type SourcesDriver} from './sources-driver';
import {botProvidersFailure,createBotProvidersDriver,type BotProvidersDriver} from './bot-providers-driver';
const nativeFetch=globalThis.fetch.bind(globalThis);
async function event(type:string,detail:object={}){await nativeFetch('/__r133/event',{method:'POST',body:JSON.stringify({type,...detail})});}
globalThis.fetch=((input:RequestInfo|URL,init?:RequestInit)=>{
 const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
 if(u.origin!==location.origin){void event('blocked-fetch');throw Error('R133 external fetch denied');}return nativeFetch(input,init);
}) as typeof fetch;
Object.defineProperty(globalThis,'WebSocket',{value:class{constructor(){void event('blocked-websocket');throw Error('R133 socket denied');}}});
export async function openTemporaryTelegram(_identity:unknown,signal:AbortSignal){
 await event('open');signal.throwIfAborted();
 let binding:{accountRef:string;accountEpoch:number}|null=null,sources:SourcesDriver|undefined,bots:BotProvidersDriver|undefined,closed=false;
 let cooldown:{retryAt:number|null;retryBlocked:boolean}|null=null;
 const getAccountCooldown=()=>{if(closed)return null;if(cooldown&&!cooldown.retryBlocked&&cooldown.retryAt!==null&&Date.now()>=cooldown.retryAt)cooldown=null;return cooldown;};
 const close=async()=>{if(closed)return;closed=true;binding=null;sources?.close();bots?.close();await event('close');};
 signal.addEventListener('abort',()=>{void close();},{once:true});
 const invalidateSession=()=>{binding=null;void close();};
 const request=async(kind:string,body:object,s:AbortSignal)=>{
  await event(kind+'-start',body);
  const aborted=()=>{void event(kind+'-abort');};s.addEventListener('abort',aborted,{once:true});
  try{
   // Deliberately ignores abort: only release of the HTTP barrier settles it.
   const r=await nativeFetch('/__r133/'+kind,{method:'POST',body:JSON.stringify(body)}),v=await r.json();
   await event(kind+'-settled');if(v.error){const f=botProvidersFailure(v.error,Date.now());if(f.error==='rate-limit')cooldown={retryAt:f.retryAt,retryBlocked:f.retryBlocked};throw v.error;}return v;
  }finally{s.removeEventListener('abort',aborted);}
 };
 return {
  async begin(_phone:string,s:AbortSignal){s.throwIfAborted();await event('begin');return 'app' as const;},
  async code(_phone:string,_code:string,s:AbortSignal){s.throwIfAborted();await event('code');throw {errorMessage:'SESSION_PASSWORD_NEEDED'};},
  async password(_password:string,s:AbortSignal){s.throwIfAborted();await event('password');binding={accountRef:crypto.randomUUID(),accountEpoch:1};},
  async logout(s:AbortSignal){s.throwIfAborted();if(closed)throw Error('already closed');if(bots&&!await bots.quiesce()||sources&&!await sources.quiesce())throw Error('Unsettled fictional read');await event('logout');await close();},
  close,getAccountCooldown,getAccountBinding(){return binding;},
  createSources(sessionId:string){
   if(!binding||closed)throw Error('No fictional auth');
   return sources??=createSourcesDriver(binding,sessionId,{invalidateSession,async getDialogs(req,s){
    const v=await request('dialogs',{folderId:req.folderId,limit:req.limit,offsetId:req.offsetId},s);return v.raw;
   }});
  },
  createBotProviders(sessionId:string){
   if(!binding||closed)throw Error('No fictional auth');
   return bots??=createBotProvidersDriver(binding,sessionId,{invalidateSession,async resolveIdentity(username,s){
    const v=await request('identity',{username},s);
    return {_: 'contacts.resolvedPeer',peer:{_:'peerUser',userId:v.id},chats:[],users:[{_:'user',id:v.id,bot:v.bot??true,username:v.username??username,firstName:v.label??'Proveedor ficticio',accessHash:Long.fromString('133000000001'),...(v.aliases?{usernames:v.aliases.map((username:string)=>({_:'username',username,active:true}))}:{})}]};
   }});
  },
 };
}
