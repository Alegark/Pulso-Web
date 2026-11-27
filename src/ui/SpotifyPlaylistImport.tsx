import {useEffect,useRef,useState} from 'react';
import {readSpotifyPlaylist,spotifyPlaylistId,type SpotifyImportResult} from '../playlists/spotify-import';
import {loadYoutubePlaylist,parsePlaylistId,youtubeFailureText,youtubeItemsToSongs} from '../library/youtube-playlist';
import type {YoutubeImportInput,YoutubeImportResult} from '../playlists/youtube-import';
import './spotify-playlist-import.css';

type PlaylistData=Awaited<ReturnType<typeof readSpotifyPlaylist>>;
export type YoutubeImportSummary=YoutubeImportResult&{available:number;downloading:number;ignored:number;truncated:boolean};

export function SpotifyPlaylistImport({canImport,onImport,onImportYoutube,onOpen}:{
 canImport:boolean;
 onImport(data:PlaylistData,current:()=>boolean):Promise<(SpotifyImportResult&{available:number})|null>;
 /** YouTube lists are saved as a playlist and their missing songs start downloading right away. */
 onImportYoutube?(data:YoutubeImportInput,current:()=>boolean):Promise<Omit<YoutubeImportSummary,'ignored'|'truncated'>|null>;
 onOpen(id:string):void;
}){
 const [input,setInput]=useState(''),[status,setStatus]=useState(''),[loading,setLoading]=useState(false);
 const [result,setResult]=useState<(SpotifyImportResult&{available:number})|null>(null);
 const [youtube,setYoutube]=useState<YoutubeImportSummary|null>(null);
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>active.current?.abort(),[]);
 async function submitYoutube(listId:string,controller:AbortController,current:()=>boolean){
  setStatus('Leyendo playlist de YouTube…');
  const read=await loadYoutubePlaylist(input,{signal:controller.signal});
  if(!current())return;
  if(!read.ok){setStatus(read.reason==='cancelled'?'':youtubeFailureText[read.reason]);return;}
  const {songs,ignored}=youtubeItemsToSongs(read.value.items);
  if(!songs.length){setStatus('La playlist no tiene canciones que Pulso pueda importar.');return;}
  setStatus(`Guardando ${songs.length} canciones en Biblioteca…`);
  const saved=await onImportYoutube!({listId,name:read.value.name,songs},current);
  if(!current())return;
  setYoutube(saved?{...saved,ignored,truncated:read.value.truncated}:null);
  setStatus(saved?'Playlist guardada en Biblioteca.':'No se pudo actualizar Biblioteca. Revísala antes de reintentar.');
 }
 async function submit(){
  if(active.current||!canImport)return;
  const id=spotifyPlaylistId(input),youtubeId=id?null:onImportYoutube?parsePlaylistId(input):null;
  if(!id&&!youtubeId){setStatus(onImportYoutube?'Pega un enlace público de playlist de Spotify o de YouTube.':'Pega un enlace público de playlist de open.spotify.com.');return;}
  const controller=new AbortController();
  active.current=controller;
  const current=()=>active.current===controller&&!controller.signal.aborted;
  setLoading(true);setResult(null);setYoutube(null);
  try{
   if(youtubeId){await submitYoutube(youtubeId,controller,current);return;}
   setStatus('Leyendo playlist de Spotify…');
   const data=await readSpotifyPlaylist(id!,controller.signal);
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
  <h3 id="spotify-import-heading">{onImportYoutube?'Importar playlist de Spotify o YouTube':'Importar playlist de Spotify'}</h3>
  <div className="settings-group__body">
   <p>{onImportYoutube
    ?'Copia el enlace de una playlist pública (Spotify: Compartir → Copiar enlace; YouTube: el enlace con «list=»). Se guarda en Biblioteca; con YouTube, las canciones que falten empiezan a descargarse solas.'
    :'En Spotify, abre tu playlist pública y elige Compartir → Copiar enlace. Pégalo aquí para guardarla en Biblioteca sin iniciar sesión en Spotify.'}</p>
   <form onSubmit={event=>{event.preventDefault();void submit();}}>
    <label htmlFor="spotify-playlist-url">Enlace de la playlist</label>
    <input id="spotify-playlist-url" type="url" value={input} onChange={event=>{setInput(event.target.value);setStatus('');setResult(null);setYoutube(null);}}
     placeholder={onImportYoutube?'https://open.spotify.com/playlist/… o https://www.youtube.com/playlist?list=…':'https://open.spotify.com/playlist/…'} autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="go" disabled={loading} required/>
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
   {youtube&&<div className="spotify-import__result">
    <h4>{youtube.playlist.name}</h4>
    <p>{youtube.playlist.entries.length} canciones · {youtube.available} ya {youtube.available===1?'descargada':'descargadas'} en este dispositivo{youtube.updated?' · lista actualizada':''}.</p>
    {youtube.downloading>0
     ?<p>Descargando {youtube.downloading} en segundo plano, una tras otra. Si una falla, se salta y sigue con la siguiente. Puedes abrir la playlist y escuchar las que ya estén.</p>
     :<p>No falta ninguna: todas están en este dispositivo.</p>}
    {(youtube.repeated>0||youtube.ignored>0)&&<p>{youtube.repeated} {youtube.repeated===1?'repetida':'repetidas'} · {youtube.ignored} {youtube.ignored===1?'video que no parece canción':'videos que no parecen canciones'}.</p>}
    {youtube.truncated&&<p>Se leyeron las primeras 1500 entradas de YouTube.</p>}
    <button type="button" onClick={()=>onOpen(youtube.playlist.id)}>Abrir playlist</button>
   </div>}
  </div>
 </section>;
}
