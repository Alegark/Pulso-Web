import {createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {closeDatabase,openDatabase,readRecord,writeRecord} from '../../src/storage/database';
import {prepareAccountLibrary} from '../../src/accounts/library-local';
import {PlayerArtworkCache} from '../../src/library/player-artwork-cache';
import {readArtwork,setManualArtwork} from '../../src/library/artwork';
import {CatalogArtwork} from '../../src/ui/CatalogArtwork';
import './artwork-rows-dock-fixture';
import type {Track,Playlist} from '../../src/library/library';

const owner='11111111-1111-4111-8111-111111111111';
const second='22222222-2222-4222-8222-222222222222';
const artworkUrl=(i:number)=>'https://is1-ssl.mzstatic.com/image/thumb/Music/fixture/'+i+'/100x100bb.png';
async function seed(twoAccounts=false){
 closeDatabase(await openDatabase());
 const ids=await (window as unknown as {artworkDockFixture:{seed(id?:string):Promise<Record<string,string>>}}).artworkDockFixture.seed(twoAccounts?second:undefined);
 const entries=[];
 for(let i=0;i<30;i++){
  const id=crypto.randomUUID(),title='Portada '+String(i+1).padStart(2,'0');
  const track:Track={id,accountId:owner,assetId:null,title,artist:'Artista sintético',album:null,duration:45,favorite:false,revision:1,
   createdAt:new Date(0).toISOString(),manualOverrides:{},catalogRelease:{source:'itunes',releaseId:100+i,trackId:1000+i,disc:1,position:1,title:'Edición '+title,artist:'Artista sintético',
   artworkUrl:artworkUrl(i)}};
  await writeRecord('tracks',id,track);
  entries.push({id:crypto.randomUUID(),trackId:id});
 }
 const albumEntries=[];
 const albumAsset=(await readRecord<Track>('tracks',ids['Descarga uno']))!.assetId;
 for(let i=0;i<3;i++){
  const id=crypto.randomUUID(),title=`Álbum compartido ${i+1}`;
  const track:Track={id,accountId:owner,assetId:albumAsset,title,artist:'Artista compartido',album:'Álbum compartido',duration:45,favorite:false,revision:1,createdAt:new Date(0).toISOString(),manualOverrides:{},
   catalogRelease:{source:'itunes' as const,releaseId:9999,trackId:99991+i,disc:1,position:i+1,title:'Álbum compartido',artist:'Artista compartido',...(i===0?{artworkUrl:'https://is1-ssl.mzstatic.com/image/thumb/Music/shared/9999/100x100bb.png'}:{})}};
  await writeRecord('tracks',id,track);ids[title]=id;albumEntries.push({id:crypto.randomUUID(),trackId:id});
 }
 const albumPlaylist:Playlist={id:crypto.randomUUID(),accountId:owner,name:'Álbum compartido prueba',revision:1,entries:albumEntries};
 await writeRecord('playlists',albumPlaylist.id,albumPlaylist);
 const playlist:Playlist={id:crypto.randomUUID(),accountId:owner,name:'Treinta portadas',revision:1,entries};
 await writeRecord('playlists',playlist.id,playlist);
 if(twoAccounts){
  const track=await readRecord<Track>('tracks',entries[0].trackId);
  const id=crypto.randomUUID();
  await writeRecord('tracks',id,{...track,id,accountId:second,title:'Portada de la otra cuenta',favorite:true});
 }
 await prepareAccountLibrary(owner,()=>true);
 return ids;
}
async function showEmbedded(visibleId:string,hiddenId:string){
 const key='artwork:v1:'+visibleId,manual=await readRecord<{blob?:Blob}>('settings',key);
 const blob=manual?.blob?new Blob([await manual.blob.arrayBuffer()],{type:manual.blob.type}):undefined;
 await writeRecord('settings',key,{...manual,...(blob?{blob}:{}),manual:false,provenance:'embedded-riff-id3'});
 createRoot(document.getElementById('artwork')!).render(createElement('div',null,
  createElement(CatalogArtwork,{trackId:visibleId,url:artworkUrl(0),preferUrl:true,className:'embedded'}),
  createElement(CatalogArtwork,{trackId:hiddenId,url:artworkUrl(0),preferUrl:true,className:'hidden'})));
}
async function hideAlbumTrack(id:string){await setManualArtwork(id,null,(await readArtwork(id)).revision);}
async function testPreload(keys:string[]){
 const native=IDBDatabase.prototype.transaction;let count=0;
 IDBDatabase.prototype.transaction=function(...args:Parameters<IDBDatabase['transaction']>){
  if(this.name==='pulso-web-cache-v1'&&args[1]==='readonly')count++;
  return native.apply(this,args);
 };
 const cache=new PlayerArtworkCache(owner);
 try{await cache.preload(keys);await cache.preload(keys);return count;}
 finally{cache.retire();IDBDatabase.prototype.transaction=native;}
}
Object.assign(window,{seedPersistentCache:seed,showEmbedded,hideAlbumTrack,testPreload});
