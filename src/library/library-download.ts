import {sameHeldDownload,type HeldDownload,type LibraryDownloadCheckpoint,type PendingDownload,type SavedCandidate} from './library-download-checkpoint';
import type {Track} from './library';
import type {AlbumRow} from './album-acquisition';
import type {SongPlaybackAttempt,SongChoice} from './selected-song';
import type {OrderedProvider} from './ordered-bot-acquisition';
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
 revision:number;signal:AbortSignal;current:()=>boolean;update:(rows:AlbumRow[],message:string)=>void;
 checkpoint?:LibraryDownloadCheckpoint;saveCheckpoint?:(checkpoint:LibraryDownloadCheckpoint)=>void;
 heldDownload?:(trackId:string)=>HeldDownload|null;clearHeldDownload?:(trackId:string,expected:HeldDownload)=>void;parkDownload?:(trackId:string,pending:HeldDownload)=>void;
}):Promise<'finished'|'stopped'>{
 const rows:AlbumRow[]=p.tracks.map(()=>({state:'unattempted',trackId:null,confirmed:false,message:'En espera'}));
 const live=()=>p.current()&&p.attempt.current()&&!p.signal.aborted;
 const networkCurrent=p.client.captureBotsCurrent(),remoteClock={settledAt:0};
 const update=(message:string)=>p.update(rows.map(row=>({...row})),message);
 const stop=(message='Descarga detenida. Las copias confirmadas se conservan.')=>{update(message);return 'stopped' as const;};
 let checkpoint=p.checkpoint;
 const start=checkpoint?.cursor??0,resuming=checkpoint?.pending;
 const completed=new Map<string,AlbumRow>();
 const attempts=new Map<string,SavedCandidate[]>();
 const mark=(cursor:number,pending:PendingDownload|null)=>{
  if(!checkpoint)return;
  checkpoint={...checkpoint,cursor,pending};p.saveCheckpoint?.(checkpoint);
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
     if(!live()||p.attempt.waitForDownload&&!await p.attempt.waitForDownload(p.signal))return stop();
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
    const result=await downloadSong({...p,choice,trackId:track.id,index:i,current:live,networkCurrent,remoteClock,
     previousAttempts:attempts.get(track.id),
     mark:value=>{pending=value;mark(i,value);},message:message=>{row.message=message;update(message);},progress:()=>{}});
    if(result.state==='stopped'||!live())return stop();
    Object.assign(row,result);
   }
   if(row.reason==='parked'&&pending){
    if(p.parkDownload)p.parkDownload(track.id,pending);
    else if(checkpoint)return stop();
    else uncertainSingleTracks.add(track.id);
   }
   mark(i+1,null);
   completed.set(track.id,row);
   update(row.message);
  }
  if(!live())return stop();
  update(rows.every(row=>row.confirmed)?'Selección descargada en este dispositivo.':'Descarga parcial: revisa las canciones pendientes.');
  return 'finished';
 }catch{return stop('No se pudo continuar con el almacenamiento actual.');}
}
