import {useEffect,useRef,useState,type ReactNode} from 'react';
import {downloadNotifications} from '../pwa/download-notifications';
import {createPortal} from 'react-dom';
import {CollectionDownloadButton,DownloadDock,useAlbumDownloadState} from './DownloadDock';
import {downloadHandoffInProgress,downloadWithCurrentApp,pendingDownloadAfterUpdate,takeDownloadAfterUpdate} from '../service-worker/download-update';
import {registerUpdateBlocker} from '../service-worker/update-blockers';
import {requestLibraryDownload,subscribeLibraryDownloads,subscribeLibraryTrackReviews,releaseUncertainSingleDownload,downloadLibrarySelection,type LibraryDownloadRequest} from '../library/library-download';
import {canAutoResumeLibraryDownload,claimLibraryDownload,stopAutomaticLibraryDownload,clearHeldLibraryDownload,discardLibraryDownloadCheckpoint,readHeldLibraryDownload,readLibraryDownloadCheckpoint,writeLibraryDownloadCheckpoint,pendingLibraryTrack,releaseLibraryTrack,sameHeldDownload,writeHeldLibraryDownload,type HeldDownload,type LibraryDownloadCheckpoint} from '../library/library-download-checkpoint';
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

export function LibraryDownloadController(props:{captureOwner?:()=>()=>boolean;storageReady?:()=>boolean;updateWait?:'checking'|'updating'|null;onStopUpdate?:()=>void;collection?:CollectionDownloadAction;storageTarget?:HTMLElement|null;accountId?:string;captureLifetime?:()=>()=>boolean;onReviewStorage?:()=>void;onReviewed?:(operationId?:string)=>void;tracks:readonly Track[];client:TelegramSessionClient|null;bots:BotsSnapshot|null;connected:boolean;connectionPhase?:'initializing'|'connected'|'disconnected'|'blocked';capture?:()=>SongPlaybackAttempt|null;capturePlay?:()=>SongPlaybackAttempt|null;captureBatch?:(recoverPending?:boolean)=>SongPlaybackAttempt|null}){
 const download=useAlbumDownloadState();
 const latest=useRef(props);latest.current=props;
 const flight=useRef<AbortController|null>(null);
 const admission=useRef<{account?:string;id?:string}|null>(null);
 const autoArmed=useRef(true),pageLive=useRef(true),cleanedOrphan=useRef(false);
 const [retaking,setRetaking]=useState(false);
 const [,wake]=useState(0);
 const ownedNotice=useRef<typeof albumCoordinator.notice>(undefined);
 const [notice,setNoticeMessage]=useState<{text:string}|null>(null);
 const setNotice=(text:string)=>setNoticeMessage(text?{text}:null);
 const [pendingState,setPendingState]=useState<{account?:string;checkpoint:LibraryDownloadCheckpoint|null}|null>(null);
 const pending=pendingState?.account===props.accountId?pendingState?.checkpoint??null:null;
 const setPending=(checkpoint:LibraryDownloadCheckpoint|null)=>setPendingState({account:latest.current.accountId,checkpoint});
 const [review,setReview]=useState<{trackId:string;title:string;state:'checking'|'saved'|'missing'|'uncertain';kind?:HeldDownload['kind'];canPreserveRetry?:boolean;settled?:boolean}|null>(null);
 const checking=useRef<AbortController|null>(null);
 const waiting=useRef<{request:LibraryDownloadRequest;restore?:LibraryDownloadCheckpoint;saveOnly:boolean;account:string|undefined}|null>(null);

 async function reviewTrack(trackId:string,title:string,retry:'no'|'safe'|'preserve'='no'){
  const p=latest.current,account=p.accountId,guard=p.captureLifetime?.();
  if(!account||guard&&!guard()||flight.current||albumCoordinator.running)return;
  if(retry!=='no'&&!await downloadWithCurrentApp(account,{kind:'repair',trackId,title,retry},
   ()=>latest.current.accountId===account&&!flight.current&&!albumCoordinator.running&&(guard?.()??true)))return;
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

 const accessMessage=()=>{
  const p=latest.current;
  if(p.captureOwner?.()()===false)return 'Usa Pulso en esta pestaña para continuar la descarga.';
  if(p.storageReady?.()===false)return 'Reintenta la apertura de Almacenamiento antes de continuar la descarga.';
  return p.connectionPhase==='blocked'?'El control de la pestaña o el acceso a Almacenamiento todavía impide continuar. El progreso se conserva.':null;
 };
 async function startChecked(request:LibraryDownloadRequest,restore?:LibraryDownloadCheckpoint,automatic=false){
  if(admission.current)return;
  const blocked=accessMessage();
  if(blocked){if(!automatic)setNotice(blocked);return;}
  const p=latest.current,guard=p.captureLifetime?.(),account=p.accountId;
  const check={account,id:restore?.id};
  const current=()=>admission.current===check&&pageLive.current&&latest.current.accountId===account&&
   (p.connectionPhase==='initializing'||(guard?.()??true));
  admission.current=check;
  if(automatic)setRetaking(true);
  try{
   if(await downloadWithCurrentApp(account,{kind:'library',request,checkpointId:restore?.id,...(automatic?{automatic:true}:{})},current))
    start(request,restore,undefined,automatic,automatic);
   else if(!automatic&&admission.current===check&&latest.current.accountId===account){
    const reason=accessMessage();if(reason)setNotice(reason);
   }
  }finally{
   if(admission.current===check){admission.current=null;setRetaking(false);}
  }
 }
 function start(request:LibraryDownloadRequest,restore?:LibraryDownloadCheckpoint,reviewed?:HeldDownload|null,saveOnly=false,automatic=false){
  const p=latest.current;
  if(automatic&&p.accountId&&(downloadHandoffInProgress(p.accountId)||pendingDownloadAfterUpdate(p.accountId)))return;
  if(flight.current||albumCoordinator.running){
   if(automatic)autoArmed.current=true;else setNotice('Hay otra descarga en curso.');
   return;
  }
  const blocked=accessMessage();
  if(blocked){if(!automatic)setNotice(blocked);return;}
  const providers=orderedProviders(p.bots);
  const phase=p.connectionPhase??(p.connected?'connected':'disconnected');
  if(phase==='initializing'){
   if(automatic){autoArmed.current=true;return;}
   if(!request.repair)waiting.current={request,restore,saveOnly,account:p.accountId};
   setNotice('Esperando a que Telegram termine de preparar tus bots…');return;
  }
  if(!p.client||phase!=='connected'){setNotice('Conecta Telegram y configura un bot para descargar en este dispositivo.');return;}
  if(!p.bots||!providers.length){setNotice('Telegram está conectado. Configura un bot de música compatible.');return;}
  const attempt=(request.play?(saveOnly?p.capture:p.capturePlay):p.captureBatch??p.capture)?.(!!restore);
  if(!attempt?.current()){
   if(automatic)autoArmed.current=true;
   else setNotice('Biblioteca está ocupada. Revisa Almacenamiento si hay una copia pendiente y vuelve a continuar.');
   return;
  }
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
    const claimed=claimLibraryDownload(account,request.title,request.trackIds,restore?.id,automatic);
    if(!claimed){setPending(previous);setNotice('La descarga cambió en esta pestaña.');return;}
    checkpoint=claimed;
   }
   if(request.play&&account){
    if(pendingLibraryTrack(account,request.trackIds[0])){
     void reviewRef.current(tracks[0].id,tracks[0].title);return;
    }
    checkpoint={id:request.id,trackIds:[...request.trackIds],cursor:0,pending:null};
   }
  }catch{setNotice('No se pudo conservar el progreso de la descarga. Comprueba el almacenamiento del navegador.');return;}
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
  const run={scope:'library',editionId:0,key:request.id,title:request.title,abort,stop:()=>{manualPause();abort.abort();}};
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
  void downloadLibrarySelection({tracks,attempt,client:p.client,providers,revision:p.bots.revision,signal:abort.signal,current,onManualPause:manualPause,
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
  }).catch(()=>{if(current())setNotice('No se pudo iniciar la reproducción.');}).finally(()=>{
   if(!request.repair&&!request.play&&checkpoint&&account&&finished&&current())try{if(readLibraryDownloadCheckpoint(account)?.id===checkpoint.id)writeLibraryDownloadCheckpoint(account,null);}catch{/* Keep the settled pointer for a safe replay. */ }
   if(flight.current===abort){
    flight.current=null;
    if(account&&latest.current.accountId===account)try{
     const stored=readLibraryDownloadCheckpoint(account);
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
  if(!queued||queued.account!==props.accountId||props.connectionPhase==='initializing')return;
  waiting.current=null;
  if(queued.saveOnly)start(queued.request,queued.restore,undefined,true);
  else void startRef.current(queued.request,queued.restore);
 },[props.accountId,props.connectionPhase,props.bots,props.connected]);
 useEffect(()=>registerUpdateBlocker(()=>flight.current!==null||waiting.current!==null),[]);
 useEffect(()=>{
  const unsubscribe=subscribeLibraryDownloads(request=>void startRef.current(request));
  const unsubscribeReview=subscribeLibraryTrackReviews((id,title)=>void reviewRef.current(id,title));
  const suspend=()=>{
   pageLive.current=false;admission.current=null;waiting.current=null;
   flight.current?.abort();checking.current?.abort();
  };
  const foreground=()=>{
   if(document.visibilityState==='hidden')return;
   autoArmed.current=true;wake(value=>value+1);
  };
  const restored=(event:PageTransitionEvent)=>{if(event.persisted){pageLive.current=true;foreground();}};
  document.addEventListener('visibilitychange',foreground);
  addEventListener('online',foreground);
  addEventListener('pageshow',restored);
  addEventListener('pagehide',suspend);
  const changed=(event:StorageEvent)=>{
   const account=latest.current.accountId;
   if(account&&!flight.current&&(event.key===null||event.key==='pulso:library-download:v1:'+account))
    try{setPending(readLibraryDownloadCheckpoint(account));}catch{setNotice('No se pudo leer el progreso guardado de la descarga.');}
  };
  addEventListener('storage',changed);
  return()=>{
   unsubscribe();unsubscribeReview();removeEventListener('pagehide',suspend);removeEventListener('pageshow',restored);
   removeEventListener('online',foreground);document.removeEventListener('visibilitychange',foreground);removeEventListener('storage',changed);
  };
 },[]);
 useEffect(()=>{
  autoArmed.current=true;cleanedOrphan.current=false;setRetaking(false);
  waiting.current=null;setNotice('');setPending(null);setReview(null);
  if(props.accountId)try{setPending(readLibraryDownloadCheckpoint(props.accountId));}catch{setNotice('No se pudo leer el progreso guardado de la descarga.');}
  return()=>{
   admission.current=null;checking.current?.abort();checking.current=null;
   const active=flight.current;flight.current=null;active?.abort();
   if(ownedNotice.current&&albumCoordinator.notice===ownedNotice.current){albumCoordinator.notice=undefined;notifyAlbumDownload(albumCoordinator);}
  };
 },[props.accountId]);
 useEffect(()=>{
  const account=props.accountId;
  const owns=props.captureOwner?.()??props.captureLifetime?.();
  if(!account||!pageLive.current||owns&&!owns())return;
  const pendingUpdate=pendingDownloadAfterUpdate(account),handoff=downloadHandoffInProgress(account);
  if(pendingUpdate||handoff)autoArmed.current=false;
  if(!cleanedOrphan.current){
   cleanedOrphan.current=true;
   downloadNotifications.clearProgress('collection',account,()=>latest.current.accountId===account&&(owns?.()??true));
  }
  if(handoff||props.connectionPhase!=='connected'||!props.connected||!props.client||!orderedProviders(props.bots).length||!props.tracks.length||
   props.storageReady?.()===false||props.captureLifetime&&!props.captureLifetime()())return;
  if(pendingUpdate?.kind==='library'){
   if(admission.current||flight.current||albumCoordinator.running)return;
   const {request,checkpointId}=pendingUpdate;
   // Telegram can be ready before the previous playback queue and library
   // finish restoring. Keep the handoff until the usual capture can admit it.
   const capture=request.play?props.capture:props.captureBatch??props.capture;
   if(!capture?.(!!checkpointId)?.current())return;
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
   const repair=takeDownloadAfterUpdate(account,'repair');
   if(repair)void reviewRef.current(repair.trackId,repair.title,repair.retry);
   return;
  }
  if(!autoArmed.current||!pending||!canAutoResumeLibraryDownload(pending)||!owns?.()||admission.current||
   flight.current||albumCoordinator.running||checking.current||waiting.current||document.visibilityState==='hidden'||navigator.onLine===false||
   !(props.captureBatch??props.capture)?.(true)?.current())return;
  const trackIds=new Set(props.tracks.map(track=>track.id));
  if(!pending.trackIds.every(id=>trackIds.has(id)))return;
  autoArmed.current=false;
  void startRef.current(resumeRequest(pending),pending,true);
 });
 const collection=props.collection;
 function resumeRequest(checkpoint:LibraryDownloadCheckpoint):LibraryDownloadRequest{
  const selection=collection?.request;
  const same=selection?.trackIds.length===checkpoint.trackIds.length&&checkpoint.trackIds.every((id,i)=>id===selection.trackIds[i]);
  return {id:checkpoint.id,trackIds:checkpoint.trackIds,title:checkpoint.title||(same?selection.title:'Selección de Biblioteca'),play:false};
 }
 const stopUpdate=()=>{
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
  <DownloadDock key={props.accountId} updateWait={props.updateWait} onStopUpdate={stopUpdate} message={notice} review={reviewContent} onReviewStorage={props.onReviewStorage}
   pendingDownload={pending?{saved:pending.saved??0,total:pending.trackIds.length,title:pending.title,reason:pending.pauseMessage,retaking,onContinue:()=>{
    autoArmed.current=false;void startChecked(resumeRequest(pending),pending);
   }}:undefined}/>
  {collection?.target&&(!pending||download.running)&&createPortal(<CollectionDownloadButton label={collection.label}
   disabled={!!waiting.current||collection.disabled||!collection.request.trackIds.length}
   complete={collection.complete} onStart={()=>requestLibraryDownload(collection.request.trackIds,collection.request.title)}/>,collection.target)}
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
