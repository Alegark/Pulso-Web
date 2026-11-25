import {createRoot} from 'react-dom/client';
import {registerDatabaseRealmHost} from '../../src/storage/database-realms';
import {readRecord,writeRecord} from '../../src/storage/database';
import {importFileDetailed} from '../../src/imports/import-file';
import {readArtwork,setManualArtwork} from '../../src/library/artwork';
import {albumCoordinator,notifyAlbumDownload} from '../../src/library/album-download';
import {prepareAccountLibrary} from '../../src/accounts/library-local';
import type {Track} from '../../src/library/library';
import {DownloadDock} from '../../src/ui/DownloadDock';
import '../../src/style.css';
import '../../src/ui/design-tokens.css';
import '../../src/ui/shell.css';
import '../../src/ui/responsive-shell.css';
import '../../src/ui/app-polish.css';

const accountId='11111111-1111-4111-8111-111111111111';
const artist='Intérprete de prueba';
const release={source:'itunes' as const,releaseId:10,trackId:11,disc:1,position:1,title:'Edición de prueba',artist,
 artworkUrl:'https://is1-ssl.mzstatic.com/image/thumb/Music/catalog/100x100bb.png'};

function audioFixture(title:string,index:number){
 const bytes=new Uint8Array(44+8000*2*45),wav=new DataView(bytes.buffer);
 bytes.set(new TextEncoder().encode('RIFF'),0);
 bytes.set(new TextEncoder().encode('WAVEfmt '),8);
 bytes.set(new TextEncoder().encode('data'),36);
 for(const [offset,value] of [[4,bytes.length-8],[16,16],[24,8000],[28,16000],[40,bytes.length-44]])wav.setUint32(offset,value,true);
 for(const [offset,value] of [[20,1],[22,1],[32,2],[34,16],[44,index+1]])wav.setUint16(offset,value,true);
 return new File([bytes],title+'.wav',{type:'audio/wav'});
}

async function seed(){
 registerDatabaseRealmHost({capture:(_kind,current)=>current()?{current,onLifecycle:()=>{},end:()=>{}}:null});
 localStorage.setItem('pulso:setup:v1:'+accountId,'complete');
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{
  const req=indexedDB.open('pulso-web-telegram-session-v1',1);
  req.onupgradeneeded=()=>req.result.createObjectStore('authorization');
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error);
 });
 try{await new Promise<void>((resolve,reject)=>{
  const tx=db.transaction('authorization','readwrite');
  tx.objectStore('authorization').put('TESTONLY_OFFLINE_SETUP','session');
  tx.objectStore('authorization').put(crypto.randomUUID(),'epoch');
  tx.oncomplete=()=>resolve();
  tx.onabort=()=>reject(tx.error);
 });}finally{db.close();}

 const titles=['Descarga uno','Descarga dos','Portada de catálogo','Portada manual','Portada oculta'];
 const ids:Record<string,string>={};
 for(const [i,title] of titles.entries()){
  const imported=await importFileDetailed(audioFixture(title,i),new AbortController().signal,()=>{},{backend:'idb'});
  if(imported.kind!=='confirmed')throw Error('Copia sintética sin confirmar');
  const {id}=imported.result.track;
  const track=await readRecord<Track>('tracks',id);
  await writeRecord('tracks',id,{...track,artist,favorite:true,...(i>=2?{catalogRelease:release}:{})});
  if(i>=3){
   const image=i===3?new Blob([await (await fetch('/__artwork/manual.png')).arrayBuffer()],{type:'image/png'}):null;
   await setManualArtwork(id,image,(await readArtwork(id)).revision);
  }
  ids[title]=id;
 }
 await prepareAccountLibrary(accountId,()=>true);
 return ids;
}

function showDownload(saved:number,total:number){
 albumCoordinator.active??={scope:'test',editionId:42,key:'test',title:'Descarga sintética',abort:new AbortController()};
 albumCoordinator.running=true;
 albumCoordinator.notice={title:'Descarga sintética',progress:{message:'Preparando la siguiente canción…',
  rows:Array.from({length:total},(_,i)=>i<saved?
   {state:'downloaded',trackId:'test-'+i,confirmed:true,message:'Guardada'}:
   {state:'unattempted',trackId:null,confirmed:false,message:'En espera'})}};
 notifyAlbumDownload(albumCoordinator);
}

if(location.search==='?dock')createRoot(document.getElementById('root')!).render(<DownloadDock/>);
Object.assign(window,{artworkDockFixture:{seed,showDownload}});
