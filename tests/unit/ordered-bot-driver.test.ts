import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import Long from 'long';
import {Activity} from '../../src/playback/ownership';
import {acquireFromOrderedBots,acquisitionFailureText,type CollectionBotProgress} from '../../src/library/ordered-bot-acquisition';
import {downloadSong} from '../../src/library/download-song';
import {createBotSearchDriver,type BotSearchDependency} from '../../src/telegram/bot-search-driver';
import {BOT_DOWNLOAD_MAX_BYTES,botDownloadTransferMs} from '../../src/telegram/bot-download-bytes';
import {BOT_SEARCH_BOUNDS,isBotSearchFileError,parseBotSearchReply,type BotSearchCommand,type BotSearchReply} from '../../src/telegram/bot-search-protocol';
import {TelegramSessionClient,type BotSearchAdmission,type BotSearchSnapshot,type SessionWorker} from '../../src/telegram/session-client';

const target={title:'Song',artist:'Artist',album:'Album',durationSeconds:60};
const providers=[{providerRef:crypto.randomUUID(),label:'One'},{providerRef:crypto.randomUUID(),label:'Two'}];
const audio=new TextEncoder().encode('RIFF1234WAVE');
const history=(messages:unknown[]=[])=>({_:'messages.messages',messages,users:[],chats:[]});
const incoming=(botId:number,id:number,reply:number,message='')=>({
 _:'message',id,peerId:{_:'peerUser',userId:botId},message,replyTo:{_:'messageReplyHeader',replyToMsgId:reply},
});
const document=(botId:number,id:number,reply:number,key:number,bytes=audio.length,mimeType='audio/wav')=>({
 ...incoming(botId,id,reply),media:{_:'messageMediaDocument',document:{_:'document',id:Long.fromInt(key),
  accessHash:Long.fromBits(99,0),fileReference:Uint8Array.of(4),dcId:2,mimeType,size:bytes,
  attributes:[{_:'documentAttributeAudio',title:target.title,performer:target.artist,duration:60}]}},
});
const menu=(botId:number,id:number,reply:number,options=[1,2])=>({...incoming(botId,id,reply),replyMarkup:{_:'replyInlineMarkup',rows:options.map(option=>({
 _:'keyboardInlineButtonRow',buttons:[{_:'keyboardInlineButton',text:'Song — Artist',type:{_:'inlineButtonTypeCallback',data:Uint8Array.of(option)}}],
}))}});

const startPrompts={
 'needs-start':'Envía /start para iniciar el bot',
 'start-recent':'Use /start',
 'start-welcome':'👋 Welcome!\nPlease press /start first.',
 'start-es':'🎵 Primero, envía /start.',
 'start-mention':'Encontré una canción llamada «Use /start».',
};
type Reply='direct-timeout'|'direct'|'menu-valid'|'menu-blocked'|'menu-invalid'|'menu-large'|'menu-ogg'|'menu-ogg-three'|'menu-flac'|'menu-all-ogg'|'callback-conflict'|'empty'|'unsupported'|'unsupported-format'|'limit'|'blocked'|keyof typeof startPrompts;
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
   if(scenario==='blocked')throw Object.assign(Error('USER_IS_BLOCKED'),{text:'USER_IS_BLOCKED'});
   const outgoing=++nextId;
   const reply=++nextId;
   const prompt=Object.hasOwn(startPrompts,scenario)?startPrompts[scenario as keyof typeof startPrompts]:null;
   messages=scenario.startsWith('menu-')||scenario==='callback-conflict'?[menu(id,reply,outgoing,scenario==='menu-ogg-three'?[1,2,3]:undefined)]:
    scenario==='empty'?[incoming(id,reply,outgoing,'No se encontraron resultados')]:
    prompt?[{...incoming(id,reply,outgoing,prompt),...(scenario==='needs-start'?{}:{replyTo:undefined})}]:
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
   if(scenario==='menu-blocked')throw Object.assign(Error('USER_IS_BLOCKED'),{text:'USER_IS_BLOCKED'});
   const overLimit=scenario==='menu-large'&&option===1;
   const mime=scenario==='menu-all-ogg'||(scenario==='menu-ogg'||scenario==='menu-ogg-three')&&option===1?'audio/ogg':
    scenario==='menu-flac'&&option===1?'audio/flac':undefined;
   messages.push(document(botId(peer),++nextId,id,option,overLimit?BOT_DOWNLOAD_MAX_BYTES+1:audio.length,mime));
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
   const menu=callbackBudgetMs===undefined?[]:state.rows.filter(row=>row.kind==='option'&&row.rowRef!==rowRef);
   const expiresAt=state.expiresAt;
   admit({queryId:command.queryId,cancel:()=>{}});
   publish({pending:true,error:null,delivery:'not-dispatched',expiresAt:null});
   const reply=await execute(command);
   if(reply.type==='bot-search.downloaded'){
    publish({pending:false,delivery:'acknowledged',rows:menu,expiresAt});return reply.audio;
   }
   assert.equal(reply.type,'bot-search.error');
   const retain=menu.length&&isBotSearchFileError(reply.error);
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
 return {params,searches,callbacks,errors,allowed,drive,binding,dependency,get transferStarted(){return transferStarted;},
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
const downloadFixtureSong=(f:Pick<ReturnType<typeof setup>,'params'|'drive'>,trackId?:string)=>f.drive(downloadSong({
 ...f.params,collection:progress(),choice:{...target,id:'song',source:'itunes',duration:60},
 attempt:{current:()=>true,lookup:async()=>null,save:async()=>trackId?{state:'saved',trackId}:assert.fail('No valid audio'),
  addToLibrary:async()=>true,play:async()=>'failed'},
 index:0,mark:()=>{},message:()=>{},
}));

function setupRealClient(t:TestContext,replies:readonly Reply[]){
 const fixture=setup(t,replies);
 const activity=new Activity();
 activity.open();
 const abort=new AbortController();
 const transcript:BotSearchReply[]=[];
 const snapshots:BotSearchSnapshot[]=[];
 let driver:ReturnType<typeof createBotSearchDriver>;
 let terminations=0;
 let bridgeError:unknown;
 const emit=(data:unknown)=>worker.onmessage?.({data} as MessageEvent);
 const worker:SessionWorker={
  onmessage:null,onerror:null,onmessageerror:null,
  postMessage(command){
   if(command.type==='restore'){
    driver=createBotSearchDriver(fixture.binding,command.session,fixture.dependency);
    queueMicrotask(()=>emit({version:2,session:command.session,request:command.request,phase:'connected',error:null,
     retryAt:null,delivery:null,binding:fixture.binding,saved:{peerRef:crypto.randomUUID(),kind:'saved',name:'Mensajes guardados'},
     bots:providers.map((provider,index)=>({...provider,username:index===0?'ivkmbot':'lydbot',
      status:'verified-profile',compatibility:'unverified'}))}));
    return;
   }
   assert.ok(command.type==='bot-search.search'||command.type==='bot-search.download');
   const post=(reply:BotSearchReply,sessionClosed=false)=>{
    assert.ok(parseBotSearchReply(reply,command));
    transcript.push(reply);
    emit({protocol:'pulso-bot-search',version:1,reply,sessionClosed,retryAt:null,retryBlocked:false});
   };
   void driver.handle(command,{signal:abort.signal,current:()=>!abort.signal.aborted,publish:post}).then(async reply=>{
    assert.ok(reply);
    post(reply,!await driver.whenSettled());
   }).catch(error=>{bridgeError=error;worker.onerror?.({} as ErrorEvent);});
  },
  terminate(){terminations++;abort.abort();driver.close();},
 };
 const client=new TelegramSessionClient(activity,()=>activity.scope(),()=>{},()=>worker);
 t.after(()=>client.dispose());
 client.subscribeSearch(state=>snapshots.push(state));
 client.restore();
 const params={...fixture.params,client,revision:client.botsSnapshot().revision,progress:()=>{}};
 return {...fixture,params,client,transcript,snapshots,async connected(){
  await Promise.resolve();
  assert.equal(client.snapshot().phase,'connected');
  assert.equal(client.botsSnapshot().providers.length,2);
 },assertConnected(){
  assert.equal(bridgeError,undefined);
  assert.equal(client.snapshot().error,null);
  assert.equal(client.snapshot().phase,'connected');
  assert.equal(terminations,0);
 }};
}

for(const scenario of ['blocked','menu-blocked'] as const){
 for(const fallback of ['direct','empty'] as const)test(`R3 · real session survives ${scenario} and continues to the ${fallback} bot`,async t=>{
  const f=setupRealClient(t,[scenario,fallback]);
  await f.connected();
  const song=await downloadFixtureSong(f,fallback==='direct'?'next-bot-copy':undefined);
  f.assertConnected();
  const rejection=f.transcript.find(reply=>reply.type==='bot-search.error');
  const sending=f.transcript.find(reply=>reply.type==='bot-search.sending'&&reply.requestId===rejection?.requestId);
  assert.equal(sending?.type,'bot-search.sending');
  assert.equal(rejection?.type==='bot-search.error'&&rejection.error,'needs-start');
  assert.equal(rejection?.type==='bot-search.error'&&rejection.delivery,'uncertain');
  assert.ok(f.transcript.indexOf(sending!)<f.transcript.indexOf(rejection!));
  assert.equal(f.transcript.filter(reply=>reply.type==='bot-search.sending').length,scenario==='blocked'?2:3);
  assert.deepEqual(f.callbacks,scenario==='blocked'?[]:[1]);
  assert.equal(song.state,fallback==='direct'?'downloaded':'failed');
  if(fallback==='empty')assert.equal('message' in song&&song.message,'Un bot necesita que envíes /start en Telegram');
 });
}

for(const scenario of ['menu-valid','menu-ogg-three'] as const)test(`R4 · real individual search consumes ${scenario} on success without later expiry`,async t=>{
 const f=setupRealClient(t,[scenario]);
 await f.connected();
 assert.equal((await f.drive(acquireFromOrderedBots(f.params))).state,'audio');
 assert.deepEqual(f.callbacks,scenario==='menu-valid'?[1]:[1,2]);
 assert.equal(f.transcript.filter(reply=>reply.type==='bot-search.sending').length,1+f.callbacks.length);
 t.mock.timers.tick(BOT_SEARCH_BOUNDS.resultTtlMs+1);
 await Promise.resolve();
 f.assertConnected();
 assert.equal(f.client.searchSnapshot().error,null);
 assert.equal(f.snapshots.some(state=>state.error==='expired'),false);
 assert.equal(f.client.searchSnapshot().rows.length,0);
 assert.equal(f.client.searchSnapshot().expiresAt,null);
});

for(const scenario of ['menu-ogg','menu-flac'] as const)
 test(`R1 · ${scenario} preserves the second option and saves with the same bot`,async t=>{
  const f=setup(t,[scenario,'empty']);
  const song=await downloadFixtureSong(f,'same-bot-copy');
  assert.equal(song.state,'downloaded',JSON.stringify({song,callbacks:f.callbacks,errors:f.errors.map(reply=>reply.error)}));
  assert.deepEqual(f.callbacks,[1,2]);
  assert.deepEqual(f.searches,[providers[0].providerRef]);
 });

test('R1 · unsupported audio across the menu never penalizes the bot',async t=>{
 const f=setup(t,['menu-all-ogg','direct']);
 for(let i=0;i<3;i++)assert.equal((await downloadFixtureSong(f,'fallback-copy')).state,'downloaded');
 assert.deepEqual(f.searches,Array.from({length:3},()=>providers.map(p=>p.providerRef)).flat(),JSON.stringify(f.errors.map(reply=>reply.error)));
 assert.deepEqual(f.callbacks,[1,2,1,2,1,2]);
});

test('R1 · only an exhausted incompatible menu reports the compatibility warning',async t=>{
 const f=setup(t,['menu-all-ogg','empty']);
 const song=await downloadFixtureSong(f);
 assert.deepEqual(f.callbacks,[1,2]);
 assert.equal('message' in song&&song.message,'Ningún bot entregó un archivo compatible');
});

test('R1 · a delivered compatible file rejected locally does not produce a format warning',async t=>{
 const f=setup(t,['unsupported-format','direct']);
 const result=await f.drive(acquireFromOrderedBots({...f.params,collection:progress(),accept:async()=>'retry'}));
 assert.equal(result.state,'known-failure');
 if(result.state==='known-failure')assert.doesNotMatch(acquisitionFailureText(result.reasons),/Ningún bot entregó un archivo compatible/);
});

for(const scenario of ['blocked','start-recent','start-welcome','start-es'] as const)
 test(`M9 · ${scenario} falls back to the next bot and preserves the start warning`,async t=>{
  const f=setup(t,[scenario,'empty']);
  const song=await downloadFixtureSong(f);
  assert.deepEqual(f.searches,providers.map(p=>p.providerRef));
  assert.deepEqual(f.errors.map(reply=>reply.error),['needs-start']);
  assert.equal('message' in song&&song.message,'Un bot necesita que envíes /start en Telegram');
 });

test('M9 · a song title mentioning /start is not a bot start prompt',async t=>{
 const f=setup(t,['start-mention','direct']);
 assert.equal((await downloadFixtureSong(f,'fallback-copy')).state,'downloaded');
 assert.deepEqual(f.errors.map(reply=>reply.error),['unsupported']);
});

test('M9 · mixed interactive replies do not assert catalogue absence',async t=>{
 const f=setup(t,['empty','needs-start']);
 const result=await f.drive(acquireFromOrderedBots(f.params));
 assert.equal(result.state,'known-failure');
 if(result.state==='known-failure')assert.equal(acquisitionFailureText(result.reasons),'Un bot necesita que envíes /start en Telegram');
});

test('M9 · interactive search also advances after a blocked bot',async t=>{
 const f=setup(t,['blocked','direct']);
 assert.equal((await f.drive(acquireFromOrderedBots(f.params))).state,'audio');
 assert.deepEqual(f.searches,providers.map(p=>p.providerRef));
});

test('R1 · interactive search uses the retained menu after unsupported audio',async t=>{
 const f=setup(t,['menu-ogg','empty']);
 const result=await f.drive(acquireFromOrderedBots(f.params));
 assert.equal(result.state,'audio',JSON.stringify({result,callbacks:f.callbacks,errors:f.errors.map(reply=>reply.error)}));
 assert.deepEqual(f.callbacks,[1,2]);
 assert.deepEqual(f.searches,[providers[0].providerRef]);
});

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
 assert.deepEqual(f.errors.map(error=>error.error),scenario==='empty'?[]:[scenario==='limit'?'limit-history':scenario==='unsupported-format'?'file-unsupported':scenario]);
});
