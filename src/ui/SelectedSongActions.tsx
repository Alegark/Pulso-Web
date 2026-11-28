import {formatStorageProgress} from '../library/storage-format';
import React from 'react';
import './selected-song-actions.css';

export interface SelectedSongActionsProps {
 title:string; artist:string|null; status:string|null; error:string|null;
 pending:boolean; progress?:{bytes:number;total:number}|null;
 inLibrary:boolean; canAdd:boolean; canPlay:boolean;
 playlists:readonly {id:string;name:string}[]; canAddToPlaylist:boolean;
 onAdd:()=>void; onPlay:()=>void; onAddToPlaylist:(id:string)=>void;
 onCancel:()=>void; current:()=>boolean;
}

/** Product state and side effects belong to the caller. */
export function SelectedSongActions(props:SelectedSongActionsProps){
 const committed=React.useRef<SelectedSongActionsProps|null>(null);
 React.useLayoutEffect(()=>{committed.current=props;return()=>{committed.current=null;};});
 let expired=false;
 const active=()=>{if(expired)return false;if(committed.current!==props||!props.current()){expired=true;return false;}return true;};
 const progress=props.progress;
 const validProgress=progress&&Number.isFinite(progress.bytes)&&Number.isFinite(progress.total)&&progress.total>0&&progress.bytes>=0;
 const feedback=[props.status,validProgress?formatStorageProgress(progress.bytes,progress.total):null].filter((value,index,all)=>!!value&&all.indexOf(value)===index).join('. ');
 if(!props.pending&&!props.error)return null;
 return <section className="selected-song-actions">
  {props.error&&<p role="alert">{props.error}</p>}
  {props.pending&&<><p className="selected-song-feedback">{feedback||'Obteniendo la canción…'}</p><progress aria-label={`Carga de ${props.title}`} value={validProgress?Math.min(progress.bytes,progress.total):undefined} max={validProgress?progress.total:undefined}/><button className="song-load-cancel" type="button" onClick={()=>{if(active())props.onCancel();}}>Cancelar carga</button></>}
 </section>;
}
