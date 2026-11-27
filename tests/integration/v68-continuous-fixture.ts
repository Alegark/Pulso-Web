import './interface-main-fixture';
import {openDatabase,closeDatabase} from '../../src/storage/database';

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
