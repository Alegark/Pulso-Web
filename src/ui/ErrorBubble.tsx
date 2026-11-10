import {useId,useLayoutEffect,useRef} from 'react';
import './error-bubble.css';

export interface ErrorNotice {
  /** Safe, user-facing copy supplied by the caller; never a raw exception. */
  title: string;
  message: string;
}

export interface ErrorBubbleProps {
  notice: ErrorNotice | null;
  busy?: boolean;
  onDismiss: () => void;
  onRetry?: () => void;
  /** Height reserved by the caller's fixed dock; excluded when inside a dialog. */
  bottomOffset?: number;
}

/** Controlled feedback: no timers, automatic retries, focus changes or logging. */
export function ErrorBubble({notice,busy=false,onDismiss,onRetry,bottomOffset=0}:ErrorBubbleProps) {
  const id=useId();
  const host=useRef<HTMLElement>(null);
  useLayoutEffect(()=>{
    const viewport=window.visualViewport;
    const measure=()=>{
      const node=host.current;if(!node)return;
      node.style.setProperty('--error-viewport-top',`${viewport?.offsetTop??0}px`);
      node.style.setProperty('--error-viewport-height',`${viewport?.height??window.innerHeight}px`);
      node.style.setProperty('--error-bottom-offset',`${Math.max(0,bottomOffset)}px`);
    };
    measure();viewport?.addEventListener('resize',measure);viewport?.addEventListener('scroll',measure);window.addEventListener('resize',measure);
    return()=>{viewport?.removeEventListener('resize',measure);viewport?.removeEventListener('scroll',measure);window.removeEventListener('resize',measure);};
  },[bottomOffset]);
  return <aside ref={host} className="error-bubble-host" aria-label="Avisos de error">
    <div role="alert" aria-atomic="true">
      {notice&&<div id={id} className="error-bubble__message"><strong>{notice.title}</strong><p>{notice.message}</p></div>}
    </div>
    {notice&&<div className="error-bubble__actions">
      {onRetry&&<button type="button" aria-describedby={id} disabled={busy} onClick={onRetry}>{busy?'Reintentando…':'Reintentar'}</button>}
      <button type="button" aria-label="Cerrar aviso de error" onClick={onDismiss}>Cerrar</button>
    </div>}
  </aside>;
}
