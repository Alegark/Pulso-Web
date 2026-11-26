import {CatalogArtwork} from './CatalogArtwork';
import {CollectionCover} from './CollectionCover';
import {MusicIcon} from './MusicIcon';

export interface ContinueSelection {
  trackId?: string;
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
  trackIds?: readonly string[];
  id: string;
  name: string;
  count: number;
}

export interface HomeViewProps {
  visible?: boolean;
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
  const { continueSelection, playlists } = props;
  const enabled=props.visible??true;
  return <div className="home-view">
    <h2 id="home-heading" tabIndex={-1}>Tu música</h2>
    <p className="home-view__intro">Todo lo que quieres escuchar, en un solo lugar.</p>
    <div className="home-quick">
      <button onClick={props.onOpenFavorites??props.onOpenLibrary}><span className="home-quick-art"><CollectionCover favorite trackIds={[]}/></span><strong>Favoritos</strong></button>
      {playlists.slice(0,2).map(list=><button key={list.id} onClick={()=>props.onOpenPlaylist(list.id)}><span className="home-quick-art"><CollectionCover trackIds={list.trackIds??[]} enabled={enabled}/></span><strong>{list.name}</strong></button>)}
      <button onClick={props.onOpenLibrary}><span aria-hidden="true"><MusicIcon name="library"/></span><strong>Tu biblioteca</strong></button>
      {!playlists.length&&<button onClick={props.onOpenSearch}><span aria-hidden="true"><MusicIcon name="search"/></span><strong>Buscar música</strong></button>}
    </div>
    {continueSelection&&<section aria-labelledby="home-continue-heading"><h3 id="home-continue-heading">Continuar escuchando</h3><div className="home-continue"><CatalogArtwork className="home-continue-art" trackId={continueSelection.trackId} enabled={enabled}/><div><strong>{continueSelection.title}</strong><p>{continueSelection.artist??'Artista desconocido'}</p><button className="home-player-link" onClick={event=>props.onOpenPlayer(event.currentTarget)}>Abrir reproductor →</button></div>{!continueSelection.playing&&<button className="home-resume" disabled={!continueSelection.canPlay} onClick={props.onPlay}>Continuar</button>}</div></section>}
    {props.empty&&<div className="home-empty"><MusicIcon name="library"/><h3>Haz espacio para tu música</h3><p>Tu música aparecerá aquí cuando la añadas a tu biblioteca.</p><button onClick={props.onOpenSearch}>Buscar música</button></div>}
    <section aria-labelledby="home-playlists-heading"><div className="home-section-heading"><h3 id="home-playlists-heading">Tus playlists</h3><button disabled={!props.canCreate} onClick={props.onCreatePlaylist}><MusicIcon name="plus"/>Crear playlist</button></div>{playlists.length?<div className="home-playlists">{playlists.map(list=><button key={list.id} onClick={()=>props.onOpenPlaylist(list.id)}><span className="home-art"><CollectionCover trackIds={list.trackIds??[]} enabled={enabled}/></span><strong>{list.name}</strong><small>{list.count} canciones</small></button>)}</div>:<p>Crea una playlist para reunir tus canciones.</p>}</section>
  </div>;
}
