import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import './library-download.css';
import {registerUpdateBlocker} from '../service-worker/update-blockers';
import {subscribeLibraryDownloads,downloadLibrarySelection,type LibraryDownloadRequest} from '../library/library-download';
import {clearHeldLibraryDownload,discardLibraryDownloadCheckpoint,readHeldLibraryDownload,readLibraryDownloadCheckpoint,writeLibraryDownloadCheckpoint,type LibraryDownloadCheckpoint} from '../library/library-download-checkpoint';
import {albumCoordinator,notifyAlbumDownload} from '../library/album-download';
import {orderedProviders} from '../library/ordered-bot-acquisition';
import type {BotsSnapshot,TelegramSessionClient} from '../telegram/session-client';
import type {Track} from '../library/library';
import type {SongPlaybackAttempt} from '../library/selected-song';

export function LibraryDownloadController(props:{accountId?:string;captureLifetime?:()=>()=>boolean;tracks:readonly Track[];client:TelegramSessionClient|null;bots:BotsSnapshot|null;connected:boolean;capture?:()=>SongPlaybackAttempt|null;capturePlay?:()=>SongPlaybackAttempt|null;captureBatch?:()=>SongPlaybackAttempt|null}){
 const latest=useRef(props);latest.current=props;
 const flight=useRef<AbortController|null>(null);
 const ownedNotice=useRef<typeof albumCoordinator.notice>(undefined);
 const [notice,setNotice]=useState('');
 const [pending,setPending]=useState<LibraryDownloadCheckpoint|null>(null);

 function start(request:LibraryDownloadRequest,restore?:LibraryDownloadCheckpoint){
  const p=latest.current;
  if(flight.current||albumCoordinator.running){setNotice('Hay otra descarga en curso.');return;}
  const providers=orderedProviders(p.bots);
  if(!p.client||!p.connected||!p.bots||!providers.length){setNotice('Conecta Telegram y configura un bot para descargar en este dispositivo.');return;}
  const attempt=(request.play?p.capturePlay:p.captureBatch??p.capture)?.();
  if(!attempt?.current()){setNotice('Biblioteca está ocupada. Revisa Almacenamiento si hay una copia pendiente y vuelve a continuar.');return;}
  const index=new Map(p.tracks.map(t=>[t.id,t]));
  const tracks=request.trackIds.map(id=>index.get(id)).filter((t):t is Track=>!!t);
  if(tracks.length!==request.trackIds.length){setNotice('La selección cambió. Vuelve a elegirla.');return;}
  let checkpoint=restore;
  const account=p.accountId;
  try{
   if(!request.play&&account){
    const previous=readLibraryDownloadCheckpoint(account);
    if(!checkpoint&&previous){
     setPending(previous);setNotice('Hay una descarga pendiente. Puedes continuar desde su última pista confirmada.');return;
    }
    if(checkpoint&&previous?.id!==checkpoint.id){setPending(previous);setNotice('La descarga cambió en esta pestaña.');return;}
    checkpoint={...(checkpoint??{trackIds:[...request.trackIds],cursor:0,pending:null}),id:crypto.randomUUID()};
    writeLibraryDownloadCheckpoint(account,checkpoint);
   }
   const previous=request.play&&account?readLibraryDownloadCheckpoint(account):null;
   if(request.play&&account&&(previous?.pending&&previous.trackIds[previous.pending.index]===request.trackIds[0]||
    readHeldLibraryDownload(account,request.trackIds[0]))){
    setNotice('Hay un guardado pendiente en la descarga de Biblioteca. Revísalo antes de repetir una entrega.');return;
   }
  }catch{setNotice('No se pudo conservar el progreso de la descarga. Comprueba el almacenamiento del navegador.');return;}
  const abort=new AbortController();
  flight.current=abort;setPending(null);setNotice('');albumCoordinator.running=true;
  const run={scope:'library',editionId:0,key:request.id,title:request.title,abort};albumCoordinator.active=run;
  const current=()=>flight.current===abort&&latest.current.accountId===account&&attempt.current();
  let readyId:string|null=null,finished=false;
  void downloadLibrarySelection({tracks,attempt,client:p.client,providers,revision:p.bots.revision,signal:abort.signal,current,
   checkpoint,saveCheckpoint:account&&checkpoint?next=>{
    if(!current()||readLibraryDownloadCheckpoint(account)?.id!==next.id)throw Error('Library download changed');
    writeLibraryDownloadCheckpoint(account,next);checkpoint=next;
   }:undefined,
   heldDownload:account&&checkpoint?id=>readHeldLibraryDownload(account,id):undefined,
   clearHeldDownload:account&&checkpoint?id=>{if(current())clearHeldLibraryDownload(account,id);}:undefined,
   update:(rows,message)=>{
    if(flight.current!==abort||latest.current.accountId!==account)return;
    readyId=rows.length===1&&rows[0].confirmed?rows[0].trackId:null;
    ownedNotice.current={title:request.title,titles:tracks.map(t=>t.title),progress:{rows,message}};
    albumCoordinator.notice=ownedNotice.current;
    notifyAlbumDownload(albumCoordinator);
   },
  }).then(async outcome=>{
   finished=outcome==='finished';
   if(request.play&&readyId&&current()&&!abort.signal.aborted){
    const result=await attempt.play(readyId,()=>current()&&!abort.signal.aborted,abort.signal);
    if(result==='gesture-required')setNotice('Copia guardada. Pulsa Reproducir para escucharla.');
   }
  }).catch(()=>{if(current())setNotice('No se pudo iniciar la reproducción.');}).finally(()=>{
   if(checkpoint&&account&&finished&&current())try{if(readLibraryDownloadCheckpoint(account)?.id===checkpoint.id)writeLibraryDownloadCheckpoint(account,null);}catch{/* Keep the settled pointer for a safe replay. */ }
   if(flight.current===abort){
    flight.current=null;
    if(account&&latest.current.accountId===account)try{setPending(readLibraryDownloadCheckpoint(account));}
    catch{setNotice('No se pudo leer el progreso guardado de la descarga.');}
   }
   if(albumCoordinator.active===run){albumCoordinator.running=false;albumCoordinator.active=undefined;notifyAlbumDownload(albumCoordinator);}
  });
 }
 const startRef=useRef(start);startRef.current=start;
 useEffect(()=>registerUpdateBlocker(()=>flight.current!==null),[]);
 useEffect(()=>{
  const unsubscribe=subscribeLibraryDownloads(request=>startRef.current(request));
  const suspend=()=>flight.current?.abort();
  addEventListener('pagehide',suspend);
  return()=>{unsubscribe();removeEventListener('pagehide',suspend);};
 },[]);
 useEffect(()=>{
  setNotice('');setPending(null);
  if(props.accountId)try{setPending(readLibraryDownloadCheckpoint(props.accountId));}catch{setNotice('No se pudo leer el progreso guardado de la descarga.');}
  return()=>{
   const active=flight.current;flight.current=null;active?.abort();
   if(ownedNotice.current&&albumCoordinator.notice===ownedNotice.current){albumCoordinator.notice=undefined;notifyAlbumDownload(albumCoordinator);}
  };
 },[props.accountId]);
 return notice||pending?createPortal(<aside className="library-download-hint">
  <p role="status">{notice||'Hay una descarga de Biblioteca pendiente.'}</p>
  {pending&&<>
   <button type="button" onClick={()=>start({id:pending.id,trackIds:pending.trackIds,title:'Selección de Biblioteca',play:false},pending)}>Continuar descarga de Biblioteca</button>
   <button type="button" onClick={()=>{
    if(!props.accountId||flight.current||albumCoordinator.running)return;
    try{
     if(props.captureLifetime&&!props.captureLifetime()()){setNotice('Usa Pulso en esta pestaña para descartar la selección.');return;}
     discardLibraryDownloadCheckpoint(props.accountId,pending);
     setPending(readLibraryDownloadCheckpoint(props.accountId));setNotice('');
    }catch{setNotice('No se pudo descartar el progreso de la selección.');}
   }}>Descartar selección pendiente</button>
  </>}
  {notice&&<button type="button" onClick={()=>setNotice('')}>Cerrar aviso</button>}
 </aside>,document.body):null;
}
