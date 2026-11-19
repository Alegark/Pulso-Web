import test from 'node:test';import assert from 'node:assert/strict';
import type {BotSearchSnapshot} from '../../src/telegram/session-client';
import type {BotSearchRow} from '../../src/telegram/bot-search-protocol';
import {downloadLibrarySelection} from '../../src/library/library-download';
import type {Track} from '../../src/library/library';
import type {SongPlaybackAttempt} from '../../src/library/selected-song';
const track:Track={id:'11111111-1111-4111-8111-111111111111',title:'Propia',artist:'Artista',album:'Álbum',duration:60,favorite:false,revision:1,createdAt:'2026-11-17T00:00:00Z',manualOverrides:{},assetId:null};
test('downloading a restored selection reuses verified copies, preserves organization and never invokes playback',async()=>{
 let looked=0,saved=0,added=0,played=0,final:any;
 const attempt:SongPlaybackAttempt={current:()=>true,lookup:async c=>{looked++;assert.equal(c.id,'local:'+track.id);return track.id;},save:async()=>{saved++;return {state:'failed',trackId:null};},addToLibrary:async()=>{added++;return true;},play:async()=>{played++;return 'failed';}};
 const client={captureBotsCurrent:()=>()=>true,searchBot:()=>{throw Error('no search');}} as never;
 await downloadLibrarySelection({tracks:[track],attempt,client,providers:[],revision:1,signal:new AbortController().signal,current:()=>true,update:(rows,message)=>{final={rows,message};}});
 assert.equal(looked,1);assert.equal(saved,0);assert.equal(added,0);assert.equal(played,0);assert.equal(final.rows[0].state,'reused');assert.equal(final.rows[0].confirmed,true);
});
test('restored metadata uses its original catalogue credit for a later download',async()=>{
 const selected={...track,artist:'Etiqueta extendida',catalogChoice:{id:'lrclib:1',source:'lrclib' as const,title:'Propia',artist:'Artista',album:'Álbum',duration:60}};
 let artist:string|null=null;const attempt:SongPlaybackAttempt={current:()=>true,lookup:async c=>{artist=c.artist;return track.id;},save:async()=>{throw Error('no save');},addToLibrary:async()=>{throw Error('no add');},play:async()=>{throw Error('no play');}};
 await downloadLibrarySelection({tracks:[selected],attempt,client:{captureBotsCurrent:()=>()=>true} as never,providers:[],revision:1,signal:new AbortController().signal,current:()=>true,update:()=>{}});assert.equal(artist,'Artista');
});

import {copyLibraryDownloadCheckpoint,discardLibraryDownloadCheckpoint,readHeldLibraryDownload,readLibraryDownloadCheckpoint,writeLibraryDownloadCheckpoint} from '../../src/library/library-download-checkpoint';
import type {LibraryDownloadCheckpoint} from '../../src/library/library-download-checkpoint';
import type {AlbumRow} from '../../src/library/album-acquisition';
import type {TelegramSessionClient} from '../../src/telegram/session-client';
import type {BotSearchTarget} from '../../src/telegram/bot-search-protocol';
const selection=Array.from({length:4},(_,i)=>({...track,id:`11111111-1111-4111-8111-11111111111${i+1}`,title:`Pista ${i+1}`}));
const batch=():LibraryDownloadCheckpoint=>({id:crypto.randomUUID(),trackIds:selection.map(t=>t.id),cursor:0,pending:null});
function fixture(checkpoint=batch(),options:{twoBots?:boolean;absent?:boolean;flood?:boolean;alternates?:boolean}={}){
 const requests:string[]=[],queries:string[]=[],downloads:string[]=[],parked=new Map(),abort=new AbortController();
 let flooded=false;
 let state={queryId:'',providerRef:'bot',providerRevision:1,expectedTarget:null,pending:false,cancelling:false,available:true,
  error:null,delivery:'acknowledged',retryBlocked:false,retryAt:null,rows:[]} as unknown as BotSearchSnapshot;
 const start=(started:(admission:{queryId:string;cancel():void})=>void)=>started({queryId:state.queryId!,cancel:()=>{}});
 const client={
  botsSnapshot:()=>({revision:1}),searchSnapshot:()=>state,captureBotsCurrent:()=>()=>true,
  captureSearchActionCurrent:()=>()=>true,subscribeSearch:()=>()=>{},
  searchBot(input:{providerRef:string;target:BotSearchTarget},_allowed:unknown,started:Parameters<typeof start>[0]){
   assert.ok(!state.retryAt||Date.now()>=state.retryAt,'cannot query before retryAt');
   requests.push(input.target.title);queries.push(input.providerRef);
   const rows:BotSearchRow[]=options.absent&&input.target.title==='Pista 3'?[]:[{
    kind:'option',rowRef:'row',correlation:'reply',label:input.target.title+' — '+input.target.artist,
   }];
   if(rows.length&&options.alternates)rows.push({...rows[0],rowRef:'alternate'} as BotSearchRow);
   state={...state,error:null,queryId:String(requests.length),expectedTarget:input.target,providerRef:input.providerRef,rows};
   start(started);
  },
  async downloadBot(row:string,_allowed:unknown,started:Parameters<typeof start>[0]){
   start(started);downloads.push(row);
   if(options.flood&&!flooded&&state.expectedTarget?.title==='Pista 3'){
    flooded=true;state={...state,error:'rate-limit',retryAt:Date.now()+1200};return null;
   }
   const digest=state.providerRef==='bot'&&row==='row'?'a':'b';
   return {blob:new Blob(['x']),bytes:1,mime:'audio/wav',sha256:digest.repeat(64),target:state.expectedTarget};
  },
 } as unknown as TelegramSessionClient;
 let saved=checkpoint,rows:AlbumRow[]=[];
 const attempt:SongPlaybackAttempt={current:()=>true,lookup:async c=>selection.slice(0,2).find(t=>'local:'+t.id===c.id)?.id??null,
  save:async(_a,c)=>({state:'saved',trackId:c.id.slice(6)}),addToLibrary:async()=>{throw Error('No membership change');},
  play:async()=>{throw Error('No autoplay');}};
 const providers=[{providerRef:'bot',label:'Bot'},...(options.twoBots?[{providerRef:'other',label:'Other'}]:[])];
 return {requests,queries,downloads,parked,attempt,abort,get checkpoint(){return saved;},get rows(){return rows;},
  run:()=>downloadLibrarySelection({tracks:selection,attempt,client,providers,revision:1,signal:abort.signal,current:()=>true,
   checkpoint,saveCheckpoint:v=>{saved=v;},parkDownload:(id,pending)=>parked.set(id,pending),update:v=>{rows=v;}}),
 };
}

test('a definite failure after two reused tracks leaves the fourth track eligible',async()=>{
 const run=fixture(),save=run.attempt.save;
 run.attempt.save=async(audio,choice,signal,progress,id)=>{
  assert.ok(id);
  return choice.title===selection[2].title?{state:'failed',trackId:null}:save(audio,choice,signal,progress,id);
 };
 assert.equal(await run.run(),'finished');
 assert.deepEqual(run.rows.map(r=>r.state),['reused','reused','failed','downloaded']);
 assert.equal(run.rows[2].reason,'no-valid-file');
 assert.deepEqual(run.requests,selection.slice(2).map(t=>t.title));
 assert.equal(run.checkpoint.cursor,4);
});

test('restart reconciles the third track through the exact receipt before sending only track four',async()=>{
 const first=fixture();
 first.attempt.save=async()=>{first.abort.abort();return {state:'uncertain',trackId:null};};
 assert.equal(await first.run(),'stopped');
 const checkpoint=copyLibraryDownloadCheckpoint(JSON.parse(JSON.stringify(first.checkpoint)))!;
 assert.equal(checkpoint.pending?.kind,'save');
 assert.equal(checkpoint.cursor,2);
 assert.deepEqual(first.requests,[selection[2].title]);
 const resumed=fixture(checkpoint);
 resumed.attempt.reconcileDownload=async(operationId,id)=>{
  assert.equal(checkpoint.pending?.kind==='save'&&checkpoint.pending.operationId,operationId);
  assert.equal(id,selection[2].id);return {state:'saved',trackId:id};
 };
 assert.equal(await resumed.run(),'finished');
 assert.deepEqual(resumed.requests,[selection[3].title]);
 assert.deepEqual(resumed.rows.map(r=>r.state),['reused','reused','reused','downloaded']);
});

test('explicit cancel during save preserves its receipt and never starts the next track',async()=>{
 const run=fixture();
 run.attempt.save=async()=>{run.abort.abort();return {state:'uncertain',trackId:null};};
 assert.equal(await run.run(),'stopped');
 assert.equal(run.checkpoint.pending?.kind,'save');
 assert.deepEqual(run.requests,[selection[2].title]);
 const resumed=fixture(run.checkpoint);
 resumed.attempt.reconcileDownload=async()=>({state:'uncertain',trackId:null});
 assert.equal(await resumed.run(),'finished');
 assert.equal(resumed.rows[2].reason,'parked');
 assert.equal(resumed.parked.get(selection[2].id).kind,'save');
 assert.deepEqual(resumed.requests,[selection[3].title]);
});

test('discard is scoped to one execution and preserves the uncertain receipt apart from the selection',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),storage=new Map<string,string>();
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
  getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),
  removeItem:(key:string)=>storage.delete(key),
 }});
 try{
  const owner=crypto.randomUUID(),other=crypto.randomUUID(),original=batch(),operationId=crypto.randomUUID();
  const newer:LibraryDownloadCheckpoint={...original,id:crypto.randomUUID(),cursor:2,pending:{kind:'save',index:2,operationId}};
  writeLibraryDownloadCheckpoint(owner,newer);
  assert.equal(discardLibraryDownloadCheckpoint(owner,original),false);
  assert.deepEqual(readLibraryDownloadCheckpoint(owner),newer);
  assert.equal(discardLibraryDownloadCheckpoint(owner,newer),true);
  assert.equal(readLibraryDownloadCheckpoint(owner),null);
  assert.deepEqual(readHeldLibraryDownload(owner,selection[2].id),{kind:'save',operationId});
  assert.equal(readHeldLibraryDownload(other,selection[2].id),null);
 }finally{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else Reflect.deleteProperty(globalThis,'localStorage');}
});

test('a network-only checkpoint can resume without assuming a local write',async()=>{
 const checkpoint:LibraryDownloadCheckpoint={...batch(),cursor:2,pending:{kind:'network',index:2}};
 const resumed=fixture(checkpoint);
 assert.equal(await resumed.run(),'finished');
 assert.deepEqual(resumed.requests,selection.slice(2).map(t=>t.title));
 assert.deepEqual(resumed.rows.map(r=>r.state),['reused','reused','downloaded','downloaded']);
});

test('an invalid write checks and cleans its exact receipt, then the second bot saves',async()=>{
 const run=fixture(batch(),{twoBots:true}),save=run.attempt.save,staging=new Set<string>(),cleaned:string[]=[];
 run.attempt.save=async(audio,choice,signal,progress,id)=>{
  if(choice.title==='Pista 3'&&audio.sha256[0]==='a'){
   assert.ok(id);staging.add(id);return {state:'failed',trackId:null};
  }
  return save(audio,choice,signal,progress,id);
 };
 run.attempt.reconcileDownload=async(id,trackId,_,repair)=>{
  assert.equal(repair,true);assert.equal(trackId,selection[2].id);assert.equal(staging.delete(id),true);cleaned.push(id);
  return {state:'missing',trackId:null};
 };
 assert.equal(await run.run(),'finished');
 assert.deepEqual(run.queries,['bot','other','bot']);
 assert.equal(cleaned.length,1);assert.equal(staging.size,0);assert.ok(run.rows.every(r=>r.confirmed));
});

test('a transient save failure retries identical bytes with a fresh operation ID',async()=>{
 const run=fixture(),save=run.attempt.save,ids:string[]=[];
 run.attempt.save=async(audio,choice,signal,progress,id)=>{
  assert.ok(id);
  if(choice.title==='Pista 3'){
   ids.push(id);
   if(ids.length===1)return {state:'failed',trackId:null,retryWrite:true};
   assert.equal(audio.sha256,'a'.repeat(64));
  }
  return save(audio,choice,signal,progress,id);
 };
 run.attempt.reconcileDownload=async id=>{assert.equal(id,ids[0]);return {state:'missing',trackId:null};};
 assert.equal(await run.run(),'finished');assert.equal(new Set(ids).size,2);
 assert.deepEqual(run.requests,['Pista 3','Pista 4']);assert.equal(run.rows[2].confirmed,true);
});

test('all bots report no compatible match and the following song is saved',async()=>{
 const run=fixture(batch(),{twoBots:true,absent:true});
 assert.equal(await run.run(),'finished');
 assert.deepEqual(run.requests,['Pista 3','Pista 3','Pista 4']);
 assert.equal(run.rows[2].message,'No existe en tus bots');assert.equal(run.rows[2].reason,'not-found');
 assert.equal(run.rows[3].confirmed,true);
});

test('flood wait during delivery delays the retry and does not skip a track',async()=>{
 const run=fixture(batch(),{twoBots:true,flood:true});
 assert.equal(await run.run(),'finished');
 assert.deepEqual(run.requests,['Pista 3','Pista 3','Pista 4']);
 assert.deepEqual(run.queries,['bot','bot','bot']);assert.ok(run.rows.every(r=>r.confirmed));
});

test('missing receipt after an ambiguous save advances to the alternate within the same bot',async()=>{
 const run=fixture(batch(),{twoBots:true,alternates:true}),save=run.attempt.save;
 let lost:string|undefined;
 run.attempt.save=async(audio,choice,signal,progress,id)=>{
  if(choice.title==='Pista 3'&&audio.sha256[0]==='a'){lost=id;throw Error('lost receipt');}
  assert.notEqual(id,lost);
  return save(audio,choice,signal,progress,id);
 };
 run.attempt.reconcileDownload=async(id)=>{assert.equal(id,lost);return {state:'missing',trackId:null};};
 assert.equal(await run.run(),'finished');assert.deepEqual(run.downloads,['row','alternate','row']);
 assert.deepEqual(run.queries,['bot','bot','bot']);assert.ok(run.rows.every(r=>r.confirmed));
});

test('repeated playlist entries share a lookup and work across a persisted cursor',async()=>{
 const tracks=[track,{...track,id:crypto.randomUUID()},track],trackIds=tracks.map(t=>t.id);
 for(const cursor of [0,2]){
  const checkpoint=copyLibraryDownloadCheckpoint({id:crypto.randomUUID(),trackIds,cursor,pending:null});
  assert.ok(checkpoint);
  const looked:string[]=[],inspected:string[]=[];
  const attempt:SongPlaybackAttempt={
   current:()=>true,lookup:async choice=>{looked.push(choice.id);return choice.id.slice(6);},
   inspectDownload:async id=>{inspected.push(id);return id;},
   save:async()=>{throw Error('unexpected save');},addToLibrary:async()=>false,play:async()=>'failed',
  };
  let rows:AlbumRow[]=[],last=checkpoint;
  assert.equal(await downloadLibrarySelection({tracks,attempt,checkpoint,saveCheckpoint:next=>{last=next;},
   client:{captureBotsCurrent:()=>()=>true} as never,providers:[],revision:1,signal:new AbortController().signal,
   current:()=>true,update:value=>{rows=value;},
  }),'finished');
  assert.deepEqual(rows.map(row=>row.trackId),trackIds);
  assert.ok(rows.every(row=>row.confirmed));
  assert.deepEqual(looked,cursor?[]:trackIds.slice(0,2).map(id=>'local:'+id));
  assert.deepEqual(inspected,cursor?trackIds.slice(0,2):[]);
  assert.equal(last.cursor,3);
 }
});
