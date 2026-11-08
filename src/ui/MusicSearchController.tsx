import {SelectedSongActions} from './SelectedSongActions';
import type {BotDownloadedAudio} from '../telegram/bot-search-protocol';
import React from 'react';
import type {Track,Playlist} from '../library/library';
import {createMusicSuggestionsClient,normalizeMusicSuggestionsQuery,type MusicSuggestion} from '../library/music-suggestions';
import type {TelegramSessionClient,BotsSnapshot,BotSearchSnapshot} from '../telegram/session-client';
import type {SessionState} from '../telegram/session-protocol';
import {isBotSearchQuery,parseBotSearchTarget,BOT_SEARCH_LIMIT_DIAGNOSTICS,isBotSearchLimitError,type BotSearchLimitError,type BotSearchTarget,type BotSearchRow,type BotSearchError} from '../telegram/bot-search-protocol';
import {musicSearchCatalog} from '../library/music-search-catalog';
import {songChoiceKey,matchingSongRows,type SongChoice,type SongPlaybackAttempt,type SongManagement,type SongCopyInspection} from '../library/selected-song';
import {MusicSearchPanel,type MusicSearchResultRow} from './MusicSearchPanel';
import {AlbumPageController,type AlbumCoordinator} from './AlbumPageController';
import {ArtistSearchResults,ArtistPage} from './ArtistCatalogView';
import type {CatalogArtist} from '../library/album-catalog';

// One RAM-only transport per document, including cooldown across account/scope changes.
// Construction performs no IO. Each mounted view owns only its request and AbortSignal.
const suggestionsClient=createMusicSuggestionsClient();
// Retain unresolved album delivery across navigation and account/scope remounts.
const albumCoordinator:AlbumCoordinator={running:false,uncertainTracks:new Set(),remoteClock:{settledAt:0},rows:new Map(),listeners:new Set()};
interface Props {
 captureSongPlayback?:()=>SongPlaybackAttempt|null;captureSongCopyInspection?:()=>SongCopyInspection|null;
 libraryTrackIds?:ReadonlySet<string>;playlists?:readonly Playlist[];captureSongManagement?:(id:string)=>SongManagement|null;
 visible:boolean;scopeKey:string;client:TelegramSessionClient|null;phase:SessionState['phase'];
 captureDownloadSave?:()=>((audio:BotDownloadedAudio,signal:AbortSignal,onProgress:(bytes:number)=>void)=>Promise<'saved'|'failed'|'uncertain'>)|null;
 bots:BotsSnapshot|null;searchState:BotSearchSnapshot|null;canConnect:boolean;tracks:readonly Track[];
}
const fold=(s:string)=>s.normalize('NFC').trim().toLocaleLowerCase('es');
function resultView(row:BotSearchRow,target:BotSearchTarget|null):MusicSearchResultRow {
 let title:string,subtitle:string|null,match:MusicSearchResultRow['match']='unknown';
 if(row.kind==='audio'){
  title=row.title??'Audio sin título informado';subtitle=[row.performer,row.durationSeconds+' s',Math.round(row.bytes/1024)+' KiB'].filter(Boolean).join(' · ');
  if(target){const titleKnown=!!row.title,artistKnown=!!row.performer&&!!target.artist;
   if(titleKnown&&fold(row.title!)!==fold(target.title)||artistKnown&&fold(row.performer!)!==fold(target.artist!))match='conflict';
   else if(titleKnown&&artistKnown)match='compatible';
  }
 }else if(row.kind==='option'){title=row.label;subtitle='El bot no ha informado metadatos suficientes para confirmar la canción.';}
 else{title=row.text;subtitle=null;}
 return {id:row.rowRef,kind:row.kind,title,subtitle,correlation:row.correlation,match};
}
const searchErrors:Record<Exclude<BotSearchError,BotSearchLimitError>,string>={
 'file-too-large':'Esta primera versión admite canciones de hasta 8 MiB.', 'file-invalid':'El archivo está incompleto o no es un audio compatible.', conflict:'La opción, el documento o sus metadatos cambiaron. Busca y elige de nuevo.',
 cancelled:'Consulta detenida. Un mensaje ya enviado puede permanecer en tu chat.',timeout:'El bot no respondió dentro del plazo. No se repetirá la consulta automáticamente.',busy:'Hay otra operación de Telegram pendiente.',expired:'Estos resultados han caducado. Haz una consulta nueva si quieres continuar.',
 'session-expired':'La sesión de Telegram ha caducado. Vuelve a conectarla.',limit:'La consulta o la respuesta supera los límites admitidos.',unsupported:'Este bot o su respuesta todavía no son compatibles con este adaptador.','identity-changed':'El perfil del bot ha cambiado. Comprueba su identidad y vuelve a añadirlo.',
 'rate-limit':'Telegram ha limitado las consultas. Respeta la espera indicada antes de volver a buscar.',network:'No se pudo completar la consulta al bot.',uncertain:'No se pudo confirmar si el bot recibió o completó la consulta. Revisa su chat antes de repetirla.','needs-start':'Abre el chat del bot en Telegram e inícialo allí; después vuelve a buscar aquí.',
};
function searchErrorText(error:BotSearchError):string {
 const entry=location.pathname.match(/\/releases\/([a-f0-9]{16})\.html$/)?.[1]??'local';
 if(isBotSearchLimitError(error)||error==='limit'){
  const code=isBotSearchLimitError(error)?BOT_SEARCH_LIMIT_DIAGNOSTICS[error]:'L00';
  return `No se pudo leer la consulta o respuesta del bot. Código ${code} · entrada ${entry} · diagnóstico D1. No se repetirá automáticamente.`;
 }
 return searchErrors[error];
}
/** A song gesture owns one pipeline. Root retains local publication/playback authority. */
interface SongFlight {key:string;choice:SongChoice;target:BotSearchTarget;attempt:SongPlaybackAttempt;abort:AbortController;scope:string;client:TelegramSessionClient|null;networkCurrent:(()=>boolean)|null;revision:number|undefined;queryId:string|null;trackId?:string;phase:'lookup'|'query'|'choice'|'download'|'saving'|'play'|'done'|'error'}
export function MusicSearchController(props:Props){
 const [query,setQuery]=React.useState('');
 const [album,setAlbum]=React.useState<{title:string;artist:string|null;editionId?:number}|null>(null);
 const [artist,setArtist]=React.useState<CatalogArtist|null>(null),[artistRequest,setArtistRequest]=React.useState(0);
 const artistOpener=React.useRef<HTMLButtonElement|null>(null),albumOpener=React.useRef<HTMLButtonElement|null>(null);
 const artistScroll=React.useRef<[number,number]>([0,0]),albumScroll=React.useRef<[number,number]>([0,0]);
 const navigationReturn=React.useRef<{scope:string;kind:'artist'|'search';opener:HTMLButtonElement|null;position:[number,number]|null}|null>(null);
 const searchContainer=React.useRef<HTMLDivElement>(null);
 React.useLayoutEffect(()=>{
  const point=navigationReturn.current;if(!point)return;navigationReturn.current=null;
  if(!props.visible||props.scopeKey!==point.scope||album||point.kind==='artist'&&!artist||point.kind==='search'&&artist)return;
  if(point.opener?.isConnected)point.opener.focus({preventScroll:true});
  else if(point.kind==='search')searchContainer.current?.querySelector<HTMLInputElement>('input[type=search]')?.focus();
  if(point.position)window.scrollTo(...point.position);
 },[album,artist,props.visible,props.scopeKey]);
 const [chosenId,setChosenId]=React.useState<string|null>(null),[resultsVisible,setResultsVisible]=React.useState(false);
 const [remote,setRemote]=React.useState<readonly MusicSuggestion[]>([]),[remoteQuery,setRemoteQuery]=React.useState<string|null>(null),[suggesting,setSuggesting]=React.useState(false),[suggestionError,setSuggestionError]=React.useState<string|null>(null),[suggestionNotice,setSuggestionNotice]=React.useState<string|null>(null);
 const [retry,setRetry]=React.useState(0),[notice,setNotice]=React.useState<string|null>(null),[displayedQuery,setDisplayedQuery]=React.useState<string|null>(null),[selectedResult,setSelectedResult]=React.useState<string|null>(null);
 const downloadAbort=React.useRef<AbortController|null>(null),flight=React.useRef<SongFlight|null>(null);
 const [download,setDownload]=React.useState<{phase:'network'|'saving'|'saved'|'failed'|'uncertain';bytes:number;total:number}|null>(null);
 const [organizing,setOrganizing]=React.useState(false),[songError,setSongError]=React.useState<string|null>(null);
 const actionArea=React.useRef<HTMLDivElement>(null);
 React.useLayoutEffect(()=>{if(chosenId&&props.visible)actionArea.current?.scrollIntoView({block:'nearest'});},[chosenId,props.visible]);
 const saving=download?.phase==='saving',localPending=['lookup','saving','play'].includes(flight.current?.phase??'');
 const [,pulse]=React.useReducer(n=>n+1,0);
 const latest=React.useRef(props),mounted=React.useRef(false),viewEpoch=React.useRef(0),committed=React.useRef<object|null>(null),metadataAttempt=React.useRef<{abort:AbortController}|null>(null),metadataEpoch=React.useRef(0);
 const chosenDraft=React.useRef<string|null>(null);
 const renderToken={};const renderEpoch=viewEpoch.current;
 React.useLayoutEffect(()=>{latest.current=props;mounted.current=true;committed.current=renderToken;return()=>{committed.current=null;};});
 React.useEffect(()=>()=>{mounted.current=false;metadataAttempt.current?.abort.abort();},[]);
 const current=()=>mounted.current&&committed.current===renderToken&&viewEpoch.current===renderEpoch&&latest.current.visible&&latest.current.scopeKey===props.scopeKey&&latest.current.client===props.client;
 const client=props.client,state=client?.searchSnapshot()??props.searchState,action=client?.captureSearchActionCurrent(),cancel=client?.captureSearchCancel();
 const choices=React.useMemo(()=>musicSearchCatalog(query,props.tracks,remoteQuery===normalizeMusicSuggestionsQuery(query)?remote:[]),[query,props.tracks,remote,remoteQuery]);
 const primary=props.bots?.providers[0]??null;
 const selectedProvider=primary?{id:primary.providerRef,username:primary.username,label:primary.label,supported:primary.username.toLowerCase()==='ivkmbot'}:null;
 const provider=primary?.providerRef??null,ownPending=!!cancel||!!state?.cancelling;
 const limited=!!state?.retryBlocked||state?.retryAt!==null&&state?.retryAt!==undefined&&Date.now()<state.retryAt;
 const ready=props.canConnect&&props.phase==='connected'&&!!state?.available&&!state.pending&&!limited&&!!selectedProvider?.supported;
 const rateNotice=state?.retryBlocked?'Telegram ha limitado las consultas sin indicar un plazo utilizable. No se reintentará automáticamente.':limited&&state?.retryAt?'Telegram permite reintentar después de '+new Date(state.retryAt).toLocaleTimeString()+'.':null;
 const results=displayedQuery!==null&&state?.queryId===displayedQuery?state.rows.map(row=>resultView(row,state.expectedTarget)):[];
 const revokeMetadata=()=>{++metadataEpoch.current;const attempt=metadataAttempt.current;metadataAttempt.current=null;attempt?.abort.abort();setSuggesting(false);};
 const bump=()=>{++viewEpoch.current;pulse();};
 const edit=(queryChanged=false)=>{flight.current?.abort.abort();flight.current=null;downloadAbort.current?.abort();setDownload(null);setSongError(null);bump();chosenDraft.current=null;if(queryChanged){revokeMetadata();setRemote([]);setRemoteQuery(null);setResultsVisible(false);}setChosenId(null);setDisplayedQuery(null);setSelectedResult(null);setNotice(null);cancel?.();if(action?.())client?.clearSearch(action);};
 React.useEffect(()=>{
  const f=flight.current;if(f){f.abort.abort();f.networkCurrent=null;f.queryId=null;}bump();setDownload(null);setDisplayedQuery(null);setSelectedResult(null);
  // Revoking Telegram authority must stop work, not erase the user's outcome.
  // Keep only the chosen catalogue metadata; never retain chat rows/capabilities.
  if(f&&!['done','error'].includes(f.phase)){
   f.phase='error';setNotice(null);setSongError(props.phase==='connected'?'La configuración del bot cambió. La consulta se detuvo; elige la canción de nuevo.':'La conexión de Telegram se interrumpió al obtener la canción. No se pudo confirmar la descarga y no se iniciará música. Vuelve a conectar antes de intentarlo.');
  }
  if(!f)setChosenId(null);
 },[props.scopeKey,props.bots?.revision,props.bots?.scopeKey]);
 React.useEffect(()=>()=>{downloadAbort.current?.abort();client?.captureSearchCancel()?.();},[props.scopeKey,props.bots?.revision,client,props.visible]);
 React.useEffect(()=>{if(!props.visible){metadataAttempt.current?.abort.abort();client?.captureSearchCancel()?.();setDisplayedQuery(null);setSelectedResult(null);}},[props.visible,client]);
 React.useEffect(()=>{const until=state?.retryAt;if(!until||until<=Date.now())return;const timer=setTimeout(()=>{if(mounted.current)pulse();},until-Date.now()+1);return()=>clearTimeout(timer);},[state?.retryAt]);
 React.useEffect(()=>{
  const expires=state?.expiresAt;if(!expires||!client)return;
  const timer=setTimeout(()=>{if(latest.current.client===client){client.revalidate();pulse();}},Math.max(0,expires-Date.now()+1));return()=>clearTimeout(timer);
 },[state?.expiresAt,client]);
 React.useEffect(()=>{
  const abort=new AbortController(),attempt={abort};metadataAttempt.current?.abort.abort();metadataAttempt.current=attempt;
  setRemote([]);setRemoteQuery(null);setSuggestionError(null);setSuggesting(false);
  const valid=normalizeMusicSuggestionsQuery(query);
  if(chosenDraft.current!==null&&query===chosenDraft.current){setSuggestionNotice('Canción elegida para consultar al bot principal.');return()=>abort.abort();}
  if(!props.visible||!valid){setSuggestionNotice(query?'Escribe entre 3 y 160 caracteres para obtener sugerencias.':null);return()=>abort.abort();}
  const scope=props.scopeKey,epoch=metadataEpoch.current,waitUntil=Date.now()+15000;
  const live=()=>epoch===metadataEpoch.current&&mounted.current&&!abort.signal.aborted&&metadataAttempt.current===attempt&&latest.current.visible&&latest.current.scopeKey===scope;
  let timer:ReturnType<typeof setTimeout>|undefined;
  setSuggesting(true);setSuggestionNotice(null);
  let fallback=false;
  const run=()=>{
   if(!live())return;
   const rate=suggestionsClient.getRateState(),wait=rate.retryAt===null?0:Math.max(0,rate.retryAt-Date.now());
   // Wait for original cancellation/body cleanup, never overlap or release its slot by a clock.
   // This is dispatch of the latest draft, not retry of a failed remote request.
   if(rate.state==='busy'){
    if(Date.now()<waitUntil){timer=setTimeout(run,100);return;}
    clearTimeout(deadline);setSuggesting(false);setSuggestionError('La consulta anterior sigue cerrándose. Vuelve a intentar las sugerencias.');return;
   }
   if(rate.state==='blocked'||wait>2000){clearTimeout(deadline);setSuggesting(false);setSuggestionError('LRCLIB ha limitado las consultas. Espera antes de reintentar.');return;}
   if(wait>0){timer=setTimeout(run,wait+1);return;}
   const words=valid.split(/\s+/u);
   const request=fallback?words.slice(0,Math.ceil(words.length/2)).join(' '):valid;
   void suggestionsClient.search(request,{signal:abort.signal,current:live}).then(result=>{
    if(!live())return;
    // One bounded, sequential prefix reformulation only after an empty successful response.
    if(result.state==='ready'&&!result.tracks.length&&!fallback&&words.length>=2&&normalizeMusicSuggestionsQuery(words.slice(0,Math.ceil(words.length/2)).join(' '))&&Date.now()<waitUntil){fallback=true;timer=setTimeout(run,100);return;}
    clearTimeout(deadline);setSuggesting(false);
    if(result.state==='ready'){setRemoteQuery(valid);setRemote(result.tracks);setSuggestionNotice(result.tracks.length?null:'No hay sugerencias para este nombre. Prueba con otro nombre de canción o álbum.');}
    else if(result.state==='rate-limited')setSuggestionError(result.retryAt===null?'LRCLIB ha limitado las consultas y no indicó una espera utilizable.':'LRCLIB ha limitado las consultas. Podrás reintentar después de '+new Date(result.retryAt).toLocaleTimeString()+'.');
    else if(result.state==='busy')setSuggestionError('La consulta anterior sigue cerrándose. Vuelve a intentar las sugerencias.');
    else if(result.state==='unavailable')setSuggestionError('No se pudieron obtener sugerencias. Puedes reintentarlo o ver las coincidencias de tu biblioteca.');
   }).catch(()=>{if(live()){clearTimeout(deadline);setSuggesting(false);setSuggestionError('No se pudieron obtener sugerencias.');}});
  };
  timer=setTimeout(run,450);
  const deadline=setTimeout(()=>{if(live()){abort.abort();setSuggesting(false);setSuggestionError('La consulta de sugerencias agotó el plazo.');}},15000);
  return()=>{if(timer!==undefined)clearTimeout(timer);clearTimeout(deadline);abort.abort();};
 },[query,props.visible,props.scopeKey,retry]);
 const viewLive=(f:SongFlight)=>mounted.current&&flight.current===f&&!f.abort.signal.aborted&&latest.current.visible&&latest.current.scopeKey===f.scope&&latest.current.client===f.client;
 const live=(f:SongFlight)=>viewLive(f)&&f.attempt.current()&&(!f.networkCurrent||f.networkCurrent()&&latest.current.bots?.revision===f.revision);
 const finishPlay=async(f:SongFlight,id:string)=>{
  if(!live(f))return;f.trackId=id;f.phase='play';setNotice('Preparando la canción para reproducir…');pulse();
  const outcome=await f.attempt.play(id,()=>live(f),f.abort.signal);
  if(!viewLive(f))return;f.phase='done';setDownload(null);setNotice(outcome==='playing'?'Reproduciendo la canción desde la copia de este navegador.':outcome==='gesture-required'?'Canción disponible. Toca Reproducir para continuar; el navegador necesita ese gesto.':'La canción se conserva. No se pudo iniciar la reproducción; comprueba el reproductor.');pulse();
 };
 async function downloadRow(f:SongFlight,id:string){
  if(!live(f)||!f.client||!['query','choice'].includes(f.phase))return;
  const now=f.client.searchSnapshot();if(now.pending||now.queryId!==f.queryId||!now.rows.some(r=>r.rowRef===id&&r.kind!=='message'))return;
  const allowed=f.client.captureSearchActionCurrent();if(!allowed())return;
  f.phase='download';setSelectedResult(id);downloadAbort.current=f.abort;setDownload({phase:'network',bytes:0,total:0});setNotice('Obteniendo la canción elegida…');pulse();
  try{
   const audio=await f.client.downloadBot(id,allowed);
   if(!viewLive(f))return;
   if(!live(f)){f.abort.abort();f.phase='error';setDownload(null);setNotice(null);setSongError('La conexión o el permiso para obtener la canción se interrumpió. No se pudo confirmar la descarga y no se iniciará música.');pulse();return;}
   if(!audio){f.phase='error';setDownload(null);setNotice(f.client.searchSnapshot().error?null:'El bot no devolvió un audio que coincida con la canción elegida.');pulse();return;}
   f.phase='saving';setDownload({phase:'saving',bytes:0,total:audio.bytes});setNotice('Verificando la única copia local…');
   const result=await f.attempt.save(audio,f.choice,f.abort.signal,bytes=>{if(live(f))setDownload({phase:'saving',bytes,total:audio.bytes});});
   if(result.state==='saved'&&result.trackId)f.trackId=result.trackId;
   // The file may have committed even when Cancel wins the presentation/Play intent.
   if(mounted.current&&flight.current===f&&f.abort.signal.aborted){f.phase=result.state==='uncertain'?'error':'done';setDownload(null);setNotice(result.state==='saved'?'La copia ya estaba confirmada y se conserva. No se iniciará la reproducción.':result.state==='uncertain'?'La copia requiere revisión. No repitas la descarga hasta comprobar Almacenamiento.':'Operación detenida sin publicar otra copia ni iniciar música.');pulse();return;}
   if(!live(f))return;
   if(result.state==='saved'&&result.trackId){await finishPlay(f,result.trackId);return;}
   f.phase='error';setDownload({phase:result.state==='uncertain'?'uncertain':'failed',bytes:0,total:audio.bytes});setNotice(result.state==='uncertain'?'La copia requiere revisión. No repitas la descarga hasta comprobar Almacenamiento.':'No se pudo guardar la canción.');pulse();
  }catch{if(viewLive(f)){f.phase='error';setDownload(null);setNotice('No se pudo completar la canción. Revisa el estado antes de volver a elegirla.');pulse();}}
 }
 // A newer explicit playback action (including Pause/media keys) revokes the
 // original song intent. Abort still waits for the original transport/import receipt.
 React.useEffect(()=>{
  const f=flight.current;if(!f||f.abort.signal.aborted||['done','error'].includes(f.phase))return;
  let valid=false;try{valid=f.attempt.current();}catch{/* Fail closed. */}
  if(valid)return;f.abort.abort();f.client?.captureSearchCancel()?.();
  if(f.phase!=='saving'){f.phase='error';setDownload(null);}
  setNotice('Se conserva tu última acción del reproductor. No se iniciará la canción pendiente.');pulse();
 });
 // React receives only closed worker snapshots. This continuation belongs to the
 // original song gesture, not to renders, timers, navigation or catalogue submit.
 React.useEffect(()=>{
  const f=flight.current;if(!f||f.phase!=='query'||!live(f)||!f.client)return;
  const now=f.client.searchSnapshot();if(now.queryId!==f.queryId||now.pending)return;
  if(now.error){f.phase='error';setNotice(null);pulse();return;}
  const matches=matchingSongRows(now.rows,f.target);
  if(matches.length)void downloadRow(f,matches[0].rowRef);
  else{f.phase='error';setNotice('El bot no devolvió una coincidencia suficiente con el título, artista y versión elegidos.');pulse();}
 });
 function showResults(){if(current()&&query.trim())setResultsVisible(true);}
 async function choose(id:string){
  if(!current())return;const choice=choices.find(c=>c.id===id);if(!choice)return;
  if(choice.kind==='album'){if(ownPending||localPending)return;edit();setAlbum({title:choice.title,artist:choice.artist});return;}
  await chooseChoice(choice);
 }
 async function chooseChoice(choice:SongChoice){
  if(!current())return;
  const id=choice.id;
  const key=songChoiceKey(choice)??JSON.stringify([choice.source,choice.id,choice.title,choice.artist]);
  const old=flight.current;
  if(old?.key===key&&old.scope===props.scopeKey&&old.client===client&&!old.abort.signal.aborted&&!['done','error'].includes(old.phase)&&(old.phase!=='choice'||old.client?.searchSnapshot().queryId===old.queryId&&old.client?.searchSnapshot().expiresAt!==null)){setNotice('Esta canción ya está en proceso. Se usará la misma copia.');return;}
  if(ownPending||localPending)return;
  const chosen=parseBotSearchTarget({title:choice.title.normalize('NFC').trim(),artist:(choice.searchArtist??choice.artist)?.normalize('NFC').trim()||null,album:choice.album?.normalize('NFC').trim()||null,durationSeconds:choice.duration});
  if(!chosen){setNotice('Los metadatos de esta sugerencia no permiten identificar la canción.');return;}
  const attempt=props.captureSongPlayback?.();if(!attempt){setNotice('La biblioteca está ocupada o requiere revisión. Comprueba Almacenamiento.');return;}
  old?.abort.abort();const abort=new AbortController();downloadAbort.current=abort;
  const f:SongFlight={key,choice,target:chosen,attempt,abort,scope:props.scopeKey,client,networkCurrent:null,revision:props.bots?.revision,queryId:null,phase:'lookup'};flight.current=f;
  revokeMetadata();bump();chosenDraft.current=query;setChosenId(id);setResultsVisible(true);setDownload(null);setSongError(null);setSelectedResult(null);setNotice('Comprobando si ya tienes esta canción…');
  try{
   const local=await attempt.lookup(choice,abort.signal);if(!live(f))return;
   if(local){await finishPlay(f,local);return;}
   if(!ready||!provider||!client){f.phase='error';setNotice(!primary?'Añade un bot en «Bots de música» para conseguir esta canción.':!selectedProvider?.supported?'El bot principal todavía no es compatible. Cambia su orden en «Bots de música».':'Conecta Telegram para conseguir esta canción. Las copias ya descargadas no necesitan conexión.');pulse();return;}
   f.networkCurrent=client.captureBotsCurrent();if(!live(f))return;
   const now=client.searchSnapshot();
   if(now.providerRef===provider&&now.providerRevision===props.bots?.revision&&now.expiresAt!==null&&now.expiresAt>Date.now()&&JSON.stringify(now.expectedTarget)===JSON.stringify(chosen)&&now.rows.some(r=>r.kind!=='message')){
    f.queryId=now.queryId;f.phase='choice';setDisplayedQuery(f.queryId);const matches=matchingSongRows(now.rows,chosen);if(matches.length)void downloadRow(f,matches[0].rowRef);else{f.phase='error';setNotice('La respuesta disponible no contiene una coincidencia suficiente con la canción elegida.');}pulse();return;
   }
   const allowed=client.captureSearchActionCurrent();if(!allowed()||!isBotSearchQuery(chosen.title)){f.phase='error';setNotice('No se puede consultar esta canción ahora.');pulse();return;}
   const before=client.searchSnapshot().queryId;f.phase='query';client.searchBot({providerRef:provider,query:chosen.title,target:chosen,consent:true},allowed);
   const after=client.searchSnapshot();if(!after.queryId||after.queryId===before){f.phase='error';setNotice('No se inició otra consulta. Comprueba la operación pendiente.');pulse();return;}
   f.queryId=after.queryId;setDisplayedQuery(f.queryId);setNotice('Buscando el archivo de la canción…');pulse();
  }catch(error){if(viewLive(f)){f.phase='error';setDownload(null);setNotice(error instanceof Error?error.message:'No se pudo comprobar la copia local.');pulse();}}
 }
 function cancelSong(){const f=flight.current;f?.abort.abort();client?.captureSearchCancel()?.();if(f&&f.phase!=='saving')f.phase='error';setNotice('Operación detenida. Una copia ya confirmada se conserva; no se iniciará música.');pulse();}
 const selected=flight.current,management=selected?.trackId?props.captureSongManagement?.(selected.trackId):null;
 const manage=async(kind:'add'|'playlist'|'play',id?:string)=>{
  if(!current()||organizing||!selected?.trackId||!management?.current())return;
  const epoch=viewEpoch.current;setOrganizing(true);
  try{const result=kind==='add'?await management.add():kind==='playlist'?await management.addToPlaylist(id!):await management.play();
   if(!mounted.current||flight.current!==selected||viewEpoch.current!==epoch||!latest.current.visible)return;
   setNotice(kind==='play'?(result==='playing'?'Reproduciendo la canción.':result==='gesture-required'?'El navegador requiere pulsar Reproducir de nuevo.':'No se pudo iniciar el audio. Revisa el reproductor.'):(result?(kind==='add'?'Canción agregada a tu biblioteca.':'Canción añadida a la playlist.'):'No se pudo confirmar el cambio. Comprueba el estado antes de repetirlo.'));
  }finally{if(mounted.current)setOrganizing(false);}
 };
 const songActions=selected&&<div ref={actionArea} className="music-search-selection"><SelectedSongActions key={selected.key} title={selected.choice.title} artist={selected.choice.artist}
  status={notice??(ownPending?'Obteniendo la canción…':null)} error={songError??(state?.error?searchErrorText(state.error):null)}
  pending={ownPending||saving||localPending||organizing} progress={ownPending||saving?(download?.total?download:state?.downloadProgress):null}
  inLibrary={!!selected.trackId&&!!props.libraryTrackIds?.has(selected.trackId)}
  canAdd={!!selected.trackId&&!!management?.current()&&!ownPending&&!localPending&&!saving&&!organizing}
  canPlay={!!management?.playReady&&!!management.current()&&!ownPending&&!localPending&&!saving&&!organizing}
  playlists={props.playlists??[]} canAddToPlaylist={!!selected.trackId&&!!management?.current()&&!ownPending&&!localPending&&!saving&&!organizing}
  onAdd={()=>void manage('add')} onAddToPlaylist={id=>void manage('playlist',id)} onPlay={()=>void manage('play')} onCancel={cancelSong} current={current}/></div>;
 return <><div ref={searchContainer} hidden={!!album||!!artist}><MusicSearchPanel songActions={album?null:songActions} query={query} onQueryChange={value=>{if(!current())return;edit(true);setQuery(value.slice(0,640));}}
  suggestions={choices.map(c=>({id:c.id,kind:c.kind,title:c.title,subtitle:(c.kind==='track'?[c.artist,c.album]:[c.artist]).filter(Boolean).join(' · ')||null,source:c.source}))} resultsVisible={resultsVisible} selectedSuggestionId={chosenId} suggestionsPending={suggesting} suggestionsError={suggestionError} suggestionsNotice={suggestionNotice}
  onRetrySuggestions={()=>{if(current()&&!ownPending){edit();setRetry(n=>n+1);}}}
  primaryProvider={selectedProvider}
  sessionReady={props.phase==='connected'} canSearch={ready} searchPending={ownPending||saving||localPending}
  onSearch={showResults} onSearchArtists={()=>{if(current()&&!ownPending&&!localPending&&query.trim())setArtistRequest(n=>n+1);}} onSearchAlbums={()=>{if(current()&&!ownPending&&!localPending&&query.trim()){edit();setAlbum({title:query.trim(),artist:null});}}} onChooseSuggestion={choose}
  onCancel={cancelSong}
  downloadStatus={download?.phase==='saving'?'Guardando copia verificada…':null} downloadProgress={saving?download:state?.downloadProgress??null} onCancelDownload={saving?cancelSong:undefined}
  automaticSelection results={results} selectedResultId={selectedResult} onSelectResult={id=>{const f=flight.current;if(current()&&f)void downloadRow(f,id);}}
  status={rateNotice??notice??(displayedQuery&&state?.queryId===displayedQuery&&!state.error&&results.length?'Respuesta del bot recibida. Revisa las opciones; la identidad musical sigue sin confirmar.':null)} error={state?.error?searchErrorText(state.error):null} uncertain={state?.delivery==='uncertain'} current={current}/>{artistRequest>0&&<ArtistSearchResults query={query} scope={props.scopeKey} visible={props.visible&&!album&&!artist} request={artistRequest} onOpen={(row,opener)=>{if(!current()||ownPending||localPending)return;artistOpener.current=opener;artistScroll.current=[window.scrollX,window.scrollY];setArtist(row);}}/>}</div>
  {artist&&<div hidden={!!album}><ArtistPage artist={artist} scope={props.scopeKey} visible={props.visible&&!album} onBack={()=>{if(!current())return;navigationReturn.current={scope:props.scopeKey,kind:'search',opener:artistOpener.current,position:artistScroll.current};setArtist(null);}} onAlbum={(row,opener)=>{if(!current()||ownPending||localPending)return;albumOpener.current=opener;albumScroll.current=[window.scrollX,window.scrollY];setAlbum({title:row.title,artist:row.artist,editionId:row.id});}}/></div>}
  {album&&<AlbumPageController coordinator={albumCoordinator} title={album.title} artist={album.artist} editionId={album.editionId} backLabel={artist?'Volver al artista':undefined} scope={props.scopeKey} visible={props.visible} captureInspection={props.captureSongCopyInspection} selectedKey={selected?.phase==='done'&&selected.trackId?selected.choice.id:null} libraryTrackIds={props.libraryTrackIds} client={client} revision={props.bots?.revision} provider={selectedProvider?.supported?provider:null} capture={()=>current()?props.captureSongPlayback?.()??null:null} management={id=>props.captureSongManagement?.(id)??null} songActions={songActions} onChoose={choice=>{if(current())void chooseChoice(choice);}} onBack={()=>{if(!current())return;edit();navigationReturn.current={scope:props.scopeKey,kind:artist?'artist':'search',opener:artist?albumOpener.current:null,position:artist?albumScroll.current:null};setAlbum(null);}}/>}</>;
}
