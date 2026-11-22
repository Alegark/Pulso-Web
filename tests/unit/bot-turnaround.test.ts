import assert from 'node:assert/strict';
import test from 'node:test';
import {createBotHealth,sessionBotHealth} from '../../src/library/bot-health';
import {acquireFromOrderedBots} from '../../src/library/ordered-bot-acquisition';
import {beginSongAggregate} from '../../src/diagnostics/song-aggregate';
import {parseSongAggregate,songTimingKeys} from '../../src/diagnostics/contract';
import {capabilityFields,projectReview,type Capabilities} from '../../src/diagnostics/export';
import {createDiagnosticSession} from '../../src/diagnostics/session';
import {emptyNetworkTiming} from '../../src/diagnostics/download-timing';
import {botOptionDurationMismatch,matchingSongRows,type BotDownloadedAudio,type BotSearchRow} from '../../src/telegram/bot-search-protocol';
import type {TelegramSessionClient,BotSearchSnapshot,BotSearchAdmission} from '../../src/telegram/session-client';

const providers=Object.freeze([{providerRef:'private-bot-a',label:'Bot A'},{providerRef:'private-bot-b',label:'Bot B'}]);
test('two consecutive failures demote a bot with a healthy alternative and restore its original slot after five minutes',()=>{
 let now=0;
 const health=createBotHealth(()=>now);
 const check=(first:number)=>assert.equal(health.order(providers)[0],providers[first]);
 health.observe(providers[0].providerRef,15000,'timeout');
 health.observe(providers[0].providerRef,15000,'timeout');
 check(0);
 health.observe(providers[1].providerRef,500,'success');
 check(1);
 assert.deepEqual(health.order(providers),[providers[1],providers[0]]);
 assert.deepEqual(health.order(providers.slice(0,1)),[providers[0]]);
 now=299999;check(1);
 now=300000;check(0);
 assert.equal(providers[0].providerRef,'private-bot-a');
});
test('honest empty reply breaks the failure streak and account or session changes discard health',()=>{
 const client={};
 const health=sessionBotHealth(client,'session-1');
 health.observe(providers[1].providerRef,100,'success');
 health.observe(providers[0].providerRef,15000,'timeout');
 health.observe(providers[0].providerRef,250,'reply');
 health.observe(providers[0].providerRef,15000,'timeout');
 assert.deepEqual(health.order(providers),providers);
 health.observe(providers[0].providerRef,50,'unsupported');
 assert.equal(sessionBotHealth(client,'session-1').order(providers)[0],providers[1]);
 assert.deepEqual(sessionBotHealth({},'session-1').order(providers),providers);
 assert.deepEqual(sessionBotHealth(client,'session-2').order(providers),providers);
 assert.deepEqual(sessionBotHealth(client,'session-1').order(providers),providers);
});

const target={title:'Título privado',artist:'Artista privado',album:null,durationSeconds:272};
const option=(rowRef:string,suffix=''):BotSearchRow=>({kind:'option',rowRef,correlation:'reply',label:`${target.artist} - ${target.title}${suffix}`});
test('duration displayed on a button uses a ±7-second filter before callback without changing audio matching',()=>{
 for(const suffix of ['', ' (4:25)',' [4:39]',' (9:99)'])assert.equal(botOptionDurationMismatch(option('a',suffix),target),false);
 for(const suffix of [' (4:24)',' [4:40]'])assert.equal(botOptionDurationMismatch(option('a',suffix),target),true);
 assert.equal(botOptionDurationMismatch(option('a',' (5:00)'),{...target,durationSeconds:null}),false);
 assert.equal(matchingSongRows([option('a',' (5:00)')],target).length,1);
});

test('one closed song record adds every bot, option and transfer while the dock reports current phases',async()=>{
 const session=createDiagnosticSession();session.setEnabled(true);
 const measurement=beginSongAggregate(session)!;
 const statuses:string[]=[],searches:string[]=[],downloads:string[]=[];
 const incompatible:BotSearchRow={kind:'audio',rowRef:'private-audio',correlation:'reply',title:target.title,performer:target.artist,
  durationSeconds:350,mimeType:'audio/wav',bytes:100};
 const audio:BotDownloadedAudio={blob:new Blob([]),sha256:'a'.repeat(64),target,bytes:100,mime:'audio/wav'};
 let state:BotSearchSnapshot={binding:null,scopeKey:'private-scope',providerRef:null,providerRevision:1,expectedTarget:target,
  pending:false,cancelling:false,available:true,retryBlocked:false,retryAt:null,delivery:'acknowledged',expiresAt:null,
  queryId:null,error:null,providerNotice:null,rows:[]};
 const listeners=new Set<(state:BotSearchSnapshot)=>void>();
 const emit=()=>{for(const listener of listeners)listener(state);};
 const client={
  botsSnapshot:()=>({scopeKey:'private-scope',revision:1}),
  searchSnapshot:()=>state,
  captureSearchActionCurrent:()=>()=>true,
  subscribeSearch(listener:(state:BotSearchSnapshot)=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},
  searchBot({providerRef}:{providerRef:string},_allowed:unknown,admit:(value:BotSearchAdmission)=>void,timing:(value:unknown)=>void){
   searches.push(providerRef);
   const queryId='private-query-'+searches.length,timeout=searches.length===1;
   state={...state,providerRef,queryId,error:timeout?'timeout':null,rows:timeout?[]:[option('a'),option('b')],
    expiresAt:Date.now()+120000};
   admit({queryId,cancel:()=>{}});
   timing({...emptyNetworkTiming(),searchPollMs:timeout?15000:250,...(timeout?{}:{firstBotReplyMs:300})});
  },
  async downloadBot(rowRef:string,_allowed:unknown,admit:(value:BotSearchAdmission)=>void,timing:(value:unknown)=>void){
   downloads.push(rowRef);
   admit({queryId:state.queryId!,cancel:()=>{}});
   if(rowRef==='a'){state={...state,rows:[option('b'),incompatible]};timing({...emptyNetworkTiming(),callbackPollMs:2600});return null;}
   state={...state,pending:true,downloadProgress:{bytes:3200000,total:8000000}};emit();
   state={...state,pending:false,rows:[],downloadProgress:null};emit();
   timing({...emptyNetworkTiming(),callbackPollMs:500,transferMs:125});return audio;
  },
 } as unknown as TelegramSessionClient;
 const result=await acquireFromOrderedBots({client,providers,revision:1,target,signal:new AbortController().signal,current:()=>true,
  networkCurrent:()=>true,collection:{completed:new Set(),ambiguous:new Set(),responded:false,reasons:[]},
  measurement,progress:()=>{},status:message=>statuses.push(message),accept:async()=>{await new Promise(ok=>setTimeout(ok,5));return 'saved';}});
 measurement.finish();measurement.finish();
 assert.equal(result.state,'audio');
 assert.deepEqual(searches,providers.map(p=>p.providerRef));assert.deepEqual(downloads,['a','b']);
 assert.equal(listeners.size,0);
 for(const needle of ['Consultando bot 1 de 2','Probando otro bot','El bot prepara el archivo','La opción no coincide (duración)','Descargando 3,2 de 8,0 MB'])
  assert.ok(statuses.some(text=>text.includes(needle)),needle);
 const [song]=session.getSnapshot().songs;
 assert.equal(session.getSnapshot().songs.length,1);
 assert.deepEqual({...song,rejections:{...song.rejections},timeoutMs:0,importMs:0,totalMs:0},{
  songSeq:1,botsTried:2,winningBotSlot:1,flow:'callback-menu',candidatesTried:2,candidatesDownloaded:1,candidatesRejected:1,
  timeoutCount:1,rejections:{timeout:1,'mismatch-duration':1},timeoutMs:0,firstBotReplyMs:300,searchPollMs:15250,
  callbackPollMs:3100,transferMs:125,importMs:0,reconnectMs:0,floodWaitMs:0,totalMs:0,
 });
 assert.ok(song.importMs>0&&song.totalMs>=song.importMs);
 const opts={errors:[],capabilities:[],limits:[],songs:songTimingKeys};
 const caps=Object.fromEntries(capabilityFields.map(key=>[key,'unknown'])) as Capabilities;
 const {json}=projectReview(session.getSnapshot(),opts,caps);
 assert.doesNotMatch(json,/privad|private|providerRef|queryId|https?:/i);
 assert.deepEqual(JSON.parse(json).datasets.songs,[JSON.parse(JSON.stringify(song))]);
 assert.equal(parseSongAggregate({...song,title:target.title}),null);
 assert.equal(parseSongAggregate({...song,rejections:{'private-query':1}}),null);
 const old=beginSongAggregate(session)!;session.clear();old.finish();
 assert.deepEqual(session.getSnapshot().songs,[]);
});

test('a stalled transfer cannot spend the backup bot’s reserved time',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 t.mock.method(performance,'now',()=>Date.now());
 const searched:string[]=[];
 const audio:BotDownloadedAudio={blob:new Blob([]),sha256:'b'.repeat(64),target,bytes:100,mime:'audio/wav'};
 const row:BotSearchRow={kind:'audio',rowRef:'audio',correlation:'reply',title:target.title,performer:target.artist,
  durationSeconds:272,mimeType:'audio/wav',bytes:100};
 let state={pending:false,available:true,retryBlocked:false,retryAt:null,delivery:'acknowledged',
  scopeKey:'test',providerRevision:1,expectedTarget:target,providerRef:'',queryId:'',error:null as string|null,rows:[row]};
 let markStarted!:()=>void;
 const inFlight=new Promise<void>(resolve=>{markStarted=resolve;});
 const client={
  botsSnapshot:()=>({revision:1,scopeKey:'budget-test'}),
  searchSnapshot:()=>state,subscribeSearch:()=>()=>{},captureSearchActionCurrent:()=>()=>true,
  searchBot({providerRef}:{providerRef:string},_allowed:unknown,admit:(value:BotSearchAdmission)=>void){
   searched.push(providerRef);
   state={...state,providerRef,queryId:providerRef,error:null};admit({queryId:providerRef,cancel:()=>{}});
  },
  downloadBot(_ref:string,_allowed:unknown,admit:(value:BotSearchAdmission)=>void){
   return new Promise(resolve=>{
    admit({queryId:state.queryId,cancel:()=>{state={...state,error:'cancelled'};resolve(null);}});
    if(searched.length===1)markStarted();else resolve(audio);
   });
  },
 } as unknown as TelegramSessionClient;
 const result=acquireFromOrderedBots({client,providers,revision:1,target,signal:new AbortController().signal,current:()=>true,
  networkCurrent:()=>true,collection:{completed:new Set(),ambiguous:new Set(),responded:false,reasons:[]},
  progress:()=>{},accept:async()=> 'saved'});
 await inFlight;
 t.mock.timers.tick(149999);
 assert.deepEqual(searched,[providers[0].providerRef]);
 t.mock.timers.tick(1);
 assert.equal((await result).state,'audio');
 assert.deepEqual(searched,providers.map(p=>p.providerRef));
});

test('a clock-shaped suffix in the title or performer is part of the button identity',()=>{
 for(const [title,artist] of [['Train (12:30)','Own Artist'],['Train','Own Artist [12:30]']]){
  const wanted={...target,title,artist,durationSeconds:210};
  const label=title.endsWith(')')?`${artist} - ${title}`:`${title} - ${artist}`;
  const row={...option('a'),label} as BotSearchRow;
  assert.equal(matchingSongRows([row],wanted).length,1);
  assert.equal(botOptionDurationMismatch(row,wanted),false);
  assert.equal(botOptionDurationMismatch({...row,label:label+' (10:00)'} as BotSearchRow,wanted),true);
 }
});

function scriptedAcquisition(wanted=target){
 let state:BotSearchSnapshot={binding:null,scopeKey:'review',providerRef:null,providerRevision:1,expectedTarget:wanted,
  pending:false,cancelling:false,available:true,retryBlocked:false,retryAt:null,delivery:'acknowledged',expiresAt:null,
  queryId:null,error:null,providerNotice:null,rows:[]};
 const listeners=new Set<(value:BotSearchSnapshot)=>void>(),searches:string[]=[],statuses:string[]=[],downloads:string[]=[];
 const update=(patch:Partial<BotSearchSnapshot>)=>{
  state={...state,...patch};
  for(const listener of listeners)listener(state);
 };
 const session=createDiagnosticSession();session.setEnabled(true);
 const measurement=beginSongAggregate(session)!;
 const fixture={
  searches,statuses,downloads,update,session,measurement,
  onSearch:(_first:boolean,_cancel:()=>void)=>{},
  onDownload:async(_ref:string,_admit:(cancel?:()=>void)=>void,_budget?:number):Promise<BotDownloadedAudio|null>=>null,
 };
 const client={
  botsSnapshot:()=>({revision:1,scopeKey:'review'}),searchSnapshot:()=>state,captureSearchActionCurrent:()=>()=>true,
  subscribeSearch(fn:(value:BotSearchSnapshot)=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
  searchBot({providerRef}:{providerRef:string},_allowed:unknown,admit:(v:BotSearchAdmission)=>void){
   searches.push(providerRef);
   const queryId=String(searches.length);
   update({providerRef,queryId,pending:false,error:null,delivery:'acknowledged',rows:[],expiresAt:Date.now()+120000});
   const cancel=()=>update({error:'cancelled',pending:false});
   admit({queryId,cancel});fixture.onSearch(providerRef===providers[0].providerRef,cancel);
  },
  downloadBot(ref:string,_allowed:unknown,admit:(v:BotSearchAdmission)=>void,_timing:unknown,budget?:number){
   downloads.push(ref);
   return fixture.onDownload(ref,cancel=>admit({queryId:state.queryId!,cancel:cancel??(()=>{})}),budget);
  },
 } as unknown as TelegramSessionClient;
 return {...fixture, hooks:fixture, params:{client,providers,revision:1,target:wanted,signal:new AbortController().signal,
  current:()=>true,networkCurrent:()=>true,progress:()=>{},status:(message:string)=>statuses.push(message),measurement}};
}

for(const phase of ['búsqueda','descarga'])test(`a reserved bot timeout during ${phase} leaves an empty album result unavailable`,async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 t.mock.method(performance,'now',()=>Date.now());
 const f=scriptedAcquisition();
 f.hooks.onSearch=first=>{if(first)f.update(phase==='búsqueda'?{pending:true}:{rows:[option('a')]});};
 f.hooks.onDownload=async(_ref,admit)=>new Promise(resolve=>{
  admit(()=>{f.update({pending:false,error:'cancelled'});resolve(null);});
 });
 const result=acquireFromOrderedBots({...f.params,accept:async()=> 'saved'});
 await new Promise(resolve=>setImmediate(resolve));
 t.mock.timers.tick(150000);
 assert.deepEqual(await result,{state:'unavailable'});
 assert.deepEqual(f.searches,providers.map(p=>p.providerRef));
});

for(const collection of [false,true])test(`timer expiry survives a wall-clock rollback in ${collection?'a collection':'an interactive search'}`,async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 let monotonic=1000;
 t.mock.method(performance,'now',()=>monotonic);
 const f=scriptedAcquisition();
 f.hooks.onSearch=first=>{if(first)f.update({pending:true});};
 const setTime=Date.now;
 let offset=0;
 t.mock.method(Date,'now',()=>setTime()-offset);
 const health=sessionBotHealth(f.params.client,'review');
 if(collection){
  health.observe(providers[0].providerRef,15000,'timeout');
  health.observe(providers[1].providerRef,250,'success');
 }
 const initial=f.hooks.onSearch;
 f.hooks.onSearch=(first,cancel)=>{initial(first,cancel);if(first)offset=1;};
 const result=acquireFromOrderedBots({...f.params,...(collection?{accept:async()=> 'saved' as const,
  collection:{completed:new Set<number>(),ambiguous:new Set<number>(),responded:false,reasons:[]}}:{})});
 await new Promise(resolve=>setImmediate(resolve));
 monotonic+=149999;t.mock.timers.tick(150000);
 await result;
 f.measurement.finish();
 assert.deepEqual(f.searches,providers.map(p=>p.providerRef));
 assert.deepEqual({...f.session.getSnapshot().songs[0].rejections},{timeout:1,'no-compatible-row':1});
 if(collection)assert.equal(health.order(providers)[0],providers[1]);
});

test('an album callback timeout with budget remaining does not repeat the search',async t=>{
 let now=0;t.mock.method(performance,'now',()=>now);
 const f=scriptedAcquisition();
 f.hooks.onSearch=first=>{if(first)f.update({rows:[option('a'),option('b')]});};
 f.hooks.onDownload=async(_ref,admit,budget)=>{
  admit();assert.equal(budget,65000);now+=budget!-4000;
  f.update({error:'timeout',rows:[]});return null;
 };
 await acquireFromOrderedBots({...f.params,accept:async()=> 'saved'});
 assert.deepEqual(f.searches,providers.map(p=>p.providerRef));
});

test('when duration rejects every compatible button, report only duration',async()=>{
 const f=scriptedAcquisition();
 f.hooks.onSearch=()=>f.update({rows:[option('a',' (10:00)')]});
 const result=await acquireFromOrderedBots({...f.params,providers:providers.slice(0,1),accept:async()=> 'saved'});
 assert.deepEqual(result,{state:'known-failure',reasons:['returned-audio-mismatch','audio-duration-mismatch']});
 assert.deepEqual(f.downloads,[]);
});

test('a metadata rejection is shown for the next callback only',async()=>{
 const f=scriptedAcquisition();
 f.hooks.onSearch=()=>f.update({rows:[option('a'),option('b'),option('c')]});
 f.hooks.onDownload=async(ref,admit)=>{
  admit();
  f.update({rows:[option('b'),option('c')].filter(row=>row.rowRef!==ref)});
  return {blob:new Blob(),sha256:'c'.repeat(64),target,bytes:100,mime:'audio/wav'};
 };
 let attempts=0;
 const result=await acquireFromOrderedBots({...f.params,providers:providers.slice(0,1),
  accept:async()=>++attempts===1?'import-tag-mismatch':attempts===2?'retry':'saved'});
 assert.equal(result.state,'audio');
 assert.deepEqual(f.downloads,['a','b','c']);
 assert.deepEqual(f.statuses.filter(s=>s.includes('prepara')),[
  'El bot prepara el archivo…','La opción no coincide (metadatos) · probando otra… El bot prepara el archivo…','El bot prepara el archivo…',
 ]);
});

for(const album of [false,true])test(`a deadline after a mismatch remains inconclusive in ${album?'an album':'an interactive search'}`,async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 t.mock.method(performance,'now',()=>Date.now());
 const f=scriptedAcquisition();
 f.hooks.onSearch=first=>f.update({rows:album?
  (first?[option('bad',' (10:00)'),option('good')]:[]):
  [first?option('bad',' (10:00)'):option('good')]});
 f.hooks.onDownload=async(_ref,admit)=>new Promise(resolve=>{
  admit(()=>{f.update({pending:false,error:'cancelled'});resolve(null);});
 });
 const result=acquireFromOrderedBots({...f.params,...(album?{accept:async()=> 'saved' as const}:{})});
 await new Promise(resolve=>setImmediate(resolve));
 t.mock.timers.tick(album?150000:180000);
 assert.deepEqual(await result,{state:album?'unavailable':'uncertain'});
 assert.deepEqual(f.searches,providers.map(p=>p.providerRef));
});

test('a direct audio retry consumes the stale rejection before the next menu callback',async()=>{
 const f=scriptedAcquisition();
 const rows:BotSearchRow[]=[272,273].map((durationSeconds,i)=>({kind:'audio',rowRef:`audio-${i}`,correlation:'reply',
  title:target.title,performer:target.artist,durationSeconds,mimeType:'audio/wav',bytes:100}));
 f.hooks.onSearch=()=>f.update({rows:[...rows,option('menu')]});
 f.hooks.onDownload=async(_ref,admit)=>{
  admit();f.update({rows:[]});
  return {blob:new Blob(),sha256:'c'.repeat(64),target,bytes:100,mime:'audio/wav'};
 };
 let attempts=0;
 const result=await acquireFromOrderedBots({...f.params,providers:providers.slice(0,1),
  accept:async()=>++attempts===1?'import-tag-mismatch':attempts===2?'retry':'saved'});
 assert.equal(result.state,'audio');
 assert.deepEqual(f.downloads,['audio-0','audio-1','menu']);
 assert.deepEqual(f.statuses.filter(s=>s.includes('prepara')),['El bot prepara el archivo…']);
});

test('an answered collection with an exhausted callback fails only the song',async t=>{
 let now=0;t.mock.method(performance,'now',()=>now);
 const f=scriptedAcquisition();
 f.hooks.onSearch=first=>f.update({rows:first?[option('a')]:[]});
 f.hooks.onDownload=async(_ref,admit,budget)=>{
  admit();assert.equal(budget,65000);now+=budget!;
  f.update({error:'timeout',rows:[]});return null;
 };
 const collection={completed:new Set<number>(),ambiguous:new Set<number>(),responded:false,reasons:[]};
 const result=await acquireFromOrderedBots({...f.params,collection,accept:async()=> 'saved'});
 assert.deepEqual(result,{state:'timed-out'});
 assert.equal(collection.responded,true);
 assert.deepEqual(f.searches,providers.map(p=>p.providerRef));
});
