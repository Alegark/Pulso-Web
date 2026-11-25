import {useEffect,useRef,useState,type ReactNode} from 'react';
import {downloadNotifications} from '../pwa/download-notifications';
import {createPortal} from 'react-dom';
import {announceDownloadMessage,CollectionDownloadButton,DownloadDock,openDownloadDock,useAlbumDownloadState} from './DownloadDock';
import {downloadHandoffInProgress,downloadVersionCheckInProgress,downloadWithCurrentApp,pendingDownloadAfterUpdate,subscribeDownloadHandoffs,takeDownloadAfterUpdate} from '../service-worker/download-update';
import {registerUpdateBlocker} from '../service-worker/update-blockers';
import {subscribeLibraryDownloads,subscribeLibraryTrackReviews,releaseUncertainSingleDownload,downloadLibrarySelection,type LibraryDownloadRequest} from '../library/library-download';
import {canAutoResumeLibraryDownload,claimLibraryDownload,stopAutomaticLibraryDownload,clearHeldLibraryDownload,discardLibraryDownloadCheckpoint,readHeldLibraryDownload,readLibraryDownloadCheckpoint,writeLibraryDownloadCheckpoint,pendingLibraryTrack,releaseLibraryTrack,sameHeldDownload,writeHeldLibraryDownload,type HeldDownload,type LibraryDownloadCheckpoint} from '../library/library-download-checkpoint';
import {inspectLibraryTrackDownload} from '../library/library-download-recovery';
import {albumCoordinator,notifyAlbumDownload,runAlbumDownload} from '../library/album-download';
import {albumDownloadKey,libraryDownloadKey,createCollectionDownloadQueue,collectionQueueStorageKey,type CollectionDownloadJob,type CollectionDownloadOutcome} from '../library/collection-download-queue';
import {readSavedAlbum,type SavedAlbum,type SavedAlbumFailures,type SaveAlbumResult} from '../library/saved-albums';
import type {AlbumDetail} from '../library/album-catalog';
import {orderedProviders} from '../library/ordered-bot-acquisition';
import type {BotsSnapshot,TelegramSessionClient} from '../telegram/session-client';
import type {Track} from '../library/library';
import type {SongManagement,SongPlaybackAttempt} from '../library/selected-song';

export interface CollectionDownloadAction {
 target:HTMLElement|null;
 id?:string;
 request:Pick<LibraryDownloadRequest,'trackIds'|'title'>;
 label:string;
 complete:boolean;
 disabled:boolean;
}

export function LibraryDownloadController(props:{libraryPending?:boolean;libraryLoaded:boolean;captureAlbum?:()=>SongPlaybackAttempt|null;saveAlbum?:(detail:AlbumDetail,current:()=>boolean,failure:SavedAlbumFailures)=>Promise<SaveAlbumResult>;captureAlbumManagement?:(id:string)=>SongManagement|null;captureOwner?:()=>()=>boolean;storageReady?:()=>boolean;updateWait?:'checking'|'updating'|null;onStopUpdate?:()=>void;collection?:CollectionDownloadAction;storageTarget?:HTMLElement|null;accountId?:string;captureLifetime?:()=>()=>boolean;onReviewStorage?:()=>void;onReviewed?:(operationId?:string)=>void;tracks:readonly Track[];client:TelegramSessionClient|null;bots:BotsSnapshot|null;connected:boolean;connectionPhase?:'initializing'|'connected'|'disconnected'|'blocked';capture?:()=>SongPlaybackAttempt|null;capturePlay?:()=>SongPlaybackAttempt|null;captureBatch?:(recoverPending?:boolean)=>SongPlaybackAttempt|null}){
 const download=useAlbumDownloadState();
 const latest=useRef(props);latest.current=props;
 const flight=useRef<AbortController|null>(null);
 const admission=useRef<{account?:string;id?:string}|null>(null);
 const autoArmed=useRef(true),pageLive=useRef(true),cleanedOrphan=useRef(false);
 const [retaking,setRetaking]=useState(false);
 const [,wake]=useState(0);
 const dispatch=useRef<{account:string;key:string;cancelled:boolean}|null>(null);
 const pausedHead=useRef<{id:string;untilReady:boolean}|null>(null);
 const clearPausedHead=()=>{if(pausedHead.current){pausedHead.current=null;wake(value=>value+1);}};
 const ownedNotice=useRef<typeof albumCoordinator.notice>(undefined);
 const [notice,setNoticeMessage]=useState<{text:string}|null>(null);
 const setNotice=(text:string)=>setNoticeMessage(text?{text}:null);
 const [pendingState,setPendingState]=useState<{account?:string;checkpoint:LibraryDownloadCheckpoint|null}|null>(null);
 const pending=pendingState?.account===props.accountId?pendingState?.checkpoint??null:null;
 const setPending=(checkpoint:LibraryDownloadCheckpoint|null)=>setPendingState({account:latest.current.accountId,checkpoint});
 const [review,setReview]=useState<{trackId:string;title:string;state:'checking'|'saved'|'missing'|'uncertain';kind?:HeldDownload['kind'];canPreserveRetry?:boolean;settled?:boolean}|null>(null);
 const checking=useRef<AbortController|null>(null);

 async function checkVersion(
  account:Parameters<typeof downloadWithCurrentApp>[0],
  action:Parameters<typeof downloadWithCurrentApp>[1],
  current:()=>boolean,
 ):Promise<boolean|'busy'>{
  if(downloadVersionCheckInProgress())return 'busy';
  return downloadWithCurrentApp(account,action,current);
 }
 const waiting=useRef<{request:LibraryDownloadRequest;restore?:LibraryDownloadCheckpoint;saveOnly:boolean;account:string|undefined}|null>(null);

 const hasControl=()=>latest.current.captureOwner?.()()??latest.current.captureLifetime?.()()??true;
 function publishQueue(account=latest.current.accountId){
  const jobs=account?createCollectionDownloadQueue(localStorage,account).read():[];
  albumCoordinator.queueAccount=account;
  albumCoordinator.queued=jobs;
  notifyAlbumDownload(albumCoordinator);
  return jobs;
 }
 function removeQueued(key:string,account=latest.current.accountId,expectedId?:string){
  if(!account||latest.current.accountId!==account||!hasControl())return;
  try{createCollectionDownloadQueue(localStorage,account).remove(key,expectedId);publishQueue(account);return true;}
  catch{setNotice('No se pudo actualizar la cola de descargas.');}
 }
 function removeCollection(key:string){
  const account=latest.current.accountId;
  if(!account||!hasControl()||albumCoordinator.active?.accountId===account&&albumCoordinator.active.collectionKey===key)return;
  try{
   const checkpoint=readLibraryDownloadCheckpoint(account);
   if(checkpoint?.collectionKey===key&&discardLibraryDownloadCheckpoint(account,checkpoint))setPending(null);
   removeQueued(key,account);
  }catch{setNotice('No se pudo descartar el progreso de la descarga.');}
 }
 function enqueue(job:CollectionDownloadJob){
  const account=latest.current.accountId;
  if(!account||!hasControl()){setNotice('Usa Pulso en esta pestaña para descargar.');return;}
  if(latest.current.storageReady?.()===false){
   setNotice('Reintenta la apertura de Almacenamiento antes de continuar la descarga.');return;
  }
  if(albumCoordinator.active?.collectionKey===job.key)return;
  try{
   if(readLibraryDownloadCheckpoint(account)?.collectionKey===job.key){openDownloadDock();return;}
   createCollectionDownloadQueue(localStorage,account).add(job);
   const queued=publishQueue(account).filter(item=>item.key!==albumCoordinator.active?.collectionKey);
   const position=queued.findIndex(item=>item.key===job.key)+1;
   if(albumCoordinator.running||albumCoordinator.songFlight||pending||position>1)announceDownloadMessage(`En cola · posición ${position}`);
   const p=latest.current;
   if(navigator.onLine===false)setNotice('Sin conexión. La descarga queda en cola hasta que vuelva la red.');
   else if(p.connectionPhase==='initializing')setNotice('Esperando a que Telegram termine de preparar tus bots…');
   else if(!p.client||!p.connected)setNotice('Conecta Telegram para continuar las descargas en cola.');
   else if(!orderedProviders(p.bots).length)setNotice('Configura un bot de música para continuar las descargas en cola.');
  }catch{setNotice('No se pudo guardar la descarga en la cola. Comprueba el espacio disponible.');}
 }
 const queueCallbacks=useRef({enqueue,removeCollection});queueCallbacks.current={enqueue,removeCollection};
 useEffect(()=>{
  albumCoordinator.requestAlbum=(album:SavedAlbum,fromLibrary?:boolean)=>queueCallbacks.current.enqueue({
   kind:'album',id:crypto.randomUUID(),key:albumDownloadKey(album.edition.id),title:album.edition.title,album,...(fromLibrary?{fromLibrary:true as const}:{}),
  });
  albumCoordinator.removeQueued=key=>queueCallbacks.current.removeCollection(key);
  return()=>{delete albumCoordinator.requestAlbum;delete albumCoordinator.removeQueued;delete albumCoordinator.queued;delete albumCoordinator.queueAccount;};
 },[]);

 async function reviewTrack(trackId:string,title:string,retry:'no'|'safe'|'preserve'='no'){
  const p=latest.current,account=p.accountId,guard=p.captureLifetime?.();
  if(!account||!pageLive.current||guard&&!guard()||checking.current||admission.current||flight.current||
   albumCoordinator.running||albumCoordinator.dispatching||albumCoordinator.songFlight)return;
  const abort=new AbortController();checking.current=abort;
  const current=()=>checking.current===abort&&!abort.signal.aborted&&pageLive.current&&latest.current.accountId===account&&
   !flight.current&&!albumCoordinator.running&&!albumCoordinator.dispatching&&!albumCoordinator.songFlight&&(guard?.()??true);
  try{
   if(retry!=='no'&&await checkVersion(account,{kind:'repair',trackId,title,retry},current)!==true)return;
   setReview({trackId,title,state:'checking'});
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
  finally{if(checking.current===abort){checking.current=null;wake(value=>value+1);}}
 }
 const reviewRef=useRef(reviewTrack);reviewRef.current=reviewTrack;

 const accessMessage=()=>{
  const p=latest.current;
  if(p.captureOwner?.()()===false)return 'Usa Pulso en esta pestaña para continuar la descarga.';
  if(p.storageReady?.()===false)return 'Reintenta la apertura de Almacenamiento antes de continuar la descarga.';
  return p.connectionPhase==='blocked'?'El control de la pestaña o el acceso a Almacenamiento todavía impide continuar. El progreso se conserva.':null;
 };
 async function startChecked(request:LibraryDownloadRequest,restore?:LibraryDownloadCheckpoint,automatic=false){
  if(admission.current||checking.current||albumCoordinator.dispatching||albumCoordinator.songFlight)return;
  const blocked=accessMessage();
  if(blocked){if(!automatic)setNotice(blocked);return;}
  const p=latest.current,guard=p.captureLifetime?.(),account=p.accountId;
  const check={account,id:restore?.id};
  const current=()=>admission.current===check&&pageLive.current&&latest.current.accountId===account&&!albumCoordinator.songFlight&&
   (p.connectionPhase==='initializing'||(guard?.()??true));
  admission.current=check;
  if(automatic)setRetaking(true);
  try{
   if(await checkVersion(account,{kind:'library',request,checkpointId:restore?.id,...(automatic?{automatic:true}:{})},current)===true)
    return start(request,restore,undefined,automatic,automatic);
   else if(!automatic&&admission.current===check&&latest.current.accountId===account)
    setNotice(accessMessage()??`No se pudo iniciar «${request.title}».`);
  }finally{
   if(admission.current===check){admission.current=null;setRetaking(false);wake(value=>value+1);}
  }
 }
 async function start(request:LibraryDownloadRequest,restore?:LibraryDownloadCheckpoint,reviewed?:HeldDownload|null,saveOnly=false,automatic=false,queued=false):Promise<CollectionDownloadOutcome>{
  const p=latest.current;
  if(automatic&&p.accountId&&(downloadHandoffInProgress(p.accountId)||pendingDownloadAfterUpdate(p.accountId)))return 'deferred';
  if(flight.current||albumCoordinator.running||albumCoordinator.songFlight||albumCoordinator.dispatching&&!queued){
   if(automatic)autoArmed.current=true;else setNotice('Hay otra descarga en curso.');
   return 'deferred';
  }
  const blocked=accessMessage();
  if(blocked){if(!automatic)setNotice(blocked);return 'deferred';}
  const providers=orderedProviders(p.bots);
  const phase=p.connectionPhase??(p.connected?'connected':'disconnected');
  if(phase==='initializing'){
   if(automatic){autoArmed.current=true;return 'deferred';}
   if(!request.repair)waiting.current={request,restore,saveOnly,account:p.accountId};
   setNotice('Esperando a que Telegram termine de preparar tus bots…');return 'deferred';
  }
  if(!p.client||!p.connected||phase!=='connected'){setNotice('Conecta Telegram y configura un bot para descargar en este dispositivo.');return 'deferred';}
  if(!p.bots||!providers.length){setNotice('Telegram está conectado. Configura un bot de música compatible.');return 'deferred';}
  const attempt=(request.play?(saveOnly?p.capture:p.capturePlay):p.captureBatch??p.capture)?.(!!restore);
  if(!attempt?.current()){
   if(automatic)autoArmed.current=true;
   else setNotice('Biblioteca está ocupada. Revisa Almacenamiento si hay una copia pendiente y vuelve a continuar.');
   return 'deferred';
  }
  const index=new Map(p.tracks.map(t=>[t.id,t]));
  const tracks=request.trackIds.map(id=>index.get(id)).filter((t):t is Track=>!!t);
  if(tracks.length!==request.trackIds.length){setNotice('La selección cambió. Vuelve a elegirla.');return 'deferred';}
  let checkpoint=restore;
  const account=p.accountId;
  try{
   if(request.repair&&account){
    const trackId=request.trackIds[0],search=p.client.searchSnapshot();
    if(search.pending||search.cancelling||search.retryBlocked||search.retryAt!==null&&search.retryAt>Date.now()){
     setNotice('Telegram todavía está resolviendo una operación. Espera antes de reintentar.');return 'deferred';
    }
    if(search.error==='uncertain'){
     const allowed=p.client.captureSearchActionCurrent();
     if(!allowed()){setNotice('Vuelve a conectar Telegram antes de reintentar esta canción.');return 'deferred';}
     p.client.clearSearch(allowed);
    }
    if(reviewed===undefined||!releaseLibraryTrack(account,trackId,reviewed)||pendingLibraryTrack(account,trackId)){
     setNotice('El estado de la pista cambió. Vuelve a revisarla.');return 'deferred';
    }
    releaseUncertainSingleDownload(trackId);
    checkpoint={id:request.id,trackIds:[trackId],cursor:0,pending:null};
   }else if(!request.play&&account){
    const previous=readLibraryDownloadCheckpoint(account);
    if(!checkpoint&&previous){
     setPending(previous);setNotice('Hay una descarga pendiente. Puedes continuar desde su última pista confirmada.');return 'deferred';
    }
    const job=createCollectionDownloadQueue(localStorage,account).read().find(item=>item.kind==='library'&&item.request.id===(restore?.queueId??request.id));
    const claimed=claimLibraryDownload(account,request.title,request.trackIds,restore?.id,automatic,job?{key:job.key,id:restore?.queueId??request.id}:undefined);
    if(!claimed){setPending(previous);setNotice('La descarga cambió en esta pestaña.');return 'deferred';}
    checkpoint=claimed;
   }
   if(request.play&&account){
    if(pendingLibraryTrack(account,request.trackIds[0])){
     void reviewRef.current(tracks[0].id,tracks[0].title);return 'deferred';
    }
    checkpoint={id:request.id,trackIds:[...request.trackIds],cursor:0,pending:null};
   }
  }catch(error){if(queued)throw error;setNotice('No se pudo conservar el progreso de la descarga. Comprueba el almacenamiento del navegador.');return 'deferred';}
  const collection=!request.repair&&!request.play;
  const owns=p.captureOwner?.()??p.captureLifetime?.();
  const ownerCurrent=()=>latest.current.accountId===account&&(owns?.()??true);
  const manualPause=()=>{
   if(collection&&account&&checkpoint&&ownerCurrent())try{stopAutomaticLibraryDownload(account,checkpoint.id);}
   catch{setNotice('No se pudo conservar el progreso de la descarga.');}
  };
  const abort=new AbortController();
  autoArmed.current=false;
  flight.current=abort;setPending(null);setNotice('');setReview(null);albumCoordinator.running=true;
  let discardCheckpoint=false;
  const run={scope:'library',accountId:account,editionId:0,key:request.id,title:request.title,abort,collectionKey:checkpoint?.collectionKey,stop:(discard=false)=>{discardCheckpoint||=discard;manualPause();abort.abort();}};
  albumCoordinator.active=run;
  ownedNotice.current={title:request.title,titles:tracks.map(track=>track.title),progress:{
   message:'Comprobando las copias de esta selección…',
   rows:tracks.map(()=>({state:'unattempted',trackId:null,confirmed:false,message:''})),
  }};
  albumCoordinator.notice=ownedNotice.current;
  notifyAlbumDownload(albumCoordinator);
  const current=()=>flight.current===abort&&latest.current.accountId===account&&attempt.current();
  const noticeCurrent=()=>ownerCurrent()&&!abort.signal.aborted;
  const dismiss=()=>downloadNotifications.dismiss('collection',run,ownerCurrent);
  if(collection)abort.signal.addEventListener('abort',dismiss,{once:true});
  let pauseMessage:string|undefined;
  let readyId:string|null=null,finished=false,preserveHeld=false,confirmed=0,wasWaiting=false;
  const summary=()=>`${confirmed} de ${tracks.length} guardadas`;
  const notify=(body:string,pause=false)=>downloadNotifications.notify('collection',run,run.title,body,false,noticeCurrent,pause,account);
  return downloadLibrarySelection({tracks,attempt,client:p.client,providers,revision:p.bots.revision,signal:abort.signal,current,onManualPause:manualPause,
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
    if(collection&&!abort.signal.aborted)notify(waiting?`${summary()} · ${message}`:summary(),enteringWait);
    ownedNotice.current={title:request.title,titles:tracks.map(t=>t.title),progress:{rows,message,waiting}};
    albumCoordinator.notice=ownedNotice.current;
    notifyAlbumDownload(albumCoordinator);
   },
  }).then(async outcome=>{
   finished=outcome==='finished';
   if(collection&&noticeCurrent()){
    if(outcome==='stopped')manualPause();
    if(!finished&&account&&checkpoint){
     pauseMessage=outcome==='paused'?ownedNotice.current?.progress.message:
      accessMessage()??'La descarga se interrumpió. Revisa Telegram o Almacenamiento y pulsa Continuar.';
     try{
      const stored=readLibraryDownloadCheckpoint(account);
      if(stored?.id===checkpoint.id)writeLibraryDownloadCheckpoint(account,{...stored,pauseMessage});
     }catch{/* The dock still has the reason if localStorage is unavailable. */}
    }
    downloadNotifications.collectionOutcome(run,run.title,finished?'finished':'paused',
     finished?confirmed:Math.max(confirmed,checkpoint?.saved??0),tracks.length,noticeCurrent,account);
   }
   if(request.play&&!saveOnly&&readyId&&current()&&!abort.signal.aborted){
    const result=await attempt.play(readyId,()=>current()&&!abort.signal.aborted,abort.signal);
    if(result==='gesture-required')setNotice('Copia guardada. Pulsa Reproducir para escucharla.');
   }
   return discardCheckpoint?'cancelled-by-user':finished?'completed':'interrupted';
  }).catch(():CollectionDownloadOutcome=>{if(current())setNotice('No se pudo iniciar la reproducción.');return 'interrupted';}).finally(()=>{
   if(collection&&checkpoint&&account&&(finished&&current()||discardCheckpoint&&ownerCurrent()))try{
    const stored=readLibraryDownloadCheckpoint(account);
    if(stored?.id===checkpoint.id){
     if(checkpoint.collectionKey&&checkpoint.queueId&&!removeQueued(checkpoint.collectionKey,account,checkpoint.queueId))throw Error('Queue settlement failed');
     if(discardCheckpoint)discardLibraryDownloadCheckpoint(account,stored);
     else writeLibraryDownloadCheckpoint(account,null);
    }
   }catch{setNotice('No se pudo conservar el progreso de la descarga.');}
   if(flight.current===abort){
    flight.current=null;
    if(account&&latest.current.accountId===account)try{
     const stored=readLibraryDownloadCheckpoint(account);
     if(checkpoint?.queueId&&stored?.id===checkpoint.id&&canAutoResumeLibraryDownload(stored))autoArmed.current=true;
     setPending(stored&&stored.id===checkpoint?.id&&pauseMessage?{...stored,pauseMessage}:stored);
    }catch{
     if(checkpoint&&pauseMessage)setPending({...checkpoint,pauseMessage});
     setNotice('No se pudo leer el progreso guardado de la descarga.');
    }
   }
   if(albumCoordinator.active===run){albumCoordinator.running=false;albumCoordinator.active=undefined;notifyAlbumDownload(albumCoordinator);}
  });
 }
 const startRef=useRef(startChecked);startRef.current=startChecked;
 useEffect(()=>{
  const queued=waiting.current;
  if(!queued||queued.account!==props.accountId||props.connectionPhase==='initializing'||download.dispatching||download.songFlight)return;
  waiting.current=null;
  if(queued.saveOnly)start(queued.request,queued.restore,undefined,true);
  else void startRef.current(queued.request,queued.restore);
 },[props.accountId,props.connectionPhase,props.bots,props.connected,download.dispatching,download.songFlight]);
 useEffect(()=>registerUpdateBlocker(()=>flight.current!==null||waiting.current!==null),[]);
 useEffect(()=>{
  pageLive.current=true;
  const unsubscribe=subscribeLibraryDownloads(request=>void startRef.current(request));
  const unsubscribeReview=subscribeLibraryTrackReviews((id,title)=>void reviewRef.current(id,title));
  const suspend=()=>{
   pageLive.current=false;admission.current=null;waiting.current=null;
   flight.current?.abort();checking.current?.abort();
   if(albumCoordinator.active?.accountId===latest.current.accountId)albumCoordinator.active?.abort.abort();
  };
  const networkChanged=()=>wake(value=>value+1);
  const foreground=()=>{
   if(document.visibilityState==='hidden'){networkChanged();return;}
   if(pausedHead.current?.untilReady)pausedHead.current=null;
   autoArmed.current=true;networkChanged();
  };
  const restored=(event:PageTransitionEvent)=>{if(event.persisted){pageLive.current=true;foreground();}};
  document.addEventListener('visibilitychange',foreground);
  addEventListener('online',foreground);
  addEventListener('offline',networkChanged);
  addEventListener('pageshow',restored);
  addEventListener('pagehide',suspend);
  const changed=(event:StorageEvent)=>{
   const account=latest.current.accountId;
   if(account&&(event.key===null||event.key===collectionQueueStorageKey(account)))try{publishQueue(account);}catch{setNotice('No se pudo leer la cola de descargas.');}
   if(account&&!flight.current&&(event.key===null||event.key==='pulso:library-download:v1:'+account))
    try{setPending(readLibraryDownloadCheckpoint(account));}catch{setNotice('No se pudo leer el progreso guardado de la descarga.');}
  };
  addEventListener('storage',changed);
  return()=>{
   pageLive.current=false;
   unsubscribe();unsubscribeReview();removeEventListener('pagehide',suspend);removeEventListener('pageshow',restored);
   removeEventListener('online',foreground);removeEventListener('offline',networkChanged);document.removeEventListener('visibilitychange',foreground);removeEventListener('storage',changed);
  };
 },[]);
 useEffect(()=>{
  autoArmed.current=true;cleanedOrphan.current=false;pausedHead.current=null;setRetaking(false);
  waiting.current=null;setNotice('');setPending(null);setReview(null);
  try{publishQueue(props.accountId);}catch{albumCoordinator.queued=[];notifyAlbumDownload(albumCoordinator);setNotice('No se pudo leer la cola de descargas.');}
  if(props.accountId)try{setPending(readLibraryDownloadCheckpoint(props.accountId));}catch{setNotice('No se pudo leer el progreso guardado de la descarga.');}
  return()=>{
   if(downloadVersionCheckInProgress())latest.current.onStopUpdate?.();
   admission.current=null;checking.current?.abort();checking.current=null;
   const active=flight.current;flight.current=null;active?.abort();
   if(albumCoordinator.active?.accountId===props.accountId)albumCoordinator.active?.abort.abort();
   if(ownedNotice.current&&albumCoordinator.notice===ownedNotice.current){albumCoordinator.notice=undefined;notifyAlbumDownload(albumCoordinator);}
  };
 },[props.accountId]);
 useEffect(()=>{
  const account=props.accountId;
  const owns=props.captureOwner?.()??props.captureLifetime?.();
  if(!account||!pageLive.current||owns&&!owns())return;
  // A removed track can invalidate a checkpoint as well as a queued job.
  // Wait for this account's first library snapshot before drawing that conclusion.
  if(pending&&download.queueAccount===account&&download.queued?.length&&props.libraryLoaded&&!props.libraryPending&&
   !flight.current&&!admission.current&&!albumCoordinator.running&&!tracksLoaded(pending,props.tracks)){
   try{
    const checkpoint=readLibraryDownloadCheckpoint(account);
    if(checkpoint&&!tracksLoaded(checkpoint,props.tracks)&&discardLibraryDownloadCheckpoint(account,checkpoint)){
     if(checkpoint.collectionKey&&checkpoint.queueId)removeQueued(checkpoint.collectionKey,account,checkpoint.queueId);
     const intent=pendingDownloadAfterUpdate(account);
     if(intent?.kind==='library'&&intent.checkpointId===checkpoint.id)takeDownloadAfterUpdate(account,'library');
     setPending(null);
     setNotice(`«${checkpoint.title??'Selección de Biblioteca'}» salió de la cola porque algunas pistas ya no están en Biblioteca.`);
    }
   }catch{
    const text='No se pudo descartar el progreso de la descarga.';
    setNoticeMessage(previous=>previous?.text===text?previous:{text});
    return;
   }
  }
  const pendingUpdate=pendingDownloadAfterUpdate(account),handoff=downloadHandoffInProgress(account);
  if(pendingUpdate||handoff)autoArmed.current=false;
  if(!cleanedOrphan.current){
   cleanedOrphan.current=true;
   downloadNotifications.clearProgress('collection',account,()=>latest.current.accountId===account&&(owns?.()??true));
  }
  if(handoff||props.connectionPhase!=='connected'||!props.connected||!props.client||!orderedProviders(props.bots).length||!props.tracks.length||
   props.storageReady?.()===false||props.captureLifetime&&!props.captureLifetime()())return;
  if(albumCoordinator.dispatching||albumCoordinator.songFlight)return;
  if(pendingUpdate?.kind==='library'){
   if(!pendingUpdate.checkpointId&&download.queueAccount===account&&download.queued?.some(job=>job.id===pendingUpdate.request.id))return;
   if(admission.current||flight.current||albumCoordinator.running)return;
   const {request,checkpointId}=pendingUpdate;
   // Telegram can be ready before the previous playback queue and library
   // finish restoring. Keep the handoff until the usual capture can admit it.
   const capture=request.play?props.capture:props.captureBatch??props.capture;
   if(!capture?.(!!checkpointId)?.current()||!tracksLoaded(request,props.tracks))return;
   const intent=takeDownloadAfterUpdate(account,'library');
   if(!intent)return;
   try{
    const checkpoint=checkpointId?readLibraryDownloadCheckpoint(account):undefined;
    if(checkpointId&&checkpoint?.id!==checkpointId){setNotice('La descarga guardada cambió.');return;}
    // The gesture already checked the pointer. Only the verified destination
    // bundle can take the handoff, so admit it now with the restored scope.
    start(request,checkpoint??undefined,undefined,true,intent.automatic);
   }catch{setNotice('No se pudo leer el progreso guardado de la descarga.');}
  }
  if(pendingUpdate){
   if(pendingUpdate.kind==='repair'&&(checking.current||admission.current||flight.current||albumCoordinator.running||downloadVersionCheckInProgress()))return;
   const repair=takeDownloadAfterUpdate(account,'repair');
   if(repair)void reviewRef.current(repair.trackId,repair.title,repair.retry);
   return;
  }
  if(downloadVersionCheckInProgress()||!telegramReady(props.client)||!autoArmed.current||!pending||!canAutoResumeLibraryDownload(pending)||!owns?.()||admission.current||
   flight.current||albumCoordinator.running||checking.current||waiting.current||document.visibilityState==='hidden'||navigator.onLine===false||
   !(props.captureBatch??props.capture)?.(true)?.current())return;
  if(!tracksLoaded(pending,props.tracks))return;
  autoArmed.current=false;
  void startRef.current(resumeRequest(pending),pending,true);
 });
 function tracksLoaded(request:Pick<LibraryDownloadRequest,'trackIds'>,tracks:readonly Track[]){
  const trackIds=new Set(tracks.map(track=>track.id));
  return request.trackIds.every(id=>trackIds.has(id));
 }
 const retryAt=props.client?.searchSnapshot().retryAt;
 // The cooldown belongs to Telegram, including while another job owns the dispatch.
 useEffect(()=>{
  if(!retryAt)return;
  let timer:ReturnType<typeof setTimeout>;
  const expire=()=>{
   const remaining=retryAt-Date.now();
   if(remaining>0)timer=setTimeout(expire,Math.min(2_147_483_647,remaining+1));
   else wake(value=>value+1);
  };
  expire();
  return()=>clearTimeout(timer);
 },[retryAt]);
 useEffect(()=>props.client?.subscribeSearch(()=>wake(value=>value+1)),[props.client]);
 useEffect(()=>subscribeDownloadHandoffs(()=>wake(value=>value+1)),[]);
 function telegramReady(client:TelegramSessionClient|null){
  const search=client?.searchSnapshot();
  return !!search?.available&&!search.pending&&!search.cancelling&&!search.retryBlocked&&
   (search.retryAt===null||search.retryAt<=Date.now());
 }
 useEffect(()=>{
  const account=props.accountId;
  if(!account||albumCoordinator.dispatching||downloadVersionCheckInProgress()||!hasControl())return;
  const queue=createCollectionDownloadQueue(localStorage,account);
  const job=download.queueAccount===account?download.queued?.[0]:undefined;
  if(!job)return;
  if(pausedHead.current?.id!==job.id)clearPausedHead();
  const ownerCurrent=props.captureOwner?.()??props.captureLifetime?.();
  const sameOwner=()=>pageLive.current&&latest.current.accountId===account&&(ownerCurrent?.()??true);
  const token={account,key:job.key,cancelled:false};
  const matchesIntent=(intent:ReturnType<typeof pendingDownloadAfterUpdate>)=>
   job.kind==='album'&&intent?.kind==='album'&&job.album.edition.id===intent.editionId||
   job.kind==='library'&&intent?.kind==='library'&&!intent.checkpointId&&job.id===intent.request.id;
  // Use live authority and the persisted head/checkpoint at each async boundary.
  // This token may pass its own dispatch reservation but never another's.
  const ready=()=>{
   const p=latest.current;
   const intent=pendingDownloadAfterUpdate(account);
   if(token.cancelled||!sameOwner()||!hasControl()||document.visibilityState==='hidden'||navigator.onLine===false||
    albumCoordinator.running||albumCoordinator.songFlight||flight.current||checking.current||waiting.current||admission.current||
    albumCoordinator.dispatching&&dispatch.current!==token||downloadHandoffInProgress(account)||
    intent&&!matchesIntent(intent)||
    p.libraryPending||job.kind==='library'&&!p.libraryLoaded||!p.connected||p.connectionPhase!=='connected'||!orderedProviders(p.bots).length||
    p.storageReady?.()===false||!telegramReady(p.client))return false;
   if(readLibraryDownloadCheckpoint(account)||queue.read()[0]?.id!==job.id)return false;
   return !!(job.kind==='album'?p.captureAlbum??p.capture:p.captureBatch??p.capture)?.()?.current();
  };
  const pause=(untilReady=false)=>{
   if(!sameOwner()||pausedHead.current?.id===job.id)return;
   pausedHead.current={id:job.id,untilReady};
   setNotice(`No se pudo continuar «${job.title}». Revisa Telegram o Almacenamiento.`);
  };
  try{
   const paused=pausedHead.current?.id===job.id?pausedHead.current:null;
   if(paused&&!paused.untilReady)return;
   if(!ready()){
    // An interrupted head can resume when it next becomes ready.
    if(paused)clearPausedHead();
    return;
   }
   if(paused)return;
  }catch{pause();return;}

  const intent=pendingDownloadAfterUpdate(account);
  const client=props.client;
  const sessionCurrent=client?.captureBotsCurrent();
  const revision=props.bots?.revision;
  let readinessLost=false;
  const stillReady=()=>{
   try{
    const valid=ready();readinessLost||=!valid;return valid;
   }catch{
    // The updater calls this guard from a timer. Keep its promise settleable.
    pause();return false;
   }
  };
  const run=async():Promise<CollectionDownloadOutcome>=>{
   const action=job.kind==='library'?{kind:'library' as const,request:job.request}:
    {kind:'album' as const,editionId:job.album.edition.id,title:job.album.edition.title,artist:job.album.edition.artist,...(job.fromLibrary?{fromLibrary:true as const}:{})};
   if(!stillReady())return 'deferred';
   if(!intent){
    const allowed=await checkVersion(account,action,stillReady);
    if(!stillReady())return 'deferred';
    if(allowed!==true){readinessLost||=allowed==='busy';return 'deferred';}
   }
   if(job.kind==='library'){
    if(intent&&!takeDownloadAfterUpdate(account,'library')){readinessLost=true;return 'deferred';}
    if(!tracksLoaded(job.request,latest.current.tracks)){
     setNotice(`«${job.title}» salió de la cola porque algunas pistas ya no están en Biblioteca.`);
     return 'completed';
    }
    return start(job.request,undefined,undefined,false,false,true);
   }
   const album=await readSavedAlbum(account,job.album.edition.id);
   if(!stillReady())return 'deferred';
   if(intent&&!takeDownloadAfterUpdate(account,'album')){readinessLost=true;return 'deferred';}
   if(!album)return 'completed';
   const p=latest.current,providers=orderedProviders(p.bots);
   const attempt=(p.captureAlbum??p.capture)?.();
   if(!attempt?.current())return 'deferred';
   return runAlbumDownload({detail:album,saved:album,accountId:account,scope:account,coordinator:albumCoordinator,queued:true,
    attempt,client:p.client,revision:p.bots?.revision,provider:providers[0].providerRef,providers,
    management:id=>latest.current.captureAlbumManagement?.(id)??null,saveAlbum:p.saveAlbum});
  };
  dispatch.current=token;albumCoordinator.dispatching=true;
  notifyAlbumDownload(albumCoordinator);
  const settle=(outcome:CollectionDownloadOutcome)=>{
   const result=token.cancelled?'cancelled-by-user':outcome;
   if(!sameOwner())return;
   if(result==='completed'||result==='cancelled-by-user'){
    if(job.kind==='library'&&readLibraryDownloadCheckpoint(account)?.queueId===job.id)return;
    if(!removeQueued(job.key,account,job.id))pause();
   }else if(result==='deferred'&&!readinessLost&&!pausedHead.current){
    pause();
   }else if(result==='interrupted'&&job.kind==='album'&&latest.current.client===client&&sessionCurrent?.()&&
    latest.current.bots?.revision===revision&&client?.searchSnapshot().retryAt===retryAt){
    pause(true);
   }
  };
  void run().then(settle,()=>{if(token.cancelled)settle('cancelled-by-user');else pause();}).catch(()=>pause()).finally(()=>{
   dispatch.current=null;albumCoordinator.dispatching=false;
   notifyAlbumDownload(albumCoordinator);
  });
 });
 const retryQueued=()=>{
  pausedHead.current=null;setNotice('');wake(value=>value+1);
 };
 const pausedJob=download.queueAccount===props.accountId?download.queued?.find(job=>job.id===pausedHead.current?.id):undefined;
 const collection=props.collection;
 function resumeRequest(checkpoint:LibraryDownloadCheckpoint):LibraryDownloadRequest{
  const selection=collection?.request;
  const same=selection?.trackIds.length===checkpoint.trackIds.length&&checkpoint.trackIds.every((id,i)=>id===selection.trackIds[i]);
  return {id:checkpoint.id,trackIds:checkpoint.trackIds,title:checkpoint.title||(same?selection.title:'Selección de Biblioteca'),play:false};
 }
 const stopUpdate=()=>{
  const queued=dispatch.current;
  if(queued&&queued.account===latest.current.accountId){
   queued.cancelled=true;
   const active=albumCoordinator.active;
   if(active?.accountId===queued.account&&active.collectionKey===queued.key)active.stop?.(true);
  }
  const check=admission.current;
  if(check?.account&&check.id&&latest.current.accountId===check.account&&(props.captureOwner?.()()??props.captureLifetime?.()()??true))
   try{setPending(stopAutomaticLibraryDownload(check.account,check.id));}catch{setNotice('No se pudo conservar el progreso de la descarga.');}
  admission.current=null;setRetaking(false);props.onStopUpdate?.();
 };
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
  <DownloadDock key={props.accountId} accountId={props.accountId} updateWait={props.updateWait} onStopUpdate={stopUpdate} message={notice} onRetryQueued={pausedJob?retryQueued:undefined} review={reviewContent} onReviewStorage={props.onReviewStorage}
   pendingDownload={pending?{saved:pending.saved??0,total:pending.trackIds.length,title:pending.title,reason:pending.pauseMessage,retaking,onContinue:()=>{
    autoArmed.current=false;void startChecked(resumeRequest(pending),pending);
   }}:undefined}/>
  {collection?.target&&(!pending||download.running||collection.id)&&createPortal(<CollectionDownloadButton label={collection.label}
   paused={collection.id!==undefined&&pending?.collectionKey===libraryDownloadKey(collection.id)}
   accountId={props.accountId} collectionKey={collection.id?libraryDownloadKey(collection.id):undefined}
   disabled={!!waiting.current||collection.disabled||!collection.request.trackIds.length}
   complete={collection.complete} onStart={()=>{
    const request:LibraryDownloadRequest={...collection.request,id:crypto.randomUUID(),play:false};
    if(collection.id&&props.accountId)enqueue({kind:'library',id:request.id,key:libraryDownloadKey(collection.id),title:request.title,request});
    else void startRef.current(request);
   }}/>,collection.target)}
  {props.storageTarget&&pending&&!download.running&&createPortal(<button type="button" onClick={()=>{
   if(!props.accountId||flight.current||albumCoordinator.running)return;
   try{
    if(props.captureLifetime&&!props.captureLifetime()()){setNotice('Usa Pulso en esta pestaña para descartar la selección.');return;}
    waiting.current=null;
    if(pending.collectionKey&&pending.queueId&&!removeQueued(pending.collectionKey,props.accountId,pending.queueId))return;
    discardLibraryDownloadCheckpoint(props.accountId,pending);
    setPending(readLibraryDownloadCheckpoint(props.accountId));setNotice('');
   }catch{setNotice('No se pudo descartar el progreso de la selección.');}
  }}>Descartar selección pendiente</button>,props.storageTarget)}
 </>;
}
