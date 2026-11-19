import type {HeldDownload,LibraryDownloadCheckpoint,PendingDownload} from './library-download-checkpoint';
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
export async function downloadLibrarySelection(p:{
 tracks:readonly Track[];attempt:SongPlaybackAttempt;client:TelegramSessionClient;providers:readonly OrderedProvider[];
 revision:number;signal:AbortSignal;current:()=>boolean;update:(rows:AlbumRow[],message:string)=>void;
 checkpoint?:LibraryDownloadCheckpoint;saveCheckpoint?:(checkpoint:LibraryDownloadCheckpoint)=>void;
 heldDownload?:(trackId:string)=>HeldDownload|null;clearHeldDownload?:(trackId:string)=>void;parkNetworkDownload?:(trackId:string)=>void;
}):Promise<'finished'|'stopped'>{
 const rows:AlbumRow[]=p.tracks.map(()=>({state:'unattempted',trackId:null,confirmed:false,message:'En espera'}));
 const live=()=>p.current()&&p.attempt.current()&&!p.signal.aborted;
 const networkCurrent=p.client.captureBotsCurrent(),remoteClock={settledAt:0};
 const update=(message:string)=>p.update(rows.map(row=>({...row})),message);
 let checkpoint=p.checkpoint;
 const start=checkpoint?.cursor??0,resuming=checkpoint?.pending;
 const mark=(cursor:number,pending:PendingDownload|null)=>{
  if(!checkpoint)return;
  checkpoint={...checkpoint,cursor,pending};p.saveCheckpoint?.(checkpoint);
 };
 const ready=async()=>live()&&(!p.attempt.waitForDownload||await p.attempt.waitForDownload(p.signal))&&live();
 const confirm=(row:AlbumRow,id:string,state:'reused'|'downloaded')=>{
  row.state=state;row.trackId=id;row.confirmed=true;
  row.message=state==='reused'?'Ya descargada en este dispositivo.':'Descargada en este dispositivo.';
 };
 const stop=(message:string)=>{update(message);return 'stopped' as const;};
 try{for(let i=0;i<p.tracks.length;i++){
  if(!await ready())return stop('Descarga detenida. Las copias confirmadas se conservan.');
  const track=p.tracks[i],row=rows[i],choice:SongChoice={source:'local',id:'local:'+track.id,
   title:track.manualOverrides.title??track.catalogChoice?.title??track.title,
   artist:'artist' in track.manualOverrides?track.manualOverrides.artist??null:track.catalogChoice?.artist??track.artist,
   album:'album' in track.manualOverrides?track.manualOverrides.album??null:track.catalogChoice?.album??track.album,duration:track.catalogChoice?.duration??track.duration};
  let id=await p.attempt.lookup(choice,p.signal);
  if(!live())return stop('Descarga detenida. Las copias confirmadas se conservan.');
  const heldDownload=p.heldDownload?.(track.id),previous=i===start&&resuming?resuming:heldDownload;
  if(i>=start&&previous?.kind==='save'&&!id){
   mark(i,{kind:'save',index:i,operationId:previous.operationId});
   const receipt=await p.attempt.reconcileDownload?.(previous.operationId,track.id,p.signal);
   if(!live())return stop('Descarga detenida. Las copias confirmadas se conservan.');
   if(!receipt||receipt.state==='uncertain'){
    row.state='uncertain';row.message='Guardado no confirmado. Revisa Almacenamiento y vuelve a continuar.';
    return stop(row.message);
   }
   id=receipt.trackId;
   if(!id&&heldDownload)p.clearHeldDownload?.(track.id);
  }
  if(id){
   if(heldDownload)p.clearHeldDownload?.(track.id);
   uncertainSingleTracks.delete(track.id);
   confirm(row,id,'reused');
   if(i>=start)mark(i+1,null);
   update('Copia local reutilizada.');continue;
  }
  if(i<start||previous?.kind==='network'){
   row.state= i<start?'failed':'uncertain';
   row.message=i<start?'Procesada anteriormente y sin copia disponible.':'Entrega anterior sin confirmar. Se omitió al continuar.';
   if(i>=start){
    if(previous?.kind==='network')p.parkNetworkDownload?.(track.id);
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
  const held={kind:'network' as const,index:i};
  mark(i,held);
  row.message='Buscando canción…';update(row.message);
  const result=await acquireFromOrderedBots({client:p.client,providers:p.providers,revision:p.revision,target,
   signal:p.signal,current:live,networkCurrent,remoteClock,progress:()=>{}});
  if(!live()||result.state==='uncertain'){
   if(!checkpoint)uncertainSingleTracks.add(track.id);
   row.state='uncertain';row.message=checkpoint?'Entrega sin confirmar. Puedes continuar con las demás pistas.':'Entrega sin confirmar; revisa antes de repetir.';return stop(row.message);
  }
  if(result.state==='known-failure'){
   row.state='failed';row.message=acquisitionFailureText(result.reasons);
   if(result.reasons.includes('no-compatible-row'))row.message+=' Corrige la identificación de la canción en las opciones de la playlist o búscala manualmente en Buscar.';mark(i+1,null);update(row.message);continue;
  }
  mark(i,null);
  // The delivered Blob is held only in this page while waiting for a short local operation.
  if(!await ready())return stop('Descarga detenida. Las copias confirmadas se conservan.');
  const operationId=checkpoint?crypto.randomUUID():undefined;
  if(operationId)mark(i,{kind:'save',index:i,operationId});
  row.message='Guardando copia…';update(row.message);
  const saved=await p.attempt.save(result.audio,choice,p.signal,()=>{},operationId);
  if(saved.state==='saved'&&saved.trackId){
   confirm(row,saved.trackId,'downloaded');mark(i+1,null);update(row.message);continue;
  }
  if(saved.state==='failed'){
   if(p.signal.aborted){mark(i,null);return stop('Descarga detenida. Las copias confirmadas se conservan.');}
   row.state='failed';row.message='No se pudo guardar esta copia.';mark(i+1,null);update(row.message);continue;
  }
  if(!checkpoint)uncertainSingleTracks.add(track.id);
  row.state='uncertain';row.message='Guardado no confirmado. Revisa Almacenamiento y vuelve a continuar.';return stop(row.message);
 }
 if(!live())return stop('Descarga detenida. Las copias confirmadas se conservan.');
 update(rows.every(row=>row.confirmed)?'Selección descargada en este dispositivo.':'Descarga parcial: revisa las canciones pendientes.');
 return 'finished';
 }catch{return stop('Descarga interrumpida. Comprueba las copias antes de repetir.');}
}
