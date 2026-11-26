import {formatStorageMB} from '../library/storage-format';
import {AUDIO_FILE_MAX_BYTES} from '../storage/audio-limits';
import React from 'react';
import './music-search.css';
import {CatalogArtwork} from './CatalogArtwork';
import {PlaybackIndicator} from './PlaybackIndicator';
import {TrackActionsMenu,TrackPlaylistAction} from './TrackActionsMenu';
import {useLongPress} from './useLongPress';
import type {TrackMenuHost} from './track-menu-host';

export interface MusicSearchSuggestionRow {
 id:string;kind:'track'|'album'|'artist';title:string;subtitle:string|null;source:'local'|'lrclib'|'itunes'|'musicbrainz';artworkUrl?:string|null;trackId?:string;
}
export interface MusicSearchProviderRow {id:string;username:string;label:string;supported:boolean}
export interface MusicSearchResultRow {
 id:string;kind:'audio'|'option'|'message';title:string;subtitle:string|null;
 correlation:'reply'|'recent'|'unknown';match:'compatible'|'conflict'|'unknown';
}
export interface MusicSearchPanelProps {
 trackMenuHost?:TrackMenuHost;localAvailableTrackIds?:ReadonlySet<string>;
 query:string;onQueryChange:(query:string)=>void;
 onQueryFocus?:()=>void;
 suggestions:readonly MusicSearchSuggestionRow[];suggestionsPending:boolean;
 suggestionsError?:string|null;suggestionsNotice?:string|null;onRetrySuggestions?:()=>void;
 resultsVisible:boolean;selectedSuggestionId:string|null;playingTrackIds?:ReadonlySet<string>;
 primaryProvider:MusicSearchProviderRow|null;
 hasSupportedProvider?:boolean;
 sessionReady:boolean;canSearch:boolean;searchPending:boolean;searchPendingLabel?:string;
 /** Catalogue results only. This callback never submits a Telegram query. */
 onSearch:()=>void;
 onChooseSuggestion:(id:string,opener:HTMLButtonElement)=>void;onCancel:()=>void;
 songActions?:React.ReactNode;
 suggestionFeedback?:{id:string;message:string}|null;
 automaticSelection?:boolean;
 results:readonly MusicSearchResultRow[];status?:string|null;error?:string|null;uncertain:boolean;
 downloadStatus?:string|null;downloadProgress?:{bytes:number;total:number}|null;onCancelDownload?:()=>void;
 selectedResultId:string|null;onSelectResult:(id:string)=>void;
 /** Non-reviving guard captured by root for this render. */
 current:()=>boolean;
}
const kindLabels={track:'Canción',album:'Álbum',artist:'Artista'} as const;
const correlationLabels={reply:'Respuesta a la consulta; identidad musical sin confirmar.',recent:'Mensaje reciente; la proximidad temporal no confirma su identidad ni que responda a la consulta.',unknown:'Relación con la consulta desconocida.'};
const matchLabels={compatible:'Metadatos compatibles; identidad musical sin confirmar.',conflict:'Conflicto: los metadatos no coinciden con la consulta.',unknown:'Coincidencia musical desconocida.'};

function SearchTrackRow({row,props,choose}:{row:MusicSearchSuggestionRow;props:MusicSearchPanelProps;choose:(row:MusicSearchSuggestionRow,opener:HTMLButtonElement)=>void}){
 const [menuSignal,openMenu]=React.useReducer(n=>n+1,0);
 const longPress=useLongPress({onLongPress:openMenu});
 const host=props.trackMenuHost,trackId=row.trackId,inLibrary=!!trackId&&!!host?.libraryTrackIds.has(trackId);
 const playing=!!trackId&&!!props.playingTrackIds?.has(trackId),localAvailable=!!trackId&&!!props.localAvailableTrackIds?.has(trackId);
 return <li className="catalog-track-row" {...longPress}>
  <button type="button" className="collection-track-main" data-suggestion-id={row.id} data-catalog-kind="track" aria-pressed={(props.suggestionFeedback?.id??props.selectedSuggestionId)===row.id} onClick={event=>choose(row,event.currentTarget)}>
   <span className="catalog-art-wrap"><CatalogArtwork className="catalog-art catalog-art--track" url={row.artworkUrl} trackId={trackId} fallback="♪"/>{playing&&<PlaybackIndicator variant="overlay"/>}</span>
   <span className="catalog-row-copy"><strong title={row.title} className={playing?'catalog-track-playing':undefined}><bdi dir="auto">{row.title}</bdi></strong><span className="catalog-row-meta">Canción{row.subtitle&&<> · <bdi dir="auto">{row.subtitle}</bdi></>}</span></span>
  </button>
  <TrackActionsMenu title={row.title} artist={row.subtitle??undefined} active={props.current()} openSignal={menuSignal}>
   <button disabled={!trackId||!host?.canOrganize} onClick={event=>{event.currentTarget.focus();if(trackId)host?.onToggleFavorite(trackId);}}>{trackId&&host?.tracksById.get(trackId)?.favorite?'Quitar favorito':'Favorito'}</button>
   <button disabled={!trackId||!host?.canOrganize||inLibrary} onClick={()=>{if(trackId)host?.onAddToLibrary(trackId);}}>{inLibrary?'En Biblioteca':'Añadir a Biblioteca'}</button>
   {trackId&&host&&<TrackPlaylistAction playlists={host.playlists} trackId={trackId} enabled={host.canOrganize} onAdd={list=>host.onAddToPlaylist(list.id,trackId)}/>}
   <button disabled={!trackId||!host?.canAppend||!localAvailable} onClick={()=>{if(trackId)host?.onQueueNext(trackId);}}>Reproducir a continuación</button>
   <button disabled={!trackId||!host?.canAppend||!localAvailable} onClick={()=>{if(trackId)host?.onQueueLater(trackId);}}>Añadir al final de la cola</button>
   <details><summary>Información</summary>{row.subtitle&&<p>{row.subtitle}</p>}<p>{trackId?'Canción identificada localmente.':'Resultado de catálogo sin descarga local.'}</p></details>
  </TrackActionsMenu>
  {row.id===props.suggestionFeedback?.id&&<p role="status">{props.suggestionFeedback.message}</p>}{row.id===props.selectedSuggestionId&&props.songActions}
 </li>;
}

/** Controlled product state; only the local category filter lives here. */
export function MusicSearchPanel(props:MusicSearchPanelProps){
 const committed=React.useRef<MusicSearchPanelProps|null>(null);
 React.useLayoutEffect(()=>{committed.current=props;return()=>{committed.current=null;};});
 const id=React.useId();
 const [filter,setFilter]=React.useState<'all'|'track'|'album'|'artist'>('all');
 const [editing,setEditing]=React.useState(false);
 const input=React.useRef<HTMLInputElement>(null),heading=React.useRef<HTMLHeadingElement>(null);
 const searching=editing||!!props.query.trim();
 const active=()=>committed.current===props&&props.current();
 const provider=props.primaryProvider;
 const ready=props.canSearch&&props.sessionReady&&(props.hasSupportedProvider??!!provider?.supported)&&!props.searchPending;
 const choose=(row:MusicSearchSuggestionRow,opener:HTMLButtonElement)=>{if(active())props.onChooseSuggestion(row.id,opener);};
 const showAll=()=>{if(active()&&props.query.trim()){props.onSearch();setFilter('all');}};
 const resetQuery=(keepEditing:boolean)=>{
  if(!active())return;
  props.onQueryChange('');setFilter('all');setEditing(keepEditing);
  if(keepEditing)input.current?.focus({preventScroll:true});
  else {input.current?.blur();heading.current?.focus({preventScroll:true});}
 };
 // Only order the presentation. IDs, membership, matching and source priority
 // still belong to the controller; preserve relative order within each kind.
 const rank=(row:MusicSearchSuggestionRow)=>row.title.trim().localeCompare(props.query.trim(),'es',{sensitivity:'base'})===0?-1:({artist:0,album:1,track:2} as const)[row.kind];
 const rows=props.suggestions.filter(row=>filter==='all'||row.kind===filter).map((row,index)=>({row,index})).sort((a,b)=>rank(a.row)-rank(b.row)||a.index-b.index).map(item=>item.row);
 const card=(row:MusicSearchSuggestionRow)=><button type="button"
  data-suggestion-id={row.id} data-catalog-kind={row.kind}
  aria-pressed={(props.suggestionFeedback?.id??props.selectedSuggestionId)===row.id} onClick={event=>choose(row,event.currentTarget)}>
  <CatalogArtwork className={`catalog-art catalog-art--${row.kind}`} url={row.artworkUrl} trackId={row.trackId} fallback={row.kind==='artist'?Array.from(row.title.trim())[0]?.toLocaleUpperCase('es')??'♪':row.kind==='album'?'◉':'♪'}/>
  <span className="catalog-row-copy"><strong title={row.title}><bdi dir="auto">{row.title}</bdi></strong>
  <span className="catalog-row-meta">{kindLabels[row.kind]}{row.subtitle&&<> · <bdi dir="auto">{row.subtitle}</bdi></>}</span></span><span className="catalog-chevron" aria-hidden="true">›</span>
  {row.trackId&&props.playingTrackIds?.has(row.trackId)&&<PlaybackIndicator/>}
 </button>;
 return <section className="music-search" data-search-active={searching?'true':undefined} aria-labelledby={`${id}-heading`}>
  <p className="catalog-eyebrow">DESCUBRE</p><h2 ref={heading} tabIndex={-1} id={`${id}-heading`}>Buscar música</h2><p className="catalog-intro">Encuentra canciones, álbumes y artistas.</p>
  <form className="catalog-search-form" onSubmit={event=>{event.preventDefault();showAll();input.current?.blur();}}>
   <label htmlFor={`${id}-query`}>Canción, álbum o artista</label>
   <div className="music-search-query">
    <div className="music-search-query-bar">
     <div className="catalog-search-field"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>
     <input ref={input} id={`${id}-query`} type="search" placeholder="¿Qué quieres escuchar?" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={640} enterKeyHint="search"
      value={props.query} aria-describedby={`${id}-query-help`}
      onFocus={()=>{setEditing(true);if(active())props.onQueryFocus?.();}}
      onChange={event=>{if(active())props.onQueryChange(event.currentTarget.value);}}
      onKeyDown={event=>{if(event.key==='Enter'&&event.nativeEvent.isComposing)event.preventDefault();}}/>
     {props.query.length>0&&<button className="catalog-clear" type="button" aria-label="Borrar búsqueda" onClick={()=>resetQuery(true)}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><path d="m7 7 10 10M17 7 7 17"/></svg></button>}</div>
     {searching?<button className="catalog-cancel" type="button" onClick={()=>resetQuery(false)}>Cancelar</button>:<button type="submit" disabled={!props.query.trim()}>Buscar</button>}
    </div>
   </div>
   <p id={`${id}-query-help`} className="catalog-help">Busca por título o nombre de artista.</p>
  </form>
  <div className="catalog-search-status" role="status">{props.suggestionsPending?'Buscando…':props.suggestions.length?null:props.suggestionsNotice}</div>
  {props.suggestionsError&&<p role="alert">{props.suggestionsError}</p>}
  {props.onRetrySuggestions&&props.suggestionsError&&props.query.trim().length>=3&&<button type="button" disabled={props.suggestionsPending||props.searchPending}
   onClick={()=>{if(active()&&!props.suggestionsPending&&!props.searchPending)props.onRetrySuggestions?.();}}>{props.suggestionsError?'Reintentar sugerencias':'Actualizar sugerencias'}</button>}
  {!props.query.trim()&&<div className="catalog-discovery"><h3>Explora tu música</h3><p>Busca una canción, un álbum o un artista para empezar.</p><div><span>♪ <b>Canciones</b></span><span>◉ <b>Álbumes</b></span><span>◎ <b>Artistas</b></span></div></div>}
  {!!props.query.trim()&&<section className="music-search-catalog" aria-labelledby={`${id}-catalog-heading`} aria-busy={props.suggestionsPending}>
   <h3 className="catalog-result-heading" id={`${id}-catalog-heading`}>Resultados para «{props.query}»</h3>
   <div className="music-search-actions" role="group" aria-label="Tipo de resultado">
    {([['all','Todo'],['track','Canciones'],['album','Álbumes'],['artist','Artistas']] as const).map(([kind,label])=><button type="button" key={kind} aria-pressed={filter===kind} onClick={()=>setFilter(kind)}>{label}</button>)}
   </div>
   {rows.length?<ul className="catalog-mixed-list">{rows.map(row=>row.kind==='track'?<SearchTrackRow key={row.id} row={row} props={props} choose={choose}/>:<li key={row.id}>{card(row)}{row.id===props.suggestionFeedback?.id&&<p role="status">{props.suggestionFeedback.message}</p>}{row.id===props.selectedSuggestionId&&props.songActions}</li>)}</ul>:!props.suggestionsPending&&!props.suggestionsError&&(props.suggestions.length>0||!props.suggestionsNotice)&&<div className="catalog-empty">
    <p>{props.suggestions.length?'No hay resultados con este filtro.':'No encontramos coincidencias. Prueba con otro título o artista.'}</p>
    {props.suggestions.length>0&&filter!=='all'&&<button type="button" onClick={()=>setFilter('all')}>Ver todos los resultados</button>}
   </div>}
  </section>}
  {props.songActions&&!rows.some(row=>row.id===props.selectedSuggestionId)&&<div className="song-selection-fallback">{props.songActions}</div>}
  <section className="music-search-bot" aria-label="Consulta al bot">
   <details><summary>Fuentes para la canción elegida</summary>
   {provider?<p>Bot principal: <bdi dir="auto">@{provider.username.replace(/^@/,'')}</bdi>. {provider.supported?'Se probará primero. Si no consigue una copia compatible, se probará el siguiente bot disponible.':'Se usarán los siguientes bots compatibles de tu lista.'}</p>:<p>Añade tus proveedores en «Bots de música» para buscar las canciones en el orden que elijas.</p>}
   {!props.sessionReady&&<p>Conecta Telegram para consultar tu bot. Las sugerencias musicales ya están disponibles.</p>}
   {props.sessionReady&&(props.hasSupportedProvider??provider?.supported)&&!ready&&!props.searchPending&&<p>La consulta estará disponible cuando termine la operación pendiente.</p>}
   </details>
   {!props.songActions&&<>{props.searchPending&&<button type="button" onClick={()=>{if(committed.current===props&&props.searchPending)(props.onCancelDownload??props.onCancel)();}}>Cancelar consulta</button>}
   {props.downloadProgress&&props.downloadProgress.total>0&&<progress aria-label="Progreso de la descarga" value={props.downloadProgress.bytes} max={props.downloadProgress.total}/>}
   {props.downloadStatus&&<p role="status">{props.downloadStatus}</p>}
   <div role="status">{props.searchPending?(props.searchPendingLabel??'Consultando la canción elegida…'):props.status}</div>
   {props.error&&<p role="alert">{props.error}</p>}
   {props.uncertain&&<p>Resultado incierto: no se ha confirmado la respuesta del bot. No se reintentará ni cambiará de bot automáticamente.</p>}
   </>}
   {props.results.length>0&&!props.automaticSelection&&<><h3>Respuesta del bot</h3><p>Si hay varias opciones, elige la versión correcta: se descargará y reproducirá una única copia en Pulso. Límite por canción: {formatStorageMB(AUDIO_FILE_MAX_BYTES)}; no hace falta exportar a Archivos.</p>
    <ul className="music-search-results">{props.results.map(row=><li key={row.id} data-result-id={row.id}>
     <strong><bdi dir="auto">{row.title}</bdi></strong>{row.subtitle&&<p><bdi dir="auto">{row.subtitle}</bdi></p>}
     <p>{row.kind==='audio'?'Referencia de audio; disponibilidad sin verificar.':row.kind==='option'?'Botón del bot: se pulsa sólo al elegir esta opción.':'Mensaje del bot.'}</p>
     <p>{correlationLabels[row.correlation]}</p><p>{matchLabels[row.match]}</p>
     <button type="button" aria-pressed={props.selectedResultId===row.id} disabled={props.searchPending||row.kind==='message'}
      onClick={()=>{if(active()&&!props.searchPending)props.onSelectResult(row.id);}}>{row.kind==='audio'?'Escuchar esta versión':'Elegir esta versión'}</button>

    </li>)}</ul></>}
  </section>
  <details className="catalog-sources"><summary>Opciones de búsqueda</summary>
   {props.onRetrySuggestions&&props.query.trim().length>=3&&<button type="button" disabled={props.suggestionsPending||props.searchPending} onClick={()=>{if(active()&&!props.suggestionsPending&&!props.searchPending)props.onRetrySuggestions?.();}}>Actualizar sugerencias</button>}
   <p>Las sugerencias externas proceden de iTunes US, MusicBrainz como respaldo y <a href="https://lrclib.net/docs" target="_blank" rel="noopener noreferrer">LRCLIB</a>. Las coincidencias repetidas se agrupan; las versiones distintas se conservan. Los resultados no confirman disponibilidad en Telegram ni álbumes completos.</p>
  </details>
 </section>;
}
