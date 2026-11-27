import React from 'react';
import {createRoot} from 'react-dom/client';
import {CatalogArtwork,PlayerArtworkCacheContext} from '../../src/ui/CatalogArtwork';
import './interface-main-fixture';
import {closeDatabase,openDatabase,readRecord,writeRecord} from '../../src/storage/database';
import type {Track} from '../../src/library/library';
import {saveAlbumRecord} from '../../src/library/saved-albums';
import {readArtwork,storeEmbeddedArtwork} from '../../src/library/artwork';
import {validateArtwork} from '../../src/imports/artwork';
import {PlayerArtworkCache} from '../../src/library/player-artwork-cache';

Object.assign(window,{setupV66Albums:async()=>{
 await (window as unknown as {setupCollectionFixture:()=>Promise<void>}).setupCollectionFixture();
 const {rows}=JSON.parse(sessionStorage.getItem('test-own-fixture')!);
 const canvas=document.createElement('canvas');canvas.width=canvas.height=32;
 const ctx=canvas.getContext('2d')!;ctx.fillStyle='#bb2244';ctx.fillRect(0,0,32,32);
 const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png'));
 const image=await validateArtwork(blob);
 for(const [position,index] of [0,4].entries()){
  const track=(await readRecord<Track>('tracks',rows[index].track))!;
  const title=`Pista ${position+1}`;
  await writeRecord('tracks',track.id,{...track,title,artist:'Artista prueba',album:'Álbum con portada',manualOverrides:{},catalogChoice:{source:'itunes',id:`itunes:811:1:${position+1}:${911+position}`,title,artist:'Artista prueba',album:'Álbum con portada',duration:30}});
  if(position===1)await storeEmbeddedArtwork(track.id,track.audioFingerprint!.sha256,async()=>image);
 }
 for(const [position,index] of [1,2].entries()){
  const track=(await readRecord<Track>('tracks',rows[index].track))!;
  const title=`Remota ${position+1}`;
  await writeRecord('tracks',track.id,{...track,...(position===0?{assetId:null}:{}),title,artist:'Artista prueba',album:'Álbum sin archivo',manualOverrides:{},catalogChoice:{source:'itunes',id:`itunes:813:1:${position+1}:${921+position}`,title,artist:'Artista prueba',album:'Álbum sin archivo',duration:30}});
  if(position===1)await storeEmbeddedArtwork(track.id,track.audioFingerprint!.sha256,async()=>image);
 }
 await writeRecord('settings','library-playback',{version:1,entries:[{id:'v66-entry',trackId:rows[0].track}],currentEntryId:'v66-entry',position:0,repeat:'off',shuffleOrder:null});
 const account='11111111-1111-4111-8111-111111111111';
 await saveAlbumRecord(account,{edition:{id:811,title:'Álbum con portada',artist:'Artista prueba',trackCount:2,releaseDate:null},tracks:[1,2].map(position=>({releaseId:811,trackId:910+position,disc:1,position,title:`Pista ${position}`,artist:'Artista prueba',durationMs:30000}))},()=>true);
 await saveAlbumRecord(account,{edition:{id:813,title:'Álbum sin archivo',artist:'Artista prueba',trackCount:2,releaseDate:null},tracks:[1,2].map(position=>({releaseId:813,trackId:920+position,disc:1,position,title:`Remota ${position}`,artist:'Artista prueba',durationMs:30000}))},()=>true);
 await saveAlbumRecord(account,{edition:{id:812,title:'Álbum proveedor',artist:'Artista prueba',trackCount:1,releaseDate:null},tracks:[{releaseId:812,trackId:913,disc:1,position:1,title:'Sin copia',artist:'Artista prueba',durationMs:30000}]},()=>true);
 const cache=new PlayerArtworkCache(account);await cache.saveProvider('edition:812','Álbum proveedor',image);
 const db=await openDatabase();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('settings','readwrite');tx.objectStore('settings').delete('artwork:v1:'+rows[1].track);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});}finally{closeDatabase(db);}
 const primary=await readArtwork(rows[1].track,true),fallback=await readArtwork(rows[2].track,true);
 if(primary.state!=='unrecorded'||fallback.state!=='ready')throw Error(`fixture artwork: ${primary.state}/${fallback.state}`);
 const host=document.createElement('div');host.id='metadata-only-covers';document.body.append(host);
 createRoot(host).render(React.createElement(PlayerArtworkCacheContext.Provider,{value:cache},
  React.createElement(CatalogArtwork,{className:'fallback-cover',trackId:rows[1].track,sharedArtworkKey:'edition:813',fallbackTrackIds:[rows[2].track]}),
  React.createElement(CatalogArtwork,{className:'provider-cover',trackId:rows[1].track,sharedArtworkKey:'edition:812'})));

}});
