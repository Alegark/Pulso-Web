import './interface-main-fixture';
import {openDatabase,closeDatabase} from '../../src/storage/database';
import {PersistentArtwork} from '../../src/cache/persistent-artwork';
import {saveTelegramSession,sessionLease} from '../../src/telegram/saved-session';
import {rememberCompletedSetup} from '../../src/ui/RequiredSetup';
import {createPlaylist,changePlaylist} from '../../src/library/library';

Object.assign(window,{seedV68ContinuousPlaylist:async()=>{
 await (window as unknown as {setupCollectionFixture:()=>Promise<void>}).setupCollectionFixture();
 const lease=await sessionLease();
 if(!await saveTelegramSession(lease,'TESTONLY_V68_SESSION'))throw Error('session fixture');
 rememberCompletedSetup('11111111-1111-4111-8111-111111111111');
 const {rows}=JSON.parse(sessionStorage.getItem('test-own-fixture')!);
 const db=await openDatabase();
 try{await new Promise<void>((resolve,reject)=>{
  const tx=db.transaction('tracks','readwrite'),store=tx.objectStore('tracks');
  const request=store.get(rows[1].track);
  request.onsuccess=()=>store.put({...request.result,assetId:null,duration:2},rows[1].track);
  tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
 });}finally{closeDatabase(db);}
 const list=await createPlaylist('Continuidad sintética');
 for(let i=0;i<3;i++)await changePlaylist(list.id,i+1,{type:'add',trackId:rows[i].track});
}});

Object.assign(window,{setupV68SyncedAlbum:async()=>{
 await (window as unknown as {setupCollectionFixture:()=>Promise<void>}).setupCollectionFixture();
 const {rows}=JSON.parse(sessionStorage.getItem('test-own-fixture')!);
 const db=await openDatabase();
 try{await new Promise<void>((resolve,reject)=>{
  const tx=db.transaction('tracks','readwrite'),store=tx.objectStore('tracks');
  for(let i=0;i<3;i++){
   const request=store.get(rows[i].track);
   request.onsuccess=()=>store.put({...request.result,manualOverrides:{},catalogRelease:{source:'itunes',releaseId:201,trackId:301+i,disc:1,position:i+1,title:'Álbum sintético',artist:'Artista sintético'}},rows[i].track);
  }
  tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
 });}finally{closeDatabase(db);}
}});

Object.assign(window,{seedV69AlbumAndPlaylist:async(complete=false)=>{
 await (window as unknown as {seedV68ContinuousPlaylist:()=>Promise<void>}).seedV68ContinuousPlaylist();
 const {rows}=JSON.parse(sessionStorage.getItem('test-own-fixture')!);
 const db=await openDatabase();
 try{await new Promise<void>((resolve,reject)=>{
  const tx=db.transaction('tracks','readwrite'),store=tx.objectStore('tracks');
  for(const i of (complete?[0,2]:[0,1,2])){
   const request=store.get(rows[i].track);
   request.onsuccess=()=>store.put({...request.result,manualOverrides:{},catalogRelease:{source:'itunes',releaseId:201,trackId:301+i,disc:1,position:complete&&i===2?2:i+1,title:'Álbum sintético',artist:'Artista sintético'}},rows[i].track);
  }
  tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
 });}finally{closeDatabase(db);}
}});

Object.assign(window,{seedV68Artwork:async()=>{
 const storage=new PersistentArtwork('11111111-1111-4111-8111-111111111111',new AbortController().signal);
 const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aS8AAAAASUVORK5CYII='),c=>c.charCodeAt(0));
 const image={blob:new Blob([bytes],{type:'image/png'}),mime:'image/png' as const,width:1,height:1,sha256:'0'.repeat(64)};
 for(const key of ['provider:edition:201','provider:album:artista sintetico:album sintetico'])await storage.put(key,image,Date.now());
}});
