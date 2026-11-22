/** Synthetic Telegram RPC replies. The app's session, worker and bot driver run normally. */
import Long from 'long';
import {benchmarkPart} from './playlist-benchmark-audio.mjs';
import {openTemporaryTelegram as setupSdk} from './required-setup-sdk';
import {createBotSearchDriver} from '../../src/telegram/bot-search-driver';

type Audio = {key:number;title:string;artist:string;duration:number;mime:string;bytes:number};
declare const __PLAYLIST_RPC_MS__:number;
const benchmark=typeof __PLAYLIST_RPC_MS__!=='undefined'&&__PLAYLIST_RPC_MS__>0;
const delayRpc=()=>benchmark?new Promise<void>(resolve=>setTimeout(resolve,__PLAYLIST_RPC_MS__)):undefined;
type Reply = {silent?:boolean;delayMs?:number;audio:Audio[];menu?:{label:string;audio:Audio}[]};
type Chat = {outgoing:number;messages:unknown[];latest:number;menu?:Reply['menu'];readyAt:number;delayMs:number;quietCallback?:boolean};

export async function openTemporaryTelegram(identity:unknown,signal:AbortSignal){
 const base=await setupSdk(identity,signal);
 const chats=new Map<number,Chat>();
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
 return {...base,createBotSearch(session:string){
  const pool=base.createBotProviders(session);
  return createBotSearchDriver(base.getAccountBinding()!,session,{
   captureProvider:(ref,rev)=>pool.captureSearchProvider(ref,rev),
   async resolveIdentity(username){
    await delayRpc();
    const id=101+['kdmusic_bot','deezermusicbot','lydbot'].indexOf(username);
    return {_:'contacts.resolvedPeer',peer:peerUser(id),users:[{_:'user',id,bot:true,username,firstName:username,accessHash:new Long(3,id,false)}],chats:[]};
   },
   async sendQuery(input,query,_randomId,abort){
    const peer=botId(input);
    await delayRpc();
    const response=await rpc('search',{peer,query},abort);
    if(!response.ok)throw Error('Unexpected fixture query');
    const {audio,menu,silent,delayMs=0}:Reply=await response.json();
    const outgoing=(chats.get(peer)?.latest??0)+1;
    const options=menu&&{
     ...incoming(peer,outgoing+1,outgoing,'Selecciona una canción'),
     replyMarkup:{_:'replyInlineMarkup',rows:menu.map(({label},index)=>({
      _:'keyboardInlineButtonRow',buttons:[{_:'keyboardInlineButton',text:label,
       type:{_:'inlineButtonTypeCallback',data:Uint8Array.of(index+1)}}],
     }))},
    };
    const messages=silent?[]:options?[options]:audio.length?audio.map((candidate,index)=>document(peer,outgoing+1+index,outgoing,candidate))
     :[incoming(peer,outgoing+1,outgoing,'No se encontraron resultados')];
    chats.set(peer,{outgoing,messages,latest:outgoing+messages.length,menu,readyAt:performance.now()+delayMs,delayMs});
    return {_:'updateShortSentMessage',out:true,id:outgoing,date:1,pts:outgoing,ptsCount:1};
   },
   async readHistory(input,_min,limit){
    await delayRpc();
    const chat=chats.get(botId(input));
    if(chat?.quietCallback&&limit===20)await new Promise(resolve=>setTimeout(resolve,700));
    if(chat&&performance.now()<chat.readyAt)return history();
    return history(limit===1?chat?.messages.slice(-1):chat?.messages);
   },
   async readKnown(input,id){
    await delayRpc();
    const chat=chats.get(botId(input));
    const match=chat?.messages.find(message=>(message as {id:number}).id===id);
    return history(match?[match]:[]);
   },
   async callback(input,id,data,abort){
    const peer=botId(input),chat=chats.get(peer),audio=chat?.menu?.[data[0]-1]?.audio;
    if(!chat||!audio||id!==chat.outgoing+1)throw Error('Unexpected fixture callback');
    await delayRpc();
    const response=await rpc('callback',{peer,key:audio.key,option:data[0]},abort);
    if(!response.ok)throw Error('Fixture callback was rejected');
    const {silent=false}=await response.json();
    chat.quietCallback=silent;
    if(!silent)chat.messages.push(document(peer,++chat.latest,id,audio));
    chat.readyAt=performance.now()+chat.delayMs;
    return {_:'messages.botCallbackAnswer',cacheTime:0};
   },
   async readDocumentPart(doc,offset,limit,abort){
    await delayRpc();
    if(benchmark)return benchmarkPart(doc.location.id.toNumber(),offset,limit);
    const response=await rpc('read',{key:doc.location.id.toNumber(),offset,limit},abort);
    if(response.status===429)throw {errorMessage:'FLOOD_WAIT_2'};
    if(response.status===503)throw new TypeError('Synthetic network failure reading audio part');
    if(!response.ok)throw Error('Unexpected fixture document or part');
    return new Uint8Array(await response.arrayBuffer());
   },
   invalidateSession(){void base.close();},
  });
 }};
}
