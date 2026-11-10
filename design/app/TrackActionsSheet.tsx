import {useId,useLayoutEffect,useRef} from 'react';
import type {DemoPlaylist} from './playlists';
interface TrackActionsSheetProps {
  track:{id:string;title:string;artist:string}|null;
  saved:boolean;
  playlists:DemoPlaylist[];
  opener:HTMLButtonElement|null;
  onClose:()=>void;
  onPlay:()=>void;
  onSave:()=>void;
  onAdd:(playlistId:string)=>void;
}
/** Local design actions; native dialog provides modal focus and background inert. */
export function TrackActionsSheet(props:TrackActionsSheetProps){
  const id=useId(),dialog=useRef<HTMLDialogElement>(null),heading=useRef<HTMLHeadingElement>(null);
  const trackId=props.track?.id;
  useLayoutEffect(()=>{
    const node=dialog.current;if(!trackId||!node)return;
    const viewport=window.visualViewport;
    const measure=()=>{
      node.style.setProperty('--sheet-height',`${viewport?.height??innerHeight}px`);
      node.style.setProperty('--sheet-bottom',`${Math.max(0,innerHeight-(viewport?.height??innerHeight)-(viewport?.offsetTop??0))}px`);
    };
    measure();const previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';node.showModal();heading.current?.focus({preventScroll:true});
    const opener=props.opener;
    viewport?.addEventListener('resize',measure);viewport?.addEventListener('scroll',measure);window.addEventListener('resize',measure);
    return()=>{if(node.open)node.close();document.body.style.overflow=previousOverflow;viewport?.removeEventListener('resize',measure);viewport?.removeEventListener('scroll',measure);window.removeEventListener('resize',measure);if(opener?.isConnected)opener.focus({preventScroll:true});else document.querySelector<HTMLElement>('.page-heading h1')?.focus({preventScroll:true});};
  },[trackId]);
  return <dialog ref={dialog} className="track-action-sheet" aria-labelledby={id} onCancel={event=>{event.preventDefault();props.onClose();}}>
    {props.track&&<><div className="track-action-sheet__head"><div><h2 ref={heading} tabIndex={-1} id={id}>Opciones de {props.track.title}</h2><p>{props.track.artist}</p></div><button type="button" className="round-button" aria-label="Cerrar opciones de canción" onClick={props.onClose}>×</button></div>
      <div className="track-action-sheet__body"><button type="button" onClick={()=>{props.onPlay();props.onClose();}}>▶ Reproducir ahora</button><button type="button" onClick={()=>{props.onSave();props.onClose();}}>{props.saved?'✓ Quitar de Favoritos':'+ Añadir a Favoritos'}</button>
        <h3>Añadir a una playlist</h3>{props.playlists.length?props.playlists.map(playlist=>{const present=playlist.trackIds.includes(props.track!.id);return <button key={playlist.id} type="button" disabled={present} onClick={()=>{props.onAdd(playlist.id);props.onClose();}}><strong>{playlist.name}</strong><span>{present?'Ya está en esta playlist':`${playlist.trackIds.length} canciones`}</span></button>;}):<p>Crea primero una playlist desde Biblioteca.</p>}
        <p className="detail-footnote">Cambios de muestra en esta pestaña. Añadir no descarga ni envía mensajes.</p>
      </div></>}
  </dialog>;
}
