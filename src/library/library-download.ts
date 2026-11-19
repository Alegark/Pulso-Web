import {sameHeldDownload,type HeldDownload,type LibraryDownloadCheckpoint,type PendingDownload} from './library-download-checkpoint';
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
 const mark=(cursor:number,pending:PendingDownload|null)=>{
  if(!checkpoint)return;
  checkpoint={...checkpoint,cursor,pending};p.saveCheckpoint?.(checkpoint);
 };
 try{
  for(let i=0;i<p.tracks.length;i++){
   if(!live())return stop();
   const track=p.tracks[i],row=rows[i],earlier=completed.get(track.id);
   // A pending receipt on resume still has to settle even if another entry
   // for the same track appears before the cursor.
   if(earlier&&!(i===start&&resuming)){
    Object.assign(row,earlier);
    if(earlier.confirmed)Object.assign(row,{state:'reused',message:'Ya descargada'});
    if(i>=start)mark(i+1,null);
    update(row.message);
    continue;
   }
   const choice:SongChoice={source:'local',id:'local:'+track.id,
    title:track.manualOverrides.title??track.catalogChoice?.title??track.title,
    artist:'artist' in track.manualOverrides?track.manualOverrides.artist??null:track.catalogChoice?.artist??track.artist,
    album:'album' in track.manualOverrides?track.manualOverrides.album??null:track.catalogChoice?.album??track.album,
    duration:track.catalogChoice?.duration??track.duration};
   const held=p.heldDownload?.(track.id),previous=i===start&&resuming?resuming:held;
   const clearPrevious=()=>{if(held&&previous&&sameHeldDownload(held,previous))p.clearHeldDownload?.(track.id,held);};
   let id:string|null=null,parked=false;
   if(previous?.kind==='save'){
    if(i>=start)mark(i,{...previous,index:i});
    const receipt=await reconcileSongDownload(p.attempt,previous.operationId,track.id,choice,p.signal);
    if(!live())return stop();
    if(receipt?.state==='saved'&&receipt.trackId===track.id)id=track.id;
    else if(receipt?.state!=='missing'){
     parked=true;
     await parkSongDownload(p.attempt,previous.operationId,p.signal);
    }
    if(!parked)clearPrevious();
   }
   if(!id&&!parked){
    try{
     if(i<start&&p.attempt.inspectDownload)id=await p.attempt.inspectDownload(track.id,p.signal);
     else{
      if(p.attempt.waitForDownload&&!await p.attempt.waitForDownload(p.signal))return stop();
      id=await p.attempt.lookup(choice,p.signal,true);
     }
    }catch{parked=true;}
   }
   if(!live())return stop();
   // A network marker precedes the first local write. It can be replayed once
   // the captured Telegram lane is ready, without guessing about a save.
   if(previous?.kind==='network')clearPrevious();
   let pending:HeldDownload|null=parked?previous??null:null;
   if(id){
    clearPrevious();
    uncertainSingleTracks.delete(track.id);
    Object.assign(row,{state:'reused',trackId:id,confirmed:true,message:'Ya descargada'});
   }else if(parked||uncertainSingleTracks.has(track.id)){
    Object.assign(row,parkedSong);
   }else if(i<start){
    Object.assign(row,{state:'failed',message:'Procesada anteriormente sin copia'});
   }else{
    const result=await downloadSong({...p,choice,trackId:track.id,index:i,current:live,networkCurrent,remoteClock,
     previousAttempts:previous?.kind==='save'?previous.attempts:undefined,
     mark:value=>{pending=value;mark(i,value);},message:message=>{row.message=message;update(message);},progress:()=>{}});
    if(result.state==='stopped'||!live())return stop();
    Object.assign(row,result);
   }
   if(i>=start){
    if(row.reason==='parked'&&pending){
     if(p.parkDownload)p.parkDownload(track.id,pending);
     else if(!checkpoint)uncertainSingleTracks.add(track.id);
    }
    mark(i+1,null);
   }
   if(row.confirmed||i>=start)completed.set(track.id,row);
   update(row.message);
  }
  if(!live())return stop();
  update(rows.every(row=>row.confirmed)?'Selección descargada en este dispositivo.':'Descarga parcial: revisa las canciones pendientes.');
  return 'finished';
 }catch{return stop('No se pudo continuar con el almacenamiento actual.');}
}
