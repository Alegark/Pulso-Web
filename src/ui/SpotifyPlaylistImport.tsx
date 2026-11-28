import {useEffect,useRef,useState} from 'react';
import {readSpotifyPlaylist,spotifyPlaylistId,type SpotifyImportResult} from '../playlists/spotify-import';
import {loadYoutubePlaylist,parsePlaylistId,youtubeFailureText,youtubeItemsToSongs} from '../library/youtube-playlist';
import type {YoutubeImportInput,YoutubeImportResult} from '../playlists/youtube-import';
import './spotify-playlist-import.css';

type PlaylistData=Awaited<ReturnType<typeof readSpotifyPlaylist>>;
export type YoutubeImportSummary=YoutubeImportResult&{available:number;missingTrackIds:readonly string[];ignored:number;truncated:boolean};

export function SpotifyPlaylistImport({canImport,canDownload,onImport,onImportYoutube,onDownloadMissing,onOpen}:{
 canImport:boolean;
 canDownload:boolean;
 onImport(data:PlaylistData,current:()=>boolean):Promise<(SpotifyImportResult&{available:number})|null>;
 /** YouTube lists are saved without requesting any downloads. */
 onImportYoutube?(data:YoutubeImportInput,current:()=>boolean):Promise<Omit<YoutubeImportSummary,'ignored'|'truncated'>|null>;
 onDownloadMissing?(trackIds:readonly string[],playlistName:string):void;
 onOpen(id:string):void;
}){
 const [input,setInput]=useState(''),[status,setStatus]=useState(''),[loading,setLoading]=useState(false);
 const [result,setResult]=useState<(SpotifyImportResult&{available:number})|null>(null);
 const [youtube,setYoutube]=useState<YoutubeImportSummary|null>(null);
 const [downloadRequested,setDownloadRequested]=useState(false);
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
  setLoading(true);setResult(null);setYoutube(null);setDownloadRequested(false);
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
   ?'Copia el enlace de una playlist pública (Spotify: Compartir → Copiar enlace; YouTube: el enlace con «list=») o pega un ID de playlist de YouTube. Se guarda en Biblioteca; las descargas de YouTube son opcionales y manuales.'
    :'En Spotify, abre tu playlist pública y elige Compartir → Copiar enlace. Pégalo aquí para guardarla en Biblioteca sin iniciar sesión en Spotify.'}</p>
   <form onSubmit={event=>{event.preventDefault();void submit();}}>
    <label htmlFor="spotify-playlist-url">Enlace de la playlist</label>
    <input id="spotify-playlist-url" type="text" inputMode="url" value={input} onChange={event=>{setInput(event.target.value);setStatus('');setResult(null);setYoutube(null);setDownloadRequested(false);}}
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
    <p>{youtube.playlist.entries.length} canciones · {youtube.reused} {youtube.reused===1?'ficha reutilizada':'fichas reutilizadas'} · {youtube.available} {youtube.available===1?'con copia local':'con copias locales'} · {youtube.missingTrackIds.length} pendientes de copia local{youtube.updated?' · lista actualizada':''}.</p>
    {youtube.missingTrackIds.length>0
     ?<p>Puedes abrir la playlist y escuchar las copias disponibles, o solicitar las descargas pendientes.</p>
     :<p>Todas las canciones tienen una copia local disponible.</p>}
    {(youtube.repeated>0||youtube.ignored>0)&&<p>{youtube.repeated} {youtube.repeated===1?'entrada repetida':'entradas repetidas'} · {youtube.ignored} {youtube.ignored===1?'video ignorado':'videos ignorados'}.</p>}
    {youtube.truncated&&<p>Se leyeron las primeras 1500 entradas de YouTube; puede haber más canciones en la playlist.</p>}
    <button type="button" onClick={()=>onOpen(youtube.playlist.id)}>Abrir en Biblioteca</button>
    {youtube.missingTrackIds.length>0&&onDownloadMissing&&<button className="spotify-import__download-missing" type="button" disabled={!canDownload||downloadRequested}
     onClick={()=>{if(canDownload&&!downloadRequested){onDownloadMissing(youtube.missingTrackIds,youtube.playlist.name);setDownloadRequested(true);}}}>
     {downloadRequested?'Descargas solicitadas':`Descargar faltantes (${youtube.missingTrackIds.length})`}</button>}
   </div>}
  </div>
 </section>;
}
