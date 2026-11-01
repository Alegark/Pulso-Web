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
  canImport: boolean;
  canCreate: boolean;
  onOpenPlayer: (opener: HTMLButtonElement) => void;
  onPlay: () => void;
  onOpenLibrary: () => void;
  onOpenPlaylist: (id: string) => void;
  onPrepareTrack: (id: string) => void;
  onImport: () => void;
  onCreatePlaylist: () => void;
}

function formatPosition(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`;
}

export function HomeView(props: HomeViewProps) {
  const { continueSelection, recent, playlists } = props;
  return (
    <div className="home-view">
      <h2 id="home-heading" tabIndex={-1}>Inicio</h2>
      <section aria-labelledby="home-continue-heading">
        <h3 id="home-continue-heading">Continuar</h3>
        {continueSelection ? (
          <div className="home-view__item">
            <p><strong>{continueSelection.title}</strong>{continueSelection.artist && <> · {continueSelection.artist}</>}</p>
            <p>{continueSelection.stateText} · Posición: {formatPosition(continueSelection.positionSeconds)}</p>
            <div className="home-view__actions">
              <button type="button" onClick={(event) => props.onOpenPlayer(event.currentTarget)}>Abrir reproductor</button>
              {!continueSelection.playing && <button type="button" disabled={!continueSelection.canPlay} onClick={props.onPlay}>Continuar</button>}
            </div>
          </div>
        ) : <p>No hay ninguna pista seleccionada.</p>}
      </section>
      <section aria-labelledby="home-recent-heading">
        <h3 id="home-recent-heading">Añadidas recientemente</h3>
        {recent.length ? <ul className="home-view__list">{recent.map((track) => (
          <li className="home-view__item" key={track.id}>
            <p><strong>{track.title}</strong>{track.artist && <> · {track.artist}</>}</p>
            <p>{track.availability}</p>
            <button type="button" disabled={!track.canPrepare} onClick={() => props.onPrepareTrack(track.id)}>Preparar en pausa</button>
          </li>
        ))}</ul> : <p>No hay pistas añadidas recientemente.</p>}
      </section>
      <section aria-labelledby="home-playlists-heading">
        <h3 id="home-playlists-heading">Tus playlists</h3>
        {playlists.length ? <ul className="home-view__list">{playlists.map((playlist) => (
          <li className="home-view__item" key={playlist.id}>
            <p><strong>{playlist.name}</strong> · {playlist.count} {playlist.count === 1 ? 'pista' : 'pistas'}</p>
            <button type="button" onClick={() => props.onOpenPlaylist(playlist.id)}>Abrir playlist</button>
          </li>
        ))}</ul> : <p>No hay playlists todavía.</p>}
      </section>
      {props.empty && <p>Importa audios o crea una playlist para empezar.</p>}
      <div className="home-view__actions">
        <button type="button" disabled={!props.canImport} onClick={props.onImport}>Importar audios</button>
        {props.empty && <button type="button" disabled={!props.canCreate} onClick={props.onCreatePlaylist}>Crear playlist</button>}
        <button type="button" onClick={props.onOpenLibrary}>Ver biblioteca</button>
      </div>
    </div>
  );
}
