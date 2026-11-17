import {useEffect,useRef,useState} from 'react';
import {readSpotifyPlaylist,spotifyPlaylistId,type SpotifyImportResult} from '../playlists/spotify-import';
import './spotify-playlist-import.css';

type PlaylistData=Awaited<ReturnType<typeof readSpotifyPlaylist>>;

export function SpotifyPlaylistImport({canImport,onImport,onOpen}:{
 canImport:boolean;
 onImport(data:PlaylistData,current:()=>boolean):Promise<(SpotifyImportResult&{available:number})|null>;
 onOpen(id:string):void;
}){
 const [input,setInput]=useState(''),[status,setStatus]=useState(''),[loading,setLoading]=useState(false);
 const [result,setResult]=useState<(SpotifyImportResult&{available:number})|null>(null);
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>active.current?.abort(),[]);
 async function submit(){
  if(active.current||!canImport)return;
  const id=spotifyPlaylistId(input);
  if(!id){setStatus('Pega un enlace público de playlist de open.spotify.com.');return;}
  const controller=new AbortController();
  active.current=controller;
  const current=()=>active.current===controller&&!controller.signal.aborted;
  setLoading(true);setResult(null);setStatus('Leyendo playlist de Spotify…');
  try{
   const data=await readSpotifyPlaylist(id,controller.signal);
   if(!current())return;
   setStatus('Guardando playlist en Biblioteca…');
   const saved=await onImport(data,current);
   if(!current())return;
   setResult(saved);
   setStatus(saved?'Playlist guardada en Biblioteca.':'No se pudo actualizar Biblioteca. Revísala antes de reintentar.');
  }catch(error){
   if(current())setStatus(error instanceof Error?error.message:'No se pudo importar la playlist.');
  }finally{
   if(current()){active.current=null;setLoading(false);}
  }
 }
 return <section className="settings-group spotify-import" aria-labelledby="spotify-import-heading">
  <h3 id="spotify-import-heading">Importar playlist de Spotify</h3>
  <div className="settings-group__body">
   <p>En Spotify, abre tu playlist pública y elige Compartir → Copiar enlace. Pégalo aquí para guardarla en Biblioteca sin iniciar sesión en Spotify.</p>
   <form onSubmit={event=>{event.preventDefault();void submit();}}>
    <label htmlFor="spotify-playlist-url">Enlace de la playlist de Spotify</label>
    <input id="spotify-playlist-url" type="url" value={input} onChange={event=>{setInput(event.target.value);setStatus('');setResult(null);}}
     placeholder="https://open.spotify.com/playlist/…" autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="go" disabled={loading} required/>
    <button type="submit" disabled={loading||!canImport}>Importar playlist</button>
   </form>
   <p role="status" aria-live="polite">{status}</p>
   {result&&<div className="spotify-import__result">
    <h4>{result.playlist.name}</h4>
    <p>Pulso busca los álbumes y las portadas en segundo plano. Puedes seguir el progreso en Biblioteca.</p>
    <p>{result.playlist.entries.length} canciones · {result.reused} {result.reused===1?'ficha reutilizada':'fichas reutilizadas'} · {result.available} {result.available===1?'disponible':'disponibles'} en este dispositivo.</p>
    {result.available<result.playlist.entries.length&&<p>Las canciones sin copia se pueden buscar desde Biblioteca con un bot de Telegram si tienen metadatos suficientes.</p>}
    {(result.repeated>0||result.omitted>0)&&<p>{result.repeated} {result.repeated===1?'entrada repetida':'entradas repetidas'} · {result.omitted} {result.omitted===1?'entrada omitida':'entradas omitidas'}.</p>}
    {!result.complete&&<p>{result.limited?'Se leyeron hasta 100 entradas. ':''}Spotify no confirmó que se haya leído la playlist completa.</p>}
    <button type="button" onClick={()=>onOpen(result.playlist.id)}>Abrir en Biblioteca</button>
   </div>}
  </div>
 </section>;
}
