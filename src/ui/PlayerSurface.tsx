import {useLayoutEffect,useRef,type ReactNode} from 'react';

interface PlayerSurfaceProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** Presentation only: keeps the existing player tree mounted during expansion. */
export function PlayerSurface({open,onClose,children}:PlayerSurfaceProps) {
  const surface=useRef<HTMLElement>(null);
  const close=useRef(onClose);
  close.current=onClose;

  useLayoutEffect(()=>{
    const node=surface.current;
    if(!open||!node)return;
    const viewport=window.visualViewport;
    const measure=()=>{
      node.style.setProperty('--player-visible-height',`${viewport?.height??window.innerHeight}px`);
      node.style.setProperty('--player-visible-top',`${viewport?.offsetTop??0}px`);
    };
    measure();
    viewport?.addEventListener('resize',measure);
    viewport?.addEventListener('scroll',measure);
    window.addEventListener('resize',measure);

    // Make background surfaces inert without unmounting audio, workers or forms.
    const background=new Map<HTMLElement,boolean>();
    for(let path:HTMLElement|null=node;path?.parentElement;path=path.parentElement){
      for(const sibling of path.parentElement.children){
        if(sibling!==path&&sibling instanceof HTMLElement){background.set(sibling,sibling.inert);sibling.inert=true;}
      }
      if(path.parentElement===document.body)break;
    }
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close.current();return;}
      if(event.key!=='Tab')return;
      const closedDetails=[...node.querySelectorAll('details:not([open])')];
      const controls=[...node.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],summary,[tabindex],[contenteditable="true"]')]
        .filter(el=>el.tabIndex>=0&&!el.matches(':disabled')&&el.getClientRects().length>0&&!el.closest('[hidden],[inert]')&&
          closedDetails.every(details=>!details.contains(el)||details.querySelector(':scope > summary')?.contains(el)));
      const first=controls[0],last=controls.at(-1);
      if(!first){event.preventDefault();node.focus();return;}
      const active=document.activeElement;
      if(event.shiftKey&&(active===first||!controls.includes(active as HTMLElement))){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&(active===last||!node.contains(active))){event.preventDefault();first.focus();}
    };
    node.addEventListener('keydown',key);
    return()=>{
      viewport?.removeEventListener('resize',measure);
      viewport?.removeEventListener('scroll',measure);
      window.removeEventListener('resize',measure);
      node.removeEventListener('keydown',key);
      for(const [element,inert]of background)element.inert=inert;
      document.body.style.overflow=previousOverflow;
      node.style.removeProperty('--player-visible-height');
      node.style.removeProperty('--player-visible-top');
    };
  },[open]);

  return <section ref={surface} id="player" className="player-surface" hidden={!open} data-open={open?'true':undefined}
    role={open?'dialog':undefined} aria-modal={open?true:undefined} aria-label="Reproductor" tabIndex={-1}>
    {open&&<div className="player-surface__toolbar"><span>Ahora suena</span><button type="button" onClick={onClose} aria-label="Cerrar reproductor">Volver</button></div>}
    {children}
  </section>;
}
