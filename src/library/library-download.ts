import {beginSongAggregate} from '../diagnostics/song-aggregate';
import {collectionTelegramWait} from './collection-telegram-wait';
import {sameHeldDownload,type HeldDownload,type LibraryDownloadCheckpoint,type PendingDownload,type SavedCandidate} from './library-download-checkpoint';
import type {Track} from './library';
import type {AlbumRow} from './album-acquisition';
import type {SongPlaybackAttempt,SongChoice} from './selected-song';
import {orderedProviders,type CollectionBotProgress,type OrderedProvider} from './ordered-bot-acquisition';
import {downloadSong,parkedSong,parkSongDownload,reconcileSongDownload} from './download-song';
import type {TelegramSessionClient} from '../telegram/session-client';
export interface LibraryDownloadRequest {id:string;trackIds:readonly string[];title:string;play:boolean;repair?:boolean}
const uncertainSingleTracks=new Set<string>();
export function releaseUncertainSingleDownload(trackId:string){uncertainSingleTracks.delete(trackId);}
const repairListeners=new Set<(trackId:string,title:string)=>void>();
export function requestLibraryTrackReview(trackId:string,title:string){for(const listener of repairListeners)listener(trackId,title);}
export function subscribeLibraryTrackReviews(listener:(trackId:string,title:string)=>void){repairListeners.add(listener);return()=>{repairListeners.delete(listener);};}
const listeners=new Set<(request:LibraryDownloadRequest)=>void>();
export function requestLibraryDownload(trackIds:readonly string[],title:string,play=false){if(trackIds.length>5000||!trackIds.length)return;const request={id:crypto.randomUUID(),trackIds:[...trackIds],title,play:play&&trackIds.length===1};for(const fn of listeners)fn(request);}
export function subscribeLibraryDownloads(fn:(request:LibraryDownloadRequest)=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
export async function downloadLibrarySelection(p:{
 tracks:readonly Track[];attempt:SongPlaybackAttempt;client:TelegramSessionClient;providers:readonly OrderedProvider[];
 revision:number;signal:AbortSignal;current:()=>boolean;update:(rows:AlbumRow[],message:string,waiting?:boolean)=>void;
 onManualPause?:()=>void;checkpoint?:LibraryDownloadCheckpoint;saveCheckpoint?:(checkpoint:LibraryDownloadCheckpoint)=>void;
 heldDownload?:(trackId:string)=>HeldDownload|null;clearHeldDownload?:(trackId:string,expected:HeldDownload)=>void;parkDownload?:(trackId:string,pending:HeldDownload)=>void;
}):Promise<'finished'|'stopped'|'paused'>{
 const rows:AlbumRow[]=p.tracks.map(()=>({state:'unattempted',trackId:null,confirmed:false,message:'En espera'}));
 const accountCurrent=p.client.captureDownloadAccountCurrent?.();
 const live=()=>accountCurrent?.()!==false&&p.current()&&p.attempt.current()&&!p.signal.aborted;
 const remoteClock={settledAt:0};
 const initialBots=p.client.botsSnapshot?.();
 const providerNames=p.providers.map(provider=>initialBots?.providers?.find(row=>row.providerRef===provider.providerRef)?.username);
 const update=(message:string,waiting=false)=>p.update(rows.map(row=>({...row})),message,waiting);
 const stop=(message='Descarga detenida. Las copias confirmadas se conservan.')=>{update(message);return 'stopped' as const;};
 let checkpoint=p.checkpoint;
 const wait=collectionTelegramWait(p.client,p.signal,live,checkpoint?.telegramRetryAt??0,telegramRetryAt=>{
  if(checkpoint){checkpoint={...checkpoint,telegramRetryAt};p.saveCheckpoint?.(checkpoint);}
 });
 const waitForDownload=p.attempt.waitForDownload?async(signal:AbortSignal)=>{
  do{
   await wait.waitWhileOccupied();
   if(!live())return false;
   if(await p.attempt.waitForDownload!(signal))return true;
  }while(wait.occupied());
  return false;
 }:undefined;
 const storagePause=()=>{p.onManualPause?.();update('No se pudo continuar con el almacenamiento actual. Revisa Almacenamiento y pulsa Continuar.',true);return 'paused' as const;};
 const start=checkpoint?.cursor??0,resuming=checkpoint?.pending;
 const completed=new Map<string,AlbumRow>();
 const attempts=new Map<string,SavedCandidate[]>();
 let confirmed=0;
 const mark=(cursor:number,pending:PendingDownload|null)=>{
  if(!checkpoint)return;
  const saved=confirmed;
  const progressed=saved>(checkpoint.saved??0);
  checkpoint={...checkpoint,cursor,pending,...(checkpoint.autoResume!==undefined&&progressed?{saved,autoAttempts:0}:{})};
  p.saveCheckpoint?.(checkpoint);
 };
 const reconcile=async(trackId:string,receipt:Extract<HeldDownload,{kind:'save'}>)=>{
  const outcome=await reconcileSongDownload(p.attempt,receipt.operationId,trackId,p.signal);
  if(!live())return false;
  if(outcome?.state==='saved'&&outcome.trackId===trackId){
   completed.set(trackId,{state:'reused',trackId,confirmed:true,message:'Ya descargada'});
   uncertainSingleTracks.delete(trackId);
  }else if(outcome?.state==='missing'){
   if(receipt.attempts)attempts.set(trackId,receipt.attempts);
  }else{
   await parkSongDownload(p.attempt,receipt.operationId,p.signal);
   if(!live())return false;
   completed.set(trackId,{...parkedSong,trackId:null,confirmed:false});
   return true;
  }
  const held=p.heldDownload?.(trackId);
  if(held&&sameHeldDownload(held,receipt))p.clearHeldDownload?.(trackId,held);
  return true;
 };
 try{
  // Settle the original receipt before a retry can move the cursor backwards.
  if(!live())return stop();
  const resumedTrack=resuming?.kind==='save'?p.tracks[start]:undefined;
  if(resuming?.kind==='save'&&resumedTrack){
   if(!await reconcile(resumedTrack.id,resuming))return stop();
   if(completed.get(resumedTrack.id)?.reason==='parked'){
    if(!p.parkDownload)return stop();
    p.parkDownload(resumedTrack.id,resuming);
   }
   mark(start,null);
  }
  // A later row can already own a parked receipt from a previous run. Admit
  // those receipts before earlier rows wait for storage or try to write.
  for(const trackId of new Set(p.tracks.map(track=>track.id))){
   if(!live())return stop();
   const held=p.heldDownload?.(trackId);
   if(held?.kind==='save'&&!(trackId===resumedTrack?.id&&sameHeldDownload(held,resuming??null))){
    if(!await reconcile(trackId,held))return stop();
   }
  }
  for(let i=0;i<p.tracks.length;i++){
   if(!live())return stop();
   const track=p.tracks[i],row=rows[i],earlier=completed.get(track.id);
   if(earlier){
    Object.assign(row,earlier);
    if(earlier.confirmed)Object.assign(row,{state:'reused',message:'Ya descargada'});
    if(row.confirmed)confirmed++;
    mark(i+1,null);
    update(row.message);
    continue;
   }
   const choice:SongChoice={source:'local',id:'local:'+track.id,
    title:track.manualOverrides.title??track.catalogChoice?.title??track.title,
    artist:'artist' in track.manualOverrides?track.manualOverrides.artist??null:track.catalogChoice?.artist??track.artist,
    album:'album' in track.manualOverrides?track.manualOverrides.album??null:track.catalogChoice?.album??track.album,
    duration:track.catalogChoice?.duration??track.duration};
   const held=p.heldDownload?.(track.id);
   let id:string|null=null,parked=false;
   try{
    if(i<start&&p.attempt.inspectDownload)id=await p.attempt.inspectDownload(track.id,p.signal);
    if(!id){
     if(!live()||waitForDownload&&!await waitForDownload(p.signal))return stop();
     if(!live())return stop();
     id=await p.attempt.lookup(choice,p.signal,true);
    }
   }catch{parked=true;}
   if(!live())return stop();
   // A network marker precedes the first local write. It can be replayed once
   // the captured Telegram lane is ready, without guessing about a save.
   if(held?.kind==='network')p.clearHeldDownload?.(track.id,held);
   const networkMarker=i===start&&resuming?.kind==='network'?resuming:held?.kind==='network'?held:null;
   let pending:HeldDownload|null=parked?networkMarker:null;
   if(id){
    uncertainSingleTracks.delete(track.id);
    Object.assign(row,{state:'reused',trackId:id,confirmed:true,message:'Ya descargada'});
   }else if(parked||uncertainSingleTracks.has(track.id)){
    Object.assign(row,parkedSong);
   }else{
    const pause=wait.pauseForTrack();
    const collection:CollectionBotProgress={completed:new Set(),reasons:[]};
    let interrupted=false,suspended=false,lastSuspension=-1;
    const status=(message:string,waiting=false)=>{if(row.message!==message){row.message=message;update(message,waiting);}};
    const measurement=beginSongAggregate();
    try{while(live()){
     const pauseReason=await pause(message=>status(message,true),interrupted,suspended,measurement?.values);
     if(!live())return stop();
     if(pauseReason){
      mark(i,{kind:'network',index:i});
      if(!pauseReason.automatic)p.onManualPause?.();
      status(pauseReason.message,true);return 'paused';
     }
     const bots=p.client.botsSnapshot(),captured=p.client.captureBotsCurrent(),generation=wait.generation();
     const sameSession=bots.scopeKey===initialBots?.scopeKey;
     const providers=sameSession?p.providers:orderedProviders(bots);
     const unchanged=sameSession?bots.revision===p.revision:
      providers.every((provider,index)=>bots.providers.find(row=>row.providerRef===provider.providerRef)?.username===providerNames[index]);
     if(!providers.length||providers.length!==p.providers.length||!unchanged){
      p.onManualPause?.();
      status('La selección de bots cambió. Revisa Telegram y pulsa Continuar.',true);return 'paused';
     }
     const audioCurrent=()=>captured()&&p.client.botsSnapshot().revision===bots.revision;
     const crossedSuspension=()=>wait.generation()!==generation&&wait.generation()!==lastSuspension;
     const result=await downloadSong({...p,providers,revision:bots.revision,collection,measurement,choice,trackId:track.id,index:i,current:live,
      networkCurrent:()=>audioCurrent()&&wait.online(),audioCurrent,suspended:crossedSuspension,remoteClock,
      waitForDownload,previousAttempts:attempts.get(track.id),onFailedCandidates:candidates=>attempts.set(track.id,candidates),
      mark:value=>{pending=value;mark(i,value);},message:status,progress:()=>{}});
     if(!live())return stop();
     if(result.state==='stopped')return storagePause();
     if(result.state!=='telegram'&&result.state!=='suspended'){
      Object.assign(row,result);
      if(result.reason==='missing-metadata')row.state='unattempted';
      break;
     }
     interrupted=true;suspended=crossedSuspension();
     if(suspended)lastSuspension=wait.generation();
    }}finally{measurement?.finish();}
    if(!live())return stop();
   }
   if(row.reason==='parked'&&pending){
    if(p.parkDownload)p.parkDownload(track.id,pending);
    else if(checkpoint)return stop();
    else uncertainSingleTracks.add(track.id);
   }
   if(row.confirmed)confirmed++;
   mark(i+1,null);
   completed.set(track.id,row);
   update(row.message);
  }
  if(!live())return stop();
  update(rows.every(row=>row.confirmed)?'Selección descargada en este dispositivo.':'Descarga parcial: revisa las canciones pendientes.');
  return 'finished';
 }catch{return live()?storagePause():stop();}finally{wait.dispose();}
}
