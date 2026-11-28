import './playback-indicator.css';
export function PlaybackIndicator({variant='inline'}:{variant?:'inline'|'overlay'}) { return <span className={`playback-indicator playback-indicator--${variant}`} role="img" aria-label="Reproduciendo" title="Reproduciendo"><span className="playback-indicator__bar"/><span className="playback-indicator__bar"/><span className="playback-indicator__bar"/></span>; }
