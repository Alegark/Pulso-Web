/** Synthetic Telegram RPC replies. The app's session, worker and bot driver run normally. */
import Long from 'long';
import {benchmarkPart} from './playlist-benchmark-audio.mjs';
import {openTemporaryTelegram as setupSdk} from './required-setup-sdk';
import {createBotSearchDriver} from '../../src/telegram/bot-search-driver';
import type {BotSearchDependency} from '../../src/telegram/bot-search-driver';
import {loadTelegramSession} from '../../src/telegram/saved-session';

type Audio = {key:number;title:string;artist:string;duration:number;mime:string;bytes:number};
declare const __PLAYLIST_RPC_MS__:number;
declare const __PLAYLIST_M1__:boolean;
const benchmark=typeof __PLAYLIST_RPC_MS__!=='undefined'&&__PLAYLIST_RPC_MS__>0;
const lifecycleFixture=typeof __PLAYLIST_M1__!=='undefined'&&__PLAYLIST_M1__;
const delayRpc=()=>benchmark?new Promise<void>(resolve=>setTimeout(resolve,__PLAYLIST_RPC_MS__)):undefined;
type Reply = {response?:'unsupported'|'limit'|'needs-start';silent?:boolean;delayMs?:number;audio:Audio[];menu?:{label:string;audio:Audio}[]};
type Chat = {response?:Reply['response'];outgoing:number;messages:unknown[];latest:number;menu?:Reply['menu'];readyAt:number;delayMs:number;quietCallback?:boolean};

export async function openTemporaryTelegram(identity:unknown,signal:AbortSignal){
 const base=await setupSdk(identity,signal);
 let socket:WebSocket|null=null,opening:Promise<void>|null=null;
 function openTransport(kind:'restore'|'import'){
  if(opening)return opening;
  if(socket?.readyState===WebSocket.OPEN)return;
  const endpoint=new URL('/__playlist-m1-updates',location.href);
  endpoint.protocol='ws:';
  const next=new WebSocket(endpoint);
  socket=next;
  opening=new Promise<void>((resolve,reject)=>{
   next.addEventListener('open',()=>next.send(kind),{once:true});
   next.addEventListener('message',event=>{
    if(event.data==='ready')resolve();
    else if(event.data==='test-update')next.send('processed');
   });
   next.addEventListener('close',()=>reject(Error('Fixture transport closed')),{once:true});
   next.addEventListener('error',()=>reject(Error('Fixture transport failed')),{once:true});
  }).finally(()=>{opening=null;});
  return opening;
 }
 const resumeTransport=async()=>{
  if(!lifecycleFixture)return;
  if(opening)return opening;
  if(socket?.readyState===WebSocket.OPEN)return;
  if(!(await loadTelegramSession()))throw Error('session-expired');
  await openTransport('import');
 };
 const suspendTransport=async()=>{
  try{await opening;}catch{/* The transport can be paused after a failed open. */}
  const previous=socket;socket=null;
  if(previous&&previous.readyState<WebSocket.CLOSING)previous.close();
 };
 const rpcDelay=()=>lifecycleFixture?resumeTransport().then(delayRpc):delayRpc();
 const chats=new Map<number,Chat>();
 const wakeups=new Map<number,()=>void>();
 const signalReady=(peer:number,chat:Chat)=>{
  const hint=wakeups.get(peer);
  if(hint)setTimeout(()=>{if(wakeups.get(peer)===hint&&chats.get(peer)===chat)hint();},chat.delayMs);
 };
 let rpcSequence=0;
 const countRpc=(kind:string)=>{if(benchmark)console.debug(`TESTONLY playlist RPC ${++rpcSequence} ${kind}`);};
 const history=(messages:unknown[]=[])=>({_:'messages.messages',messages,users:[],chats:[]});
 const rpc=(kind:string,details:object,signal:AbortSignal)=>fetch('/__playlist-full-rpc',{
  method:'POST',body:JSON.stringify({kind,...details}),signal,
 });
 const peerUser=(userId:number)=>({_:'peerUser',userId});
 const incoming=(peer:number,id:number,reply:number,message='')=>({
  _:'message',id,peerId:peerUser(peer),fromId:peerUser(peer),date:1,message,
  replyTo:{_:'messageReplyHeader',replyToMsgId:reply},
 });
 const document=(peer:number,id:number,reply:number,audio:Audio)=>({
  ...incoming(peer,id,reply),
  media:{_:'messageMediaDocument',document:{_:'document',id:Long.fromNumber(audio.key),
   accessHash:new Long(45,2),fileReference:new Uint8Array([4,5]),dcId:2,mimeType:audio.mime,size:audio.bytes,
   attributes:[{_:'documentAttributeAudio',duration:audio.duration,title:audio.title,performer:audio.artist}]}},
 });
 const botId=(peer:{_ :string;userId?:number})=>{
  if(peer._!=='inputPeerUser'||!peer.userId)throw Error('Unexpected input peer');
  return peer.userId;
 };
 const connection=lifecycleFixture?{
  async restore(){const restored=await base.restore();if(restored&&lifecycleFixture)await openTransport('restore');return restored;},
  async close(){await suspendTransport();await base.close();},
  suspendConnection:suspendTransport,
  warmConnection(){void resumeTransport().catch(()=>{});},
  connectForLogout:resumeTransport,
 }:{};
 return {...base,...connection,createBotSearch(session:string){
  const pool=base.createBotProviders(session);
  const dependency:BotSearchDependency & {subscribeBotWakeup(peer:number,hint:()=>void):()=>void}={
   subscribeBotWakeup(peer,hint){
    wakeups.set(peer,hint);
    return ()=>{if(wakeups.get(peer)===hint)wakeups.delete(peer);};
   },
   captureProvider:(ref,rev)=>pool.captureSearchProvider(ref,rev),
   async resolveIdentity(username){
    countRpc('resolveUsername');
    await rpcDelay();
    const id=101+['kdmusic_bot','deezermusicbot','lydbot'].indexOf(username);
    return {_:'contacts.resolvedPeer',peer:peerUser(id),users:[{_:'user',id,bot:true,username,firstName:username,accessHash:new Long(3,id,false)}],chats:[]};
   },
   async sendQuery(input,query,_randomId,abort){
    countRpc('sendMessage');
    const peer=botId(input);
    await rpcDelay();
    const response=await rpc('search',{peer,query},abort);
    if(!response.ok)throw Error('Unexpected fixture query');
    const {audio,menu,silent,response:fixtureResponse,delayMs=0}:Reply=await response.json();
    const outgoing=(chats.get(peer)?.latest??0)+1;
    const options=menu&&{
     ...incoming(peer,outgoing+1,outgoing,'Selecciona una canción'),
     replyMarkup:{_:'replyInlineMarkup',rows:menu.map(({label},index)=>({
      _:'keyboardInlineButtonRow',buttons:[{_:'keyboardInlineButton',text:label,
       type:{_:'inlineButtonTypeCallback',data:Uint8Array.of(index+1)}}],
     }))},
    };
    const messages=silent?[]:options?[options]:audio.length?audio.map((candidate,index)=>document(peer,outgoing+1+index,outgoing,candidate))
     :[incoming(peer,outgoing+1,outgoing,fixtureResponse==='needs-start'?'Envía /start para iniciar el bot':'No se encontraron resultados')];
    const chat={response:fixtureResponse,outgoing,messages,latest:outgoing+messages.length,menu,readyAt:performance.now()+delayMs,delayMs};
    chats.set(peer,chat);
    if(!silent)signalReady(peer,chat);
    return {_:'updateShortSentMessage',out:true,id:outgoing,date:1,pts:outgoing,ptsCount:1};
   },
   async readHistory(input,_min,limit){
    countRpc('getHistory'+limit);
    await rpcDelay();
    const chat=chats.get(botId(input));
    if(chat?.response==='unsupported'&&limit===20)return {_:'messages.notModified'};
    if(chat?.response==='limit'&&limit===20)return history(Array.from({length:21},()=>({})));
    if(chat?.quietCallback&&limit===20)await new Promise(resolve=>setTimeout(resolve,700));
    if(chat&&performance.now()<chat.readyAt)return history();
    return history(limit===1?chat?.messages.slice(-1):chat?.messages);
   },
   async readKnown(input,id){
    countRpc('getMessages');
    await rpcDelay();
    const chat=chats.get(botId(input));
    const match=chat?.messages.find(message=>(message as {id:number}).id===id);
    return history(match?[match]:[]);
   },
   async callback(input,id,data,abort){
    countRpc('getBotCallbackAnswer');
    const peer=botId(input),chat=chats.get(peer),audio=chat?.menu?.[data[0]-1]?.audio;
    if(!chat||!audio||id!==chat.outgoing+1)throw Error('Unexpected fixture callback');
    await rpcDelay();
    const response=await rpc('callback',{peer,key:audio.key,option:data[0]},abort);
    if(!response.ok)throw Error('Fixture callback was rejected');
    const {silent=false}=await response.json();
    chat.quietCallback=silent;
    if(!silent)chat.messages.push(document(peer,++chat.latest,id,audio));
    chat.readyAt=performance.now()+chat.delayMs;
    if(!silent)signalReady(peer,chat);
    return {_:'messages.botCallbackAnswer',cacheTime:0};
   },
   async readDocumentPart(doc,offset,limit,abort){
    countRpc('upload.getFile');
    await rpcDelay();
    if(benchmark&&doc.location.id.toNumber()<400)return benchmarkPart(doc.location.id.toNumber(),offset,limit);
    const response=await rpc('read',{key:doc.location.id.toNumber(),offset,limit},abort);
    if(response.status===429)throw {errorMessage:'FLOOD_WAIT_2'};
    if(response.status===503)throw new TypeError('Synthetic network failure reading audio part');
    if(!response.ok)throw Error('Unexpected fixture document or part');
    return new Uint8Array(await response.arrayBuffer());
   },
   invalidateSession(){void base.close();},
  };
  return createBotSearchDriver(base.getAccountBinding()!,session,dependency);
 }};
}
