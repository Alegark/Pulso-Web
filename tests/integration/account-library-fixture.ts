import {createElement,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LibraryDownloadController} from '../../src/ui/LibraryDownloadController';
import {TrackActionsMenu} from '../../src/ui/TrackActionsMenu';
import {requestLibraryDownload,requestLibraryTrackReview} from '../../src/library/library-download';
import type {SongPlaybackAttempt} from '../../src/library/selected-song';
import type {TelegramSessionClient} from '../../src/telegram/session-client';
import {reconcileLibraryDownload,inspectLibraryTrackDownload,prepareBatchCopyReplacement,repairBatchLibraryDownload} from '../../src/library/library-download-recovery';
import {readHeldLibraryDownload,readLibraryDownloadCheckpoint,writeLibraryDownloadCheckpoint,writeHeldLibraryDownload} from '../../src/library/library-download-checkpoint';
import {createOperation,importOperation,importOperations,terminal} from '../../src/storage/import-operations';
import {importFile} from '../../src/imports/import-file';
import {verifiedAssetDetailed,type Track} from '../../src/library/library';
import {openDatabase,admittedTransaction,request,closeDatabase,writeRecord} from '../../src/storage/database';
import {transactionDone} from '../../src/storage/transaction-done';
import {prepareAccountLibrary,readAccountLibrary,applyAccountLibrary,attachRestoredAccountTrack} from '../../src/accounts/library-local';
import {createLibrarySync,accountLibraryRequest} from '../../src/accounts/library-sync';
import {groupAlbums,groupArtists} from '../../src/library/groups';
import {makeLibraryMembership,libraryMembershipKey} from '../../src/library/library-membership';
const id=(n:number)=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
let account=id(100),live=true;
async function rows(store:string){const db=await openDatabase();try{const tx=admittedTransaction(db,store),done=transactionDone(tx);const value=await request(tx.objectStore(store).getAll());await done;return value;}finally{closeDatabase(db);}}
async function seed(n:number,owned=false,cache=false){const db=await openDatabase();try{const tx=admittedTransaction(db,['tracks','settings','assets','chunks'],'readwrite'),done=transactionDone(tx);const t={id:id(n),...(owned?{accountId:account}:{}),title:'Propia '+n,artist:'Artista propio',album:'Álbum propio',duration:2,createdAt:'2026-11-17T00:00:00Z',revision:1,assetId:id(n+200),audioFingerprint:{algorithm:'sha256',sha256:'a'.repeat(64),bytes:16},favorite:false,manualOverrides:{}};tx.objectStore('tracks').put(t,t.id);tx.objectStore('assets').put({id:t.assetId,namespace:'local',storageKey:t.assetId,bytes:16,sha256:'a'.repeat(64),mime:'audio/wav',chunks:1,state:'complete',revision:1,chunkSize:65536,backend:'idb',retention:'kept'},t.assetId);tx.objectStore('chunks').put(new Uint8Array(16).fill(n),[t.assetId,0]);if(cache)tx.objectStore('settings').put(makeLibraryMembership(t.id,false),libraryMembershipKey(t.id));await done;}finally{closeDatabase(db);}}
async function mutate(store:string,key:string,patch:object){const db=await openDatabase();try{const tx=admittedTransaction(db,store,'readwrite'),done=transactionDone(tx),s=tx.objectStore(store),old=await request(s.get(key));s.put({...old,...patch},key);await done;}finally{closeDatabase(db);}}
function testAudio(variant=0){
  const wav=new Uint8Array(32044),v=new DataView(wav.buffer);
  const ascii=(at:number,text:string)=>{for(let i=0;i<text.length;i++)wav[at+i]=text.charCodeAt(i);};
  ascii(0,'RIFF');v.setUint32(4,wav.length-8,true);ascii(8,'WAVEfmt ');v.setUint32(16,16,true);
  v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);
  v.setUint16(32,2,true);v.setUint16(34,16,true);ascii(36,'data');v.setUint32(40,wav.length-44,true);
 wav[wav.length-1]=variant;
 return new File([wav],'copia-prueba.wav',{type:'audio/wav'});
}
async function requestChunk(key:string){
 const db=await openDatabase();try{
  const tx=admittedTransaction(db,'chunks'),done=transactionDone(tx);
  const result=await request(tx.objectStore('chunks').count([key,0]));await done;return result;
 }finally{closeDatabase(db);}
}
const sync=createLibrarySync({read:readAccountLibrary,apply:applyAccountLibrary,remote:accountLibraryRequest,save:(i,r,d,s)=>accountLibraryRequest(i,s,{revision:r,document:d}),ready:()=>live,changed:()=>{}});
const api={id,seed,rows,mutate,
 async prepare(n:number){sync.account(null);account=id(n);await prepareAccountLibrary(account,()=>true);sync.account(account);},
 async sync(){await sync.sync();return sync.getSnapshot();},
 async snapshot(){const result=await readAccountLibrary(account,()=>true);const tracks=result.document.tracks.map(t=>({...t,assetId:null,revision:1,manualOverrides:{},localAlbum:t.localAlbum??undefined}));return {...result,albums:groupAlbums(tracks),artists:groupArtists(tracks)};},
 async list(n:number,trackIds:number[]){const db=await openDatabase();try{const tx=admittedTransaction(db,'playlists','readwrite'),done=transactionDone(tx);tx.objectStore('playlists').put({id:id(n),accountId:account,name:'Mi playlist',revision:1,entries:trackIds.map(v=>({id:id(v+500),trackId:id(v)}))},id(n));await done;}finally{closeDatabase(db);}},
 async deleteList(n:number){const db=await openDatabase();try{const tx=admittedTransaction(db,'playlists','readwrite'),done=transactionDone(tx);tx.objectStore('playlists').delete(id(n));await done;}finally{closeDatabase(db);}},
 async physical(){const [assets,chunks]=await Promise.all([rows('assets'),rows('chunks')]);return {assets:assets.length,chunks:chunks.map((v:any)=>Array.from(v))};},
 async attach(old:number,fresh:number){return attachRestoredAccountTrack(account,id(old),id(fresh),()=>live);},
 async stageDownload(n:number){
  const trackId=id(n),operationId=crypto.randomUUID();
  const db=await openDatabase();try{
   const tx=admittedTransaction(db,'tracks','readwrite'),done=transactionDone(tx);
   const track:Track={id:trackId,accountId:account,title:'Copia de test',artist:null,album:null,duration:2,
    assetId:null,revision:1,favorite:false,createdAt:'2026-11-17T00:00:00Z',manualOverrides:{}};
   tx.objectStore('tracks').add(track,trackId);await done;
  }finally{closeDatabase(db);}
  writeLibraryDownloadCheckpoint(account,{id:crypto.randomUUID(),trackIds:[trackId],cursor:0,pending:{kind:'save',index:0,operationId}});
  await importFile(testAudio(),new AbortController().signal,undefined,{operationId,libraryMode:'cache',backend:'idb'});
 },
 async resumeDownload(accountNumber:number){
  const accountId=id(accountNumber),checkpoint=readLibraryDownloadCheckpoint(accountId);
  if(checkpoint?.pending?.kind!=='save')return {state:'absent'};
  return reconcileLibraryDownload(accountId,checkpoint.pending.operationId,checkpoint.trackIds[0],new AbortController().signal,()=>true);
 },
 stageMissingBatch(){
  writeLibraryDownloadCheckpoint(id(120),{id:crypto.randomUUID(),trackIds:[id(130)],cursor:0,
   pending:{kind:'save',index:0,operationId:crypto.randomUUID()}});
 },
 missingBatchState(){
  return {active:readLibraryDownloadCheckpoint(id(120))!==null,held:readHeldLibraryDownload(id(120),id(130))?.kind??null};
 },
 async verifyReplacement(n:number){
  const target=(await rows('tracks')).find((t:Track)=>t.id===id(n)) as Track;
  const old=target.assetId!,asset=(await rows('assets')).find(a=>a.id===old);
  const db=await openDatabase();try{
   const tx=admittedTransaction(db,['chunks','tracks'],'readwrite'),done=transactionDone(tx);
   const chunks=tx.objectStore('chunks'),bytes=await request<Uint8Array>(chunks.get([asset.storageKey,0]));
   bytes[bytes.length-1]^=1;chunks.put(bytes,[asset.storageKey,0]);
   tx.objectStore('tracks').put({...target,id:id(145),favorite:true},id(145));
   await done;
  }finally{closeDatabase(db);}
  const signal=new AbortController().signal;
  const before=await inspectLibraryTrackDownload(target.accountId!,target.id,undefined,signal,()=>true);
  const reviewed=await prepareBatchCopyReplacement(target,target.accountId!,signal,()=>true);
  await prepareAccountLibrary(target.accountId!,()=>true);
  const saved=await importFile(testAudio(),signal,undefined,{libraryMode:'cache',backend:'idb'});
  const [tracks,assets]=await Promise.all([rows('tracks'),rows('assets')]);
  return {before,reviewed,saved:saved.track.id,newAsset:tracks.find((t:Track)=>t.id===target.id)?.assetId,
   old,kept:tracks.find((t:Track)=>t.id===id(145))?.assetId,assetKept:assets.some(a=>a.id===old)};
 },
 async stageReview(){
  const track={id:id(140),accountId:id(120),title:'Título corregido',artist:'Artista corregido',album:null,duration:2,
   assetId:null,revision:2,favorite:false,createdAt:'2026-11-17T00:00:00Z',manualOverrides:{title:'Título corregido',artist:'Artista corregido'},
   catalogChoice:{source:'spotify',id:'fixture',title:'Título anterior',artist:null,album:null,duration:2}} as Track;
  const unknown={...track,id:id(141),title:'Guardado ambiguo'};
  await writeRecord('tracks',track.id,track);await writeRecord('tracks',unknown.id,unknown);
  await writeRecord('jobs',id(142),{fixture:'never delete'});
  await seed(143,true);
  const linked={...track,id:id(144),title:'Copia corrupta compartida',assetId:id(343)};
  await writeRecord('tracks',linked.id,linked);
  writeHeldLibraryDownload(id(120),track.id,{kind:'network'});
  writeHeldLibraryDownload(id(120),unknown.id,{kind:'save',operationId:id(142)});
 },
 async mountReview(){
  const tracks=(await rows('tracks')).filter((t:Track)=>[id(140),id(141),id(144)].includes(t.id));
  const bots={revision:1,providers:[{providerRef:'testonly',label:'KD',username:'kdmusic_bot'}]} as never;
  const queries:string[]=[],snapshot={available:true,pending:false,cancelling:false,error:null,delivery:'acknowledged',retryBlocked:false,retryAt:null,rows:[]};
  const client={botsSnapshot:()=>bots,captureBotsCurrent:()=>()=>true,captureSearchActionCurrent:()=>()=>true,
   searchSnapshot:()=>snapshot,subscribeSearch:()=>()=>{},searchBot(input:any,_guard:any,admit:any){
    queries.push(input.query);const queryId=crypto.randomUUID();admit({queryId,cancel:()=>{}});
    Object.assign(snapshot,{queryId,providerRef:input.providerRef,providerRevision:1,expectedTarget:input.target});
   }} as unknown as TelegramSessionClient;
  const attempt:SongPlaybackAttempt={current:()=>true,lookup:async()=>null,
   save:async()=>{throw Error('Unexpected save');},addToLibrary:async()=>{throw Error('Unexpected membership change');},play:async()=>{throw Error('Unexpected playback');}};
  const host=document.createElement('div'),target=document.createElement('div');document.body.append(host,target);createRoot(host).render(createElement('main',null,
   ...tracks.map((t:Track)=>createElement('li',{key:t.id},createElement(TrackActionsMenu,{title:t.title,artist:t.artist??'',active:true,
    children:createElement('button',{'data-menu-dismiss-after':'true',onClick:()=>requestLibraryTrackReview(t.id,t.title)},'Revisar descarga de esta canción')}))),
   createElement(LibraryDownloadController,{target,accountId:id(120),tracks,client,bots,connected:true,captureBatch:()=>attempt})));
  Object.assign(window,{trackReviewFixture:{queries,held:(n:number)=>readHeldLibraryDownload(id(120),id(n))}});
 },
 async mountAutomaticBatch(mode:'alternate'|'exhausted'|'same-provider'|'transient'|'resume',seedOnly=false){
  const batchAccount=id(150),trackIds=[151,152,153,154].map(id);
  await prepareAccountLibrary(batchAccount,()=>true);
  const tracks=trackIds.map((trackId,index):Track=>({id:trackId,accountId:batchAccount,title:'Lote '+(index+1),artist:'Artista prueba',album:null,duration:index===2?0:2,
   assetId:null,revision:1,favorite:false,createdAt:'2026-11-17T00:00:00Z',manualOverrides:{}}));
  const checkpoint=mode==='resume'?readLibraryDownloadCheckpoint(batchAccount):null;
  if(!checkpoint){
   for(const track of tracks)await writeRecord('tracks',track.id,track);
   for(const [i,trackId] of trackIds.slice(0,2).entries()){
    const signal=new AbortController().signal;
    const saved=await importFile(testAudio(10+i),signal,undefined,{libraryMode:'cache',backend:'idb'});
    await attachRestoredAccountTrack(batchAccount,trackId,saved.track.id,()=>true);
   }
  }
  const bots={revision:1,providers:[{providerRef:'A',label:'KD',username:'kdmusic_bot'},{providerRef:'B',label:'LY',username:'lydbot'},
   {providerRef:'C',label:'ANS',username:'ansmusicbot'}]};
  if(mode==='same-provider'||mode==='transient')bots.providers.splice(1);
  const requests:string[]=[],saves:string[]=[];
  let snapshot:any={available:true,pending:false,cancelling:false,error:null,delivery:'acknowledged',retryBlocked:false,retryAt:null,rows:[]};
  let staging=checkpoint?.pending?.kind==='save'?checkpoint.pending.operationId:null;
  const stage=async(operationId:string,bytes:number)=>{
   staging=operationId;
   await createOperation({version:1,operationId,accountId:batchAccount,owner:crypto.randomUUID(),backend:'idb',
    storageKey:operationId,bytes:0,expectedBytes:bytes,libraryMode:'cache',revision:1,state:'writing'});
   await writeRecord('chunks',[operationId,0],new Uint8Array([1,2,3]));
  };
  const downloads:string[]=[];
  if(mode==='resume'&&!checkpoint){
   const operationId=crypto.randomUUID();
   await stage(operationId,testAudio().size);
   const hash=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,'0')).join('');
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await testAudio(7).arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');
   const rowKey=await hash(JSON.stringify(['A','option','Lote 3 — Artista prueba']));
   writeLibraryDownloadCheckpoint(batchAccount,{id:crypto.randomUUID(),trackIds,cursor:2,pending:{kind:'save',index:2,operationId,attempts:[{digest,rowKey}]}});
  }
  if(seedOnly)return;
  const client={botsSnapshot:()=>bots,captureBotsCurrent:()=>()=>true,captureSearchActionCurrent:()=>()=>true,
   searchSnapshot:()=>snapshot,subscribeSearch:()=>()=>{},searchBot(input:any,_guard:any,admit:any){
    requests.push(input.providerRef+' '+input.query);const queryId=crypto.randomUUID();admit({queryId,cancel:()=>{}});
    const rows=[{kind:'option',rowRef:'row',correlation:'reply',label:input.query+' — '+input.target.artist}];
    if(mode==='same-provider'&&input.query==='Lote 3')rows.push({...rows[0],rowRef:'alternate',label:'2. '+rows[0].label});
    snapshot={...snapshot,queryId,providerRef:input.providerRef,providerRevision:1,expectedTarget:input.target,rows};
   },async downloadBot(row:any,_guard:any,admit:any){
    admit({queryId:snapshot.queryId,cancel:()=>{}});
    downloads.push(snapshot.providerRef+' '+row);
    const third=snapshot.expectedTarget.title==='Lote 3';
    const variant=!third?9:row==='alternate'||snapshot.providerRef==='C'&&mode!=='exhausted'?8:7;
    const blob=testAudio(variant),digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
    return {blob,bytes:blob.size,mime:'audio/wav',sha256:Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join(''),target:snapshot.expectedTarget};
   }} as unknown as TelegramSessionClient;
  const attempt:SongPlaybackAttempt={current:()=>true,
   waitForDownload:async()=>!(await importOperations()).some(job=>!terminal(job)),
   async inspectDownload(trackId,signal){
    return (await inspectLibraryTrackDownload(batchAccount,trackId,undefined,signal,()=>true)).state==='saved'?trackId:null;
   },
   async lookup(choice){
    const track=(await rows('tracks')).find((t:Track)=>'local:'+t.id===choice.id) as Track|undefined;
    return track?.assetId&&(await verifiedAssetDetailed(track.assetId,true)).state==='valid'?track.id:null;
   },
   async save(audio,choice,signal,_progress,operationId){
    saves.push(choice.title);
    if(choice.title==='Lote 3'&&!staging&&operationId){
     await stage(operationId,audio.bytes);
     if(mode==='alternate')throw Error('Fixture lost worker response');
     return mode==='transient'?{state:'failed',trackId:null,retryWrite:true}:{state:'uncertain',trackId:null};
    }
    const saved=await importFile(audio.blob as File,signal,undefined,{operationId,libraryMode:'cache',backend:'idb'});
    const trackId=await attachRestoredAccountTrack(batchAccount,choice.id.slice(6),saved.track.id,()=>!signal.aborted);
    return {state:'saved',trackId};
   },
   reconcileDownload:(operationId,trackId,signal,repair)=>(repair?repairBatchLibraryDownload:reconcileLibraryDownload)(batchAccount,operationId,trackId,signal,()=>true),
   addToLibrary:async()=>{throw Error('Unexpected membership change');},play:async()=>{throw Error('Unexpected playback');}};
  const host=document.createElement('div'),target=document.createElement('div');document.body.append(host,target);createRoot(host).render(createElement('main',null,
   createElement('button',{onClick:()=>requestLibraryDownload(trackIds,'Playlist automática')},'Descargar playlist completa'),
   createElement(LibraryDownloadController,{target,accountId:batchAccount,tracks,client,bots:bots as never,connected:true,captureBatch:()=>attempt})));
  Object.assign(window,{automaticFixture:{requests,downloads,saves,receipt:async()=>staging?{state:(await importOperation(staging))?.state,
    chunks:await requestChunk(staging)}:null}});
 },
 mountBatch(){
  const rows=[1,2,3].map(n=>({id:id(90+n),title:'Canción '+n,artist:'Prueba',album:null,duration:2,assetId:null,favorite:false,
   revision:1,manualOverrides:{},createdAt:'2026-11-17T00:00:00Z'}));
  let release!:()=>void,lookups=0;
  const held=new Promise<void>(resolve=>{release=resolve;});
  const attempt:SongPlaybackAttempt={current:()=>true,lookup:async choice=>{lookups++;await held;return choice.id.slice(6);},
   save:async()=>{throw Error('Unexpected save');},addToLibrary:async()=>{throw Error('Unexpected membership change');},play:async()=>{throw Error('Unexpected playback');}};
  const client={captureBotsCurrent:()=>()=>true,searchBot(){throw Error('Unexpected Telegram search');}} as unknown as TelegramSessionClient;
  const bots={revision:1,providers:[{providerRef:'testonly',label:'KD',username:'kdmusic_bot'}]} as never;
  function Fixture(){
   const [route,setRoute]=useState<'home'|'playlist'|'downloads'>('playlist');
   const [target,setTarget]=useState<HTMLDivElement|null>(null);
   const startAction=route==='playlist'?createElement('button',
    {onClick:()=>requestLibraryDownload(rows.map(row=>row.id),'Playlist de prueba')},'Descargar selección'):null;
   return createElement('main',{className:'pulso-app'},
    createElement('button',{onClick:()=>setRoute('home')},'Ir a Inicio'),
    createElement('button',{onClick:()=>setRoute('playlist')},'Abrir playlist'),
    createElement('button',{onClick:()=>setRoute('downloads')},'Gestionar descargas'),
    createElement('h2',null,route==='home'?'Inicio':route==='playlist'?'Playlist de prueba':'Tus descargas'),
    route!=='home'&&createElement('div',{ref:setTarget,'data-surface':route}),
    createElement(LibraryDownloadController,{target,startAction,allowDiscard:route==='downloads',accountId:id(120),tracks:rows,client,bots,connected:true,captureBatch:()=>attempt}));
  }
  const host=document.createElement('div');document.body.append(host);createRoot(host).render(createElement(Fixture));
  Object.assign(window,{batchFixture:{release,lookups:()=>lookups}});
 },
 dispose(){sync.dispose();},
};
Object.assign(window,{libraryFixture:api});
