import {announceDownloadMessage,CollectionDownloadButton} from './DownloadDock';
import {BackButton} from './BackButton';
import {downloadWithCurrentApp} from '../service-worker/download-update';
import {downloadNotifications} from '../pwa/download-notifications';
import {musicBrainzId} from '../library/catalog-id';
import type {CatalogId} from '../library/catalog-id';
import {notifyAlbumDownload,type AlbumCoordinator,type AlbumDownloadRun} from '../library/album-download';
export type {AlbumCoordinator} from '../library/album-download';
import {catalogTransportMode} from '../library/catalog-fetch';
import type {OrderedProvider} from '../library/ordered-bot-acquisition';
import React from 'react';
import {AlbumCatalog,albumHintsFromSongs,type AlbumDetail,type AlbumEdition,type AlbumFailure,type AlbumStage} from '../library/album-catalog';
import {musicCatalogKey} from '../library/music-search-catalog';
import {acquireAlbum,albumTrackChoice,type AlbumRow,type AlbumProgress} from '../library/album-acquisition';
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
const detailKey=(detail:AlbumDetail)=>JSON.stringify(detail.tracks.map(track=>albumTrackChoice(track,detail.edition.title))); 
interface Props {
 savedAlbums?:readonly SavedAlbum[]; fixedDetail?:SavedAlbum; libraryView?:boolean; albumOptions?:React.ReactNode;
 localTracks?:readonly Track[]; songAliases?:SongAliases; localAvailability?:ReadonlyMap<string,AvailabilityRecord>; canSaveAlbum?:boolean;
 saveAlbum?:(detail:AlbumDetail,current:()=>boolean,failure?:SavedAlbumFailures)=>Promise<SaveAlbumResult>;
 accountId?:string;resumeDownload?:()=>void;metadataOnly?:boolean;coordinator:AlbumCoordinator;captureInspection?:()=>SongCopyInspection|null;selectedKey:string|null;actionKey?:string|null;libraryTrackIds?:ReadonlySet<string>;playerTrackId?:string|null;title:string;artist:string|null;editionId?:CatalogId;artworkUrl?:string;searchBatch?:{data:unknown;pending:boolean};backLabel?:string;scope:string;visible:boolean;client:TelegramSessionClient|null;revision:number|undefined;provider:string|null;providers:readonly OrderedProvider[];capture:()=>SongPlaybackAttempt|null;management:(id:string)=>SongManagement|null;onBack:()=>void;onChoose:(choice:SongChoice)=>void;songActions:React.ReactNode}
const metadataIdentity=(props:Props)=>JSON.stringify([props.title,props.artist,props.editionId??null,props.scope]);
const catalogError=(reason:AlbumFailure,detail:boolean,stage?:AlbumStage,httpStatus?:number,backup=false)=>{
 const prefix=detail?'No se pudo verificar la lista completa de pistas.':'No se pudo consultar el catálogo de álbumes.';
 const message=reason==='rate-limited'?'El catálogo ha limitado temporalmente las consultas.':reason==='timeout'?'La consulta tardó demasiado.':reason==='network'||reason==='http'?'Comprueba la conexión e inténtalo de nuevo.':reason==='incomplete'?'El catálogo no devolvió una lista completa y coherente de canciones de esta edición.':'La respuesta del catálogo no se pudo verificar.';
 const entry=location.pathname.match(/\/releases\/([a-f0-9]{16})\.html$/)?.[1]??'local';
 const diagnostic=[detail?'album-detail':stage??'album-search',backup?'musicbrainz-relay':catalogTransportMode(),reason,...(Number.isInteger(httpStatus)&&httpStatus!>=400&&httpStatus!<=599?[String(httpStatus)]:[]),entry].join(' · ');
 return `${prefix} ${message} Diagnóstico: ${diagnostic}.`;
};
export function AlbumPageController(props:Props){
 const fixedDetail=props.fixedDetail;
 const relevantBatch=props.editionId?undefined:props.searchBatch;
 const headingId=React.useId();
 const [inspectionRevision,bumpInspection]=React.useReducer(n=>n+1,0);
 const [inspecting,setInspecting]=React.useState(false),[copies,setCopies]=React.useState<Record<string,{state:'available'|'missing'|'unknown';trackId:string|null;inLibrary:boolean|null}>>({});
 const inspectionTail=React.useRef<Promise<void>>(Promise.resolve()),inspectedEdition=React.useRef<AlbumDetail|null>(null),finishedInspection=React.useRef<AlbumDetail|null>(null);
 const loadedMetadata=React.useRef<string|null>(null);
 const [saveNotice,setSaveNotice]=React.useState('');
 const [saving,setSaving]=React.useState(false),savingRef=React.useRef(false);
 const [progress,setProgress]=React.useState<AlbumProgress|null>(null),[busy,setBusy]=React.useState(false);
 const [,refreshCoordinator]=React.useReducer(n=>n+1,0);
 const rows=React.useRef<AlbumRow[]>([]),flight=React.useRef<{attempt:SongPlaybackAttempt;current:()=>boolean}|null>(null);
 const [editions,setEditions]=React.useState<AlbumEdition[]>([]),[detail,setDetail]=React.useState<AlbumDetail|null>(fixedDetail??null),[status,setStatus]=React.useState(fixedDetail?'':'Buscando ediciones…');
 const runKey=(album:AlbumDetail)=>JSON.stringify([props.accountId??null,detailKey(album)]);
 const [retryVersion,retryMetadata]=React.useReducer(n=>n+1,0),[retryTarget,setRetryTarget]=React.useState<AlbumEdition|null|undefined>(undefined);
 React.useEffect(()=>{
  if(props.metadataOnly)return;
  const synchronize=()=>{if(!detail)return;const saved=props.coordinator.rows.get(detail.edition.id);if(saved&&saved.key===runKey(detail)){rows.current=saved.rows.map(r=>({...r}));setProgress({rows:rows.current,message:saved.message??'Comprueba las copias antes de continuar.'});}};
  const listener=()=>{refreshCoordinator();synchronize();if(detail&&!props.coordinator.running){inspectedEdition.current=null;bumpInspection();}};
  props.coordinator.listeners.add(listener);synchronize();
  // Initial subscription must not abort the first full copy inspection.
  return()=>{props.coordinator.listeners.delete(listener);};
 },[props.coordinator,detail,props.metadataOnly,props.accountId]);
 const latest=React.useRef(props),committed=React.useRef<object|null>(null),mounted=React.useRef(false),op=React.useRef<AbortController|null>(null),metadata=React.useRef<AbortController|null>(null),heading=React.useRef<HTMLHeadingElement>(null);
 React.useLayoutEffect(()=>{latest.current=props;mounted.current=true;heading.current?.focus();return()=>{mounted.current=false;};},[]);
 const renderToken={};
 React.useLayoutEffect(()=>{latest.current=props;committed.current=renderToken;return()=>{if(committed.current===renderToken)committed.current=null;};});
 const active=()=>mounted.current&&committed.current===renderToken&&props.visible;
 const stop=()=>{op.current?.abort();};
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
  const abort=new AbortController();metadata.current=abort;setDetail(null);setEditions([]);setRetryTarget(undefined);setStatus('Buscando ediciones…');
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
 const chooseEdition=(edition:AlbumEdition)=>{if(!active())return;stop();metadata.current?.abort();const abort=new AbortController();metadata.current=abort;setDetail(null);const identity=metadataIdentity(props);const live=()=>mounted.current&&metadata.current===abort&&!abort.signal.aborted&&latest.current.visible&&metadataIdentity(latest.current)===identity;void load(edition,abort,live);};
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
 React.useEffect(()=>{
  if(props.metadataOnly||!detail||!props.visible){inspectedEdition.current=null;setInspecting(false);return;}
  if(running){setInspecting(false);return;}
  const abort=new AbortController(),first=inspectedEdition.current!==detail;inspectedEdition.current=detail;
  if(first)setCopies({});
  const targets=first||props.libraryView?detail.tracks:detail.tracks.filter(t=>albumTrackChoice(t,detail.edition.title).id===props.selectedKey);
  finishedInspection.current=null;setInspecting(true);
  const run=async()=>{
   if(abort.signal.aborted)return;
   const inspector=latest.current.captureInspection?.();if(!inspector)return;
   for(const track of targets){
    if(abort.signal.aborted||!mounted.current||!latest.current.visible||latest.current.coordinator.running)break;
    const choice=albumTrackChoice(track,detail.edition.title);
    let value:{state:'available'|'missing'|'unknown';trackId:string|null;inLibrary:boolean|null}={state:'unknown',trackId:null,inLibrary:null};
    try{if(inspector.current())value=await inspector.inspect(choice,abort.signal);}catch{/* Unknown is not a verified copy. */}
    if(abort.signal.aborted||!mounted.current)break;
    setCopies(previous=>({...previous,[choice.id]:value}));
   }
  };
  const task=inspectionTail.current.catch(()=>{}).then(run);inspectionTail.current=task;
  void task.finally(()=>{if(!abort.signal.aborted&&mounted.current){finishedInspection.current=detail;setInspecting(false);}});
  return()=>abort.abort();
 },[detail,props.scope,props.visible,props.metadataOnly,inspectionSelection,inspectionRevision,inspectionSignature,running]);
 const savedAlbum=props.savedAlbums?.find(album=>album.edition.id===detail?.edition.id);
 async function addAlbum(download=true){
  if(!active()||flight.current||savingRef.current||props.coordinator.running||!detail||download&&inspecting)return;
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
     if(sameEdition())setSaveNotice(result?.state==='limit'?'Llegaste al máximo de 500 álbumes guardados. Quita alguno de Biblioteca para guardar este.':'No se pudo guardar el álbum en Biblioteca.');
     return;
    }
   }
   if(!download||!sameEdition()||!await downloadWithCurrentApp(props.accountId,{kind:'album',editionId,title,artist},sameEdition))return;
  }finally{savingRef.current=false;if(mounted.current)setSaving(false);}
  const p=latest.current;
  if(!sameEdition()||flight.current||p.coordinator.running)return;
  const attempt=p.capture();if(!attempt){announceDownloadMessage('La biblioteca está ocupada o requiere revisión en Almacenamiento.');return;}
  const abort=new AbortController(),identity={attempt,current:()=>attempt.current()};op.current=abort;flight.current=identity;
  const {scope,client,revision,provider,coordinator}=p,providers=p.providers.map(row=>({...row})),snapshot=detail;
  const run:AlbumDownloadRun={scope,editionId:snapshot.edition.id,key:runKey(snapshot),title:snapshot.edition.title,abort};
  coordinator.notice={title:run.title,titles:snapshot.tracks.map(track=>track.title),progress:{rows:rows.current,message:'Comprobando copias…'}};
  coordinator.active=run;coordinator.running=true;notifyAlbumDownload(coordinator);setBusy(true);
  // Route visibility/unmount is presentation only. The captured root attempt and
  // Telegram driver's original account/provider guards remain authoritative.
  const boundSession=client?.snapshot().phase==='connected'?client.captureBotsCurrent():null;
  const current=()=>coordinator.active===run&&attempt.current()&&(!boundSession||boundSession()&&(revision===undefined||client!.botsSnapshot().revision===revision));identity.current=current;
  const unsubscribe=client?.subscribeSearch(()=>{let valid=false;try{valid=current();}catch{/* Revoked. */}if(!valid)abort.abort();});
  if(rows.current.length!==snapshot.tracks.length)rows.current=snapshot.tracks.map(()=>({state:'unattempted',trackId:null,confirmed:false,message:''}));
  void acquireAlbum({detail:snapshot,attempt,client,provider,providers,revision,management:p.management,signal:abort.signal,current,rows:rows.current,remoteClock:coordinator.remoteClock,uncertainTracks:coordinator.uncertainTracks,update:value=>{
   if(coordinator.active!==run)return;rows.current=value.rows;coordinator.rows.set(snapshot.edition.id,{key:run.key,rows:value.rows.map(r=>({...r})),message:value.message});coordinator.notice={title:run.title,titles:snapshot.tracks.map(track=>track.title),progress:value};notifyAlbumDownload(coordinator);
   downloadNotifications.notify('album',run,run.title,`${value.rows.filter(row=>row.confirmed).length} de ${value.rows.length} canciones guardadas`,false,current);
   if(mounted.current&&flight.current===identity)setProgress(value);
  }}).then(async()=>{
   if(!p.saveAlbum||!saved||!current())return;
   const failures=new Set(saved.failedTracks);
   rows.current.forEach((row,index)=>{
    const key=albumTrackChoice(snapshot.tracks[index],title).id;
    if(row.state==='failed')failures.add(key);
    else if(row.confirmed)failures.delete(key);
   });
   try{await p.saveAlbum(snapshot,current,{savedAt:saved.savedAt,failedTracks:[...failures]});}catch{/* Verified audio stays available. */}
  }).finally(()=>{unsubscribe?.();if(coordinator.active===run){const confirmed=(coordinator.rows.get(snapshot.edition.id)?.rows??[]).filter(row=>row.confirmed).length;downloadNotifications.notify('album',run,run.title,confirmed===snapshot.tracks.length?'Álbum guardado.':`Descarga detenida: ${confirmed} de ${snapshot.tracks.length} canciones guardadas.`,true,()=>attempt.current()&&(!coordinator.active||coordinator.active===run)&&(!boundSession||boundSession()));coordinator.active=undefined;coordinator.running=false;notifyAlbumDownload(coordinator);}if(flight.current===identity){op.current=null;flight.current=null;if(mounted.current){setBusy(false);inspectedEdition.current=null;bumpInspection();}}});
 }
 React.useEffect(()=>{
  if(!props.resumeDownload||resumed.current)return;
  if(!props.visible||retryTarget!==undefined||detail&&detail.edition.id!==props.editionId){cancelResume();return;}
  if(!detail||finishedInspection.current!==detail||inspecting||!active()||props.coordinator.running)return;
  resumed.current=true;
  void addAlbum().finally(props.resumeDownload);
 });
 React.useEffect(()=>{if(!op.current||op.current.signal.aborted||!flight.current)return;let valid=false;try{valid=flight.current.current();}catch{/* Fail closed without tying work to route visibility. */}if(!valid)stop();});
 const renderedOperation=op.current;
 const activeRun=props.coordinator.active;
 const ownRun=running&&detail&&activeRun?.editionId===detail.edition.id&&activeRun.key===runKey(detail);
 const activeProgress=busy||!!ownRun;
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
 const albumImage=detail?.edition.artworkUrl??props.artworkUrl??(editions.length===1?editions[0].artworkUrl:undefined);
 return <section className="album-page" aria-labelledby={headingId}>
  <BackButton onClick={()=>{if(active()&&op.current===renderedOperation){props.onBack();}}}>{props.backLabel??(props.libraryView?'Volver a Biblioteca':'Volver a búsqueda')}</BackButton>
  <div className="album-hero"><span className="album-art"><CollectionCover variant="album" artworkUrl={albumImage} trackIds={firstCopy?[firstCopy]:[]} enabled={props.visible}/></span><div><p className="catalog-eyebrow">ÁLBUM</p><h2 id={headingId} ref={heading} tabIndex={-1}>{detail?.edition.title??props.title}</h2><p className="album-artist">{detail?.edition.artist??props.artist}</p>{detail&&<p>{detail.tracks.length} pistas · {new Set(detail.tracks.map(t=>t.disc)).size} discos</p>}{savedAlbum&&<p role="status">{downloaded} de {detail!.tracks.length} descargadas</p>}</div></div>

  {status&&<p role="status">{status}</p>}
  {retryTarget!==undefined&&<button type="button" onClick={()=>{if(!active())return;if(retryTarget)chooseEdition(retryTarget);else retryMetadata();}}>Reintentar consulta</button>}
  {editions.length>0&&(!detail||editions.length>1)&&<section aria-label="Ediciones"><h3>Ediciones</h3><ul>{editions.map(e=><li key={e.id}><button type="button" disabled={busy||inspecting||props.coordinator.running} onClick={()=>chooseEdition(e)}>{e.title} · {e.artist} · {e.releaseDate?.slice(0,10)??'fecha desconocida'}{e.trackCount?` · ${e.trackCount} pistas`:''}</button></li>)}</ul></section>}
  {detail&&props.metadataOnly&&<><h3 className="album-tracks-heading">Canciones</h3><ol className="album-tracks">{detail.tracks.map(track=><li key={`${track.disc}:${track.position}`}><span className="album-track-copy"><strong><bdi dir="auto">{track.title}</bdi></strong><span><bdi dir="auto">{track.artist}</bdi></span></span></li>)}</ol></>}
  {detail&&!props.metadataOnly&&<>
   <div className="album-actions">
    {!savedAlbum&&props.saveAlbum&&<button type="button" disabled={!props.canSaveAlbum||saving||props.coordinator.running} onClick={()=>void addAlbum(false)}>Guardar álbum</button>}
    {(!props.libraryView||!savedAlbum||downloaded<detail.tracks.length||props.coordinator.running)&&
     <CollectionDownloadButton coordinator={props.coordinator} label={albumAction} showLabel={props.libraryView} disabled={busy||saving||inspecting||!!props.saveAlbum&&!props.canSaveAlbum} onStart={()=>void addAlbum()}/>}
    {!props.coordinator.running&&!saving&&props.albumOptions}
   </div>
   {saveNotice&&<p role="status">{saveNotice}</p>}
   {inspecting&&<p role="status">Comprobando copias locales…</p>}
   <h3 className="album-tracks-heading">Canciones</h3>
   <ol className="album-tracks">{detail.tracks.map((track,index)=>{
    const choice=albumTrackChoice(track,detail.edition.title),copy=copies[choice.id],row=visibleRows?.[index];
    const present=available(choice.id,index),pending=props.libraryView&&!!savedAlbum&&!present;
    const failed=row?.state==='failed'||savedAlbum?.failedTracks.includes(choice.id);
    const trackId=copy?.trackId??row?.trackId;
    const local=props.libraryView&&present&&trackId?localTrackIndex.get(trackId):undefined;
    const inLibrary=member(choice.id,index);
    const badge=present?(savedAlbum&&!inLibrary?'En caché de escucha':'Descargada'):pending&&failed?'Error':copy?.state==='missing'?(pending?'No descargada':'Sin descarga'):'Copia sin comprobar';
    return <li key={`${track.disc}:${track.position}`} data-album-pending={pending||undefined}>
     <button type="button" disabled={pending||busy||inspecting||props.coordinator.running} onClick={()=>{if(active()&&!flight.current&&!props.coordinator.running&&!inspecting)props.onChoose(choice);}}>
      <span className="album-track-number" aria-label={`Disco ${track.disc}, pista ${track.position}`}>{track.position}</span>
      <span className="album-track-copy"><strong><bdi dir="auto">{local?.manualOverrides?.title??track.title}</bdi></strong><span><bdi dir="auto">{local?.manualOverrides?.artist??track.artist}</bdi></span></span>
     </button>
     <span className="album-track-badges">{trackId&&props.playerTrackId===trackId&&<PlaybackIndicator/>}{badge}{inLibrary?' · En Biblioteca':''}</span>
     {(props.actionKey??props.selectedKey)===choice.id&&props.songActions}
    </li>;
   })}</ol>
  </> }

   <details className="catalog-sources"><summary>Fuente de los metadatos</summary><p>Catálogo {detail&&musicBrainzId(detail.edition.id)||!detail&&editions.some(e=>musicBrainzId(e.id))?<a href={detail&&musicBrainzId(detail.edition.id)?'https://musicbrainz.org/release/'+detail.edition.id.slice(12):'https://musicbrainz.org'} target="_blank" rel="noopener noreferrer">MusicBrainz · respaldo</a>:<a href="https://www.apple.com/itunes/" target="_blank" rel="noopener noreferrer">iTunes US</a>}.</p></details>
 </section>;
}
