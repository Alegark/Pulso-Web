import test from 'node:test';import assert from 'node:assert/strict';
import type {BotSearchSnapshot} from '../../src/telegram/session-client';
import type {BotSearchRow} from '../../src/telegram/bot-search-protocol';
import {collectionTelegramWait} from '../../src/library/collection-telegram-wait';
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

import {canAutoResumeLibraryDownload,claimLibraryDownload,stopAutomaticLibraryDownload,copyLibraryDownloadCheckpoint,discardLibraryDownloadCheckpoint,readHeldLibraryDownload,readLibraryDownloadCheckpoint,sameHeldDownload,writeLibraryDownloadCheckpoint} from '../../src/library/library-download-checkpoint';
import type {HeldDownload,LibraryDownloadCheckpoint} from '../../src/library/library-download-checkpoint';
import type {AlbumRow} from '../../src/library/album-acquisition';
import type {TelegramSessionClient} from '../../src/telegram/session-client';
import type {BotSearchTarget} from '../../src/telegram/bot-search-protocol';
const selection=Array.from({length:4},(_,i)=>({...track,id:`11111111-1111-4111-8111-11111111111${i+1}`,title:`Pista ${i+1}`}));
const batch=():LibraryDownloadCheckpoint=>({id:crypto.randomUUID(),trackIds:selection.map(t=>t.id),cursor:0,pending:null});
function fixture(checkpoint=batch(),options:{onAudio?:()=>void;twoBots?:boolean;absent?:boolean;flood?:boolean|number;expired?:boolean;alternates?:boolean;tracks?:Track[];parked?:Map<string,HeldDownload>}={}){
 const requests:string[]=[],queries:string[]=[],downloads:string[]=[],abort=new AbortController();
 const parked=options.parked??new Map<string,HeldDownload>(),checkpoints:LibraryDownloadCheckpoint[]=[];
 let flooded=false,expired=false;
 let state={queryId:'',providerRef:'bot',providerRevision:1,expectedTarget:null,pending:false,cancelling:false,available:true,
  error:null,delivery:'acknowledged',retryBlocked:false,retryAt:null,rows:[]} as unknown as BotSearchSnapshot;
 const start=(started:(admission:{queryId:string;cancel():void})=>void)=>started({queryId:state.queryId!,cancel:()=>{}});
 const client={
  botsSnapshot:()=>({revision:1}),searchSnapshot:()=>state,
  snapshot:()=>({phase:expired?'error':'connected',error:expired?'session-expired':null,retryAt:null}),captureBotsCurrent:()=>()=>true,
  captureSearchActionCurrent:()=>()=>true,subscribeSearch:()=>()=>{},
  searchBot(input:{providerRef:string;target:BotSearchTarget},_allowed:unknown,started:Parameters<typeof start>[0]){
   assert.ok(!state.retryAt||Date.now()>=state.retryAt,'cannot query before retryAt');
   requests.push(input.target.title);queries.push(input.providerRef);
   const rows:BotSearchRow[]=options.absent&&input.target.title==='Pista 3'?[{kind:'message',rowRef:'absent',correlation:'reply',text:'No se encontraron resultados'}]:[{
    kind:'option',rowRef:'row',correlation:'reply',label:input.target.title+' — '+input.target.artist,
   }];
   if(rows.length&&options.alternates)rows.push({...rows[0],rowRef:'alternate'} as BotSearchRow);
   state={...state,error:null,queryId:String(requests.length),expectedTarget:input.target,providerRef:input.providerRef,rows};
   start(started);
  },
  async downloadBot(row:string,_allowed:unknown,started:Parameters<typeof start>[0]){
   start(started);downloads.push(row);
   if(options.expired&&state.expectedTarget?.title==='Pista 3'){
    expired=true;state={...state,error:'session-expired',available:false};return null;
   }
   if(options.flood&&!flooded&&state.expectedTarget?.title==='Pista 3'){
    flooded=true;state={...state,error:'rate-limit',retryAt:Date.now()+(typeof options.flood==='number'?options.flood:1200)};return null;
   }
   options.onAudio?.();
   const digest=state.providerRef==='bot'&&row==='row'?'a':'b';
   return {blob:new Blob(['x']),bytes:1,mime:'audio/wav',sha256:digest.repeat(64),target:state.expectedTarget};
  },
 } as unknown as TelegramSessionClient;
 let saved=checkpoint,rows:AlbumRow[]=[];const messages:string[]=[];
 const attempt:SongPlaybackAttempt={current:()=>true,lookup:async c=>selection.slice(0,2).find(t=>'local:'+t.id===c.id)?.id??null,
  save:async(_a,c)=>({state:'saved',trackId:c.id.slice(6)}),addToLibrary:async()=>{throw Error('No membership change');},
  play:async()=>{throw Error('No autoplay');}};
 const providers=[{providerRef:'bot',label:'Bot'},...(options.twoBots?[{providerRef:'other',label:'Other'}]:[])];
 return {requests,queries,downloads,parked,attempt,abort,checkpoints,messages,get checkpoint(){return saved;},get rows(){return rows;},
  run:()=>downloadLibrarySelection({tracks:options.tracks??selection,attempt,client,providers,revision:1,signal:abort.signal,current:()=>true,
   checkpoint,saveCheckpoint:v=>{saved=v;checkpoints.push(v);},parkDownload:(id,pending)=>parked.set(id,pending),
   heldDownload:id=>parked.get(id)??null,clearHeldDownload:(id,expected)=>{
    if(sameHeldDownload(parked.get(id)??null,expected))parked.delete(id);
   },update:(v,message)=>{rows=v;messages.push(message);}}),
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
 assert.equal(resumed.parked.get(selection[2].id)?.kind,'save');
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

const staleTracks=Array.from({length:6},(_,i)=>({...track,id:crypto.randomUUID(),title:`Pista ${i+1}`}));
const staleBatch=():LibraryDownloadCheckpoint=>({...batch(),trackIds:staleTracks.map(t=>t.id),cursor:5});

test('a legacy cursor at five retries every earlier track without a verified copy',async()=>{
 const resumed=fixture(staleBatch(),{tracks:staleTracks});
 resumed.attempt.inspectDownload=async()=>null;
 assert.equal(await resumed.run(),'finished');
 assert.deepEqual(resumed.requests,staleTracks.map(t=>t.title));
 assert.deepEqual(resumed.rows.map(row=>row.state),staleTracks.map(()=> 'downloaded'));
 assert.equal(resumed.checkpoint.cursor,6);
});

test('an ambiguous cursor receipt is reconciled and parked before any earlier track writes',async()=>{
 const pending={kind:'save' as const,index:5,operationId:crypto.randomUUID()};
 const resumed=fixture({...staleBatch(),pending},{tracks:staleTracks});
 const reconciled:string[]=[],parkedByAttempt:string[]=[];
 resumed.attempt.inspectDownload=async()=>null;
 resumed.attempt.reconcileDownload=async(operationId,id)=>{
  assert.equal(id,staleTracks[5].id);
  assert.equal(resumed.checkpoint.pending,pending);
  assert.deepEqual(resumed.requests,[]);
  reconciled.push(operationId);
  return {state:'uncertain',trackId:null};
 };
 resumed.attempt.parkDownload=async operationId=>{
  assert.equal(resumed.checkpoint.pending,pending);
  parkedByAttempt.push(operationId);
 };
 resumed.attempt.waitForDownload=async()=>sameHeldDownload(resumed.parked.get(staleTracks[5].id)??null,pending);
 assert.equal(await resumed.run(),'finished');
 assert.deepEqual(reconciled,[pending.operationId]);
 assert.deepEqual(parkedByAttempt,[pending.operationId]);
 assert.deepEqual(resumed.requests,staleTracks.slice(0,5).map(t=>t.title));
 assert.deepEqual(resumed.rows.map(row=>row.state),['downloaded','downloaded','downloaded','downloaded','downloaded','uncertain']);
 assert.equal(resumed.rows[5].message,'Pendiente en Almacenamiento');
});

test('interruption during an earlier save preserves both receipts and reuses published copies on resume',async()=>{
 const later={kind:'save' as const,index:5,operationId:crypto.randomUUID()};
 const copies=new Map<string,{operationId:string}>(),laterId=staleTracks[5].id,interruptedId=staleTracks[1].id;
 const first=fixture({...staleBatch(),pending:later},{tracks:staleTracks});
 const receipt:NonNullable<SongPlaybackAttempt['reconcileDownload']>=async(operationId,id)=>{
  if(operationId===later.operationId&&id===laterId)return {state:'uncertain',trackId:null};
  assert.equal(operationId,copies.get(id)?.operationId);
  return {state:'saved',trackId:id};
 };
 const lookup:SongPlaybackAttempt['lookup']=async choice=>copies.has(choice.id.slice(6))?choice.id.slice(6):null;
 const save:SongPlaybackAttempt['save']=async(_audio,choice,_signal,_progress,operationId)=>{
  const id=choice.id.slice(6);
  assert.ok(operationId);
  assert.equal(copies.has(id),false,'must not publish a duplicate');
  copies.set(id,{operationId});
  return {state:'saved',trackId:id};
 };
 first.attempt.lookup=lookup;
 first.attempt.reconcileDownload=receipt;
 first.attempt.save=async(...args)=>{
  const saved=await save(...args);
  if(saved.trackId===interruptedId)first.abort.abort();
  return saved;
 };
 assert.equal(await first.run(),'stopped');
 const checkpoint=copyLibraryDownloadCheckpoint(JSON.parse(JSON.stringify(first.checkpoint)));
 assert.ok(checkpoint);
 assert.equal(checkpoint.cursor,1);
 assert.deepEqual(first.requests,staleTracks.slice(0,2).map(t=>t.title));
 assert.equal(checkpoint.pending?.kind,'save');
 assert.equal(checkpoint.pending.operationId,copies.get(interruptedId)?.operationId);
 assert.equal(first.parked.get(laterId)?.kind,'save');

 const resumed=fixture(checkpoint,{tracks:staleTracks,parked:first.parked});
 resumed.attempt.lookup=lookup;
 resumed.attempt.inspectDownload=async id=>copies.has(id)?id:null;
 const reconciled:string[]=[];
 resumed.attempt.reconcileDownload=async(operationId,id,signal,repair)=>{
  reconciled.push(id);
  return receipt(operationId,id,signal,repair);
 };
 resumed.attempt.waitForDownload=async()=>reconciled.includes(laterId);
 resumed.attempt.save=save;
 assert.equal(await resumed.run(),'finished');
 assert.deepEqual(reconciled,[interruptedId,laterId]);
 assert.deepEqual(resumed.requests,staleTracks.slice(2,5).map(t=>t.title));
 assert.deepEqual(resumed.rows.map(row=>row.state),['reused','reused','downloaded','downloaded','downloaded','uncertain']);
 assert.equal(copies.size,5);
 assert.equal(resumed.checkpoint.pending,null);
 assert.ok([...first.checkpoints,...resumed.checkpoints].every(checkpoint=>copyLibraryDownloadCheckpoint(checkpoint)));
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


test('a very long FLOOD preserves the exact deadline and track across Continuar',async()=>{
 const since=Date.now(),delay=1_800_000,first=fixture(batch(),{flood:delay});
 assert.equal(await first.run(),'paused');
 assert.deepEqual(first.requests,['Pista 3']);
 assert.equal(first.rows[2].state,'unattempted');
 assert.equal(first.checkpoint.cursor,2);
 assert.deepEqual(first.checkpoint.pending,{kind:'network',index:2});
 assert.ok(first.checkpoint.telegramRetryAt!>=since+delay&&first.checkpoint.telegramRetryAt!<=Date.now()+delay);
 const resumed=fixture(copyLibraryDownloadCheckpoint(JSON.parse(JSON.stringify(first.checkpoint)))!);
 assert.equal(await resumed.run(),'paused');
 assert.deepEqual(resumed.requests,[]);
 assert.match(resumed.messages.at(-1)!,/Pulsa Continuar/);
 const settled=fixture({...resumed.checkpoint,telegramRetryAt:Date.now()-1});
 assert.equal(await settled.run(),'finished');
 assert.deepEqual(settled.requests,['Pista 3','Pista 4']);
 assert.ok(settled.rows.every(row=>row.confirmed));
});


test('an expired session preserves the current track and requires reconnecting before Continuar',async()=>{
 const run=fixture(batch(),{expired:true});
 assert.equal(await run.run(),'paused');
 assert.deepEqual(run.requests,['Pista 3']);
 assert.equal(run.rows[2].state,'unattempted');
 assert.equal(run.checkpoint.cursor,2);
 assert.deepEqual(run.checkpoint.pending,{kind:'network',index:2});
 assert.match(run.messages.at(-1)!,/Vuelve a conectar Telegram.*Continuar/);
});

test('audio received after hiding is accepted with the captured authority',async t=>{
 const page=Object.assign(new EventTarget(),{visibilityState:'visible'});
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{value:page,configurable:true});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else Reflect.deleteProperty(globalThis,'document');});
 const run=fixture(batch(),{onAudio:()=>{
  page.visibilityState='hidden';page.dispatchEvent(new Event('visibilitychange'));
 }});
 assert.equal(await run.run(),'finished');
 assert.deepEqual(run.requests,['Pista 3','Pista 4']);
 assert.deepEqual(run.downloads,['row','row']);
 assert.ok(run.rows.every(row=>row.confirmed));
});

test('suspension recovery retries a transiently failed restore at the next backoff step',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
 const attempts:number[]=[];
 let phase:'connected'|'error'='connected';
 const client={
  snapshot:()=>({phase,error:phase==='error'?'network':null}),
  searchSnapshot:()=>({available:phase==='connected'}),
  reconnectForDownload:()=>{attempts.push(Date.now());phase=attempts.length===1?'error':'connected';return true;},
 } as unknown as TelegramSessionClient;
 const wait=collectionTelegramWait(client,new AbortController().signal,()=>true,0,()=>{});
 try{
  const paused=wait.pauseForTrack()(()=>{},true,true);
  for(let i=0;i<62;i++){t.mock.timers.tick(250);await Promise.resolve();await Promise.resolve();}
  assert.equal(await paused,null);
  assert.deepEqual(attempts,[5000,15250]);
 }finally{wait.dispose();}
});

test('four slow restores get separate backoffs after a clock jump inside the wait',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
 const attempts:number[]=[],settled:number[]=[];
 let phase='error',denied=0;
 const client={
  snapshot:()=>({phase,error:phase==='error'?'network':null}),
  searchSnapshot:()=>({available:false}),
  reconnectForDownload:()=>{
   if(denied++<2)return false;
   attempts.push(Date.now());phase='restoring';
   setTimeout(()=>{settled.push(Date.now());phase='error';},45_000);
   return true;
  },
 } as unknown as TelegramSessionClient;
 const abort=new AbortController(),wait=collectionTelegramWait(client,abort.signal,()=>!abort.signal.aborted,0,()=>{});
 let outcome:Awaited<ReturnType<ReturnType<typeof wait.pauseForTrack>>>|undefined;
 try{
  const task=wait.pauseForTrack()(()=>{},true,true).then(result=>{outcome=result;});
  t.mock.timers.setTime(75_000);t.mock.timers.tick(0);await Promise.resolve();
  for(let i=0;i<1100&&outcome===undefined;i++){t.mock.timers.tick(250);await Promise.resolve();await Promise.resolve();}
  assert.deepEqual(attempts,[80_500,135_500,200_500,285_500]);
  assert.deepEqual(settled,[125_500,180_500,245_500,330_500]);
  assert.match(outcome?.message??'',/No se pudo reconectar/);
  await task;
 }finally{abort.abort();wait.dispose();}
});

for(const pending of [false,true])test(`the reconnect wait ends after 60 s with ${pending?'an occupied lane':'persistent admission denial'}`,async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
 const calls:number[]=[];
 const client={
  snapshot:()=>({phase:'error',error:'network'}),
  searchSnapshot:()=>({available:false,pending}),
  reconnectForDownload:()=>{calls.push(Date.now());return false;},
 } as unknown as TelegramSessionClient;
 const abort=new AbortController(),wait=collectionTelegramWait(client,abort.signal,()=>!abort.signal.aborted,0,()=>{});
 let outcome:Awaited<ReturnType<ReturnType<typeof wait.pauseForTrack>>>|undefined;
 const task=wait.pauseForTrack()(()=>{},true,true).then(result=>{outcome=result;});
 const tick=async(count:number)=>{
  for(let i=0;i<count;i++){t.mock.timers.tick(250);await Promise.resolve();await Promise.resolve();}
 };
 try{
  await tick(80);
  t.mock.timers.setTime(95_000);t.mock.timers.tick(0);
  await Promise.resolve();await Promise.resolve();
  await tick(239);
  const result=()=>outcome;
  assert.equal(result(),undefined);
  await tick(1);await Promise.resolve();
  assert.equal(result()?.automatic,true);
  assert.match(result()?.message??'',/Pulsa Continuar/);
  if(pending)assert.deepEqual(calls,[]);
  else{
   assert.equal(calls[0],5000);
   assert.equal(calls.find(at=>at>=95_000),100_000);
   assert.equal(calls.at(-1),154_750);
  }
 }finally{abort.abort();await task;wait.dispose();}
});

function useCheckpointStorage(t:import('node:test').TestContext){
 const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),values=new Map<string,string>();
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
  getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key),
 }});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else Reflect.deleteProperty(globalThis,'localStorage');});
}

test('checkpoint retains the title and automatic state, and Detener makes it manual',t=>{
 useCheckpointStorage(t);
 const account=crypto.randomUUID(),legacy=batch();
 writeLibraryDownloadCheckpoint(account,legacy);
 assert.equal(canAutoResumeLibraryDownload(readLibraryDownloadCheckpoint(account)!),false);
 const running=claimLibraryDownload(account,'Mi lista',legacy.trackIds,legacy.id)!;
 assert.deepEqual(readLibraryDownloadCheckpoint(account),running);
 assert.equal(running.title,'Mi lista');
 assert.equal(running.autoResume,true);
 stopAutomaticLibraryDownload(account,running.id);
 assert.equal(readLibraryDownloadCheckpoint(account)?.autoResume,false);
 assert.equal(claimLibraryDownload(account,running.title!,running.trackIds,running.id,true),null);
});

test('only the first start may claim the same checkpoint id',t=>{
 useCheckpointStorage(t);
 const account=crypto.randomUUID(),checkpoint=claimLibraryDownload(account,'Lista',batch().trackIds)!;
 const first=claimLibraryDownload(account,'Lista',checkpoint.trackIds,checkpoint.id,true);
 assert.ok(first);
 assert.notEqual(first.id,checkpoint.id);
 assert.equal(claimLibraryDownload(account,'Lista',checkpoint.trackIds,checkpoint.id,true),null);
 assert.deepEqual(readLibraryDownloadCheckpoint(account),first);
});

test('a checkpoint cannot be resumed under a different account',t=>{
 useCheckpointStorage(t);
 const account=crypto.randomUUID(),other=crypto.randomUUID();
 const checkpoint=claimLibraryDownload(account,'Lista',batch().trackIds)!;
 assert.equal(readLibraryDownloadCheckpoint(other),null);
 assert.equal(claimLibraryDownload(other,'Lista',checkpoint.trackIds,checkpoint.id,true),null);
 assert.deepEqual(readLibraryDownloadCheckpoint(account),checkpoint);
});

test('three automatic starts without new copies exhaust the durable budget',async t=>{
 useCheckpointStorage(t);
 const account=crypto.randomUUID();
 let previous=claimLibraryDownload(account,'Lista',batch().trackIds)!;
 for(let i=1;i<=3;i++){
  previous=claimLibraryDownload(account,'Lista',previous.trackIds,previous.id,true)!;
  assert.equal(readLibraryDownloadCheckpoint(account)?.autoAttempts,i);
 }
 assert.equal(claimLibraryDownload(account,'Lista',previous.trackIds,previous.id,true),null);
 const completed=fixture(previous);
 assert.equal(await completed.run(),'finished');
 assert.equal(completed.checkpoint.saved,4);
 assert.equal(completed.checkpoint.autoAttempts,0);
});

import {acquireFromOrderedBots} from '../../src/library/ordered-bot-acquisition';
const acquireFixture=()=>{
 const target={title:'Propia',artist:'Artista',album:null,durationSeconds:null},abort=new AbortController();
 const row={kind:'option',rowRef:'row',correlation:'reply',label:'Propia — Artista'} as const;
 const state={queryId:'query',providerRef:'bot',providerRevision:1,expectedTarget:target,rows:[row],
  available:true,pending:false,cancelling:false,delivery:'acknowledged',retryAt:null,error:null} as unknown as BotSearchSnapshot;
 const admit=(started:(value:{queryId:string;cancel:()=>void})=>void)=>started({queryId:'query',cancel:()=>{}});
 const audio={target,blob:new Blob(['audio']),sha256:'a'.repeat(64)};
 let accepts=0;
 const client={
  botsSnapshot:()=>({revision:1}),searchSnapshot:()=>state,subscribeSearch:()=>()=>{},
  captureSearchActionCurrent:()=>()=>true,searchBot:(_a:unknown,_b:unknown,started:Parameters<typeof admit>[0])=>admit(started),
  async downloadBot(_a:unknown,_b:unknown,started:Parameters<typeof admit>[0]){admit(started);return audio;},
 };
 const run=(overrides:Partial<Parameters<typeof acquireFromOrderedBots>[0]>={})=>acquireFromOrderedBots({
  client:client as unknown as TelegramSessionClient,target,providers:[{providerRef:'bot',label:'Bot'}],revision:1,
  signal:abort.signal,current:()=>true,networkCurrent:()=>true,audioCurrent:()=>true,progress:()=>{},
  collection:{completed:new Set(),reasons:[]},accept:async()=>{accepts++;return 'saved';},
  ...overrides,
 });
 return {client,state,run,abort,audio,get accepts(){return accepts;}};
};

for(const stage of ['search','download'] as const)test(`an acknowledged ${stage} file refusal remains specific to the song`,async()=>{
 const f=acquireFixture();
 const error=stage==='search'?'file-too-large':'file-invalid';
 const reject=()=>{f.state.error=error;};
 if(stage==='search'){
  const search=f.client.searchBot;f.client.searchBot=(...args)=>{search(...args);reject();};
 }else{
  const download=f.client.downloadBot;f.client.downloadBot=async(...args)=>{await download(...args);reject();return null as never;};
 }
 assert.deepEqual(await f.run(),{state:'known-failure',reasons:[error]});
 assert.equal(f.accepts,0);
});

for(const revoked of ['session','account','bots','abort'] as const)test(`received audio cannot be accepted after revoking ${revoked}`,async()=>{
 const f=acquireFixture(),download=f.client.downloadBot;
 let current=true,audioCurrent=true;
 f.client.downloadBot=async(...args)=>{
  const audio=await download(...args);
  if(revoked==='abort')f.abort.abort();
  else if(revoked==='account')current=false;
  else if(revoked==='bots')f.client.botsSnapshot=()=>({revision:2});
  else audioCurrent=false;
  return audio;
 };
 const result=await f.run({current:()=>current,audioCurrent:()=>audioCurrent&&f.client.botsSnapshot().revision===1});
 assert.equal(result.state,revoked==='abort'||revoked==='account'?'stopped':'telegram');
 assert.equal(f.accepts,0);
});
