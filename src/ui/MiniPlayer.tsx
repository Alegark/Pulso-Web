import type { ReactNode } from 'react';

export interface MiniPlayerProps {
  title: string;
  artist: string | null;
  stateText: string;
  playing: boolean;
  canPlay: boolean;
  canPause: boolean;
  onPlay: () => void;
  onPause: () => void;
  onOpenPlayer: (opener: HTMLButtonElement) => void;
  artwork?: ReactNode;
}

export function MiniPlayer(props: MiniPlayerProps) {
  return (
    <section className="mini-player" aria-label="Mini reproductor">
      <div className="mini-player__artwork">{props.artwork ?? <span aria-hidden="true">♪</span>}</div>
      <div className="mini-player__details">
        <p><strong>{props.title}</strong>{props.artist && <> · {props.artist}</>}</p>
        <p>{props.stateText}</p>
      </div>
      <div className="mini-player__actions">
        {props.playing ? (
          <button type="button" aria-label="Pausar desde minirreproductor" disabled={!props.canPause} onClick={props.onPause}>Pausar</button>
        ) : (
          <button type="button" aria-label="Reproducir desde minirreproductor" disabled={!props.canPlay} onClick={props.onPlay}>Reproducir</button>
        )}
        <button type="button" aria-label="Abrir reproductor desde minirreproductor" onClick={(event) => props.onOpenPlayer(event.currentTarget)}>Abrir</button>
      </div>
    </section>
  );
}
