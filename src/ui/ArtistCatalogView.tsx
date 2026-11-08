import React from 'react';
import {AlbumCatalog,type AlbumEdition,type CatalogArtist} from '../library/album-catalog';

const catalog = new AlbumCatalog((...args) => fetch(...args));
interface SearchProps { query:string; scope:string; visible:boolean; request:number; onOpen:(artist:CatalogArtist,opener:HTMLButtonElement)=>void }
export function ArtistSearchResults(props:SearchProps) {
 const [rows,setRows]=React.useState<CatalogArtist[]>([]),[status,setStatus]=React.useState('');
 const latest=React.useRef(props), generation=React.useRef(0), completed=React.useRef('');
 React.useLayoutEffect(()=>{latest.current=props;});
 React.useEffect(()=>{
  const token=++generation.current,abort=new AbortController(),query=props.query.trim();
  if(!props.request||!props.visible||!query)return()=>abort.abort();
  const key=JSON.stringify([props.request,query,props.scope]);
  if(completed.current===key)return()=>abort.abort();
  setRows([]);setStatus('');
  setStatus('Buscando artistas…');
  const current=()=>generation.current===token&&!abort.signal.aborted&&latest.current.visible&&latest.current.query.trim()===query&&latest.current.scope===props.scope&&latest.current.request===props.request;
  void catalog.searchArtists(query,{signal:abort.signal,current}).then(result=>{if(!current())return;if(!result.ok){setStatus('No se pudieron consultar los artistas.');return;}completed.current=key;setRows(result.value);setStatus(result.value.length?'Artistas disponibles en iTunes US (hasta 20 resultados).':'No se encontraron artistas en los resultados disponibles de iTunes US.');});
  return()=>{++generation.current;abort.abort();};
 },[props.request,props.query,props.scope,props.visible]);
 return <section aria-label="Artistas"><h3>Artistas</h3>{status&&<p role="status">{status}</p>}<ul>{(completed.current===JSON.stringify([props.request,props.query.trim(),props.scope])?rows:[]).map(row=><li key={row.id}><button type="button" onClick={event=>{if(latest.current===props&&props.visible)props.onOpen(row,event.currentTarget);}}><strong>{row.name}</strong> · Artista · iTunes US · ID {row.id}</button></li>)}</ul></section>;
}
interface PageProps { artist:CatalogArtist; scope:string; visible:boolean; onBack:()=>void; onAlbum:(album:AlbumEdition,opener:HTMLButtonElement)=>void }
export function ArtistPage(props:PageProps){
 const [rows,setRows]=React.useState<AlbumEdition[]>([]),[status,setStatus]=React.useState('Cargando álbumes…');
 const latest=React.useRef(props),heading=React.useRef<HTMLHeadingElement>(null),generation=React.useRef(0),completed=React.useRef('');
 React.useLayoutEffect(()=>{latest.current=props;});
 React.useLayoutEffect(()=>{heading.current?.focus();},[props.artist.id]);
 React.useEffect(()=>{
  const token=++generation.current,abort=new AbortController();
  if(!props.visible)return()=>abort.abort();
  const key=JSON.stringify([props.artist.id,props.scope]);
  if(completed.current===key)return()=>abort.abort();
  setRows([]);setStatus('Cargando álbumes…');
  const current=()=>generation.current===token&&!abort.signal.aborted&&latest.current.visible&&latest.current.scope===props.scope&&latest.current.artist.id===props.artist.id;
  void catalog.artistAlbums(props.artist.id,{signal:abort.signal,current}).then(result=>{if(!current())return;if(!result.ok){setStatus('No se pudo consultar la lista de álbumes.');return;}completed.current=key;setRows(result.value);setStatus(result.value.length?'':'No se encontraron álbumes en los resultados disponibles.');});
  return()=>{++generation.current;abort.abort();};
 },[props.artist.id,props.scope,props.visible]);
 return <section className="album-page" aria-labelledby="artist-heading"><button type="button" onClick={()=>{if(latest.current===props&&props.visible)props.onBack();}}>Volver a búsqueda</button><h2 id="artist-heading" ref={heading} tabIndex={-1}>{props.artist.name}</h2><p>Álbumes y publicaciones asociadas en iTunes US: se muestran hasta 100 resultados; esta lista puede estar incompleta.</p>{status&&<p role="status">{status}</p>}<ul>{(completed.current===JSON.stringify([props.artist.id,props.scope])?rows:[]).map(row=><li key={row.id}><button type="button" onClick={event=>{if(latest.current===props&&props.visible)props.onAlbum(row,event.currentTarget);}}>{row.title} · {row.artist} · {row.releaseDate?.slice(0,10)??'fecha desconocida'} · {row.trackCount} pistas</button></li>)}</ul></section>;
}
