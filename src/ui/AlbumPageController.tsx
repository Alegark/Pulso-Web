import React from 'react';
import {AlbumCatalog,type AlbumDetail,type AlbumEdition} from '../library/album-catalog';
import {acquireAlbum,albumTrackChoice,type AlbumRow,type AlbumProgress} from '../library/album-acquisition';
import {musicCatalogKey} from '../library/music-search-catalog';
import type {SongChoice,SongPlaybackAttempt,SongManagement,SongCopyInspection} from '../library/selected-song';
import type {TelegramSessionClient} from '../telegram/session-client';
import './album-page.css';
const catalog=new AlbumCatalog((...args)=>fetch(...args));
const detailKey=(detail:AlbumDetail)=>JSON.stringify(detail.tracks.map(track=>albumTrackChoice(track,detail.edition.title))); 
export interface AlbumCoordinator {running:boolean;uncertainTracks:Set<number>;remoteClock:{settledAt:number};rows:Map<number,{key:string;rows:AlbumRow[]}>;listeners:Set<()=>void>}
interface Props {coordinator:AlbumCoordinator;captureInspection?:()=>SongCopyInspection|null;selectedKey:string|null;libraryTrackIds?:ReadonlySet<string>;title:string;artist:string|null;editionId?:number;backLabel?:string;scope:string;visible:boolean;client:TelegramSessionClient|null;revision:number|undefined;provider:string|null;capture:()=>SongPlaybackAttempt|null;management:(id:string)=>SongManagement|null;onBack:()=>void;onChoose:(choice:SongChoice)=>void;songActions:React.ReactNode}
const metadataIdentity=(props:Props)=>JSON.stringify([props.title,props.artist,props.editionId??null,props.scope]);
export function AlbumPageController(props:Props){
 const [inspectionRevision,bumpInspection]=React.useReducer(n=>n+1,0);
 const [inspecting,setInspecting]=React.useState(false),[copies,setCopies]=React.useState<Record<string,{state:'available'|'missing'|'unknown';trackId:string|null;inLibrary:boolean|null}>>({});
 const inspectionTail=React.useRef<Promise<void>>(Promise.resolve()),inspectedEdition=React.useRef<AlbumDetail|null>(null);
 const loadedMetadata=React.useRef<string|null>(null);
 const [progress,setProgress]=React.useState<AlbumProgress|null>(null),[busy,setBusy]=React.useState(false);
 const [,refreshCoordinator]=React.useReducer(n=>n+1,0);
 const rows=React.useRef<AlbumRow[]>([]),flight=React.useRef<{attempt:SongPlaybackAttempt}|null>(null);
 const [editions,setEditions]=React.useState<AlbumEdition[]>([]),[detail,setDetail]=React.useState<AlbumDetail|null>(null),[status,setStatus]=React.useState('Buscando ediciones…');
 React.useEffect(()=>{const listener=()=>{refreshCoordinator();if(!props.coordinator.running&&!flight.current&&detail){const saved=props.coordinator.rows.get(detail.edition.id);if(saved&&saved.key===detailKey(detail)){rows.current=saved.rows.map(r=>({...r}));setProgress({rows:rows.current,message:'Comprueba las copias antes de continuar.'});}}};props.coordinator.listeners.add(listener);return()=>{props.coordinator.listeners.delete(listener);};},[props.coordinator,detail]);
 const latest=React.useRef(props),committed=React.useRef<object|null>(null),mounted=React.useRef(false),op=React.useRef<AbortController|null>(null),metadata=React.useRef<AbortController|null>(null),heading=React.useRef<HTMLHeadingElement>(null);
 React.useLayoutEffect(()=>{latest.current=props;mounted.current=true;heading.current?.focus();return()=>{mounted.current=false;};},[]);
 const renderToken={};
 React.useLayoutEffect(()=>{latest.current=props;committed.current=renderToken;return()=>{if(committed.current===renderToken)committed.current=null;};});
 const active=()=>mounted.current&&committed.current===renderToken&&props.visible;
 const stop=()=>{op.current?.abort();props.client?.captureSearchCancel()?.();};
 React.useEffect(()=>()=>{metadata.current?.abort();op.current?.abort();props.client?.captureSearchCancel()?.();},[props.scope,props.client,props.revision,props.visible]);
 React.useEffect(()=>{
  if(!props.visible)return;
  const identity=metadataIdentity(props);
  if(detail&&loadedMetadata.current===identity)return;
  const abort=new AbortController();metadata.current=abort;setDetail(null);setEditions([]);setStatus('Buscando ediciones…');
  const live=()=>mounted.current&&metadata.current===abort&&!abort.signal.aborted&&latest.current.visible&&metadataIdentity(latest.current)===identity;
  if(props.editionId){void load({id:props.editionId,title:props.title,artist:props.artist??'',trackCount:0,releaseDate:null},abort,live);return()=>abort.abort();}
  void catalog.search(props.title,props.artist,{signal:abort.signal,current:live}).then(async result=>{
   if(!live())return;if(!result.ok){setStatus('No se pudo consultar el catálogo de álbumes.');return;}
   const candidates=props.artist?result.value.filter(e=>musicCatalogKey(e.title)===musicCatalogKey(props.title)&&musicCatalogKey(e.artist)===musicCatalogKey(props.artist!)):result.value;
   setEditions(candidates);if(candidates.length===1&&props.artist){await load(candidates[0],abort,live);return;}
   setStatus(candidates.length?'Elige una edición para ver sus pistas.':'No se encontraron ediciones compatibles.');
  });
  return()=>abort.abort();
 },[props.title,props.artist,props.editionId,props.scope,props.visible]);
 async function load(edition:AlbumEdition,abort:AbortController,live:()=>boolean){
  setStatus('Cargando pistas…');const result=await catalog.load(edition.id,{signal:abort.signal,current:live});if(!live())return;
  if(!result.ok){setStatus('No se pudo verificar la lista completa de pistas de esta edición.');return;}loadedMetadata.current=metadataIdentity(props);setDetail(result.value);setCopies({});inspectedEdition.current=null;const saved=props.coordinator.rows.get(result.value.edition.id),compatible=saved?.key===detailKey(result.value);rows.current=compatible?saved.rows.map(r=>({...r})):result.value.tracks.map(()=>({state:'unattempted',trackId:null,confirmed:false,message:''}));setProgress(compatible?{rows:rows.current,message:'Comprueba las copias antes de continuar.'}:null);setStatus('');
 }
 const chooseEdition=(edition:AlbumEdition)=>{if(!active())return;stop();metadata.current?.abort();const abort=new AbortController();metadata.current=abort;setDetail(null);const live=()=>mounted.current&&metadata.current===abort&&!abort.signal.aborted&&latest.current.visible&&latest.current.scope===props.scope;void load(edition,abort,live);};
 React.useEffect(()=>{if(op.current&&!op.current.signal.aborted&&!props.visible)stop();});
 React.useEffect(()=>{
  if(!detail||!props.visible){inspectedEdition.current=null;setInspecting(false);return;}
  const abort=new AbortController(),first=inspectedEdition.current!==detail;inspectedEdition.current=detail;
  if(first)setCopies({});
  const targets=first?detail.tracks:detail.tracks.filter(t=>albumTrackChoice(t,detail.edition.title).id===props.selectedKey);
  setInspecting(true);
  const run=async()=>{
   if(abort.signal.aborted)return;
   const inspector=latest.current.captureInspection?.();if(!inspector)return;
   for(const track of targets){
    if(abort.signal.aborted||!mounted.current||!latest.current.visible)break;
    const choice=albumTrackChoice(track,detail.edition.title);
    let value:{state:'available'|'missing'|'unknown';trackId:string|null;inLibrary:boolean|null}={state:'unknown',trackId:null,inLibrary:null};
    try{if(inspector.current())value=await inspector.inspect(choice,abort.signal);}catch{/* Unknown is not a verified copy. */}
    if(abort.signal.aborted||!mounted.current)break;
    setCopies(previous=>({...previous,[choice.id]:value}));
   }
  };
  const task=inspectionTail.current.catch(()=>{}).then(run);inspectionTail.current=task;
  void task.finally(()=>{if(!abort.signal.aborted&&mounted.current)setInspecting(false);});
  return()=>abort.abort();
 },[detail,props.scope,props.visible,props.selectedKey,inspectionRevision]);
 const addAlbum=()=>{
  if(!active()||flight.current||props.coordinator.running||inspecting||!detail)return;
  const attempt=props.capture();if(!attempt){setProgress({rows:rows.current,message:'La biblioteca está ocupada o requiere revisión en Almacenamiento.'});return;}
  const abort=new AbortController(),identity={attempt};op.current=abort;flight.current=identity;props.coordinator.running=true;for(const notify of props.coordinator.listeners)notify();setBusy(true);
  const scope=props.scope,client=props.client,revision=props.revision,provider=props.provider, snapshot=detail;
  const current=()=>mounted.current&&flight.current===identity&&latest.current.visible&&latest.current.scope===scope&&latest.current.client===client&&latest.current.revision===revision&&latest.current.provider===provider;
  void acquireAlbum({detail:snapshot,attempt,client,provider,revision,management:props.management,signal:abort.signal,current,rows:rows.current,remoteClock:props.coordinator.remoteClock,uncertainTracks:props.coordinator.uncertainTracks,update:value=>{if(flight.current!==identity)return;rows.current=value.rows;props.coordinator.rows.set(snapshot.edition.id,{key:detailKey(snapshot),rows:value.rows.map(r=>({...r}))});if(mounted.current)setProgress(value);}}).finally(()=>{if(flight.current===identity){op.current=null;props.coordinator.running=false;for(const notify of props.coordinator.listeners)notify();flight.current=null;if(mounted.current){setBusy(false);inspectedEdition.current=null;bumpInspection();}}});
 };
 React.useEffect(()=>{if(!op.current||op.current.signal.aborted||!flight.current)return;let valid=false;try{valid=props.visible&&flight.current.attempt.current();}catch{/* fail closed */}if(!valid)stop();});
 return <section className="album-page" aria-labelledby="album-page-heading">
  <button type="button" onClick={()=>{if(active()){stop();props.onBack();}}}>{props.backLabel??'Volver a búsqueda'}</button>
  <h2 id="album-page-heading" ref={heading} tabIndex={-1}>{detail?.edition.title??props.title}</h2>
  <p>Metadatos del catálogo <a href="https://www.apple.com/itunes/" target="_blank" rel="noopener noreferrer">iTunes US</a>.</p>
  {status&&<p role="status">{status}</p>}
  {editions.length>0&&(!detail||editions.length>1)&&<section aria-label="Ediciones"><h3>Ediciones</h3><ul>{editions.map(e=><li key={e.id}><button type="button" disabled={busy||inspecting||props.coordinator.running} onClick={()=>chooseEdition(e)}>{e.title} · {e.artist} · {e.releaseDate?.slice(0,10)??'fecha desconocida'} · {e.trackCount} pistas</button></li>)}</ul></section>}
  {detail&&<><p>{detail.edition.artist} · {detail.tracks.length} pistas · {new Set(detail.tracks.map(t=>t.disc)).size} discos</p><button type="button" disabled={busy||inspecting||props.coordinator.running} onClick={addAlbum}>{progress?'Continuar álbum':'Añadir álbum'}</button>{busy&&<button type="button" onClick={()=>{if(active())stop();}}>Cancelar incorporación</button>}
   {progress&&<div role="status"><p>{progress.message}</p><p>{progress.rows.filter(r=>r.confirmed).length}/{progress.rows.length} en Biblioteca · {progress.rows.filter(r=>r.state==='reused').length} reutilizadas · {progress.rows.filter(r=>r.state==='downloaded').length} descargadas · {progress.rows.filter(r=>r.state==='failed').length} fallidas · {progress.rows.filter(r=>r.state==='unattempted').length} sin intentar · {progress.rows.filter(r=>r.state==='uncertain').length} requieren revisión</p></div>}
   {inspecting&&<p role="status">Comprobando copias locales…</p>}{props.songActions}<ol>{detail.tracks.map(t=><li key={`${t.disc}:${t.position}`}><button type="button" disabled={busy||inspecting||props.coordinator.running} onClick={()=>{if(active()&&!flight.current&&!props.coordinator.running&&!inspecting){props.onChoose(albumTrackChoice(t,detail.edition.title));}}}><span>Disco {t.disc} · {t.position}.</span> <strong>{t.title}</strong> · {t.artist}</button>{(()=>{const copy=copies[albumTrackChoice(t,detail.edition.title).id],row=progress?.rows[detail.tracks.indexOf(t)],trackId=row?.trackId??copy?.trackId,member=trackId&&props.libraryTrackIds?props.libraryTrackIds.has(trackId):copy?.inLibrary===true;return <span> · {busy&&row?.confirmed||copy?.state==='available'?'Descargada':copy?.state==='missing'?'Sin descarga':'Copia sin comprobar'}{member?' · En Biblioteca':''}</span>;})()}{progress&&<span> · {progress.rows[detail.tracks.indexOf(t)]?.message||'Sin intentar'}</span>}</li>)}</ol></>}
 </section>;
}
