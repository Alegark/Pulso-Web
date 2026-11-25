import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import Long from 'long';
import {acquireFromOrderedBots,type CollectionBotProgress} from '../../src/library/ordered-bot-acquisition';
import {downloadSong} from '../../src/library/download-song';
import {createBotSearchDriver,type BotSearchDependency} from '../../src/telegram/bot-search-driver';
import {BOT_DOWNLOAD_MAX_BYTES,botDownloadTransferMs} from '../../src/telegram/bot-download-bytes';
import {parseBotSearchReply,type BotSearchCommand,type BotSearchReply} from '../../src/telegram/bot-search-protocol';
import type {BotSearchAdmission,BotSearchSnapshot,TelegramSessionClient} from '../../src/telegram/session-client';

const target={title:'Song',artist:'Artist',album:'Album',durationSeconds:60};
const providers=[{providerRef:crypto.randomUUID(),label:'One'},{providerRef:crypto.randomUUID(),label:'Two'}];
const audio=new TextEncoder().encode('RIFF1234WAVE');
const history=(messages:unknown[]=[])=>({_:'messages.messages',messages,users:[],chats:[]});
const incoming=(botId:number,id:number,reply:number,message='')=>({
 _:'message',id,peerId:{_:'peerUser',userId:botId},message,replyTo:{_:'messageReplyHeader',replyToMsgId:reply},
});
const document=(botId:number,id:number,reply:number,key:number,bytes=audio.length,mimeType='audio/wav')=>({
 ...incoming(botId,id,reply),media:{_:'messageMediaDocument',document:{_:'document',id:Long.fromInt(key),
  accessHash:Long.fromInt(99),fileReference:Uint8Array.of(4),dcId:2,mimeType,size:bytes,
  attributes:[{_:'documentAttributeAudio',title:target.title,performer:target.artist,duration:60}]}},
});
const menu=(botId:number,id:number,reply:number)=>({...incoming(botId,id,reply),replyMarkup:{_:'replyInlineMarkup',rows:[1,2].map(option=>({
 _:'keyboardInlineButtonRow',buttons:[{_:'keyboardInlineButton',text:'Song — Artist',type:{_:'inlineButtonTypeCallback',data:Uint8Array.of(option)}}],
}))}});

type Reply='direct-timeout'|'direct'|'menu-invalid'|'menu-large'|'callback-conflict'|'empty'|'unsupported'|'unsupported-format'|'limit'|'needs-start';
function setup(t:TestContext,replies:readonly Reply[]){
 t.mock.timers.enable({apis:['setTimeout','Date'],now:10_000});
 t.mock.method(performance,'now',()=>Date.now());
 const binding={accountRef:crypto.randomUUID(),accountEpoch:1};
 let sessionId=crypto.randomUUID(),activeProviders=providers;
 const searches:string[]=[],callbacks:number[]=[],errors:Extract<BotSearchReply,{type:'bot-search.error'}>[]=[];
 const listeners=new Set<(value:BotSearchSnapshot)=>void>();
 const allowed={search:true,selection:true};
 let scenario:Reply, messages:unknown[]=[],nextId=0,invalidated=false;
 let transferStarted=0,pendingTransfer:(()=>void)|undefined;
 const botId=(peer:Parameters<BotSearchDependency['readHistory']>[0])=>{
  assert.equal(peer._,'inputPeerUser');
  return peer.userId;
 };
 const dependency:BotSearchDependency={
  captureProvider(ref){
   const index=activeProviders.findIndex(p=>p.providerRef===ref);
   if(index<0)return null;
   const username=index===0?'ivkmbot':'lydbot';
   return {username,current:()=>true,verifyIdentity:()=>({botId:index+101,
    peer:{_:'inputPeerUser',userId:index+101,accessHash:Long.fromInt(10)}})};
  },
  async resolveIdentity(){return {};},
  async sendQuery(peer){
   const id=botId(peer);
   scenario=replies[id-101]??'direct';
   const outgoing=++nextId;
   const reply=++nextId;
   messages=scenario.startsWith('menu-')||scenario==='callback-conflict'?[menu(id,reply,outgoing)]:
    scenario==='empty'?[incoming(id,reply,outgoing,'No se encontraron resultados')]:
    scenario==='needs-start'?[incoming(id,reply,outgoing,'Envía /start para iniciar el bot')]:
    [document(id,reply,outgoing,id,audio.length,scenario==='unsupported-format'?'audio/ogg':undefined)];
   return {_:'updateShortSentMessage',out:true,id:outgoing};
  },
  async readHistory(peer,_min,limit){
   if(limit===1)return history(messages.filter(message=>(message as {peerId:{userId:number}}).peerId.userId===botId(peer)).slice(-1));
   if(scenario==='unsupported')return {_:'messages.notModified'};
   if(scenario==='limit')return history(Array.from({length:21},()=>({})));
   return history(messages);
  },
  async readKnown(_peer,id){
   if(scenario==='callback-conflict'&&callbacks.length&&id===nextId)return history();
   return history(messages.filter(message=>(message as {id:number}).id===id));
  },
  async callback(peer,id,data){
   const option=data[0];
   callbacks.push(option);
   const overLimit=scenario==='menu-large'&&option===1;
   messages.push(document(botId(peer),++nextId,id,option,overLimit?BOT_DOWNLOAD_MAX_BYTES+1:audio.length));
   return {_:'messages.botCallbackAnswer'};
  },
  async readDocumentPart(doc,_offset,_limit,signal){
   if(scenario==='direct-timeout'){
    transferStarted++;
    // Settle the original RPC when the driver's deadline fires.
    return new Promise((_,reject)=>{
     pendingTransfer=()=>reject(Error('Fixture transfer ended'));
     signal.addEventListener('abort',pendingTransfer,{once:true});
    });
   }
   if(scenario==='menu-invalid'&&doc.location.id.toNumber()===1)return new Uint8Array(audio.length);
   return audio;
  },
  invalidateSession(){invalidated=true;},
 };
 let driver=createBotSearchDriver(binding,sessionId,dependency);
 t.after(()=>{pendingTransfer?.();driver.close();});
 let state:BotSearchSnapshot={binding,scopeKey:'fixture',providerRevision:4,providerRef:null,queryId:null,expectedTarget:null,
  pending:false,available:true,cancelling:false,retryBlocked:false,retryAt:null,error:null,delivery:'not-dispatched',
  rows:[],expiresAt:null,providerNotice:null};
 let lastSearch:Extract<BotSearchCommand,{type:'bot-search.search'}>|undefined,selecting=false;
 const context={signal:new AbortController().signal,current:()=>true};
 const publish=(change:Partial<BotSearchSnapshot>)=>{state={...state,...change};for(const notify of listeners)notify(state);};
 const envelope=(queryId:string=crypto.randomUUID())=>({protocol:'pulso-bot-search' as const,version:1 as const,
  ...binding,sessionId,providerRevision:4,requestId:crypto.randomUUID(),queryId});
 const execute=async(command:BotSearchCommand)=>{
  const raw=await driver.handle(command,context);
  const reply=parseBotSearchReply(raw,command);
  assert.ok(reply);
  assert.equal(await driver.whenSettled(),true);
  assert.equal(invalidated,false);
  if(reply.type==='bot-search.error')errors.push(reply);
  return reply;
 };
 const client={
  botsSnapshot:()=>({revision:4,scopeKey:'fixture'}),
  searchSnapshot:()=>state,
  captureSearchActionCurrent:()=>{const selection=selecting;return()=>selection?allowed.selection:allowed.search;},
  subscribeSearch(listener:(value:BotSearchSnapshot)=>void){listeners.add(listener);return()=>listeners.delete(listener);},
  searchBot(input:{providerRef:string;query:string;target:typeof target;consent:true},_allowed:()=>boolean,admit:(value:BotSearchAdmission)=>void){
   const command={...envelope(),type:'bot-search.search' as const,...input};
   lastSearch=command;
   searches.push(command.providerRef);
   admit({queryId:command.queryId,cancel:()=>{}});
   publish({queryId:command.queryId,providerRef:command.providerRef,expectedTarget:command.target,pending:true,rows:[],error:null});
   void execute(command).then(reply=>{
    if(reply.type==='bot-search.result')publish({pending:false,delivery:reply.delivery,rows:reply.rows,expiresAt:reply.expiresAt});
    else if(reply.type==='bot-search.error')publish({pending:false,delivery:reply.delivery,error:reply.error,rows:[],expiresAt:null});
    else assert.fail(reply.type);
   });
  },
  async downloadBot(rowRef:string,_allowed:()=>boolean,admit:(value:BotSearchAdmission)=>void,_timing:unknown,callbackBudgetMs?:number){
   const command={...envelope(state.queryId!),type:'bot-search.download' as const,providerRef:state.providerRef!,
    rowRef,target:state.expectedTarget!,consent:true as const,...(callbackBudgetMs===undefined?{}:{callbackBudgetMs})};
   const menu=state.rows.filter(row=>row.kind==='option'&&row.rowRef!==rowRef);
   const expiresAt=state.expiresAt;
   admit({queryId:command.queryId,cancel:()=>{}});
   publish({pending:true,error:null,delivery:'not-dispatched',expiresAt:null});
   const reply=await execute(command);
   if(reply.type==='bot-search.downloaded'){
    publish({pending:false,delivery:'acknowledged',rows:menu,expiresAt});return reply.audio;
   }
   assert.equal(reply.type,'bot-search.error');
   const retain=menu.length&&['file-invalid','file-too-large'].includes(reply.error);
   publish({pending:false,error:reply.error,delivery:reply.delivery,rows:retain?menu:[],expiresAt:retain?expiresAt:null});
   return null;
  },
 } as unknown as TelegramSessionClient;
 const params={client,providers,revision:4,target,signal:context.signal,current:()=>true,networkCurrent:()=>true,progress:(_provider:unknown,_index:number,queryId:string|null)=>{selecting=!!queryId;}};
 async function drive<T>(result:Promise<T>){
  let settled=false;
  void result.then(()=>{settled=true;},()=>{settled=true;});
  for(let i=0;i<1900&&!settled;i++){
   await new Promise<void>(resolve=>setImmediate(resolve));
   if(!settled)t.mock.timers.tick(100);
  }
  assert.ok(settled,'Operation did not settle on the mock clock');
  return result;
 }
 return {params,searches,callbacks,errors,allowed,drive,get transferStarted(){return transferStarted;},
  reconnect(){
   driver.close();
   sessionId=crypto.randomUUID();
   activeProviders=activeProviders.map(provider=>({...provider,providerRef:crypto.randomUUID()}));
   params.providers=activeProviders;
   driver=createBotSearchDriver(binding,sessionId,dependency);
   publish({queryId:null,providerRef:null,rows:[],expiresAt:null,error:null});
  },
  async foreignExpired(){
   const previous=lastSearch!;
   const reply=await execute(previous);
   assert.equal(reply.type,'bot-search.error');
   publish({queryId:previous.queryId,providerRef:previous.providerRef,rows:[],error:reply.error,delivery:reply.delivery});
  }};
}
const progress=():CollectionBotProgress=>({completed:new Set(),reasons:[]});
const accept=async()=>'saved' as const;

test('H2 · real direct audio transfer timeout falls back and saves through downloadSong',async t=>{
 const f=setup(t,['direct-timeout','direct']);
 const save=async()=>({state:'saved' as const,trackId:'next-bot-copy'});
 const song=await f.drive(downloadSong({...f.params,collection:progress(),choice:{...target,id:'song',source:'itunes',duration:60},
  attempt:{current:()=>true,lookup:async()=>null,save,addToLibrary:async()=>true,play:async()=>'failed'},index:0,mark:()=>{},message:()=>{}}));
 assert.equal(botDownloadTransferMs(audio.length),18_000);
 assert.equal(f.transferStarted,1);
 assert.deepEqual({errors:f.errors.map(({error,delivery})=>[error,delivery]),state:song.state,searches:f.searches},
  {errors:[['timeout','acknowledged']],state:'downloaded',searches:providers.map(p=>p.providerRef)});
});

test('H3 · denying selection after a real driver result leaves Telegram pending',async t=>{
 const f=setup(t,['direct']);f.allowed.selection=false;
 const collection=progress();
 assert.deepEqual(await f.drive(acquireFromOrderedBots({...f.params,collection,accept})),{state:'telegram'});
 assert.equal(collection.resumeBot,0);
 assert.deepEqual([...collection.completed],[]);
 assert.deepEqual(f.searches,[providers[0].providerRef]);
});

test('H3 · an expired reply for a foreign search cannot close either bot',async t=>{
 const f=setup(t,['direct']);f.allowed.selection=false;
 await f.drive(acquireFromOrderedBots({...f.params,collection:progress(),accept}));
 await f.foreignExpired();
 assert.equal(f.errors.at(-1)?.error,'expired');
 f.searches.length=0;f.allowed.search=false;
 const collection=progress();
 assert.deepEqual(await f.drive(acquireFromOrderedBots({...f.params,collection,accept})),{state:'telegram'});
 assert.equal(collection.resumeBot,0);
 assert.deepEqual(f.searches,[]);
});

for(const [scenario,expectedError] of [['menu-invalid','file-invalid'],['menu-large','file-too-large']] as const)
 test(`H4 · suspension after ${expectedError} resumes the pending menu option on the same bot`,async t=>{
  const f=setup(t,[scenario,'direct']),collection=progress();
  const capture=f.params.client.captureSearchActionCurrent.bind(f.params.client);
  f.params.client.captureSearchActionCurrent=()=>f.errors.length?()=>false:capture();
  const result=await f.drive(acquireFromOrderedBots({...f.params,collection,accept,suspended:()=>f.errors.length>0}));
  assert.equal(f.errors.at(-1)?.error,expectedError);
  assert.deepEqual(result,{state:'suspended'});
  assert.equal(collection.resumeBot,0);
  assert.equal(collection.completed.size,0);
  assert.deepEqual(f.callbacks,[1]);
  f.params.client.captureSearchActionCurrent=capture;
  f.reconnect();
  assert.equal((await f.drive(acquireFromOrderedBots({...f.params,collection,accept}))).state,'audio');
  assert.deepEqual(f.searches,[providers[0].providerRef,f.params.providers[0].providerRef]);
  assert.deepEqual(f.callbacks,[1,2]);
 });

test('M8 · real post-callback conflict moves to the next bot',async t=>{
 const f=setup(t,['callback-conflict','direct']);
 const result=await f.drive(acquireFromOrderedBots({...f.params,collection:progress(),accept}));
 assert.deepEqual(f.errors.map(({error,delivery})=>[error,delivery]),[['conflict','acknowledged']]);
 assert.equal(result.state,'audio');
 assert.deepEqual(f.searches,providers.map(p=>p.providerRef));
});

for(const [scenario,message] of [
 ['needs-start','Un bot necesita que envíes /start en Telegram'],
 ['limit','Un bot alcanzó un límite de búsqueda o descarga'],
 ['unsupported','Ningún bot entregó un archivo compatible'],
 ['unsupported-format','Ningún bot entregó un archivo compatible'],
 ['empty','No existe en tus bots'],
] as const)test(`M9 · ${scenario} from the driver has its own message`,async t=>{
 const f=setup(t,[scenario,'empty']);
 const song=await f.drive(downloadSong({...f.params,collection:progress(),choice:{...target,id:'song',source:'itunes',duration:60},
  attempt:{current:()=>true,lookup:async()=>null,save:async()=>assert.fail('No valid audio'),addToLibrary:async()=>true,play:async()=>'failed'},
  index:0,mark:()=>{},message:()=>{}}));
 assert.deepEqual(f.searches,providers.map(p=>p.providerRef));
 assert.equal(song.state,'failed');
 assert.equal('message' in song&&song.message,message);
 assert.deepEqual(f.errors.map(error=>error.error),scenario==='empty'?[]:[scenario==='limit'?'limit-history':scenario==='unsupported-format'?'unsupported':scenario]);
});
