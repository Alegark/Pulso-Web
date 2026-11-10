import {useLayoutEffect,useRef,useState} from 'react';
import {albumFor,artistFor,tracks,type DemoTrack} from './catalog';
import type {DemoPlaylist} from './playlists';

export function PlaylistCover({playlist}:{playlist:DemoPlaylist}){
  if(playlist.automatic)return <span className="playlist-cover playlist-cover--favorites" aria-hidden="true"><svg viewBox="0 0 24 24" className="favorites-cover__heart"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" fill="currentColor"/></svg></span>;
  return <span className={`playlist-cover playlist-cover--${playlist.color}`} aria-hidden="true"><span className="playlist-cover__lines"><i/><i/><i/><i/></span><span className="playlist-cover__label">PULSO / PLAYLIST</span><strong>{playlist.name}</strong></span>;
}
export function PlaylistCards({playlists,onOpen}:{playlists:DemoPlaylist[];onOpen:(id:string)=>void}){
  return <div className="album-grid playlist-grid">{playlists.map(playlist=><button type="button" id={`playlist-${playlist.id}`} key={playlist.id} className="album-card" onClick={()=>onOpen(playlist.id)}><PlaylistCover playlist={playlist}/><strong>{playlist.name}</strong><span>{playlist.trackIds.length} canciones · Playlist</span></button>)}</div>;
}
export function PlaylistForm({playlist,onSave,onCancel}:{playlist?:DemoPlaylist;onSave:(name:string,description:string)=>void;onCancel:()=>void}){
  const [name,setName]=useState(playlist?.name??''),[description,setDescription]=useState(playlist?.description??'');
  const input=useRef<HTMLInputElement>(null);
  useLayoutEffect(()=>input.current?.focus(),[]);
  return <form className="playlist-form" onSubmit={event=>{event.preventDefault();if(name.trim())onSave(name.trim(),description.trim());}}>
    <h2>{playlist?'Editar playlist':'Nueva playlist'}</h2>
    <label htmlFor="playlist-name">Nombre<input ref={input} id="playlist-name" value={name} maxLength={80} required onChange={event=>setName(event.target.value)}/></label>
    <label htmlFor="playlist-description">Descripción <span>(opcional)</span><textarea id="playlist-description" value={description} maxLength={160} rows={2} onChange={event=>setDescription(event.target.value)}/></label>
    <div className="detail-actions"><button type="submit" className="primary-button" disabled={!name.trim()}>{playlist?'Guardar cambios':'Crear playlist'}</button><button type="button" onClick={onCancel}>Cancelar</button></div>
    <p>Sólo se conserva en esta muestra. No crea canales ni mensajes.</p>
  </form>;
}
export function PlaylistCollection({playlists,onOpen,onCreate,creating,onCreating}:{playlists:DemoPlaylist[];onOpen:(id:string)=>void;onCreate:(name:string,description:string)=>void;creating:boolean;onCreating:(value:boolean)=>void}){
  const create=useRef<HTMLButtonElement>(null);
  return <div className="playlist-collection"><div className="section-heading"><div><h2>Tus playlists</h2><p className="intro-copy">Tu música, en el orden que eliges.</p></div><button ref={create} type="button" className="primary-button" onClick={()=>onCreating(true)}>+ Nueva playlist</button></div>
    {creating&&<PlaylistForm onSave={onCreate} onCancel={()=>{onCreating(false);create.current?.focus();}}/>}
    {playlists.length?<PlaylistCards playlists={playlists} onOpen={onOpen}/>:<div className="empty-state"><span className="empty-state__icon" aria-hidden="true">♫</span><h2>La próxima playlist la haces tú</h2><p>Crea una lista y añade canciones de la muestra.</p></div>}
  </div>;
}
interface PlaylistDetailProps {
  playlist:DemoPlaylist;
  current:string;
  title:(track:DemoTrack)=>string;
  onPlay:(id:string)=>void;
  onUpdate:(playlist:DemoPlaylist)=>void;
  onDelete:()=>void;
}
export function PlaylistDetail({playlist,current,title,onPlay,onUpdate,onDelete}:PlaylistDetailProps){
  const [editing,setEditing]=useState(false),[adding,setAdding]=useState(false),[deleting,setDeleting]=useState(false),[selected,setSelected]=useState(new Set<string>());
  const [announcement,setAnnouncement]=useState('');
  const edit=useRef<HTMLButtonElement>(null),add=useRef<HTMLButtonElement>(null),remove=useRef<HTMLButtonElement>(null),picker=useRef<HTMLHeadingElement>(null);
  const pendingFocus=useRef<string|null>(null);
  useLayoutEffect(()=>{if(adding)picker.current?.focus();},[adding]);
  useLayoutEffect(()=>{if(pendingFocus.current){document.getElementById(pendingFocus.current)?.focus();pendingFocus.current=null;}},[playlist]);
  const songs=playlist.trackIds.map(id=>tracks.find(t=>t.id===id)!),available=tracks.filter(t=>!playlist.trackIds.includes(t.id));
  function move(index:number,direction:-1|1){const ids=[...playlist.trackIds],target=index+direction;if(target<0||target>=ids.length)return;[ids[index],ids[target]]=[ids[target],ids[index]];pendingFocus.current=`playlist-play-${ids[target]}`;onUpdate({...playlist,trackIds:ids});setAnnouncement(`Canción movida a la posición ${target+1}.`);}
  return <>
    <div className="album-detail playlist-detail"><PlaylistCover playlist={playlist}/><div><span className="eyebrow">{playlist.automatic?'PLAYLIST AUTOMÁTICA':'HECHA POR TI · MUESTRA'}</span><p className="playlist-description">{playlist.description||'Un espacio para tus canciones.'}</p><p>{songs.length} canciones · Sin copias guardadas</p><div className="detail-actions"><button type="button" className="primary-button" disabled={!songs.length} onClick={()=>onPlay(songs[0].id)}>▶ Escuchar playlist</button>{!playlist.automatic&&<button ref={edit} type="button" onClick={()=>{setEditing(true);setDeleting(false);}}>Editar playlist</button>}</div>{!playlist.automatic&&<button ref={remove} type="button" className="text-button" onClick={()=>{setDeleting(true);setEditing(false);}}>Eliminar playlist</button>}</div></div>
    {editing&&<PlaylistForm playlist={playlist} onSave={(name,description)=>{onUpdate({...playlist,name,description});setEditing(false);setAnnouncement('Playlist actualizada.');edit.current?.focus();}} onCancel={()=>{setEditing(false);edit.current?.focus();}}/>}
    {deleting&&<div className="playlist-confirm" role="group" aria-label="Confirmar eliminación"><h2>¿Eliminar «{playlist.name}»?</h2><p>Las canciones seguirán en Biblioteca y en tus otras playlists.</p><div className="detail-actions"><button type="button" onClick={onDelete}>Confirmar eliminación de playlist</button><button type="button" onClick={()=>{setDeleting(false);remove.current?.focus();}}>Cancelar eliminación</button></div></div>}
    <div className="section-heading"><h2>Canciones</h2><button ref={add} type="button" onClick={()=>{setAdding(!adding);setSelected(new Set());}}>+ Añadir canciones</button></div>
    {adding&&<form className="playlist-picker" onSubmit={event=>{event.preventDefault();onUpdate({...playlist,trackIds:[...playlist.trackIds,...selected]});setAdding(false);setSelected(new Set());setAnnouncement('Canciones añadidas a la playlist.');add.current?.focus();}}><h3 ref={picker} tabIndex={-1}>Elige canciones de la muestra</h3>
      {available.length?<div className="playlist-picker__songs">{available.map(track=><label key={track.id}><input type="checkbox" checked={selected.has(track.id)} onChange={()=>setSelected(previous=>{const next=new Set(previous);if(next.has(track.id))next.delete(track.id);else next.add(track.id);return next;})}/><span><strong>{title(track)}</strong><span>{artistFor(albumFor(track)).name}</span></span></label>)}</div>:<p>Ya añadiste todas las canciones de la muestra.</p>}
      <div className="detail-actions"><button type="submit" className="primary-button" disabled={!selected.size}>Añadir selección{selected.size?` (${selected.size})`:''}</button><button type="button" onClick={()=>{setAdding(false);add.current?.focus();}}>Cancelar selección</button></div></form>}
    {songs.length?<ol className="playlist-tracks">{songs.map((track,index)=><li key={track.id} data-current={current===track.id?'true':undefined}><span className="song-number" aria-hidden="true">{String(index+1).padStart(2,'0')}</span><button id={`playlist-play-${track.id}`} type="button" className="song-main" aria-label={`Reproducir ${track.title}`} onClick={()=>onPlay(track.id)}><strong>{title(track)}</strong><span>{artistFor(albumFor(track)).name}</span></button><div className="playlist-track-actions">{!playlist.automatic&&<><button type="button" aria-label={`Subir ${track.title}`} disabled={index===0} onClick={()=>move(index,-1)}>↑</button><button type="button" aria-label={`Bajar ${track.title}`} disabled={index===songs.length-1} onClick={()=>move(index,1)}>↓</button></>}<button type="button" aria-label={`Quitar ${track.title} de ${playlist.automatic?'Favoritos':'la playlist'}`} onClick={()=>{const ids=playlist.trackIds.filter(id=>id!==track.id);pendingFocus.current=ids.length?`playlist-play-${ids[Math.min(index,ids.length-1)]}`:null;onUpdate({...playlist,trackIds:ids});if(!ids.length)add.current?.focus();setAnnouncement('Canción retirada de esta playlist.');}}>Quitar</button></div></li>)}</ol>:<div className="empty-state"><span className="empty-state__icon" aria-hidden="true">♡</span><h2>{playlist.automatic?'Tus canciones empiezan aquí':'Hazla tuya, canción a canción'}</h2><p>{playlist.automatic?'Las canciones que añadas aparecerán en Favoritos automáticamente.':'Añade canciones para empezar. Tu biblioteca se conserva.'}</p></div>}
    <p className="detail-footnote">{playlist.automatic?'Favoritos reúne las canciones añadidas. Quitarlas aquí las retira de Biblioteca y conserva tus otras playlists.':'Ordenar o quitar aquí sólo cambia esta playlist.'} La escucha usa el sonido original de prueba de 8 segundos.</p><div className="sr-only" role="status">{announcement}</div>
  </>;
}
