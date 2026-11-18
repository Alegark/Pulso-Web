import {registerDatabaseRealmHost} from '../../src/storage/database-realms';
import {openDatabase,closeDatabase,writeRecord} from '../../src/storage/database';
import {importFileDetailed} from '../../src/imports/import-file';
import {createPlaylist,changePlaylist} from '../../src/library/library';
import {saveTelegramSession,sessionLease} from '../../src/telegram/saved-session';

registerDatabaseRealmHost({capture:(_kind,current)=>current()?{current,onLifecycle:()=>{},end:()=>{}}:null});

async function seed(){
 const db=await openDatabase();closeDatabase(db);
 const samples=8000*5,bytes=new Uint8Array(44+samples*2),view=new DataView(bytes.buffer);
 const text=(value:string,offset:number)=>bytes.set(new TextEncoder().encode(value),offset);
 text('RIFF',0);view.setUint32(4,bytes.length-8,true);text('WAVEfmt ',8);view.setUint32(16,16,true);
 view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);
 view.setUint16(32,2,true);view.setUint16(34,16,true);text('data',36);view.setUint32(40,samples*2,true);
 let unknownAssetId:string|null=null;
 const mixed=await createPlaylist('Selección mixta'),empty=await createPlaylist('Selección sin audio');
 for(let index=0;index<3;index++){
  bytes[44]=index;
  const name=`Audio de prueba ${index+1}`;
  const result=await importFileDetailed(new File([bytes],name+'.wav',{type:'audio/wav'}),new AbortController().signal,()=>{},{backend:'idb'});
  if(result.kind!=='confirmed')throw Error('No se pudo preparar el WAV sintético');
  if(index===2)unknownAssetId=result.result.track.assetId;
  await changePlaylist(mixed.id,index+1,{type:'add',trackId:result.result.track.id});
 }
 const id=crypto.randomUUID();
 await writeRecord('tracks',id,{id,assetId:null,title:'Ficha sin audio',artist:null,album:null,duration:0,
  favorite:false,revision:1,manualOverrides:{},createdAt:new Date().toISOString()});
 await changePlaylist(mixed.id,4,{type:'add',trackId:id});
 await changePlaylist(empty.id,1,{type:'add',trackId:id});
 const paged=await createPlaylist('Selección paginada');
 const entries=Array.from({length:51},()=>({id:crypto.randomUUID(),trackId:crypto.randomUUID()}));
 const pagedDb=await openDatabase();
 try{
  await new Promise<void>((resolve,reject)=>{
   const tx=pagedDb.transaction(['tracks','playlists'],'readwrite');
   entries.forEach(({trackId},index)=>tx.objectStore('tracks').put({id:trackId,assetId:null,title:`Ficha ${index+1}`,artist:null,album:null,
    duration:0,favorite:false,revision:1,manualOverrides:{},createdAt:'2000-01-01T00:00:00.000Z'},trackId));
   tx.objectStore('playlists').put({...paged,entries},paged.id);
   tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
  });
 }finally{closeDatabase(pagedDb);}
 if(!await saveTelegramSession(await sessionLease(),'TESTONLY-UNUSED'))throw Error('No se pudo preparar la sesión sintética');
 localStorage.setItem('pulso:setup:v1:11111111-1111-4111-8111-111111111111','complete');
 return {unknownAssetId,pagedTrackId:entries[50].trackId};
}
Object.assign(window,{reviewUiSeed:seed});
