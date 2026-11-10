export interface ContinueSelection {
  title: string;
  artist: string | null;
  stateText: string;
  positionSeconds: number;
  canPlay: boolean;
  playing: boolean;
}

export interface HomeTrack {
  id: string;
  title: string;
  artist: string | null;
  availability: string;
  canPrepare: boolean;
}

export interface HomePlaylist {
  id: string;
  name: string;
  count: number;
}

export interface HomeViewProps {
  continueSelection: ContinueSelection | null;
  recent: readonly HomeTrack[];
  playlists: readonly HomePlaylist[];
  empty: boolean;
  canCreate: boolean;
  onOpenPlayer: (opener: HTMLButtonElement) => void;
  onPlay: () => void;
  onOpenLibrary: () => void;
  onOpenFavorites?: () => void;
  onOpenPlaylist: (id: string) => void;
  onPrepareTrack: (id: string) => void;
  onOpenSearch: () => void;
  onCreatePlaylist: () => void;
}

export function HomeView(props: HomeViewProps) {
  const { continueSelection, recent, playlists } = props;
  return <div className="home-view">
    <h2 id="home-heading" tabIndex={-1}>Tu música</h2>
    <p className="home-view__intro">Todo lo que quieres escuchar, en un solo lugar.</p>
    <div className="home-quick">
      <button onClick={props.onOpenFavorites??props.onOpenLibrary}><span aria-hidden="true">♥</span> Favoritos</button><button onClick={props.onOpenLibrary}><span aria-hidden="true">▦</span> Tu biblioteca</button>
      <button onClick={props.onOpenSearch}><span aria-hidden="true">⌕</span> Buscar música</button>
      {playlists.slice(0,2).map(list=><button key={list.id} onClick={()=>props.onOpenPlaylist(list.id)}><span aria-hidden="true">♫</span>{list.name}</button>)}
    </div>
    {continueSelection&&<section aria-labelledby="home-continue-heading"><h3 id="home-continue-heading">Continuar escuchando</h3><div className="home-continue"><span className="home-art" aria-hidden="true">♫</span><div><strong>{continueSelection.title}</strong><p>{continueSelection.artist??'Artista desconocido'}</p></div><button onClick={event=>props.onOpenPlayer(event.currentTarget)}>Abrir reproductor</button>{!continueSelection.playing&&<button disabled={!continueSelection.canPlay} onClick={props.onPlay}>Continuar</button>}</div></section>}
    <section aria-labelledby="home-recent-heading"><h3 id="home-recent-heading">Añadidas recientemente</h3>
      {recent.length?<ul className="home-recent">{recent.map(track=><li key={track.id}><button aria-label={`Preparar ${track.title} en pausa`} disabled={!track.canPrepare} onClick={()=>props.onPrepareTrack(track.id)}><span className="home-art" aria-hidden="true">♪</span><strong>{track.title}</strong><small>{track.artist??'Artista desconocido'}</small></button></li>)}</ul>:<div className="home-empty"><p>Tu música aparecerá aquí cuando la añadas a tu biblioteca.</p><button onClick={props.onOpenSearch}>Buscar música</button></div>}
    </section>
    <section aria-labelledby="home-playlists-heading"><h3 id="home-playlists-heading">Tus playlists</h3>{playlists.length?<div className="home-playlists">{playlists.map(list=><button key={list.id} onClick={()=>props.onOpenPlaylist(list.id)}><span className="home-art" aria-hidden="true">♫</span><strong>{list.name}</strong><small>{list.count} canciones</small></button>)}</div>:<p>Crea una playlist para reunir tus canciones.</p>}<button disabled={!props.canCreate} onClick={props.onCreatePlaylist}>Crear playlist</button></section>
  </div>;
}
