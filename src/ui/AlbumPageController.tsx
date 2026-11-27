import {registerSearchCacheCleaner} from '../library/search-caches';
import type {TrackMenuHost} from './track-menu-host';
import {TrackActionsMenu,TrackPlaylistAction,trackActionOpener} from './TrackActionsMenu';
import {useLongPress} from './useLongPress';
import type {AlbumTrack} from '../library/album-catalog';
import {formatAlbumHeaderMeta} from '../library/album-header-meta';
import {announceDownloadMessage,CollectionDownloadButton} from './DownloadDock';
import {BackButton} from './BackButton';
import {downloadWithCurrentApp} from '../service-worker/download-update';
import {musicBrainzId} from '../library/catalog-id';
import type {CatalogId} from '../library/catalog-id';
import {albumRunKey,runAlbumDownload,type AlbumCoordinator} from '../library/album-download';
import {albumDownloadKey} from '../library/collection-download-queue';
export type {AlbumCoordinator} from '../library/album-download';
import {catalogTransportMode} from '../library/catalog-fetch';
import type {OrderedProvider} from '../library/ordered-bot-acquisition';
import React from 'react';
import {AlbumCatalog,albumHintsFromSongs,type AlbumDetail,type AlbumEdition,type AlbumFailure,type AlbumStage} from '../library/album-catalog';
import {musicCatalogKey} from '../library/music-search-catalog';
import {albumTrackChoice,type AlbumRow,type AlbumProgress} from '../library/album-acquisition';
import {resolveAlbum} from '../library/album-resolution';
import type {SongChoice,SongPlaybackAttempt,SongManagement,SongCopyInspection} from '../library/selected-song';
import type {TelegramSessionClient} from '../telegram/session-client';
import './album-page.css';
import {CollectionCover} from './CollectionCover';
import type {Track} from '../library/library';
import {resolvedAlbumTracks,type SavedAlbum,type SavedAlbumFailures,type SaveAlbumResult} from '../library/saved-albums';
import {createSongResolver,type SongAliases} from '../library/selected-song';
import type {AvailabilityRecord} from '../library/shell-selectors';
import {PlaybackIndicator} from './PlaybackIndicator';
const catalog=new AlbumCatalog((...args)=>fetch(...args));
registerSearchCacheCleaner(()=>catalog.clearCache());
interface Props {
 trackMenuHost?:TrackMenuHost; playerPlaying?:boolean;
 savedAlbums?:readonly SavedAlbum[]; fixedDetail?:SavedAlbum; libraryView?:boolean; albumOptions?:React.ReactNode;
 localTracks?:readonly Track[]; songAliases?:SongAliases|null; localAvailability?:ReadonlyMap<string,AvailabilityRecord>; albumSaveBlockedReason?:string;
 saveAlbum?:(detail:AlbumDetail,current:()=>boolean,failure?:SavedAlbumFailures)=>Promise<SaveAlbumResult>;
 songPending?:boolean;accountId?:string;resumeDownload?:()=>void;metadataOnly?:boolean;coordinator:AlbumCoordinator;captureInspection?:()=>SongCopyInspection|null;selectedKey:string|null;actionKey?:string|null;libraryTrackIds?:ReadonlySet<string>;playerTrackId?:string|null;title:string;artist:string|null;editionId?:CatalogId;artworkUrl?:string;searchBatch?:{data:unknown;pending:boolean};backLabel?:string;scope:string;visible:boolean;client:TelegramSessionClient|null;revision:number|undefined;provider:string|null;providers:readonly OrderedProvider[];capture:()=>SongPlaybackAttempt|null;management:(id:string)=>SongManagement|null;onBack:()=>void;onChoose:(choice:SongChoice,queueSlots?:readonly (string|null)[],chosenIndex?:number)=>void;songActions:React.ReactNode}
const metadataIdentity=(props:Props)=>JSON.stringify([props.title,props.artist,props.editionId??null,props.scope]);
const catalogError=(reason:AlbumFailure,detail:boolean,stage?:AlbumStage,httpStatus?:number,backup=false)=>{
 const prefix=detail?'No se pudo verificar la lista completa de pistas.':'No se pudo consultar el catálogo de álbumes.';
 const message=reason==='rate-limited'?'El catálogo ha limitado temporalmente las consultas.':reason==='timeout'?'La consulta tardó demasiado.':reason==='network'||reason==='http'?'Comprueba la conexión e inténtalo de nuevo.':reason==='incomplete'?'El catálogo no devolvió una lista completa y coherente de canciones de esta edición.':'La respuesta del catálogo no se pudo verificar.';
 const entry=location.pathname.match(/\/releases\/([a-f0-9]{16})\.html$/)?.[1]??'local';
 const diagnostic=[detail?'album-detail':stage??'album-search',backup?'musicbrainz-relay':catalogTransportMode(),reason,...(Number.isInteger(httpStatus)&&httpStatus!>=400&&httpStatus!<=599?[String(httpStatus)]:[]),entry].join(' · ');
 return `${prefix} ${message} Diagnóstico: ${diagnostic}.`;
};
function DownloadedIcon(){return <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2v8m-3-3 3 3 3-3M3 12h10"/></svg>;}
function AlbumTrackRow({track,trackId,present,inLibrary,failed,copyState,saved,host,playing,visible,disabled,onChoose,songActions,albumTitle,local}:{track:AlbumTrack;trackId:string|null|undefined;present:boolean;inLibrary:boolean;failed:boolean;copyState:string|undefined;saved:boolean;host?:TrackMenuHost;playing:boolean;visible:boolean;disabled:boolean;onChoose:()=>void;songActions:React.ReactNode;albumTitle:string;local?:Track}){
 const [menuSignal,openMenu]=React.useReducer(n=>n+1,0);
 const longPress=useLongPress({onLongPress:openMenu});
 const displayTitle=local?.manualOverrides?.title??track.title,displayArtist=local?.manualOverrides?.artist??track.artist;
 const state=present?(saved&&!inLibrary?'cached':'downloaded'):failed?'error':copyState==='missing'?'missing':'unknown';
 const duration=track.durationMs?`${Math.floor(track.durationMs/60000)}:${String(Math.floor(track.durationMs/1000)%60).padStart(2,'0')}`:'Duración desconocida';
 return <li {...longPress} data-track-state={state} data-album-pending={!present||undefined}>
  <button type="button" className="album-track-main" disabled={disabled} onClick={onChoose}><span className="album-track-number" aria-label={`Disco ${track.disc}, pista ${track.position}`}>{playing?<PlaybackIndicator variant="inline"/>:track.position}</span><span className="album-track-copy"><strong><bdi dir="auto">{displayTitle}</bdi></strong><span className="album-track-sub">{present&&<DownloadedIcon/>}<bdi dir="auto">{displayArtist}</bdi></span></span></button>
  <TrackActionsMenu title={displayTitle} artist={displayArtist} active={visible} openSignal={menuSignal}>
   <button disabled={!host?.canOrganize||!trackId} onClick={event=>{event.currentTarget.focus();if(trackId)host?.onToggleFavorite(trackId);}}>{trackId&&host?.tracksById.get(trackId)?.favorite?'Quitar favorito':'Favorito'}</button>
   <button disabled={!host?.canOrganize||!trackId||inLibrary} onClick={()=>{if(trackId)host?.onAddToLibrary(trackId);}}>{inLibrary?'En Biblioteca':'Añadir a Biblioteca'}</button>
   {trackId&&host&&<TrackPlaylistAction playlists={host.playlists} trackId={trackId} enabled={host.canOrganize} onAdd={list=>host.onAddToPlaylist(list.id,trackId)}/>}
   <button disabled={!host?.canAppend||!present||!trackId} onClick={()=>{if(trackId)host?.onQueueNext(trackId);}}>Reproducir a continuación</button>
   <button disabled={!host?.canAppend||!present||!trackId} onClick={()=>{if(trackId)host?.onQueueLater(trackId);}}>Añadir al final de la cola</button>
   <button data-menu-dismiss="true" disabled={!host?.canOrganize||!trackId||!host.removalEligibleTracks.has(trackId)} onClick={event=>{if(trackId)host?.onOpenRemoval(trackId,trackActionOpener(event.currentTarget));}}>Gestionar copia local</button>
   <details><summary>Información</summary><p>{albumTitle} · Disco {track.disc}, pista {track.position} · {duration}</p><p>{present?(saved&&!inLibrary?'En caché de escucha':'Descargada'):copyState==='missing'?'No descargada':'Copia sin comprobar'}{inLibrary?' · En Biblioteca':''}</p></details>
  </TrackActionsMenu>
  {failed&&<span className="album-track-error" role="status">Error al descargar</span>}{songActions}
 </li>;
}
export function AlbumPageController(props:Props){
 const fixedDetail=props.fixedDetail;
 const relevantBatch=props.editionId?undefined:props.searchBatch;
 const headingId=React.useId();
 const [inspectionRevision,bumpInspection]=React.useReducer(n=>n+1,0);
 const [inspecting,setInspecting]=React.useState(false),[copies,setCopies]=React.useState<Record<string,{state:'available'|'missing'|'unknown';trackId:string|null;inLibrary:boolean|null}>>({});
 const inspectionTail=React.useRef<Promise<void>>(Promise.resolve()),inspectedEdition=React.useRef<AlbumDetail|null>(null),finishedInspection=React.useRef<AlbumDetail|null>(null);
 const completedInspection=React.useRef<string|null>(null);
 const loadedMetadata=React.useRef<string|null>(null);
 const [saveNotice,setSaveNotice]=React.useState('');
 const [saving,setSaving]=React.useState(false),savingRef=React.useRef(false);
 const [progress,setProgress]=React.useState<AlbumProgress|null>(null);
 const [,refreshCoordinator]=React.useReducer(n=>n+1,0);
 const rows=React.useRef<AlbumRow[]>([]);
 const [editions,setEditions]=React.useState<AlbumEdition[]>([]),[detail,setDetail]=React.useState<AlbumDetail|null>(fixedDetail??null),[status,setStatus]=React.useState(fixedDetail?'':'Buscando ediciones…');
 const runKey=(album:AlbumDetail)=>albumRunKey(album,props.accountId);
 const [retryVersion,retryMetadata]=React.useReducer(n=>n+1,0),[retryTarget,setRetryTarget]=React.useState<AlbumEdition|null|undefined>(undefined);
 React.useEffect(()=>{
  if(props.metadataOnly)return;
  const synchronize=()=>{if(!detail)return;const saved=props.coordinator.rows.get(detail.edition.id);if(saved&&saved.key===runKey(detail)){rows.current=saved.rows.map(r=>({...r}));setProgress({rows:rows.current,message:saved.message??'Comprueba las copias antes de continuar.'});}};
  let wasRunning=props.coordinator.running;
  const listener=()=>{
   const running=props.coordinator.running;
   refreshCoordinator();synchronize();
   if(detail&&wasRunning&&!running){inspectedEdition.current=null;bumpInspection();}
   wasRunning=running;
  };
  props.coordinator.listeners.add(listener);synchronize();
  // Initial subscription must not abort the first full copy inspection.
  return()=>{props.coordinator.listeners.delete(listener);};
 },[props.coordinator,detail,props.metadataOnly,props.accountId]);
 const latest=React.useRef(props),committed=React.useRef<object|null>(null),mounted=React.useRef(false),metadata=React.useRef<AbortController|null>(null),heading=React.useRef<HTMLHeadingElement>(null);
 React.useLayoutEffect(()=>{latest.current=props;mounted.current=true;heading.current?.focus();return()=>{mounted.current=false;};},[]);
 const renderToken={};
 React.useLayoutEffect(()=>{latest.current=props;committed.current=renderToken;return()=>{if(committed.current===renderToken)committed.current=null;};});
 const active=()=>mounted.current&&committed.current===renderToken&&props.visible;
 const resumed=React.useRef(false);
 const cancelResume=()=>{
  if(!props.resumeDownload||resumed.current)return;
  resumed.current=true;props.resumeDownload();
 };
 React.useEffect(()=>()=>{metadata.current?.abort();cancelResume();},[props.scope,props.client,props.revision,props.visible]);
 React.useEffect(()=>{
  if(!props.visible||fixedDetail)return;
  const identity=metadataIdentity(props);
  if(detail&&loadedMetadata.current===identity)return;
  const abort=new AbortController();metadata.current=abort;setSaveNotice('');setDetail(null);setEditions([]);setRetryTarget(undefined);setStatus('Buscando ediciones…');
  const live=()=>mounted.current&&metadata.current===abort&&!abort.signal.aborted&&latest.current.visible&&metadataIdentity(latest.current)===identity;
  if(props.editionId){void load({id:props.editionId,title:props.title,artist:props.artist??'',trackCount:0,releaseDate:null},abort,live);return()=>abort.abort();}
  if(relevantBatch?.pending)return()=>abort.abort();
  // Hints identify candidates only; the complete track list always comes from
  // the authoritative edition lookup. Never infer a full album from the batch.
  const hints=props.artist?albumHintsFromSongs(relevantBatch?.data).filter(h=>h.artist&&musicCatalogKey(h.title)===musicCatalogKey(props.title)&&musicCatalogKey(h.artist)===musicCatalogKey(props.artist!)):[];
  if(hints.length){const candidates:AlbumEdition[]=hints.map(h=>({id:h.id,title:h.title,artist:h.artist!,trackCount:0,releaseDate:null,...(h.artworkUrl?{artworkUrl:h.artworkUrl}:{})}));setEditions(candidates);if(candidates.length===1)void load(candidates[0],abort,live);else setStatus('Elige una edición para ver sus pistas.');return()=>abort.abort();}
  void resolveAlbum(catalog,props.title,props.artist,{signal:abort.signal,current:live}).then(async result=>{
   if(!live())return;if(!result.ok){if(result.reason!=='cancelled'){setStatus(catalogError(result.reason,false,result.stage,result.httpStatus));setRetryTarget(null);}return;}
   const candidates=result.value;
   setEditions(candidates);if(candidates.length===1&&props.artist){await load(candidates[0],abort,live);return;}
   setStatus(candidates.length?'Elige una edición para ver sus pistas.':'No se encontraron ediciones compatibles en los resultados disponibles.');
  });
  return()=>abort.abort();
 },[props.title,props.artist,props.editionId,props.scope,props.visible,relevantBatch?.pending,relevantBatch?.data,retryVersion,fixedDetail]);
 async function load(edition:AlbumEdition,abort:AbortController,live:()=>boolean){
  setRetryTarget(undefined);setStatus('Cargando pistas…');let usedBackup=musicBrainzId(edition.id);let result=await catalog.load(edition.id,{signal:abort.signal,current:live});if(!live())return;
  if(!result.ok&&result.reason!=='cancelled'&&!musicBrainzId(edition.id)){
   setStatus('Consultando el respaldo de álbumes…');
   const alternative=await catalog.alternatives(edition.title,edition.artist,{signal:abort.signal,current:live});if(!live())return;
   if(alternative.ok){const candidates=alternative.value.filter(e=>musicCatalogKey(e.title)===musicCatalogKey(edition.title)&&(!edition.artist||musicCatalogKey(e.artist)===musicCatalogKey(edition.artist))&&(edition.trackCount===0||e.trackCount===edition.trackCount));
    if(candidates.length===1){usedBackup=true;result=await catalog.load(candidates[0].id,{signal:abort.signal,current:live});if(!live())return;}
    else if(candidates.length>1){setEditions(candidates);setRetryTarget(null);setStatus('iTunes no pudo entregar las pistas. Elige una edición del respaldo MusicBrainz.');return;}
   }
  }
  if(!result.ok){if(result.reason!=='cancelled'){setStatus(catalogError(result.reason,true,undefined,result.httpStatus,usedBackup));setRetryTarget(edition);}return;}loadedMetadata.current=metadataIdentity(props);setDetail(result.value);setCopies({});inspectedEdition.current=null;const saved=props.coordinator.rows.get(result.value.edition.id),compatible=saved?.key===runKey(result.value);rows.current=compatible?saved.rows.map(r=>({...r})):result.value.tracks.map(()=>({state:'unattempted',trackId:null,confirmed:false,message:''}));setProgress(compatible?{rows:rows.current,message:'Comprueba las copias antes de continuar.'}:null);setStatus('');
 }
 const chooseEdition=(edition:AlbumEdition)=>{if(!active())return;metadata.current?.abort();const abort=new AbortController();metadata.current=abort;setSaveNotice('');setDetail(null);const identity=metadataIdentity(props);const live=()=>mounted.current&&metadata.current===abort&&!abort.signal.aborted&&latest.current.visible&&metadataIdentity(latest.current)===identity;void load(edition,abort,live);};
 const localTrackIndex=React.useMemo(()=>new Map(props.localTracks?.map(track=>[track.id,track])),[props.localTracks]);
 const running=props.coordinator.running;
 const inspectionMatches=React.useMemo(()=>!running&&detail&&props.libraryView?resolvedAlbumTracks(detail,
  createSongResolver(props.localTracks??[],props.songAliases)):[],[running,detail,props.libraryView,props.localTracks,props.songAliases]);
 const inspectionSignature=running?'':JSON.stringify(inspectionMatches.map(({trackId})=>{
  const track=trackId?localTrackIndex.get(trackId):undefined;
  const availability=trackId?props.localAvailability?.get(trackId):undefined;
  return track?[track.id,track.revision,track.assetId,availability?.generation,availability?.state]:null;
 }));
 const inspectionSelection=props.libraryView?null:props.selectedKey;
 const inspectionKey=JSON.stringify([props.scope,inspectionSelection,inspectionRevision,inspectionSignature]);
 React.useEffect(()=>{
  if(props.metadataOnly||!detail||!props.visible){inspectedEdition.current=null;setInspecting(false);return;}
  if(running||props.coordinator.dispatching||props.songPending){
   if(finishedInspection.current!==detail)inspectedEdition.current=null;
   setInspecting(false);return;
  }
  const first=inspectedEdition.current!==detail;
  // A song can finish using copies that this detail just verified. Only
  // restart a completed scan when its inputs changed during the song.
  if(!first&&finishedInspection.current===detail&&completedInspection.current===inspectionKey)return;
  const abort=new AbortController();inspectedEdition.current=detail;
  if(first)setCopies({});
  const targets=first||props.libraryView?detail.tracks:detail.tracks.filter(t=>albumTrackChoice(t,detail.edition.title).id===props.selectedKey);
  finishedInspection.current=null;setInspecting(true);
  const run=async()=>{
   if(abort.signal.aborted)return;
   const inspector=latest.current.captureInspection?.();
   if(!inspector)return;
   const current=()=>!abort.signal.aborted&&mounted.current&&latest.current.visible&&
    !latest.current.coordinator.running&&!latest.current.coordinator.dispatching&&!latest.current.coordinator.songFlight&&inspector.current();
   for(const track of targets){
    if(!current())return;
    const choice=albumTrackChoice(track,detail.edition.title);
    let value:{state:'available'|'missing'|'unknown';trackId:string|null;inLibrary:boolean|null}={state:'unknown',trackId:null,inLibrary:null};
    try{value=await inspector.inspect(choice,abort.signal);}catch{/* An unreadable copy stays unknown. */}
    if(!current())return;
    setCopies(previous=>({...previous,[choice.id]:value}));
   }
   if(current()){
    finishedInspection.current=detail;completedInspection.current=inspectionKey;
   }
  };
  const task=inspectionTail.current.catch(()=>{}).then(run);inspectionTail.current=task;
  const settle=()=>{
   if(abort.signal.aborted||!mounted.current)return;
   if(finishedInspection.current!==detail)inspectedEdition.current=null;
   setInspecting(false);
  };
  void task.then(settle,settle);
  return()=>{
   abort.abort();
   if(finishedInspection.current!==detail)inspectedEdition.current=null;
  };
 },[detail,props.visible,props.metadataOnly,inspectionKey,running,props.songPending,props.coordinator.dispatching]);
 const savedAlbum=props.savedAlbums?.find(album=>album.edition.id===detail?.edition.id);
 async function addAlbum(download=true,restoring=false){
  if(!active()||savingRef.current||!detail||download&&inspecting)return;
  if(!savedAlbum&&props.saveAlbum&&props.albumSaveBlockedReason){
   setSaveNotice(props.albumSaveBlockedReason);return;
  }
  const metadataOperation=metadata.current;
  const sameEdition=()=>mounted.current&&latest.current.visible&&latest.current.scope===props.scope&&metadata.current===metadataOperation;
  savingRef.current=true;setSaving(true);setSaveNotice('');
  const {id:editionId,title,artist}=detail.edition;
  let saved=savedAlbum;
  try{
   if(!saved&&props.saveAlbum){
    const result=await props.saveAlbum(detail,sameEdition).catch(()=>null);
    if(result?.state==='saved')saved=result.album;
    else{
     if(sameEdition())setSaveNotice(result?.state==='limit'?'Llegaste al máximo de 500 álbumes guardados. Quita alguno de Biblioteca para guardar este.':'No se pudo guardar el álbum. Comprueba que Almacenamiento esté disponible.');
     return;
    }
   }
   if(!download)return;
   if(saved&&props.coordinator.requestAlbum&&!restoring){
    if(sameEdition())props.coordinator.requestAlbum(saved,props.libraryView);
    return;
   }
   const canStart=()=>sameEdition()&&!props.coordinator.running&&!props.coordinator.dispatching&&!props.coordinator.songFlight;
   if(!canStart()||!await downloadWithCurrentApp(props.accountId,{kind:'album',editionId,title,artist},canStart))return;
   if(!canStart())return;
   const p=latest.current,attempt=p.capture();
   if(!attempt?.current()){announceDownloadMessage('La biblioteca está ocupada o requiere revisión en Almacenamiento.');return;}
   void runAlbumDownload({...p,detail,saved,attempt}).catch(()=>announceDownloadMessage('No se pudo completar la descarga del álbum.'));
  }finally{savingRef.current=false;if(mounted.current)setSaving(false);}
 }
 React.useEffect(()=>{
  if(!props.resumeDownload||resumed.current)return;
  if(!props.visible||retryTarget!==undefined||detail&&detail.edition.id!==props.editionId){cancelResume();return;}
  if(!detail||finishedInspection.current!==detail||inspecting||!active()||props.coordinator.running||props.coordinator.dispatching||props.coordinator.songFlight)return;
  resumed.current=true;
  void addAlbum(true,true).finally(props.resumeDownload);
 });
 const activeRun=props.coordinator.active;
 const ownRun=running&&detail&&activeRun?.editionId===detail.edition.id&&activeRun.key===runKey(detail);
 const activeProgress=!!ownRun;
 const visibleRows=ownRun?props.coordinator.rows.get(detail.edition.id)?.rows:progress?.rows;
 const available=(id:string,index:number)=>copies[id]?.state==='available'||activeProgress&&visibleRows?.[index]?.confirmed===true;
 const member=(id:string,index:number)=>{
  if(activeProgress&&visibleRows?.[index]?.confirmed)return true;
  const copy=copies[id];
  return copy?.trackId&&props.libraryTrackIds?props.libraryTrackIds.has(copy.trackId):copy?.inLibrary===true;
 };
 const downloaded=detail?.tracks.filter((track,index)=>{
  const id=albumTrackChoice(track,detail.edition.title).id;
  return available(id,index)&&member(id,index);
 }).length??0;
 const albumAction=props.libraryView?'Descargar faltantes':progress?'Continuar álbum':'Añadir álbum';
 const firstCopy=detail?.tracks.map(track=>copies[albumTrackChoice(track,detail.edition.title).id])
  .find(copy=>copy?.state==='available'&&copy.trackId)?.trackId;
 const queueSlots=detail?.tracks.map((track,index)=>{const id=albumTrackChoice(track,detail.edition.title).id;return available(id,index)?copies[id]?.trackId??visibleRows?.[index]?.trackId??null:null;})??[];
 const availableTrackIds=queueSlots.filter((id):id is string=>!!id);
 const albumPlaying=!!props.playerPlaying&&!!props.playerTrackId&&availableTrackIds.includes(props.playerTrackId);
 const albumImage=detail?.edition.artworkUrl??props.artworkUrl??(editions.length===1?editions[0].artworkUrl:undefined);
 return <section className="album-page" aria-labelledby={headingId}>
  <BackButton onClick={()=>{if(active())props.onBack();}}>{props.backLabel??(props.libraryView?'Volver a Biblioteca':'Volver a búsqueda')}</BackButton>
  <div className="album-hero"><span className="album-art"><CollectionCover variant="album" artworkUrl={albumImage} trackIds={firstCopy?[firstCopy]:[]} enabled={props.visible}/></span><div><p className="catalog-eyebrow">ÁLBUM</p><h2 id={headingId} ref={heading} tabIndex={-1}>{detail?.edition.title??props.title}</h2><p className="album-artist">{detail?.edition.artist??props.artist}</p>{detail&&<p>{formatAlbumHeaderMeta(detail.tracks.length,new Set(detail.tracks.map(t=>t.disc)).size,downloaded,!!savedAlbum)}</p>}</div></div>

  {status&&<p role="status">{status}</p>}
  {retryTarget!==undefined&&<button type="button" onClick={()=>{if(!active())return;if(retryTarget)chooseEdition(retryTarget);else retryMetadata();}}>Reintentar consulta</button>}
  {editions.length>0&&(!detail||editions.length>1)&&<section aria-label="Ediciones"><h3>Ediciones</h3><ul>{editions.map(e=><li key={e.id}><button type="button" onClick={()=>chooseEdition(e)}>{e.title} · {e.artist} · {e.releaseDate?.slice(0,10)??'fecha desconocida'}{e.trackCount?` · ${e.trackCount} pistas`:''}</button></li>)}</ul></section>}
  {detail&&props.metadataOnly&&<><h3 className="album-tracks-heading">Canciones</h3><ol className="album-tracks">{detail.tracks.map(track=><li key={`${track.disc}:${track.position}`}><span className="album-track-copy"><strong><bdi dir="auto">{track.title}</bdi></strong><span><bdi dir="auto">{track.artist}</bdi></span></span></li>)}</ol></>}
  {detail&&!props.metadataOnly&&<>
   <div className="album-actions">
    <button className="album-play-btn" type="button" disabled={!albumPlaying&&(inspecting||running||!!props.songPending||!detail.tracks.length)} onClick={()=>{if(albumPlaying){props.trackMenuHost?.onTogglePlayPause();return;}const index=Math.max(0,queueSlots.findIndex(Boolean));props.onChoose(albumTrackChoice(detail.tracks[index],detail.edition.title),queueSlots,index);}}>{albumPlaying?'❚❚ Pausar':'▶ Reproducir'}</button>
    <button className="album-shuffle-btn" type="button" disabled={!availableTrackIds.length||!props.trackMenuHost||inspecting||props.coordinator.running||!!props.songPending} onClick={()=>{if(!active()||inspecting||props.coordinator.running||props.songPending)return;props.trackMenuHost?.onPlayTracks(availableTrackIds,true);}}>⇄ Aleatorio</button>
    <CollectionDownloadButton coordinator={props.coordinator} accountId={props.accountId} label={albumAction} collectionKey={albumDownloadKey(detail.edition.id)} showLabel={props.libraryView} disabled={saving||inspecting} onStart={()=>void addAlbum()}/>
    <TrackActionsMenu title={detail.edition.title} artist={detail.edition.artist} label="Opciones del álbum" closeLabel="Cerrar opciones del álbum" active={props.visible&&!props.metadataOnly}>
     {!savedAlbum&&props.saveAlbum&&<button type="button" disabled={saving} data-menu-dismiss-after="true" onClick={()=>void addAlbum(false)}>Guardar álbum</button>}
     <details className="catalog-sources"><summary>Fuente de los metadatos</summary><p>Catálogo {musicBrainzId(detail.edition.id)?<a href={'https://musicbrainz.org/release/'+detail.edition.id.slice(12)} target="_blank" rel="noopener noreferrer">MusicBrainz · respaldo</a>:<a href="https://www.apple.com/itunes/" target="_blank" rel="noopener noreferrer">iTunes US</a>}.</p></details>
     {savedAlbum&&!props.coordinator.running&&!saving&&props.albumOptions}
    </TrackActionsMenu>
   </div>
   {saveNotice&&<p role="status">{saveNotice}</p>}
   {inspecting&&<p role="status">Comprobando copias locales…</p>}
   <h3 className="album-tracks-heading">Canciones</h3>
   <ol className="album-tracks">{detail.tracks.map((track,index)=>{
    const choice=albumTrackChoice(track,detail.edition.title),copy=copies[choice.id],row=visibleRows?.[index];
    const present=available(choice.id,index);
    const failed=!!(row?.state==='failed'||savedAlbum?.failedTracks.includes(choice.id));
    const trackId=copy?.trackId??row?.trackId;
    const local=trackId?localTrackIndex.get(trackId):undefined;
    const inLibrary=!!member(choice.id,index);
    return <AlbumTrackRow key={`${track.disc}:${track.position}`} track={track} trackId={trackId} present={present} inLibrary={inLibrary} failed={failed} copyState={copy?.state} saved={!!savedAlbum} host={props.trackMenuHost} playing={!!trackId&&props.playerTrackId===trackId&&!!props.playerPlaying} visible={props.visible&&!props.metadataOnly} disabled={inspecting||props.coordinator.running||!!props.songPending} local={local} albumTitle={detail.edition.title} onChoose={()=>{if(active()&&!props.coordinator.running&&!inspecting)props.onChoose(choice,queueSlots,index);}} songActions={(props.actionKey??props.selectedKey)===choice.id&&props.songActions}/>;
   })}</ol>
  </> }


 </section>;
}
