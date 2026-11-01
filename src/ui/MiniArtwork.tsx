import {useEffect, useRef, useState} from 'react';
import type {Activity} from '../playback/ownership';
import {readArtwork} from '../library/artwork';
import './mini-artwork.css';

export interface MiniArtworkProps {
  activity: Activity;
  trackId: string;
  title: string;
  refreshToken: number;
}

type View = {trackId: string; refreshToken: number; current: () => boolean; url: string | null; text: string};

/** Read-only view of the single local library. URLs belong only to this effect. */
export function MiniArtwork({activity, trackId, title, refreshToken}: MiniArtworkProps) {
  const [view, setView] = useState<View | null>(null);
  const dispose = useRef<(() => void) | null>(null);

  useEffect(() => {
    const scope = activity.scope();
    let cancelled = false;
    let objectUrl: string | null = null;
    const current = () => !cancelled && scope();
    const revoke = () => {
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    };
    dispose.current = revoke;
    const publish = (text: string, url: string | null = null) => {
      if (current()) setView({trackId, refreshToken, current, url, text});
    };
    publish('Portada no disponible');
    // begin is synchronous admission; a denied reader must do no storage IO.
    const operation = activity.begin();
    if (operation && current()) {
      void readArtwork(trackId).then(result => {
        if (!current() || !operation.current()) return;
        if (result.state === 'ready') {
          objectUrl = URL.createObjectURL(result.blob);
          publish('', objectUrl);
        } else {
          publish(result.state === 'absent' ? (result.manual ? 'Portada ocultada' : 'Sin portada') :
            result.state === 'unrecorded' ? 'Sin portada' : 'Portada no disponible');
        }
      }).catch(() => {
        revoke();
        publish('Portada no disponible');
      }).finally(() => operation.end());
    } else operation?.end();
    return () => { cancelled = true; revoke(); dispose.current = null; };
  }, [activity, trackId, refreshToken]);

  // The parent renders on control changes; invalidation also drops a ready URL
  // even before the keyed ownership replacement is committed.
  useEffect(() => { if (view && !view.current()) dispose.current?.(); });
  const visible = view?.trackId === trackId && view.refreshToken === refreshToken && view.current() ? view : null;
  return <div className="mini-artwork" title={title}>
    {visible?.url ?
      // The track title is already adjacent in MiniPlayer; repeating it adds noise.
      <img src={visible.url} alt="" onError={() => {
        if (!visible.current()) return;
        dispose.current?.();
        setView({...visible, url: null, text: 'Portada no disponible'});
      }}/> : <span>{visible?.text ?? 'Portada no disponible'}</span>}
  </div>;
}
