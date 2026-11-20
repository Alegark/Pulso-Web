import {useEffect,useRef,useState,type ReactNode} from 'react';
import {downloadNotifications} from '../pwa/download-notifications';
import {createPortal} from 'react-dom';
import {CollectionDownloadButton,DownloadDock,useAlbumDownloadState} from './DownloadDock';
import {registerUpdateBlocker} from '../service-worker/update-blockers';
import {requestLibraryDownload,subscribeLibraryDownloads,subscribeLibraryTrackReviews,releaseUncertainSingleDownload,downloadLibrarySelection,type LibraryDownloadRequest} from '../library/library-download';
import {clearHeldLibraryDownload,discardLibraryDownloadCheckpoint,readHeldLibraryDownload,readLibraryDownloadCheckpoint,writeLibraryDownloadCheckpoint,pendingLibraryTrack,releaseLibraryTrack,sameHeldDownload,writeHeldLibraryDownload,type HeldDownload,type LibraryDownloadCheckpoint} from '../library/library-download-checkpoint';
import {inspectLibraryTrackDownload} from '../library/library-download-recovery';
import {albumCoordinator,notifyAlbumDownload} from '../library/album-download';
import {orderedProviders} from '../library/ordered-bot-acquisition';
import type {BotsSnapshot,TelegramSessionClient} from '../telegram/session-client';
import type {Track} from '../library/library';
import type {SongPlaybackAttempt} from '../library/selected-song';

export interface CollectionDownloadAction {
 target:HTMLElement|null;
 request:Pick<LibraryDownloadRequest,'trackIds'|'title'>;
 label:string;
 complete:boolean;
 disabled:boolean;
}

export function LibraryDownloadController(props:{collection?:CollectionDownloadAction;storageTarget?:HTMLElement|null;accountId?:string;captureLifetime?:()=>()=>boolean;onReviewStorage?:()=>void;onReviewed?:(operationId?:string)=>void;tracks:readonly Track[];client:TelegramSessionClient|null;bots:BotsSnapshot|null;connected:boolean;connectionPhase?:'initializing'|'connected'|'disconnected'|'blocked';capture?:()=>SongPlaybackAttempt|null;capturePlay?:()=>SongPlaybackAttempt|null;captureBatch?:(recoverPending?:boolean)=>SongPlaybackAttempt|null}){
 const download=useAlbumDownloadState();
 const latest=useRef(props);latest.current=props;
 const flight=useRef<AbortController|null>(null);
 const finalNotice=useRef<(()=>void)|null>(null);
 const ownedNotice=useRef<typeof albumCoordinator.notice>(undefined);
 const [notice,setNoticeMessage]=useState<{text:string}|null>(null);
 const setNotice=(text:string)=>setNoticeMessage(text?{text}:null);
 const [pending,setPending]=useState<LibraryDownloadCheckpoint|null>(null);
 const [review,setReview]=useState<{trackId:string;title:string;state:'checking'|'saved'|'missing'|'uncertain';kind?:HeldDownload['kind'];canPreserveRetry?:boolean;settled?:boolean}|null>(null);
 const checking=useRef<AbortController|null>(null);
 const waiting=useRef<{request:LibraryDownloadRequest;restore?:LibraryDownloadCheckpoint;account:string|undefined}|null>(null);

 async function reviewTrack(trackId:string,title:string,retry:'no'|'safe'|'preserve'='no'){
  const p=latest.current,account=p.accountId,guard=p.captureLifetime?.();
  if(!account||guard&&!guard()||flight.current||albumCoordinator.running)return;
  checking.current?.abort();
  const abort=new AbortController();checking.current=abort;
  const current=()=>checking.current===abort&&!abort.signal.aborted&&latest.current.accountId===account&&
   !flight.current&&!albumCoordinator.running&&(guard?.()??true);
  setReview({trackId,title,state:'checking'});
  try{
   const marker=pendingLibraryTrack(account,trackId),operationId=marker?.kind==='save'?marker.operationId:undefined;
   if(retry!=='no'&&(!p.client||!p.connected||!orderedProviders(p.bots).length)){
    setNotice('Conecta Telegram y configura un bot para descargar en este dispositivo.');retry='no';
   }
   const search=p.client?.searchSnapshot();
   if(retry!=='no'&&search&&(search.pending||search.cancelling||search.retryBlocked||search.retryAt!==null&&search.retryAt>Date.now())){
    setNotice('Telegram todavía está resolviendo una operación. Espera antes de reintentar.');retry='no';
   }
   const preserve=retry==='preserve'?(p.captureBatch??p.capture)?.():null;
   if(retry==='preserve'&&!preserve?.current()){
    setNotice('Biblioteca está ocupada. Revisa Almacenamiento si hay una copia pendiente.');
   }
   const mayRetry=retry!=='no'&&(retry!=='preserve'||!!preserve?.current());
   const result=await inspectLibraryTrackDownload(account,trackId,operationId,abort.signal,
    ()=>current()&&(!preserve||preserve.current()),mayRetry&&retry==='preserve');
   if(!current())return;
   const {state,settled,canPreserveRetry}=result;
   if(state==='saved'&&settled){
    if(releaseLibraryTrack(account,trackId,marker))releaseUncertainSingleDownload(trackId);
    p.onReviewed?.(operationId);
    setPending(readLibraryDownloadCheckpoint(account));setNotice('');
   }
   if(state==='missing'&&operationId)p.onReviewed?.(operationId);
   else if(mayRetry&&retry==='preserve'&&canPreserveRetry)p.onReviewed?.();
   setReview({trackId,title,state,kind:marker?.kind,canPreserveRetry,settled});
   if(mayRetry&&(state==='missing'||retry==='preserve'&&state==='uncertain'&&canPreserveRetry))start({id:crypto.randomUUID(),trackIds:[trackId],title,play:false,repair:true},undefined,marker);
  }catch{if(current())setReview({trackId,title,state:'uncertain'});}
  finally{if(checking.current===abort)checking.current=null;}
 }
 const reviewRef=useRef(reviewTrack);reviewRef.current=reviewTrack;

 function start(request:LibraryDownloadRequest,restore?:LibraryDownloadCheckpoint,reviewed?:HeldDownload|null){
  const p=latest.current;
  if(flight.current||albumCoordinator.running){setNotice('Hay otra descarga en curso.');return;}
  const providers=orderedProviders(p.bots);
  const phase=p.connectionPhase??(p.connected?'connected':'disconnected');
  if(phase==='initializing'){
   if(!request.repair)waiting.current={request,restore,account:p.accountId};
   setNotice('Esperando a que Telegram termine de preparar tus bots…');return;
  }
  if(phase==='blocked'){setNotice('El control de la pestaña o el acceso a Almacenamiento todavía impide continuar. El progreso se conserva.');return;}
  if(!p.client||phase!=='connected'){setNotice('Conecta Telegram y configura un bot para descargar en este dispositivo.');return;}
  if(!p.bots||!providers.length){setNotice('Telegram está conectado. Configura un bot de música compatible.');return;}
  const attempt=(request.play?p.capturePlay:p.captureBatch??p.capture)?.(!!restore);
  if(!attempt?.current()){setNotice('Biblioteca está ocupada. Revisa Almacenamiento si hay una copia pendiente y vuelve a continuar.');return;}
  const index=new Map(p.tracks.map(t=>[t.id,t]));
  const tracks=request.trackIds.map(id=>index.get(id)).filter((t):t is Track=>!!t);
  if(tracks.length!==request.trackIds.length){setNotice('La selección cambió. Vuelve a elegirla.');return;}
  let checkpoint=restore;
  const account=p.accountId;
  try{
   if(request.repair&&account){
    const trackId=request.trackIds[0],search=p.client.searchSnapshot();
    if(search.pending||search.cancelling||search.retryBlocked||search.retryAt!==null&&search.retryAt>Date.now()){
     setNotice('Telegram todavía está resolviendo una operación. Espera antes de reintentar.');return;
    }
    if(search.error==='uncertain'){
     const allowed=p.client.captureSearchActionCurrent();
     if(!allowed()){setNotice('Vuelve a conectar Telegram antes de reintentar esta canción.');return;}
     p.client.clearSearch(allowed);
    }
    if(reviewed===undefined||!releaseLibraryTrack(account,trackId,reviewed)||pendingLibraryTrack(account,trackId)){
     setNotice('El estado de la pista cambió. Vuelve a revisarla.');return;
    }
    releaseUncertainSingleDownload(trackId);
    checkpoint={id:request.id,trackIds:[trackId],cursor:0,pending:null};
   }else if(!request.play&&account){
    const previous=readLibraryDownloadCheckpoint(account);
    if(!checkpoint&&previous){
     setPending(previous);setNotice('Hay una descarga pendiente. Puedes continuar desde su última pista confirmada.');return;
    }
    if(checkpoint&&previous?.id!==checkpoint.id){setPending(previous);setNotice('La descarga cambió en esta pestaña.');return;}
    checkpoint={...(checkpoint??{trackIds:[...request.trackIds],cursor:0,pending:null}),id:crypto.randomUUID()};
    writeLibraryDownloadCheckpoint(account,checkpoint);
   }
   if(request.play&&account){
    if(pendingLibraryTrack(account,request.trackIds[0])){
     void reviewRef.current(tracks[0].id,tracks[0].title);return;
    }
    checkpoint={id:request.id,trackIds:[...request.trackIds],cursor:0,pending:null};
   }
  }catch{setNotice('No se pudo conservar el progreso de la descarga. Comprueba el almacenamiento del navegador.');return;}
  // Flush any completed run before starting another one with the same tag.
  if(document.visibilityState!=='hidden')finalNotice.current?.();
  finalNotice.current=null;
  const abort=new AbortController();
  flight.current=abort;setPending(null);setNotice('');setReview(null);albumCoordinator.running=true;
  const run={scope:'library',editionId:0,key:request.id,title:request.title,abort};albumCoordinator.active=run;
  ownedNotice.current={title:request.title,titles:tracks.map(track=>track.title),progress:{
   message:'Comprobando las copias de esta selección…',
   rows:tracks.map(()=>({state:'unattempted',trackId:null,confirmed:false,message:''})),
  }};
  albumCoordinator.notice=ownedNotice.current;
  notifyAlbumDownload(albumCoordinator);
  const current=()=>flight.current===abort&&latest.current.accountId===account&&attempt.current();
  const collection=!request.repair&&!request.play;
  const noticeCurrent=()=>latest.current.accountId===account&&!abort.signal.aborted;
  const dismiss=()=>downloadNotifications.dismiss('collection',run);
  if(collection)abort.signal.addEventListener('abort',dismiss,{once:true});
  let readyId:string|null=null,finished=false,preserveHeld=false,confirmed=0,wasWaiting=false;
  const summary=()=>`${confirmed} de ${tracks.length} guardadas`;
  const notify=(body:string,terminal=false,pause=false)=>downloadNotifications.notify('collection',run,run.title,body,terminal,noticeCurrent,pause);
  void downloadLibrarySelection({tracks,attempt,client:p.client,providers,revision:p.bots.revision,signal:abort.signal,current,
   checkpoint,saveCheckpoint:account&&checkpoint?next=>{
    if(!current())throw Error('Library download changed');
    if(request.repair||request.play){
     if(next.pending)writeHeldLibraryDownload(account,tracks[0].id,next.pending);
     else if(!preserveHeld)clearHeldLibraryDownload(account,tracks[0].id);
    }else{
     if(readLibraryDownloadCheckpoint(account)?.id!==next.id)throw Error('Library download changed');
     writeLibraryDownloadCheckpoint(account,next);
    }
    checkpoint=next;
   }:undefined,
   heldDownload:account&&checkpoint?id=>readHeldLibraryDownload(account,id):undefined,
   parkDownload:account&&checkpoint?(id,marker)=>{
    if(!current())return;
    const parked=readHeldLibraryDownload(account,id);
    if(parked?.kind==='save'&&!sameHeldDownload(parked,marker)){
     if(marker.kind==='network')return;
     throw Error('An earlier receipt is still pending');
    }
    writeHeldLibraryDownload(account,id,marker);preserveHeld=true;
   }:undefined,
   clearHeldDownload:account&&checkpoint?(id,expected)=>{
    if(current()&&sameHeldDownload(readHeldLibraryDownload(account,id),expected))clearHeldLibraryDownload(account,id);
   }:undefined,
   update:(rows,message,waiting)=>{
    if(flight.current!==abort||latest.current.accountId!==account)return;
    readyId=rows.length===1&&rows[0].confirmed?rows[0].trackId:null;
    confirmed=rows.filter(row=>row.confirmed).length;
    const enteringWait=!!waiting&&!wasWaiting;wasWaiting=!!waiting;
    if(collection&&!abort.signal.aborted)notify(waiting?`${summary()} · ${message}`:summary(),false,enteringWait);
    ownedNotice.current={title:request.title,titles:tracks.map(t=>t.title),progress:{rows,message,waiting}};
    albumCoordinator.notice=ownedNotice.current;
    notifyAlbumDownload(albumCoordinator);
   },
  }).then(async outcome=>{
   finished=outcome==='finished';
   if(collection&&finished&&noticeCurrent()){
    const missing=tracks.length-confirmed;
    const body=missing?`${summary()} · ${missing} sin copia`:summary();
    const publish=()=>notify(body,true);
    if(document.visibilityState==='hidden')finalNotice.current=publish;
    else publish();
   }
   if(request.play&&readyId&&current()&&!abort.signal.aborted){
    const result=await attempt.play(readyId,()=>current()&&!abort.signal.aborted,abort.signal);
    if(result==='gesture-required')setNotice('Copia guardada. Pulsa Reproducir para escucharla.');
   }
  }).catch(()=>{if(current())setNotice('No se pudo iniciar la reproducción.');}).finally(()=>{
   if(!request.repair&&!request.play&&checkpoint&&account&&finished&&current())try{if(readLibraryDownloadCheckpoint(account)?.id===checkpoint.id)writeLibraryDownloadCheckpoint(account,null);}catch{/* Keep the settled pointer for a safe replay. */ }
   if(flight.current===abort){
    flight.current=null;
    if(account&&latest.current.accountId===account)try{setPending(readLibraryDownloadCheckpoint(account));}
    catch{setNotice('No se pudo leer el progreso guardado de la descarga.');}
   }
   if(albumCoordinator.active===run){albumCoordinator.running=false;albumCoordinator.active=undefined;notifyAlbumDownload(albumCoordinator);}
  });
 }
 const startRef=useRef(start);startRef.current=start;
 useEffect(()=>{
  const queued=waiting.current;
  if(!queued||queued.account!==props.accountId||props.connectionPhase==='initializing')return;
  waiting.current=null;
  startRef.current(queued.request,queued.restore);
 },[props.accountId,props.connectionPhase,props.bots,props.connected]);
 useEffect(()=>registerUpdateBlocker(()=>flight.current!==null||waiting.current!==null),[]);
 useEffect(()=>{
  const unsubscribe=subscribeLibraryDownloads(request=>startRef.current(request));
  const unsubscribeReview=subscribeLibraryTrackReviews((id,title)=>void reviewRef.current(id,title));
  const suspend=()=>{waiting.current=null;flight.current?.abort();checking.current?.abort();};
  const foreground=()=>{
   if(document.visibilityState==='hidden')return;
   const publish=finalNotice.current;finalNotice.current=null;publish?.();
  };
  document.addEventListener('visibilitychange',foreground);
  addEventListener('pageshow',foreground);
  addEventListener('pagehide',suspend);
  return()=>{unsubscribe();unsubscribeReview();removeEventListener('pagehide',suspend);removeEventListener('pageshow',foreground);document.removeEventListener('visibilitychange',foreground);};
 },[]);
 useEffect(()=>{
  waiting.current=null;setNotice('');setPending(null);setReview(null);
  if(props.accountId)try{setPending(readLibraryDownloadCheckpoint(props.accountId));}catch{setNotice('No se pudo leer el progreso guardado de la descarga.');}
  return()=>{
   finalNotice.current=null;checking.current?.abort();checking.current=null;
   const active=flight.current;flight.current=null;active?.abort();
   if(ownedNotice.current&&albumCoordinator.notice===ownedNotice.current){albumCoordinator.notice=undefined;notifyAlbumDownload(albumCoordinator);}
  };
 },[props.accountId]);
 const collection=props.collection;
 const reviewContent:ReactNode=review&&<div className="download-dock__review">
   <strong><bdi dir="auto">{review.title}</bdi></strong>
   <p role="status">{review.state==='checking'?'Comprobando esta canción…':
    review.state==='saved'?(review.settled?'Copia verificada y disponible en Biblioteca.':'La copia de Biblioteca está disponible. Hay un guardado anterior pendiente de revisar en Almacenamiento.'):
    review.state==='uncertain'?'El guardado sigue sin confirmar. En Almacenamiento puedes recuperar la copia, descartar un parcial que Pulso pueda verificar o conservar los archivos.':
    review.kind==='network'?'No hay copia local verificada. Al reintentar se hará una nueva búsqueda en Telegram.':
    'No hay una copia local verificada para esta canción.'}</p>
   {review.state==='missing'&&<button type="button" onClick={()=>void reviewTrack(review.trackId,review.title,'safe')}>Reintentar esta canción</button>}
   {props.onReviewStorage&&(review.state==='uncertain'||review.state==='saved'&&!review.settled)&&<button type="button" onClick={()=>{setReview(null);props.onReviewStorage?.();}}>Revisar en Almacenamiento</button>}
   {review.state==='uncertain'&&<>
    <button type="button" onClick={()=>void reviewTrack(review.trackId,review.title)}>Volver a comprobar</button>
    {review.canPreserveRetry&&<button type="button" onClick={()=>void reviewTrack(review.trackId,review.title,'preserve')}>Conservar archivos y reintentar</button>}</>}
   <button type="button" onClick={()=>{checking.current?.abort();setReview(null);}}>Cerrar revisión</button>
 </div>;
 return <>
  <DownloadDock key={props.accountId} message={notice} review={reviewContent} onReviewStorage={props.onReviewStorage}/>
  {collection?.target&&createPortal(<CollectionDownloadButton label={pending?'Continuar descarga':collection.label}
   disabled={!!waiting.current||(!pending&&(collection.disabled||!collection.request.trackIds.length))}
   complete={!pending&&collection.complete} onStart={()=>{
    const {trackIds,title}=collection.request;
    if(!pending){requestLibraryDownload(trackIds,title);return;}
    const sameSelection=pending.trackIds.length===trackIds.length&&pending.trackIds.every((id,index)=>id===trackIds[index]);
    start({id:pending.id,trackIds:pending.trackIds,title:sameSelection?title:'Selección de Biblioteca',play:false},pending);
   }}/>,collection.target)}
  {props.storageTarget&&pending&&!download.running&&createPortal(<button type="button" onClick={()=>{
   if(!props.accountId||flight.current||albumCoordinator.running)return;
   try{
    if(props.captureLifetime&&!props.captureLifetime()()){setNotice('Usa Pulso en esta pestaña para descartar la selección.');return;}
    waiting.current=null;discardLibraryDownloadCheckpoint(props.accountId,pending);
    setPending(readLibraryDownloadCheckpoint(props.accountId));setNotice('');
   }catch{setNotice('No se pudo descartar el progreso de la selección.');}
  }}>Descartar selección pendiente</button>,props.storageTarget)}
 </>;
}
