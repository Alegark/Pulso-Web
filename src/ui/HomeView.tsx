import {CollectionCover} from './CollectionCover';
import {MusicIcon} from './MusicIcon';

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

export interface HomeAlbum { key: string; title: string; artist: string | null; count: number; artworkUrl?: string; trackIds: readonly string[]; saved: boolean; }

export interface HomeViewProps {
  visible?: boolean;
  albums?: readonly HomeAlbum[];
  onOpenAlbum?: (key: string, opener: HTMLButtonElement) => void;
  recent: readonly HomeTrack[];
  playlists: readonly HomePlaylist[];
  empty: boolean;
  canCreate: boolean;
  onOpenLibrary: () => void;
  onOpenFavorites?: () => void;
  onOpenPlaylist: (id: string) => void;
  onPrepareTrack: (id: string) => void;
  onOpenSearch: () => void;
  onCreatePlaylist: () => void;
}

export function HomeView(props: HomeViewProps) {
  const { playlists } = props;
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
    {props.empty&&<div className="home-empty"><MusicIcon name="library"/><h3>Haz espacio para tu música</h3><p>Tu música aparecerá aquí cuando la añadas a tu biblioteca.</p><button onClick={props.onOpenSearch}>Buscar música</button></div>}
    {!!props.albums?.length&&<section aria-labelledby="home-albums-heading"><div className="home-section-heading"><h3 id="home-albums-heading">Tus álbumes</h3></div><div className="home-albums">{props.albums.map(album=><button key={album.key} onClick={event=>props.onOpenAlbum?.(album.key,event.currentTarget)}><span className="home-art"><CollectionCover variant="album" trackIds={album.trackIds} artworkUrl={album.artworkUrl} enabled={enabled}/></span><strong>{album.title}</strong><small>{album.artist??`${album.count} canciones`}</small></button>)}</div></section>}
    <section aria-labelledby="home-playlists-heading"><div className="home-section-heading"><h3 id="home-playlists-heading">Tus playlists</h3><button disabled={!props.canCreate} onClick={props.onCreatePlaylist}><MusicIcon name="plus"/>Crear playlist</button></div>{playlists.length?<div className="home-playlists">{playlists.map(list=><button key={list.id} onClick={()=>props.onOpenPlaylist(list.id)}><span className="home-art"><CollectionCover trackIds={list.trackIds??[]} enabled={enabled}/></span><strong>{list.name}</strong><small>{list.count} canciones</small></button>)}</div>:<p>Crea una playlist para reunir tus canciones.</p>}</section>
  </div>;
}
