import {useEffect,useReducer,useState} from 'react';
import {albumCoordinator} from '../library/album-download';

export function useAlbumDownloadState(){
 const [,refresh]=useReducer(n=>n+1,0);
 useEffect(()=>{
  const listener=()=>refresh();
  albumCoordinator.listeners.add(listener);
  return()=>{albumCoordinator.listeners.delete(listener);};
 },[]);
 return albumCoordinator;
}

export function AlbumDownloadNotice({coordinator}:{coordinator:ReturnType<typeof useAlbumDownloadState>}){
 const [expanded,setExpanded]=useState(false);
 const {notice,active,running}=coordinator;
 if(!notice)return null;
 const confirmed=notice.progress.rows.filter(row=>row.confirmed).length,total=notice.progress.rows.length;
 const rows=notice.progress.rows;
 const state=running?'Descargando':confirmed===total?'Descarga completa':'Descarga detenida';
 return <section className="download-progress" aria-label="Progreso de descarga">
  <strong><bdi dir="auto">{notice.title}</bdi></strong>
  <p role="status">{state} · {confirmed} de {total} guardadas</p>
  {running&&<progress aria-label="Canciones guardadas" value={confirmed} max={Math.max(1,total)}/>}
  <p>{!running&&total===1&&confirmed===0?rows[0].message||notice.progress.message:notice.progress.message}</p>
  {confirmed<total&&<details aria-label="Descargas" onToggle={event=>setExpanded(event.currentTarget.open)}><summary>Ver canciones</summary>
   {expanded&&<ol>{rows.map((row,index)=><li key={index}><strong>{notice.titles?.[index]??`Canción ${index+1}`}</strong><span>{row.message||'En espera'}</span>
    {notice.reviewTrack&&!running&&(row.state==='failed'||row.state==='uncertain')&&<button type="button" onClick={()=>notice.reviewTrack?.(index)}>Revisar descarga</button>}
   </li>)}</ol>}
  </details>}
  {running&&active&&<button type="button" onClick={()=>{if(coordinator.active===active)active.abort.abort();}}>{active.scope==='library'?'Detener descarga de Biblioteca':'Detener descarga de álbum'}</button>}
 </section>;
}
