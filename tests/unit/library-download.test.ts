import test from 'node:test';import assert from 'node:assert/strict';
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
function bot(){
 const requests:string[]=[];
 let state={queryId:'',providerRef:'bot',providerRevision:1,expectedTarget:null as BotSearchTarget|null,
  pending:false,available:true,error:null,delivery:'acknowledged',retryBlocked:false,retryAt:null,rows:[] as object[]};
 const client={
  botsSnapshot:()=>({revision:1}),searchSnapshot:()=>state,captureBotsCurrent:()=>()=>true,
  captureSearchActionCurrent:()=>()=>true,subscribeSearch:()=>()=>{},
  searchBot(input:{target:BotSearchTarget},_allowed:unknown,start:(x:{queryId:string;cancel():void})=>void){
   requests.push(input.target.title);
   state={...state,queryId:String(requests.length),expectedTarget:input.target,
    rows:[{kind:'option',rowRef:'row',correlation:'reply',label:input.target.title+' — '+input.target.artist}]};
   start({queryId:state.queryId,cancel:()=>{}});
  },
  async downloadBot(_row:unknown,_allowed:unknown,start:(x:{queryId:string;cancel():void})=>void){
   start({queryId:state.queryId,cancel:()=>{}});
   return {blob:new Blob(['x']),bytes:1,mime:'audio/wav',sha256:'a'.repeat(64),target:state.expectedTarget};
  },
 };
 return {client:client as unknown as TelegramSessionClient,requests};
}
function fixture(checkpoint=batch()){
 const {client,requests}=bot(),abort=new AbortController();
 let saved=checkpoint,rows:AlbumRow[]=[];
 const attempt:SongPlaybackAttempt={current:()=>true,lookup:async c=>selection.slice(0,2).find(t=>'local:'+t.id===c.id)?.id??null,
  save:async(_a,c)=>({state:'saved',trackId:c.id.slice(6)}),addToLibrary:async()=>{throw Error('No membership change');},
  play:async()=>{throw Error('No autoplay');}};
 return {requests,attempt,abort,get checkpoint(){return saved;},get rows(){return rows;},
  run:()=>downloadLibrarySelection({tracks:selection,attempt,client,providers:[{providerRef:'bot',label:'Bot'}],revision:1,
   signal:abort.signal,current:()=>true,checkpoint,saveCheckpoint:v=>{saved=v;},update:v=>{rows=v;}}),
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
 assert.deepEqual(run.requests,selection.slice(2).map(t=>t.title));
 assert.equal(run.checkpoint.cursor,4);
});

test('restart reconciles the third track through the exact receipt before sending only track four',async()=>{
 const first=fixture();
 first.attempt.save=async()=>({state:'uncertain',trackId:null});
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
 assert.equal(await resumed.run(),'stopped');
 assert.deepEqual(resumed.requests,[]);
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

test('continuation skips an unconfirmed delivery and sends only the next track',async()=>{
 const checkpoint:LibraryDownloadCheckpoint={...batch(),cursor:2,pending:{kind:'network',index:2}};
 const resumed=fixture(checkpoint);
 assert.equal(await resumed.run(),'finished');
 assert.deepEqual(resumed.requests,[selection[3].title]);
 assert.deepEqual(resumed.rows.map(r=>r.state),['reused','reused','uncertain','downloaded']);
});
