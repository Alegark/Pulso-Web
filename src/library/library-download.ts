import {sameHeldDownload,type HeldDownload,type LibraryDownloadCheckpoint,type PendingDownload,type SavedCandidate} from './library-download-checkpoint';
import type {Track} from './library';
import type {AlbumRow} from './album-acquisition';
import type {SongPlaybackAttempt,SongChoice} from './selected-song';
import {acquireFromOrderedBots,acquisitionFailureText,type OrderedProvider} from './ordered-bot-acquisition';
import type {TelegramSessionClient} from '../telegram/session-client';
import {parseBotSearchTarget} from '../telegram/bot-search-protocol';
export interface LibraryDownloadRequest {id:string;trackIds:readonly string[];title:string;play:boolean;repair?:boolean}
const uncertainSingleTracks=new Set<string>();
export function releaseUncertainSingleDownload(trackId:string){uncertainSingleTracks.delete(trackId);}
const repairListeners=new Set<(trackId:string,title:string)=>void>();
export function requestLibraryTrackReview(trackId:string,title:string){for(const listener of repairListeners)listener(trackId,title);}
export function subscribeLibraryTrackReviews(listener:(trackId:string,title:string)=>void){repairListeners.add(listener);return()=>{repairListeners.delete(listener);};}
const listeners=new Set<(request:LibraryDownloadRequest)=>void>();
export function requestLibraryDownload(trackIds:readonly string[],title:string,play=false){if(trackIds.length>5000||!trackIds.length)return;const request={id:crypto.randomUUID(),trackIds:[...new Set(trackIds)],title,play:play&&trackIds.length===1};for(const fn of listeners)fn(request);}
export function subscribeLibraryDownloads(fn:(request:LibraryDownloadRequest)=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
function safeNetworkLane(client:TelegramSessionClient){
 const state=client.searchSnapshot();
 return state.available&&!state.pending&&!state.cancelling&&!state.retryBlocked&&state.error!=='uncertain'&&
  state.delivery!=='uncertain';
}
export async function downloadLibrarySelection(p:{
 tracks:readonly Track[];attempt:SongPlaybackAttempt;client:TelegramSessionClient;providers:readonly OrderedProvider[];
 revision:number;signal:AbortSignal;current:()=>boolean;update:(rows:AlbumRow[],message:string)=>void;
 autoRepair?:boolean; checkpoint?:LibraryDownloadCheckpoint;saveCheckpoint?:(checkpoint:LibraryDownloadCheckpoint)=>void;
 heldDownload?:(trackId:string)=>HeldDownload|null;clearHeldDownload?:(trackId:string,expected:HeldDownload)=>void;parkDownload?:(trackId:string,pending:HeldDownload)=>void;
}):Promise<'finished'|'stopped'>{
 const rows:AlbumRow[]=p.tracks.map(()=>({state:'unattempted',trackId:null,confirmed:false,message:'En espera'}));
 const live=()=>p.current()&&p.attempt.current()&&!p.signal.aborted;
 const networkCurrent=p.client.captureBotsCurrent(),remoteClock={settledAt:0};
 const waitForTelegram=()=>{
  const deadline=Date.now()+60_000;
  return new Promise<boolean>(resolve=>{
   let settled=false,unsubscribe=()=>{};
   let timer:ReturnType<typeof setTimeout>|undefined;
   const finish=(allowed:boolean)=>{
    if(settled)return;settled=true;clearTimeout(timer);unsubscribe();
    p.signal.removeEventListener('abort',abort);resolve(allowed);
   };
   const abort=()=>finish(false);
   const check=()=>{
    clearTimeout(timer);
    if(!live()||!networkCurrent())return finish(false);
    const state=p.client.searchSnapshot(),now=Date.now();
    if(!state.available||state.retryBlocked||state.error==='uncertain'||now>=deadline||state.retryAt!==null&&state.retryAt>=deadline)return finish(false);
    if(!state.pending&&!state.cancelling&&(state.retryAt===null||now>=state.retryAt))return finish(true);
    timer=setTimeout(check,Math.max(1,(state.retryAt&&state.retryAt>now?state.retryAt+1:deadline)-now));
   };
   check();if(settled)return;
   const state=p.client.searchSnapshot();
   update(state.retryAt!==null&&state.retryAt>Date.now()?'Telegram limitó temporalmente las consultas. El lote continuará al finalizar la espera.':
    'Esperando a que Telegram termine la consulta anterior…');
   unsubscribe=p.client.subscribeSearch(check);
   p.signal.addEventListener('abort',abort,{once:true});check();
  });
 };
 const update=(message:string)=>p.update(rows.map(row=>({...row})),message);
 let checkpoint=p.checkpoint;
 const start=checkpoint?.cursor??0,resuming=checkpoint?.pending;
 const mark=(cursor:number,pending:PendingDownload|null)=>{
  if(!checkpoint)return;
  checkpoint={...checkpoint,cursor,pending};p.saveCheckpoint?.(checkpoint);
 };
 const checkReceipt=async(operationId:string,trackId:string,repair=false)=>{
  try{return await p.attempt.reconcileDownload?.(operationId,trackId,p.signal,repair);}
  catch{return {state:'uncertain' as const,trackId:null};}
 };
 const ready=async()=>live()&&(!p.attempt.waitForDownload||await p.attempt.waitForDownload(p.signal))&&live();
 const confirm=(row:AlbumRow,id:string,state:'reused'|'downloaded')=>{
  row.state=state;row.trackId=id;row.confirmed=true;
  row.message=state==='reused'?'Ya descargada en este dispositivo.':'Descargada en este dispositivo.';
 };
 const stop=(message:string)=>{update(message);return 'stopped' as const;};
 try{for(let i=0;i<p.tracks.length;i++){
  if(!live())return stop('Descarga detenida. Las copias confirmadas se conservan.');
  const track=p.tracks[i],row=rows[i],choice:SongChoice={source:'local',id:'local:'+track.id,
   title:track.manualOverrides.title??track.catalogChoice?.title??track.title,
   artist:'artist' in track.manualOverrides?track.manualOverrides.artist??null:track.catalogChoice?.artist??track.artist,
   album:'album' in track.manualOverrides?track.manualOverrides.album??null:track.catalogChoice?.album??track.album,duration:track.catalogChoice?.duration??track.duration};
  if(p.autoRepair&&i<start&&p.attempt.inspectDownload){
   const parked=p.heldDownload?.(track.id),receipt=parked?.kind==='save'?await checkReceipt(parked.operationId,track.id,true):undefined;
   if(receipt&&receipt.state!=='uncertain'&&parked)p.clearHeldDownload?.(track.id,parked);
   const verified=receipt?.state==='saved'?receipt.trackId:await p.attempt.inspectDownload(track.id,p.signal);
   if(!live())return stop('Descarga detenida. Las copias confirmadas se conservan.');
   if(verified===track.id)confirm(row,verified,'reused');
   else{row.state='failed';row.message='Procesada anteriormente y sin copia disponible.';}
   update(row.message);continue;
  }
  const heldDownload=p.heldDownload?.(track.id),previous=i===start&&resuming?resuming:heldDownload;
  const clearPrevious=()=>{
   if(heldDownload&&previous&&sameHeldDownload(heldDownload,previous))p.clearHeldDownload?.(track.id,heldDownload);
  };
  let id:string|null=null;
  let inspected=false;
  if(p.autoRepair&&i>=start&&previous?.kind==='save'){
   inspected=true;
   mark(i,{...previous,index:i});
   const receipt=await checkReceipt(previous.operationId,track.id,true);
   if(!live())return stop('Descarga detenida. Las copias confirmadas se conservan.');
   if(receipt?.state==='saved'&&receipt.trackId===track.id)id=receipt.trackId;
   else if(receipt?.state==='missing')clearPrevious();
   else{
    p.parkDownload?.(track.id,previous);
    row.state='uncertain';row.message='El guardado anterior sigue sin confirmar. Se conserva para revisarlo.';
    mark(i+1,null);update(row.message);continue;
   }
  }
  if(!id){
   if(!await ready())return stop('Descarga detenida. Las copias confirmadas se conservan.');
   try{id=await p.attempt.lookup(choice,p.signal,p.autoRepair);}
   catch(error){
    if(!p.autoRepair||!live())throw error;
    row.state='uncertain';row.message='No se pudo verificar la copia de esta canción.';
    if(previous)p.parkDownload?.(track.id,previous);
    if(i>=start)mark(i+1,null);
    update(row.message);continue;
   }
  }
  if(!live())return stop('Descarga detenida. Las copias confirmadas se conservan.');
  if(!inspected&&i>=start&&previous?.kind==='save'&&!id){
   mark(i,{kind:'save',index:i,operationId:previous.operationId});
   const receipt=await checkReceipt(previous.operationId,track.id);
   if(!live())return stop('Descarga detenida. Las copias confirmadas se conservan.');
   if(!receipt||receipt.state==='uncertain'){
    row.state='uncertain';row.message='Guardado no confirmado. Revisa Almacenamiento y vuelve a continuar.';
    return stop(row.message);
   }
   id=receipt.trackId;
   if(!id)clearPrevious();
  }
  if(id){
   clearPrevious();
   uncertainSingleTracks.delete(track.id);
   confirm(row,id,'reused');
   if(i>=start)mark(i+1,null);
   update('Copia local reutilizada.');continue;
  }
  if(i<start||previous?.kind==='network'){
   row.state= i<start?'failed':'uncertain';
   row.message=i<start?'Procesada anteriormente y sin copia disponible.':'Entrega anterior sin confirmar. Se omitió al continuar.';
   if(i>=start){
    if(previous?.kind==='network')p.parkDownload?.(track.id,previous);
    mark(i+1,null);
   }
   update(row.message);continue;
  }
  if(!checkpoint&&uncertainSingleTracks.has(track.id)){
   row.state='uncertain';row.message='Requiere revisión antes de repetir la entrega.';return stop(row.message);
  }
  const target=track.catalogChoice?.source==='spotify'&&!choice.artist?null:
   parseBotSearchTarget({title:choice.title,artist:choice.artist,album:choice.album,durationSeconds:choice.duration||null});
  if(!target){row.state='failed';row.message='Faltan datos para buscar esta canción. Usa Corregir identificación en las opciones de la playlist o búscala manualmente en Buscar.';mark(i+1,null);update(row.message);continue;}
  let providers=p.providers;
  const attempts:SavedCandidate[]=p.autoRepair&&previous?.kind==='save'?[...(previous.attempts??[])]:[];
  const failedDigests=new Set(attempts.map(attempt=>attempt.digest)),excludedRows=new Set(attempts.map(attempt=>attempt.rowKey));
  if(attempts.length>=2){
   row.state='failed';row.message='No se pudo guardar esta canción tras dos intentos.';
   mark(i+1,null);update(row.message);continue;
  }
  while(true){
   if(p.autoRepair&&!await waitForTelegram())return stop('Telegram no puede iniciar otra consulta ahora. El progreso se conserva.');
   const held={kind:'network' as const,index:i};
   mark(i,held);row.message=failedDigests.size?'Probando otra opción para esta canción…':'Buscando canción…';update(row.message);
   const result=await acquireFromOrderedBots({client:p.client,providers,revision:p.revision,target,
    signal:p.signal,current:live,networkCurrent,remoteClock,excludedDigests:failedDigests,excludedRows:p.autoRepair?excludedRows:undefined,progress:()=>{}});
   if(!live()||result.state==='uncertain'){
    if(!checkpoint)uncertainSingleTracks.add(track.id);
    row.state='uncertain';row.message='Entrega sin confirmar; se conserva para revisar.';
    if(!live()||!p.autoRepair||!safeNetworkLane(p.client))return stop(row.message);
    p.parkDownload?.(track.id,held);mark(i+1,null);update(row.message);break;
   }
   if(result.state==='known-failure'){
    row.state='failed';row.message=acquisitionFailureText(result.reasons);
    if(result.reasons.includes('no-compatible-row'))row.message+=' Corrige la identificación de la canción en las opciones de la playlist o búscala manualmente en Buscar.';
    mark(i+1,null);update(row.message);break;
   }
   let local:Awaited<ReturnType<SongPlaybackAttempt['save']>>;
   let receipt:Awaited<ReturnType<NonNullable<SongPlaybackAttempt['reconcileDownload']>>>|undefined;
   let operationId:string|undefined;
   do{
    if(!await ready())return stop('Descarga detenida. Las copias confirmadas se conservan.');
    operationId=checkpoint?crypto.randomUUID():undefined;
    if(p.autoRepair)attempts.push({digest:result.audio.sha256,rowKey:result.rowKey});
    if(operationId)mark(i,{kind:'save',index:i,operationId,...(attempts.length?{attempts:[...attempts]}:{})});
    row.message='Guardando copia…';update(row.message);
    try{local=await p.attempt.save(result.audio,choice,p.signal,()=>{},operationId);}
    catch(error){
     if(!p.autoRepair)throw error;
     local={state:'uncertain',trackId:null};
    }
    if(!live())return stop('Descarga detenida. Las copias confirmadas se conservan.');
    receipt=p.autoRepair&&operationId&&(local.state!=='saved'||local.trackId!==track.id)?
     await checkReceipt(operationId,track.id,true):undefined;
    if(!live())return stop('Descarga detenida. Las copias confirmadas se conservan.');
   }while(p.autoRepair&&attempts.length<2&&local.retryWrite&&receipt?.state==='missing');
   const confirmed=local.state==='saved'&&(!p.autoRepair||local.trackId===track.id)?local.trackId:receipt?.state==='saved'&&receipt.trackId===track.id?receipt.trackId:null;
   if(confirmed){
    confirm(row,confirmed,'downloaded');mark(i+1,null);update(row.message);break;
   }
   const missing=receipt?receipt.state==='missing':local.state==='failed';
   if(!missing){
    if(!checkpoint)uncertainSingleTracks.add(track.id);
    row.state='uncertain';row.message='Guardado no confirmado. Se conservan sus datos.';
    if(!p.autoRepair||!operationId)return stop(row.message);
    p.parkDownload?.(track.id,{kind:'save',operationId,attempts});mark(i+1,null);update(row.message);break;
   }
   failedDigests.add(result.audio.sha256);excludedRows.add(result.rowKey);
   const used=providers.findIndex(provider=>provider.providerRef===result.providerRef);
   providers=providers.slice(used+(result.hasAlternate?0:1));
   if(p.autoRepair&&attempts.length<2&&providers.length){
    if(!await ready())return stop('No se pudo continuar con el almacenamiento actual.');
    continue;
   }
   row.state='failed';row.message='No se pudo guardar esta canción.';mark(i+1,null);update(row.message);break;
  }

 }
 if(!live())return stop('Descarga detenida. Las copias confirmadas se conservan.');
 update(rows.every(row=>row.confirmed)?'Selección descargada en este dispositivo.':'Descarga parcial: revisa las canciones pendientes.');
 return 'finished';
 }catch{return stop('Descarga interrumpida. Comprueba las copias antes de repetir.');}
}
