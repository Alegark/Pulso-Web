import React from 'react';
import {MUSIC_CATALOG_LIMITS} from '../library/music-search-catalog';
import './music-search.css';

export interface MusicSearchSuggestionRow {
 id:string;kind:'track'|'album';title:string;subtitle:string|null;source:'local'|'lrclib'|'itunes';
}
export interface MusicSearchProviderRow {id:string;username:string;label:string;supported:boolean}
export interface MusicSearchResultRow {
 id:string;kind:'audio'|'option'|'message';title:string;subtitle:string|null;
 correlation:'reply'|'recent'|'unknown';match:'compatible'|'conflict'|'unknown';
}
export interface MusicSearchPanelProps {
 query:string;onQueryChange:(query:string)=>void;
 suggestions:readonly MusicSearchSuggestionRow[];suggestionsPending:boolean;
 suggestionsError?:string|null;suggestionsNotice?:string|null;onRetrySuggestions?:()=>void;
 resultsVisible:boolean;selectedSuggestionId:string|null;
 primaryProvider:MusicSearchProviderRow|null;
 sessionReady:boolean;canSearch:boolean;searchPending:boolean;
 /** Catalogue results only. This callback never submits a Telegram query. */
 onSearch:()=>void;
 onSearchAlbums?:()=>void;
 onSearchArtists?:()=>void;
 onChooseSuggestion:(id:string)=>void;onCancel:()=>void;
 songActions?:React.ReactNode;
 automaticSelection?:boolean;
 results:readonly MusicSearchResultRow[];status?:string|null;error?:string|null;uncertain:boolean;
 downloadStatus?:string|null;downloadProgress?:{bytes:number;total:number}|null;onCancelDownload?:()=>void;
 selectedResultId:string|null;onSelectResult:(id:string)=>void;
 /** Non-reviving guard captured by root for this render. */
 current:()=>boolean;
}
const groups=[['track','Canciones'],['album','Álbumes']] as const;
const correlationLabels={reply:'Respuesta a la consulta; identidad musical sin confirmar.',recent:'Mensaje reciente; la proximidad temporal no confirma su identidad ni que responda a la consulta.',unknown:'Relación con la consulta desconocida.'};
const matchLabels={compatible:'Metadatos compatibles; identidad musical sin confirmar.',conflict:'Conflicto: los metadatos no coinciden con la consulta.',unknown:'Coincidencia musical desconocida.'};

/** Controlled product state; only focus, dropdown visibility and a local filter live here. */
export function MusicSearchPanel(props:MusicSearchPanelProps){
 const committed=React.useRef<MusicSearchPanelProps|null>(null);
 React.useLayoutEffect(()=>{committed.current=props;return()=>{committed.current=null;};});
 const id=React.useId(),queryRef=React.useRef<HTMLInputElement>(null),quickRef=React.useRef<HTMLDivElement>(null),resultsRef=React.useRef<HTMLHeadingElement>(null);
 const [open,setOpen]=React.useState(false),[focused,setFocused]=React.useState(false),[filter,setFilter]=React.useState<'all'|'track'|'album'>('all');
 const active=()=>committed.current===props&&props.current();
 const provider=props.primaryProvider;
 const ready=props.canSearch&&props.sessionReady&&!!provider?.supported&&!props.searchPending;
 const albums=props.suggestions.filter(row=>row.kind==='album');
 const songPreview=props.suggestions.filter(row=>row.kind==='track').slice(0,albums.length?4:MUSIC_CATALOG_LIMITS.preview);
 const quick=[...songPreview,...albums.slice(0,MUSIC_CATALOG_LIMITS.preview-songPreview.length)];
 const expanded=open&&!!props.query.trim()&&(quick.length>0||props.suggestionsPending);
 React.useLayoutEffect(()=>{if(props.resultsVisible){setOpen(false);resultsRef.current?.focus();}},[props.resultsVisible]);
 React.useEffect(()=>{const outside=(event:PointerEvent)=>{if(!queryRef.current?.closest('.music-search-query')?.contains(event.target as Node))setOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[]);
 const choose=(row:MusicSearchSuggestionRow)=>{if(active()&&!props.searchPending){props.onChooseSuggestion(row.id);setOpen(false);}};
 const showAll=()=>{if(active()&&props.query.trim()){props.onSearch();setFilter('all');setOpen(false);resultsRef.current?.focus();}};
 const card=(row:MusicSearchSuggestionRow,preview=false,index=0)=><button type="button" id={preview?`${id}-quick-${index}`:undefined}
  data-suggestion-id={row.id} data-catalog-kind={row.kind} disabled={props.searchPending}
  role={preview?'option':undefined} aria-selected={preview?props.selectedSuggestionId===row.id:undefined} aria-pressed={preview?undefined:props.selectedSuggestionId===row.id}
  onPointerDown={preview?event=>event.preventDefault():undefined} onClick={()=>choose(row)}
  onKeyDown={preview?event=>{
   const buttons=quickRef.current?.querySelectorAll<HTMLButtonElement>('[data-suggestion-id]');
   if(event.key==='Escape'){event.preventDefault();queryRef.current?.focus();setOpen(false);}
   else if(event.key==='ArrowDown'){event.preventDefault();buttons?.[index+1]?.focus();}
   else if(event.key==='ArrowUp'){event.preventDefault();if(index===0)queryRef.current?.focus();else buttons?.[index-1]?.focus();}
  }:undefined}>
  <strong><bdi dir="auto">{row.title}</bdi></strong>{row.subtitle&&<span><bdi dir="auto">{row.subtitle}</bdi></span>}
  <small>{row.kind==='track'?'Canción':'Álbum'} · {row.source==='local'?'En este navegador':'LRCLIB'}</small>
 </button>;
 return <section className="music-search" aria-labelledby={`${id}-heading`}>
  <h2 id={`${id}-heading`}>Buscar música</h2>
  <form onSubmit={event=>{event.preventDefault();showAll();}}>
   <label htmlFor={`${id}-query`}>Canción, álbum o artista</label>
   <div className="music-search-query" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setOpen(false);}}>
    <div className="music-search-query-bar">
     <input ref={queryRef} id={`${id}-query`} type="search" role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded?`${id}-quick`:undefined}
      autoComplete="off" maxLength={640} value={props.query} aria-describedby={`${id}-query-help`}
      onFocus={()=>{setFocused(true);setOpen(true);}} onChange={event=>{if(active()){props.onQueryChange(event.currentTarget.value);setOpen(true);}}}
      onKeyDown={event=>{
       if(event.key==='Enter'&&event.nativeEvent.isComposing){event.preventDefault();return;}
       if(event.key==='Escape'){event.preventDefault();setOpen(false);}
       if(event.key==='ArrowDown'&&quick.length){event.preventDefault();setOpen(true);requestAnimationFrame(()=>quickRef.current?.querySelector<HTMLButtonElement>('[data-suggestion-id]')?.focus());}
      }}/>
     <button type="submit" disabled={!props.query.trim()}>Buscar</button>
   {props.onSearchAlbums&&<button type="button" disabled={!props.query.trim()||props.searchPending} onClick={()=>{if(active())props.onSearchAlbums?.();}}>Buscar álbumes</button>}
   {props.onSearchArtists&&<button type="button" disabled={!props.query.trim()||props.searchPending} onClick={()=>{if(active())props.onSearchArtists?.();}}>Buscar artistas</button>}
     {focused&&<button type="button" onClick={()=>{if(active()){props.onQueryChange('');setOpen(false);setFocused(false);queryRef.current?.blur();}}}>Cancelar búsqueda</button>}
    </div>
    {expanded&&<div ref={quickRef} className="music-search-dropdown" aria-label="Sugerencias rápidas">
     <div className="music-search-dropdown-heading"><strong>Sugerencias</strong><button type="button" onClick={()=>{if(active()){queryRef.current?.focus();setOpen(false);}}}>Cerrar sugerencias</button></div>
     <ul id={`${id}-quick`} role="listbox" aria-label="Sugerencias musicales">{quick.map((row,index)=><li role="none" key={row.id}>{card(row,true,index)}</li>)}</ul>
     {props.suggestionsPending&&<p role="status">Buscando sugerencias…</p>}
     <button type="button" className="music-search-see-all" onClick={showAll}>Ver todos los resultados</button>
    </div>}
   </div>
   <p id={`${id}-query-help`}>Enter y Buscar muestran resultados en Pulso. Al elegir una canción se reutiliza tu copia o se consigue desde el bot principal para escucharla.</p>
  </form>
  {props.songActions}
  <div role="status">{props.suggestionsPending?'Buscando sugerencias…':props.suggestionsNotice}</div>
  {props.suggestionsError&&<p role="alert">{props.suggestionsError}</p>}
  {props.onRetrySuggestions&&props.query.trim().length>=3&&<button type="button" disabled={props.suggestionsPending||props.searchPending}
   onClick={()=>{if(active()&&!props.suggestionsPending&&!props.searchPending)props.onRetrySuggestions?.();}}>{props.suggestionsError?'Reintentar sugerencias':'Actualizar sugerencias'}</button>}
  {props.resultsVisible&&<section className="music-search-catalog" aria-labelledby={`${id}-catalog-heading`} aria-busy={props.suggestionsPending}>
   <h3 id={`${id}-catalog-heading`} ref={resultsRef} tabIndex={-1}>Resultados para «{props.query}»</h3>
   <div className="music-search-actions" role="group" aria-label="Tipo de resultado">
    {([['all','Todo'],['track','Canciones'],['album','Álbumes']] as const).map(([kind,label])=><button type="button" key={kind} aria-pressed={filter===kind} onClick={()=>setFilter(kind)}>{label}</button>)}
   </div>
   {groups.filter(([kind])=>filter==='all'||filter===kind).map(([kind,label])=>{
    const rows=props.suggestions.filter(row=>row.kind===kind);
    return <section key={kind} aria-label={label}><h4>{label} ({rows.length})</h4>
     {rows.length?<ul>{rows.map(row=><li key={row.id}>{card(row)}</li>)}</ul>:<p>{props.suggestionsPending?'Buscando coincidencias…':`No hay ${label.toLocaleLowerCase('es')} para este nombre en los resultados disponibles.`}</p>}
    </section>;
   })}
   <p>Las coincidencias repetidas se agrupan. Versiones en vivo, remixes y otros intérpretes se mantienen separados.</p>
   <p>Los resultados disponibles no representan todo el catálogo ni confirman un álbum completo o disponibilidad en Telegram.</p>
  </section>}
  <section className="music-search-bot" aria-label="Consulta al bot">
   <h3>Bot para la canción elegida</h3>
   {provider?<p>Bot principal: <bdi dir="auto">@{provider.username.replace(/^@/,'')}</bdi>. {provider.supported?'Se usará al elegir una canción.':'Este bot todavía no es compatible; cambia el orden en «Bots de música».'}</p>:<p>Añade un bot en «Bots de música». Aquí se usará automáticamente el primero de tu lista.</p>}
   {!props.sessionReady&&<p>Conecta Telegram para consultar tu bot. Las sugerencias musicales ya están disponibles.</p>}
   {props.sessionReady&&provider?.supported&&!ready&&!props.searchPending&&<p>La consulta estará disponible cuando termine la operación pendiente.</p>}
   {!props.songActions&&<>{props.searchPending&&<button type="button" onClick={()=>{if(committed.current===props&&props.searchPending)(props.onCancelDownload??props.onCancel)();}}>Cancelar consulta</button>}
   {props.downloadProgress&&props.downloadProgress.total>0&&<progress aria-label="Progreso de la descarga" value={props.downloadProgress.bytes} max={props.downloadProgress.total}/>}
   {props.downloadStatus&&<p role="status">{props.downloadStatus}</p>}
   <div role="status">{props.searchPending?'Consultando la canción elegida…':props.status}</div>
   {props.error&&<p role="alert">{props.error}</p>}
   {props.uncertain&&<p>Resultado incierto: no se ha confirmado la respuesta del bot. No se reintentará ni cambiará de bot automáticamente.</p>}
   </>}
   {props.results.length>0&&!props.automaticSelection&&<><h3>Respuesta del bot</h3><p>Si hay varias opciones, elige la versión correcta: se descargará y reproducirá una única copia en Pulso. Límite inicial: 8 MiB; no hace falta exportar a Archivos.</p>
    <ul className="music-search-results">{props.results.map(row=><li key={row.id} data-result-id={row.id}>
     <strong><bdi dir="auto">{row.title}</bdi></strong>{row.subtitle&&<p><bdi dir="auto">{row.subtitle}</bdi></p>}
     <p>{row.kind==='audio'?'Referencia de audio; disponibilidad sin verificar.':row.kind==='option'?'Botón del bot: se pulsa sólo al elegir esta opción.':'Mensaje del bot.'}</p>
     <p>{correlationLabels[row.correlation]}</p><p>{matchLabels[row.match]}</p>
     <button type="button" aria-pressed={props.selectedResultId===row.id} disabled={props.searchPending||row.kind==='message'}
      onClick={()=>{if(active()&&!props.searchPending)props.onSelectResult(row.id);}}>{row.kind==='audio'?'Escuchar esta versión':'Elegir esta versión'}</button>

    </li>)}</ul></>}
  </section>
  <p>Las sugerencias externas proceden de <a href="https://lrclib.net/docs" target="_blank" rel="noopener noreferrer">LRCLIB</a>.</p>
 </section>;
}
