/** Synthetic SDK transport. The application worker and bot drivers remain native. */
import Long from 'long';
import {openTemporaryTelegram as setupSdk} from './required-setup-sdk';
import {loadTelegramSession} from '../../src/telegram/saved-session';
import {BotSearchProjectionError} from '../../src/telegram/bot-search-page';
import {createBotSearchDriver} from '../../src/telegram/bot-search-driver';

function wav(){
 const bytes=new Uint8Array(32044),header=new DataView(bytes.buffer);
 const ascii=(at:number,value:string)=>{for(let i=0;i<value.length;i++)bytes[at+i]=value.charCodeAt(i);};
 ascii(0,'RIFF');header.setUint32(4,bytes.length-8,true);ascii(8,'WAVEfmt ');
 header.setUint32(16,16,true);header.setUint16(20,1,true);header.setUint16(22,1,true);
 header.setUint32(24,8000,true);header.setUint32(28,16000,true);
 header.setUint16(32,2,true);header.setUint16(34,16,true);ascii(36,'data');header.setUint32(40,bytes.length-44,true);
 return bytes;
}
export async function openTemporaryTelegram(identity:unknown,signal:AbortSignal){
 const base=await setupSdk(identity,signal),bytes=wav();
 let title='',peer=0,mode='',flooded=false;
 const history=(messages:unknown[]=[])=>({_:'messages.messages',messages,users:[],chats:[]});
 const report=async(kind:string,details:object)=>await (await fetch('/__playlist-event',{method:'POST',body:JSON.stringify({kind,workerAt:Date.now(),...details})})).json();
 const resolveIdentity=async(username:string)=>{
  peer=username==='kdmusic_bot'?101:username==='deezermusicbot'?102:103;
  return {_:'contacts.resolvedPeer',peer:{_:'peerUser',userId:peer},users:[{_:'user',id:peer,bot:true,username,firstName:username,accessHash:new Long(3,peer,false)}],chats:[]};
 };
 const missing=()=>title==='Pista 3'&&mode==='missing';
 const message=()=>missing()?{_:'message',id:12,peerId:{_:'peerUser',userId:peer},fromId:{_:'peerUser',userId:peer},date:1,
  message:'No se encontraron resultados',replyTo:{_:'messageReplyHeader',replyToMsgId:10}}:({_:'message',id:12,peerId:{_:'peerUser',userId:peer},fromId:{_:'peerUser',userId:peer},date:1,message:'',
  replyTo:{_:'messageReplyHeader',replyToMsgId:10},media:{_:'messageMediaDocument',document:{_:'document',id:new Long(12,1),
   accessHash:new Long(45,2),fileReference:new Uint8Array([4,5]),dcId:2,mimeType:'audio/wav',size:bytes.length,
   attributes:[{_:'documentAttributeAudio',duration:2,title,performer:'Artista prueba'}]}}});
 let vaultGeneration:string|null=null;
 return {...base,async restore(abort:AbortSignal){
  const restored=await base.restore();
  if(restored)vaultGeneration=(await loadTelegramSession())?.lease??null;
  abort.throwIfAborted();return restored;
 },getVaultGeneration(){return vaultGeneration;},createBotSearch(session:string){
  const pool=base.createBotProviders(session);
  return createBotSearchDriver(base.getAccountBinding()!,session,{
   captureProvider:(ref,rev)=>pool.captureSearchProvider(ref,rev),resolveIdentity,
   async readHistory(_peer,_min,limit){
    if(limit===1)return history();
    if(title==='Pista 3'&&peer===101){
     if(mode==='bot-timeout')return history();
     if(mode==='bot-unsupported')throw new BotSearchProjectionError('unsupported');
    }
    return history([message()]);
   },
   async sendQuery(_peer,query){
    const found=/Pista [1-4]|Consulta manual/.exec(query);if(!found)throw Error('Unexpected fixture query');
    title=found[0];const reply=await report('search',{title,peer});mode=reply.mode;
    return {_:'updateShortSentMessage',out:true,id:10,date:1,pts:1,ptsCount:1};
   },
   async readKnown(){return history([message()]);},
   async readDocumentPart(_document,offset,limit){
    const reply=await report('read',{title,peer});
    if(reply.network)throw Error('network');
    if(reply.flood==='unknown')throw {text:'FLOOD_WAIT'};
    if(reply.flood)throw {text:'FLOOD_WAIT',seconds:reply.flood};
    if(title==='Pista 3'&&mode==='cooldown'&&!flooded){flooded=true;throw {errorMessage:'FLOOD_WAIT_2'};}
    if(title==='Pista 3'&&!['autoheal','single','cooldown','ack-lost','long-cooldown','unknown-cooldown','reconnect','suspend','notifications-off','stop','bot-timeout','bot-unsupported','manual-lane'].includes(mode))return new Uint8Array(0);
    // Real worker rejects the invalid header; the second bot offers good bytes.
    if(title==='Pista 3'&&['autoheal','single'].includes(mode)&&peer===101)return new Uint8Array(Math.min(limit,bytes.length-offset));
    bytes[bytes.length-1]=Number(title.at(-1))+10;
    return bytes.slice(offset,offset+limit);
   },
   invalidateSession(){void base.close();},
  });
 }};
}
