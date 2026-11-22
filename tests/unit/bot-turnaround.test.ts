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
