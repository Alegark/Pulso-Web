import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {MiniPlayer} from '../../src/ui/MiniPlayer';
import {PlayerSurface} from '../../src/ui/PlayerSurface';
import {ErrorBubble,type ErrorNotice} from '../../src/ui/ErrorBubble';
import {albums,artists,tracks,albumFor,artistFor,type DemoTrack} from './catalog';
import {demoAudioUrl} from './demo-audio';
import {NowPlaying} from './NowPlaying';
import {DesktopPlayer} from './DesktopPlayer';
import {SaveTrackButton} from './SaveTrackButton';
import {TrackActionsSheet} from './TrackActionsSheet';
import {initialPlaylists,type DemoPlaylist} from './playlists';
import {PlaylistCards,PlaylistCover,PlaylistDetail} from './PlaylistScreens';
import '../../src/ui/design-tokens.css';
import '../../src/ui/responsive-shell.css';
import {LibraryView,type LibraryFilter,type LibraryItem} from './LibraryView';
import './screens.css';

type Route={screen:'home'|'search'|'library'}|{screen:'album'|'artist'|'playlist';id:string};
type Category='Canciones'|'Álbumes'|'Artistas';
type Notice=ErrorNotice&{kind:'search'|'play'};
const paths={home:'M3 11 12 3l9 8v10h-6v-7H9v7H3Z',search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',library:'M4 4v16M9 4v16M14 4l6 16',play:'m8 4 12 8-12 8Z',pause:'M8 5v14M16 5v14',heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8',back:'m14 6-6 6 6 6',next:'m5 4 12 8-12 8ZM20 4v16'};
function Icon({name}:{name:keyof typeof paths}){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} fill={name==='play'?'currentColor':'none'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;}
function Cover({album,small=false}:{album:typeof albums[number];small?:boolean}){return <span className={`cover cover--${album.color}${small?' cover--small':''}`} aria-hidden="true"><span className="cover__orbit"/><span className="cover__word">{album.title}</span><span className="cover__edition">PULSO / {album.year}</span></span>;}
function Empty({title,children}:{title:string;children:ReactNode}){return <div className="empty-state"><span className="empty-state__icon" aria-hidden="true">♫</span><h2>{title}</h2><p>{children}</p></div>;}
const startWithPlaylists=document.getElementById('root')?.dataset.start==='playlists';
const startWithPlayer=document.getElementById('root')?.dataset.start==='player';

function DemoApp(){
  const [route,setRoute]=useState<Route>({screen:startWithPlaylists?'library':'home'});
  const [query,setQuery]=useState(''),[submitted,setSubmitted]=useState(''),[category,setCategory]=useState<Category>('Canciones');
  const [filter,setFilter]=useState<LibraryFilter>(null);
  const [libraryQuery,setLibraryQuery]=useState(''),[librarySearchOpen,setLibrarySearchOpen]=useState(false),[libraryAlphabetical,setLibraryAlphabetical]=useState(false),[libraryList,setLibraryList]=useState(false);
  const [playlists,setPlaylists]=useState<DemoPlaylist[]>(initialPlaylists),[creatingPlaylist,setCreatingPlaylist]=useState(false);
  const playlistCounter=useRef(0),queue=useRef(tracks.map(t=>t.id));
  const [members,setMembers]=useState(new Set(['a','b','c','d','e','f']));
  const favorites=members;
  const favoritePlaylist:DemoPlaylist={id:'favoritos',name:'Favoritos',description:'Las canciones que añades a tu biblioteca, siempre juntas.',trackIds:[...members],color:'blue',automatic:true};
  const allPlaylists=[favoritePlaylist,...playlists];
  const [current,setCurrent]=useState('a'),[playing,setPlaying]=useState(false),[position,setPosition]=useState(0);
  const [shuffle,setShuffle]=useState(false),[repeat,setRepeat]=useState(true),[volume,setVolume]=useState(.35);
  const [playerView,setPlayerView]=useState<'player'|'lyrics'|'queue'>('player');
  const [playerOpen,setPlayerOpen]=useState(startWithPlayer),[theme,setTheme]=useState<'light'|'dark'>('light');
  const [long,setLong]=useState(false),[notice,setNotice]=useState<Notice|null>(null),[busy,setBusy]=useState(false);
  const [searchState,setSearchState]=useState<'idle'|'loading'|'ready'|'error'>('idle');
  const [status,setStatus]=useState('');
  const [actionTrack,setActionTrack]=useState<DemoTrack|null>(null),actionOpener=useRef<HTMLButtonElement|null>(null);
  const [dockOffset,setDockOffset]=useState(0),dock=useRef<HTMLDivElement>(null);
  const audio=useRef<HTMLAudioElement|null>(null),opener=useRef<HTMLButtonElement|null>(null),heading=useRef<HTMLHeadingElement|null>(null);
  const history=useRef<{route:Route;scroll:number;focus:string|null}[]>([]),restore=useRef<{scroll:number;focus:string|null}|null>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null),generation=useRef(0),retrying=useRef(false);
  const track=tracks.find(t=>t.id===current)!,album=albumFor(track),artist=artistFor(album);
  const title=(t:DemoTrack)=>long?`${t.title} — una versión en vivo con un título extraordinariamente largo 🌙 音楽 ${'Luz'.repeat(25)}`:t.title;
  const cancelPending=()=>{generation.current++;if(timer.current)clearTimeout(timer.current);timer.current=null;retrying.current=false;setBusy(false);};
  function clearNotice(){
    if(document.activeElement?.closest('.error-bubble-host')){
      const target=playerOpen?document.querySelector<HTMLButtonElement>('.player-surface__toolbar button'):route.screen==='search'?document.getElementById('music-search'):heading.current;
      target?.focus({preventScroll:true});
    }
    setNotice(null);
  }
  useEffect(()=>{
    const element=new Audio(),url=demoAudioUrl();element.src=url;element.loop=true;element.volume=.35;audio.current=element;
    const time=()=>setPosition(element.currentTime),play=()=>setPlaying(true),pause=()=>setPlaying(false);
    element.addEventListener('timeupdate',time);element.addEventListener('play',play);element.addEventListener('pause',pause);
    return()=>{element.pause();element.removeAttribute('src');element.load();URL.revokeObjectURL(url);audio.current=null;generation.current++;if(timer.current)clearTimeout(timer.current);};
  },[]);
  useEffect(()=>{document.documentElement.dataset.theme=theme;},[theme]);
  useEffect(()=>{if(audio.current)audio.current.loop=repeat;},[repeat]);
  useEffect(()=>{if(audio.current)audio.current.volume=volume;},[volume]);
  useLayoutEffect(()=>{
    const node=dock.current;if(!node)return;
    const measure=()=>{const height=getComputedStyle(node).position==='fixed'?node.getBoundingClientRect().height:0;node.closest<HTMLElement>('.music-demo')?.style.setProperty('--desktop-dock-height',`${height}px`);setDockOffset(!playerOpen?height:0);};
    const observer=new ResizeObserver(measure);observer.observe(node);measure();window.addEventListener('resize',measure);
    return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
  },[playerOpen]);
  useLayoutEffect(()=>{
    const previous=restore.current;restore.current=null;
    const target=previous?.focus?document.getElementById(previous.focus):null;
    (target??document.querySelector<HTMLInputElement>('.playlist-form input')??heading.current)?.focus({preventScroll:true});window.scrollTo(0,previous?.scroll??0);
  },[route]);
  useLayoutEffect(()=>{
    if(playerOpen){document.querySelector<HTMLButtonElement>('.player-surface__toolbar button')?.focus();return;}
    if(!opener.current&&!startWithPlayer)return;
    const visibleOpener=opener.current?.getClientRects().length?opener.current:[...document.querySelectorAll<HTMLButtonElement>('.mini-player__expand,.desktop-player__details')].find(button=>button.getClientRects().length);
    visibleOpener?.focus({preventScroll:true});
  },[playerOpen]);
  function go(next:Route){
    history.current.push({route,scroll:window.scrollY,focus:document.activeElement?.id||null});
    cancelPending();setNotice(null);if(searchState==='loading')setSearchState('idle');setRoute(next);
  }
  function back(){const previous=history.current.pop();cancelPending();setNotice(null);if(previous){restore.current=previous;setRoute(previous.route);}else setRoute({screen:'home'});}
  function toggleFavorite(id:string){setMembers(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next;});}
  function toggleAlbum(id:string){const ids=tracks.filter(t=>t.albumId===id).map(t=>t.id);const added=ids.every(i=>members.has(i));setMembers(previous=>{const next=new Set(previous);for(const i of ids){if(added)next.delete(i);else next.add(i);}return next;});setStatus(added?'Álbum quitado de la biblioteca de muestra.':'Álbum añadido a la biblioteca de muestra.');}
  async function play(id=current){const token=generation.current;setCurrent(id);try{if(!audio.current)return false;await audio.current.play();return true;}catch{if(token===generation.current)setNotice({kind:'play',title:'No pudimos iniciar el audio',message:'Tu selección sigue aquí. Reintenta para iniciar el sonido de prueba.'});return false;}}
  function selectTrack(id:string,sequence=tracks.map(t=>t.id)){queue.current=[...sequence];if(current!==id&&audio.current){audio.current.currentTime=0;setPosition(0);}void play(id);}
  function next(){const ids=queue.current,index=ids.indexOf(current);if(!ids.length)return;const candidates=ids.filter(id=>id!==current);const id=shuffle&&candidates.length?candidates[Math.floor(Math.random()*candidates.length)]:ids[(index+1)%ids.length];selectTrack(id,ids);}
  function previous(){if(audio.current&&audio.current.currentTime>3){audio.current.currentTime=0;setPosition(0);return;}const ids=queue.current,index=ids.indexOf(current);if(ids.length)selectTrack(ids[(index-1+ids.length)%ids.length],ids);}
  function openPlayer(button:HTMLButtonElement,view:'player'|'lyrics'|'queue'='player'){opener.current=button;setPlayerView(view);setPlayerOpen(true);}
  function createPlaylist(name:string,description:string){const id=`custom-${++playlistCounter.current}`;setPlaylists(previous=>[...previous,{id,name,description,trackIds:[],color:'green'}]);setCreatingPlaylist(false);go({screen:'playlist',id});}
  function updatePlaylist(playlist:DemoPlaylist){
    if(playlist.automatic){setMembers(new Set(playlist.trackIds));return;}
    const previous=playlists.find(p=>p.id===playlist.id);
    const added=playlist.trackIds.filter(id=>!previous?.trackIds.includes(id));
    if(added.length)setMembers(value=>new Set([...value,...added]));
    setPlaylists(previous=>previous.map(value=>value.id===playlist.id?playlist:value));
  }
  function search(value=query){
    cancelPending();setNotice(null);setSubmitted(value.trim());if(!value.trim()){setSearchState('idle');return;}
    setSearchState('loading');const token=generation.current;
    timer.current=setTimeout(()=>{if(token===generation.current)setSearchState('ready');timer.current=null;},450);
  }
  function simulate(kind:'search'|'play'){
    cancelPending();if(kind==='search'){go({screen:'search'});setQuery('Luna');setSubmitted('Luna');setSearchState('error');}
    else audio.current?.pause();
    setNotice(kind==='search'?{kind,title:'La búsqueda no se pudo completar',message:'Tu búsqueda se conserva. Puedes reintentarlo cuando quieras.'}:{kind,title:'No pudimos reproducir esta canción',message:'La cola y tu biblioteca se conservan. Reintenta para escuchar el sonido de prueba.'});
  }
  function retry(){
    if(!notice||retrying.current)return;
    retrying.current=true;setBusy(true);const kind=notice.kind,token=++generation.current;
    // Playback retries must retain the user's gesture, especially in Safari.
    if(kind==='play'){void play().then(success=>{if(token!==generation.current)return;retrying.current=false;setBusy(false);if(success)clearNotice();});return;}
    timer.current=setTimeout(()=>{if(token!==generation.current)return;setSearchState('ready');clearNotice();setBusy(false);retrying.current=false;setStatus('Búsqueda de muestra completada.');timer.current=null;},650);
  }
  const error=<ErrorBubble notice={notice} busy={busy} bottomOffset={dockOffset} onDismiss={()=>{cancelPending();clearNotice();}} onRetry={retry}/>;
  const match=(text:string)=>text.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().includes(submitted.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase());
  const matchingTracks=tracks.filter(t=>match([t.title,albumFor(t).title,artistFor(albumFor(t)).name].join(' ')));
  const matchingAlbums=albums.filter(a=>match(a.title+' '+artistFor(a).name)),matchingArtists=artists.filter(a=>match(a.name));
  const albumCards=(items:typeof albums)=><div className="album-grid">{items.map(a=><button id={`album-${a.id}`} type="button" className="album-card" key={a.id} onClick={()=>go({screen:'album',id:a.id})}><Cover album={a}/><strong>{a.title}</strong><span>{artistFor(a).name}</span></button>)}</div>;
  const artistCards=(items:typeof artists)=><div className="artist-grid">{items.map(a=><button id={`artist-${a.id}`} type="button" className="artist-card" key={a.id} onClick={()=>go({screen:'artist',id:a.id})}><span className="artist-avatar" aria-hidden="true">{a.initials}</span><strong>{a.name}</strong><span>Ver publicaciones</span></button>)}</div>;
  const rows=(items:DemoTrack[])=><ol className="song-list">{items.map((t,index)=><li key={t.id} data-current={current===t.id?'true':undefined}><span className="song-number" aria-hidden="true">{current===t.id&&playing?'♫':String(index+1).padStart(2,'0')}</span><button type="button" className="song-main" aria-label={`Reproducir ${t.title}`} onClick={()=>selectTrack(t.id)}><strong>{title(t)}</strong><span>{artistFor(albumFor(t)).name} · {members.has(t.id)?'En biblioteca':'Fuera de biblioteca'}</span></button><span className="song-duration">{t.duration}</span><SaveTrackButton saved={favorites.has(t.id)} label={`${favorites.has(t.id)?'Quitar de':'Añadir a'} favoritos: ${t.title}`} onToggle={()=>toggleFavorite(t.id)}/><button type="button" className="round-button song-options" aria-label={`Opciones de ${t.title}`} onClick={event=>{actionOpener.current=event.currentTarget;setActionTrack(t);}}>⋯</button></li>)}</ol>;
  const libraryItems:LibraryItem[]=[
    ...[favoritePlaylist,...[...playlists].reverse()].map(p=>({id:`playlist-${p.id}`,name:p.name,subtitle:`Playlist · ${p.trackIds.length} canciones`,kind:'Playlists' as const,pinned:p.automatic,cover:<PlaylistCover playlist={p}/>,onOpen:()=>go({screen:'playlist',id:p.id})})),
    ...albums.filter(a=>tracks.some(t=>members.has(t.id)&&t.albumId===a.id)).map(a=>({id:`album-${a.id}`,name:a.title,subtitle:`Álbum · ${artistFor(a).name}`,kind:'Álbumes' as const,cover:<Cover album={a}/>,onOpen:()=>go({screen:'album',id:a.id})})),
    ...artists.filter(a=>tracks.some(t=>members.has(t.id)&&albumFor(t).artistId===a.id)).map(a=>({id:`artist-${a.id}`,name:a.name,subtitle:'Artista',kind:'Artistas' as const,cover:<span className="artist-avatar" aria-hidden="true">{a.initials}</span>,onOpen:()=>go({screen:'artist',id:a.id})})),
  ];
  const nav=<nav className="music-nav" aria-label="Navegación principal">{(['home','search','library'] as const).map((screen,index)=><button key={screen} type="button" aria-current={route.screen===screen?'page':undefined} onClick={()=>go({screen})}><Icon name={screen}/><span>{['Inicio','Buscar','Biblioteca'][index]}</span></button>)}</nav>;
  const routeId='id'in route?route.id:'';
  const pageTitle=route.screen==='home'?'Tu música, a tu ritmo.':route.screen==='search'?'Encuentra tu próxima canción.':route.screen==='library'?'Tu biblioteca':route.screen==='album'?albums.find(a=>a.id===routeId)!.title:route.screen==='artist'?artists.find(a=>a.id===routeId)!.name:allPlaylists.find(p=>p.id===routeId)?.name??'Playlist no disponible';
  return <div className="music-demo pulso-app" data-screen={route.screen}>
    <aside className="music-sidebar"><span className="music-wordmark">pulso<span>●</span></span>{nav}<div className="sidebar-note"><span className="eyebrow">TUS PLAYLISTS</span><div className="sidebar-playlists">{allPlaylists.map(p=><button id={`sidebar-playlist-${p.id}`} type="button" key={p.id} onClick={()=>go({screen:'playlist',id:p.id})}><PlaylistCover playlist={p}/><span><strong>{p.name}</strong><span>{p.trackIds.length} canciones</span></span></button>)}<button type="button" onClick={()=>{setFilter('Playlists');setCreatingPlaylist(true);go({screen:'library'});}}>+ Crear playlist</button></div></div></aside>
    <div className="music-body">
      <header className="music-topbar"><span className="mobile-wordmark">pulso<span>●</span></span><span className="demo-label">Muestra interactiva</span><form className="desktop-search" role="search" onSubmit={event=>{event.preventDefault();if(route.screen!=='search')go({screen:'search'});search();}}><Icon name="search"/><input type="search" aria-label="Buscar música en la muestra" placeholder="¿Qué quieres escuchar?" value={query} onChange={event=>setQuery(event.target.value)}/><button type="submit">Buscar</button></form><button type="button" className="theme-button" onClick={()=>setTheme(theme==='light'?'dark':'light')} aria-label={theme==='light'?'Activar tema oscuro':'Activar tema claro'}>{theme==='light'?'◐':'◑'}<span>Apariencia</span></button></header>
      <div className="demo-context">Muestra local · datos ficticios · tono de 8 s</div>
      {!playerOpen&&error}
      <main className="music-content" id="contenido">
        <div className={`page-heading${route.screen==='library'?' page-heading--library':''}`}>{(route.screen==='album'||route.screen==='artist'||route.screen==='playlist')&&<button type="button" className="back-button" onClick={back}><Icon name="back"/>Volver</button>}<span className="eyebrow">{route.screen==='home'?'HECHO A TU MANERA':route.screen==='search'?'BUSCAR':route.screen==='library'?'LO QUE TE GUSTA':route.screen==='album'?'ÁLBUM · EDICIÓN DE MUESTRA':route.screen==='playlist'?'TU PLAYLIST':'ARTISTA DE MUESTRA'}</span><h1 ref={heading} tabIndex={-1}>{pageTitle}</h1>{route.screen==='library'&&<div className="library-heading-actions"><button className="round-button" type="button" aria-label="Buscar en Biblioteca" aria-expanded={librarySearchOpen} onClick={()=>{if(librarySearchOpen)setLibraryQuery('');setLibrarySearchOpen(!librarySearchOpen);}}><Icon name="search"/></button><button id="library-create" className="round-button" type="button" aria-label="Crear playlist" onClick={()=>setCreatingPlaylist(true)}>+</button></div>}</div>
        {route.screen==='home'&&<>
          <div className="mobile-quick-grid" aria-label="Accesos a tu música">{libraryItems.slice(0,4).map(item=><button type="button" key={item.id} id={`quick-${item.id}`} title={item.name} className="mobile-quick-card" onClick={item.onOpen}>{item.cover}<strong>{item.name}</strong></button>)}</div>
          <div className="home-feature"><div><span className="eyebrow">VUELVE A LO TUYO</span><h2>Un momento<br/> para escuchar.</h2><p>Retoma Órbita lenta, de Luna Norte.</p><button type="button" className="primary-button" onClick={()=>selectTrack('a')}><Icon name="play"/>Escuchar muestra</button><button id="feature-album" type="button" className="text-button" onClick={()=>go({screen:'album',id:'orbita'})}>Explorar álbum →</button></div><Cover album={albums[0]}/></div>
          <div className="section-heading"><h2>En tu biblioteca</h2><button type="button" className="text-button" onClick={()=>go({screen:'library'})}>Ver todo →</button></div>
          {members.size?albumCards(albums.filter(a=>tracks.some(t=>t.albumId===a.id&&members.has(t.id)))):<Empty title="Tu biblioteca empieza contigo">Añade un álbum desde la muestra para verlo aquí.</Empty>}
          <div className="section-heading"><h2>Vuelve a escuchar</h2><span>Selección de muestra</span></div>{rows(tracks.slice(0,3))}
          <div className="section-heading"><h2>Tus playlists</h2><button type="button" className="text-button" onClick={()=>{setFilter('Playlists');go({screen:'library'});}}>Ver playlists →</button></div>
          <PlaylistCards playlists={allPlaylists} onOpen={id=>go({screen:'playlist',id})}/>
        </>}
        {route.screen==='search'&&<>
          <form className="search-form" onSubmit={event=>{event.preventDefault();search();}}><label htmlFor="music-search">Canciones, álbumes o artistas</label><div><Icon name="search"/><input id="music-search" type="search" placeholder="¿Qué quieres escuchar?" value={query} onChange={event=>setQuery(event.target.value)}/><button type="submit">Buscar</button></div></form>
          <div className="filter-row" aria-label="Tipo de resultado">{(['Canciones','Álbumes','Artistas'] as Category[]).map(item=><button key={item} type="button" aria-pressed={category===item} onClick={()=>setCategory(item)}>{item}</button>)}</div>
          <p className="search-status" role="status">{searchState==='loading'?'Buscando en el catálogo de muestra…':searchState==='error'?'Búsqueda pendiente. Puedes volver a intentarlo.':submitted?`Resultados para «${submitted}»`:searchState==='ready'?'Catálogo de muestra':'Prueba con Luna, Órbita o Río Claro.'}</p>
          {searchState==='loading'?<div className="search-skeleton" aria-hidden="true"><span/><span/><span/></div>:searchState==='error'?<Empty title="Tu búsqueda sigue aquí">Tu consulta está en el campo de búsqueda. Pulsa Buscar para intentarlo de nuevo.</Empty>:searchState==='ready'?<>{category==='Canciones'&&(matchingTracks.length?rows(matchingTracks):<Empty title="Sin coincidencias">Prueba otro título o un nombre más corto.</Empty>)}{category==='Álbumes'&&(matchingAlbums.length?albumCards(matchingAlbums):<Empty title="Sin álbumes">Prueba buscando Luna u Órbita.</Empty>)}{category==='Artistas'&&(matchingArtists.length?artistCards(matchingArtists):<Empty title="Sin artistas">Prueba con Luna o Río Claro.</Empty>)}</>:<div className="search-discovery"><div className="mobile-browse"><h2>Explora tu música</h2><div><button type="button" onClick={()=>{setCategory('Álbumes');setSubmitted('');setSearchState('ready');}}>Álbumes<span aria-hidden="true">◌</span></button><button type="button" onClick={()=>{setCategory('Artistas');setSubmitted('');setSearchState('ready');}}>Artistas<span aria-hidden="true">♬</span></button><button type="button" onClick={()=>{setFilter('Playlists');go({screen:'library'});}}>Tus playlists<span aria-hidden="true">≋</span></button><button type="button" onClick={()=>go({screen:'playlist',id:'favoritos'})}>Favoritos<span aria-hidden="true">♡</span></button></div></div><div className="search-discovery__catalog"><div className="section-heading"><h2>Explora la muestra</h2></div>{albumCards(albums)}<div className="section-heading"><h2>Artistas</h2></div>{artistCards(artists)}</div></div>}
        </>}
        {route.screen==='library'&&<LibraryView items={libraryItems} filter={filter} onFilter={setFilter} query={libraryQuery} onQuery={setLibraryQuery} searchOpen={librarySearchOpen} alphabetical={libraryAlphabetical} onSort={()=>setLibraryAlphabetical(!libraryAlphabetical)} list={libraryList} onLayout={()=>setLibraryList(!libraryList)} creating={creatingPlaylist} onCreate={createPlaylist} onCancelCreate={()=>{setCreatingPlaylist(false);document.getElementById('library-create')?.focus();}}/>}
        {route.screen==='album'&&(()=>{const selected=albums.find(a=>a.id===route.id)!,songs=tracks.filter(t=>t.albumId===selected.id),owner=artistFor(selected),added=songs.every(t=>members.has(t.id));return <>
          <div className="album-detail"><Cover album={selected}/><div><button id={`album-artist-${owner.id}`} type="button" className="artist-link" onClick={()=>go({screen:'artist',id:owner.id})}>{owner.name} ↗</button><p>{selected.year} · {songs.length} canciones de muestra</p><p>{selected.caption}</p><div className="detail-actions"><button type="button" className="primary-button" onClick={()=>selectTrack(songs[0].id)}><Icon name="play"/>Escuchar muestra</button><button type="button" aria-pressed={added} onClick={()=>toggleAlbum(selected.id)}>{added?'Quitar de Biblioteca':'+ Añadir a Biblioteca'}</button></div><span className="availability">Sin copia guardada · edición ficticia</span></div></div>
          <div className="section-heading"><h2>Canciones</h2></div>{rows(songs)}<p className="detail-footnote">Los tiempos ilustran el diseño. Todos los botones de reproducción usan el mismo sonido original de prueba de 8 segundos.</p>
        </>;})()}
        {route.screen==='artist'&&(()=>{const selected=artists.find(a=>a.id===route.id)!;return <><div className="artist-detail"><span className="artist-avatar artist-avatar--large" aria-hidden="true">{selected.initials}</span><div><p>{selected.description}</p><span className="availability">Perfil ficticio · sin catálogo externo</span></div></div><div className="section-heading"><h2>Publicaciones</h2><span>En esta muestra</span></div>{albumCards(albums.filter(a=>a.artistId===selected.id))}</>;})()}
        {route.screen==='playlist'&&(()=>{const selected=allPlaylists.find(p=>p.id===route.id);return selected?<PlaylistDetail key={selected.id} playlist={selected} current={current} title={title} onPlay={id=>selectTrack(id,selected.trackIds)} onUpdate={updatePlaylist} onDelete={()=>{setPlaylists(previous=>previous.filter(p=>p.id!==selected.id));setFilter('Playlists');setStatus('Playlist eliminada. Las canciones se conservan.');go({screen:'library'});}}/>:<Empty title="Esta playlist ya no está">Encuentra tus otras listas en Biblioteca → Playlists.</Empty>;})()}
        <details className="demo-tools"><summary>Probar estados del diseño</summary><p>Estas acciones sólo cambian los datos ficticios de esta pestaña.</p><div><button type="button" onClick={()=>simulate('search')}>Probar error de búsqueda</button><button type="button" onClick={()=>simulate('play')}>Probar error de reproducción</button><button type="button" aria-pressed={long} onClick={()=>setLong(!long)}>Títulos largos</button><button type="button" onClick={()=>{setMembers(new Set());setPlaylists([]);setFilter(null);setLibraryQuery('');go({screen:'library'});}}>Biblioteca vacía</button><button type="button" onClick={()=>{setMembers(new Set(['a','b','c','d','e','f']));setPlaylists(initialPlaylists);setLong(false);setStatus('Datos de muestra restaurados.');}}>Restaurar muestra</button></div></details>
        <div className="sr-only" role="status">{status}</div>
      </main>
    </div>
    <div ref={dock} className="music-dock"><DesktopPlayer title={title(track)} artist={artist.name} saved={favorites.has(current)} playing={playing} position={position} volume={volume} shuffle={shuffle} repeat={repeat} onSave={()=>toggleFavorite(current)} onPlayPause={()=>playing?audio.current?.pause():void play()} onPrevious={previous} onNext={next} onSeek={time=>{if(audio.current)audio.current.currentTime=time;setPosition(time);}} onVolume={setVolume} onShuffle={()=>setShuffle(!shuffle)} onRepeat={()=>setRepeat(!repeat)} onOpen={openPlayer}/><MiniPlayer title={title(track)} artist={artist.name} stateText={playing?'Sonando':'En pausa'} playing={playing} canPlay canPause onPlay={()=>void play()} onPause={()=>audio.current?.pause()} onOpenPlayer={button=>openPlayer(button)}/><div className="mobile-nav">{nav}</div></div>
    <TrackActionsSheet track={actionTrack?{id:actionTrack.id,title:title(actionTrack),artist:artistFor(albumFor(actionTrack)).name}:null} saved={!!actionTrack&&favorites.has(actionTrack.id)} playlists={playlists} opener={actionOpener.current} onClose={()=>setActionTrack(null)} onPlay={()=>{if(actionTrack)selectTrack(actionTrack.id);}} onSave={()=>{if(actionTrack)toggleFavorite(actionTrack.id);}} onAdd={id=>{const playlist=playlists.find(p=>p.id===id);if(playlist&&actionTrack&&!playlist.trackIds.includes(actionTrack.id)){updatePlaylist({...playlist,trackIds:[...playlist.trackIds,actionTrack.id]});setStatus('Canción añadida a la playlist de muestra.');}}}/>
    <div data-album-color={album.color} className={playerOpen?'demo-player-mount':'demo-player-mount demo-player-mount--closed'}><PlayerSurface open={playerOpen} onClose={()=>setPlayerOpen(false)}>
      {playerOpen&&error}<NowPlaying requestedView={playerView} open={playerOpen} trackId={current} title={title(track)} artist={artist.name} album={album.title} cover={<Cover album={album}/>} playing={playing} position={position} saved={favorites.has(current)} shuffle={shuffle} repeat={repeat} queue={queue.current.map(id=>{const t=tracks.find(t=>t.id===id)!;return {id,title:title(t),artist:artistFor(albumFor(t)).name};})} onToggleSave={()=>toggleFavorite(current)} onPlayPause={()=>playing?audio.current?.pause():void play()} onSeek={time=>{if(audio.current)audio.current.currentTime=time;setPosition(time);}} onNext={next} onPrevious={previous} onShuffle={()=>setShuffle(!shuffle)} onRepeat={()=>setRepeat(!repeat)} onQueueSelect={id=>selectTrack(id,queue.current)}/>
      <p className="detail-footnote">Sonido y texto originales de muestra. No se conecta a Telegram ni a proveedores de letras.</p>
      <button type="button" onClick={()=>simulate('play')}>Probar aviso de error aquí</button>
    </PlayerSurface></div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<DemoApp/>);
