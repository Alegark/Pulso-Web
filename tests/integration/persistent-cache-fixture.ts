import {createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {closeDatabase,openDatabase,readRecord,writeRecord} from '../../src/storage/database';
import {prepareAccountLibrary} from '../../src/accounts/library-local';
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
Object.assign(window,{seedPersistentCache:seed,showEmbedded});
