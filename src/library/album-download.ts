import type {AlbumDetail} from './album-catalog';
import type {CatalogId} from './catalog-id';
import {acquireAlbum,albumTrackChoice,type AlbumRow,type AlbumProgress} from './album-acquisition';
import {albumDownloadKey} from './collection-download-queue';
import type {OrderedProvider} from './ordered-bot-acquisition';
import type {SavedAlbum,SavedAlbumFailures,SaveAlbumResult} from './saved-albums';
import type {SongManagement,SongPlaybackAttempt} from './selected-song';
import type {TelegramSessionClient} from '../telegram/session-client';
import {downloadNotifications} from '../pwa/download-notifications';

export interface AlbumDownloadRun {scope:string;editionId:CatalogId;key:string;title:string;abort:AbortController;stop?:(discardCheckpoint?:boolean)=>void;accountId?:string;collectionKey?:string}
export interface AlbumCoordinator {
 dispatching?:boolean;songFlight?:object;
 running:boolean;uncertainTracks:Set<CatalogId>;remoteClock:{settledAt:number};
 rows:Map<CatalogId,{key:string;rows:AlbumRow[];message?:string}>;listeners:Set<()=>void>;
 active?:AlbumDownloadRun;notice?:{title:string;titles?:string[];progress:AlbumProgress};
 requestAlbum?:(album:SavedAlbum)=>void;
 queueAccount?:string;
 albumRowsAccount?:string;
 queued?:readonly {key:string;title:string}[];
 removeQueued?:(key:string)=>void;
}
export const albumCoordinator:AlbumCoordinator={running:false,uncertainTracks:new Set(),remoteClock:{settledAt:0},rows:new Map(),listeners:new Set()};
export function notifyAlbumDownload(coordinator:AlbumCoordinator){for(const notify of coordinator.listeners)notify();}
export const albumRunKey=(album:AlbumDetail,accountId?:string)=>JSON.stringify([accountId??null,JSON.stringify(album.tracks.map(track=>albumTrackChoice(track,album.edition.title)))]);

export async function runAlbumDownload(p:{
 detail:AlbumDetail;saved?:SavedAlbum;accountId?:string;scope:string;coordinator:AlbumCoordinator;
 attempt:SongPlaybackAttempt;client:TelegramSessionClient|null;revision:number|undefined;provider:string|null;
 providers:readonly OrderedProvider[];management:(id:string)=>SongManagement|null;
 saveAlbum?:(detail:AlbumDetail,current:()=>boolean,failure:SavedAlbumFailures)=>Promise<SaveAlbumResult>;
}){
 const {detail,attempt,client,revision,coordinator}=p;
 if(coordinator.running||!attempt.current())return false;
 const {id:editionId,title}=detail.edition,abort=new AbortController(),key=albumRunKey(detail,p.accountId);
 const run:AlbumDownloadRun={scope:p.scope,accountId:p.accountId,editionId,key,title,abort,collectionKey:albumDownloadKey(editionId)};
 if(coordinator.albumRowsAccount!==p.accountId){
  coordinator.albumRowsAccount=p.accountId;
  coordinator.rows.clear();coordinator.uncertainTracks.clear();coordinator.remoteClock.settledAt=0;
 }
 const previous=coordinator.rows.get(editionId);
 let rows:AlbumRow[]=previous?.key===key?previous.rows.map(row=>({...row})):
  detail.tracks.map(()=>({state:'unattempted',trackId:null,confirmed:false,message:''}));
 const titles=detail.tracks.map(track=>track.title);
 coordinator.notice={title,titles,progress:{rows,message:'Comprobando copias…'}};
 coordinator.active=run;coordinator.running=true;notifyAlbumDownload(coordinator);
 const boundSession=client?.snapshot().phase==='connected'?client.captureBotsCurrent():null;
 const current=()=>coordinator.active===run&&attempt.current()&&(!boundSession||boundSession()&&(revision===undefined||client!.botsSnapshot().revision===revision));
 const unsubscribe=client?.subscribeSearch(()=>{
  let valid=false;try{valid=current();}catch{/* Revoked authority. */}
  if(!valid)abort.abort();
 });
 try{
  await acquireAlbum({detail,attempt,client,provider:p.provider,providers:p.providers.map(row=>({...row})),revision,management:p.management,
   signal:abort.signal,current,rows,remoteClock:coordinator.remoteClock,uncertainTracks:coordinator.uncertainTracks,update:value=>{
    if(coordinator.active!==run)return;
    rows=value.rows;
    coordinator.rows.set(editionId,{key,rows:rows.map(row=>({...row})),message:value.message});
    coordinator.notice={title,titles,progress:value};notifyAlbumDownload(coordinator);
    downloadNotifications.notify('album',run,title,`${rows.filter(row=>row.confirmed).length} de ${rows.length} canciones guardadas`,false,current);
   }});
  if(p.saved&&p.saveAlbum&&current()){
   const failures=new Set(p.saved.failedTracks);
   rows.forEach((row,index)=>{
    const id=albumTrackChoice(detail.tracks[index],title).id;
    if(row.state==='failed')failures.add(id);
    else if(row.confirmed)failures.delete(id);
   });
   await p.saveAlbum(detail,current,{savedAt:p.saved.savedAt,failedTracks:[...failures]}).catch(()=>{});
  }
 }finally{
  unsubscribe?.();
  if(coordinator.active===run){
   const confirmed=rows.filter(row=>row.confirmed).length;
   downloadNotifications.notify('album',run,title,confirmed===detail.tracks.length?'Álbum guardado.':`Descarga detenida: ${confirmed} de ${detail.tracks.length} canciones guardadas.`,true,()=>attempt.current()&&(!coordinator.active||coordinator.active===run)&&(!boundSession||boundSession()));
   coordinator.active=undefined;coordinator.running=false;
   notifyAlbumDownload(coordinator);
  }
 }
 return true;
}
