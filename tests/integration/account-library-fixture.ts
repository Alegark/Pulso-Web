import {createElement,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LibraryDownloadController} from '../../src/ui/LibraryDownloadController';
import {AlbumDownloadNotice} from '../../src/ui/AlbumDownloadNotice';
import {requestLibraryDownload} from '../../src/library/library-download';
import type {SongPlaybackAttempt} from '../../src/library/selected-song';
import type {TelegramSessionClient} from '../../src/telegram/session-client';
import {reconcileLibraryDownload} from '../../src/library/library-download-recovery';
import {readHeldLibraryDownload,readLibraryDownloadCheckpoint,writeLibraryDownloadCheckpoint} from '../../src/library/library-download-checkpoint';
import {importFile} from '../../src/imports/import-file';
import type {Track} from '../../src/library/library';
import {openDatabase,admittedTransaction,request,closeDatabase} from '../../src/storage/database';
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
  const wav=new Uint8Array(32044),v=new DataView(wav.buffer);
  const ascii=(at:number,text:string)=>{for(let i=0;i<text.length;i++)wav[at+i]=text.charCodeAt(i);};
  ascii(0,'RIFF');v.setUint32(4,wav.length-8,true);ascii(8,'WAVEfmt ');v.setUint32(16,16,true);
  v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);
  v.setUint16(32,2,true);v.setUint16(34,16,true);ascii(36,'data');v.setUint32(40,wav.length-44,true);
  writeLibraryDownloadCheckpoint(account,{id:crypto.randomUUID(),trackIds:[trackId],cursor:0,pending:{kind:'save',index:0,operationId}});
  await importFile(new File([wav],'copia-prueba.wav',{type:'audio/wav'}),new AbortController().signal,undefined,{operationId,libraryMode:'cache',backend:'idb'});
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
   const [home,setHome]=useState(false);
   return createElement('main',null,
    createElement('button',{onClick:()=>setHome(true)},'Ir a Inicio'),home?createElement('h2',null,'Inicio'):createElement('button',
     {onClick:()=>requestLibraryDownload(rows.map(row=>row.id),'Playlist de prueba')},'Descargar selección'),
    createElement(LibraryDownloadController,{accountId:id(120),tracks:rows,client,bots,connected:true,captureBatch:()=>attempt}),
    createElement(AlbumDownloadNotice));
  }
  const host=document.createElement('div');document.body.append(host);createRoot(host).render(createElement(Fixture));
  Object.assign(window,{batchFixture:{release,lookups:()=>lookups}});
 },
 dispose(){sync.dispose();},
};
Object.assign(window,{libraryFixture:api});
