import type { ReactNode } from 'react';

/** The catalogue hint belongs to one queue entry and never changes stored credits. */
export function miniPlayerArtist(track: {artist:string|null;manualOverrides:Partial<{artist:string|null}>}|undefined, entryId:string, hint:{entryId:string;artist:string}|null):string|null {
  if (track && Object.hasOwn(track.manualOverrides, 'artist')) return track.artist;
  return hint?.entryId===entryId ? hint.artist : track?.artist??null;
}

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
  onPrevious?: () => void; onNext?: () => void; canPrevious?: boolean; canNext?: boolean;
  position?: number; duration?: number; onSeek?: (value:number)=>void;
  volume?: number; onVolume?: (value:number)=>void;
}

export function MiniPlayer(props: MiniPlayerProps) {
  return (
    <section className="mini-player" aria-label="Mini reproductor">
      <button type="button" className="mini-player__details" title={[props.title,props.artist].filter(Boolean).join(' · ')} aria-label="Abrir reproductor desde título" onClick={event=>props.onOpenPlayer(event.currentTarget)}>
        <span className="mini-player__title">{props.title}</span>
        {props.artist&&<span className="mini-player__artist">{props.artist}</span>}
      </button>
      <div className="mini-player__actions">
        {props.onPrevious&&<button className="desktop-transport" type="button" aria-label="Anterior" disabled={!props.canPrevious} onClick={props.onPrevious}>◀◀</button>}
        {props.playing ? (
          <button type="button" className="mini-player__toggle" aria-label="Pausar desde minirreproductor" disabled={!props.canPause} onClick={props.onPause}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" fill="none" stroke="currentColor" strokeWidth="4"/></svg></button>
        ) : (
          <button type="button" className="mini-player__toggle" aria-label="Reproducir desde minirreproductor" disabled={!props.canPlay} onClick={props.onPlay}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 4 12 8-12 8Z" fill="currentColor"/></svg></button>
        )}
        {props.onNext&&<button className="desktop-transport" type="button" aria-label="Siguiente" disabled={!props.canNext} onClick={props.onNext}>▶▶</button>}
        <button type="button" className="mini-player__expand" aria-label="Abrir reproductor desde minirreproductor" onClick={(event) => props.onOpenPlayer(event.currentTarget)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
      </div>
      {props.onSeek&&<label className="desktop-seek">Posición<input aria-label="Posición desde barra" type="range" min="0" max={props.duration||0} step="0.1" value={Math.min(props.position??0,props.duration??0)} disabled={!props.duration} onChange={event=>props.onSeek?.(Number(event.target.value))}/></label>}
      {props.onVolume&&<label className="desktop-volume">Volumen<input aria-label="Volumen" type="range" min="0" max="1" step="0.01" value={props.volume??1} onChange={event=>props.onVolume?.(Number(event.target.value))}/></label>}
    </section>
  );
}
