import React from 'react';
import {LocalCopyRemovalPanel} from './LocalCopyRemovalPanel';
import {createCopyRemovalController,type CopyRemovalHost,type CopyRemovalStartup} from './local-copy-removal-state';
import type {Track} from '../library/library';

export interface LocalCopyRemovalControllerProps {
 readonly host:CopyRemovalHost;
 readonly startup:CopyRemovalStartup|null;
 readonly request:{readonly identity:object;readonly track:Track}|null;
 readonly canUse:boolean;
 readonly headingRef?:React.Ref<HTMLHeadingElement>;
 readonly onVisible:()=>void;
 readonly onOpen:(opener:HTMLButtonElement)=>void;
 readonly onClose:()=>void;
}
/** Presentation binding only. The trusted closure owns plans and settlement;
 * every callback below captures the exact immutable view rendered here. */
export function LocalCopyRemovalController(props:LocalCopyRemovalControllerProps){
 const [,render]=React.useReducer(n=>n+1,0);
 const [controller]=React.useState(()=>createCopyRemovalController({...props.host,changed:()=>render()}));
 const seen=React.useRef<object|null>(null);
 const view=controller.getView(),callbacks=controller.callbacks(view);
 React.useEffect(()=>{if(props.startup)controller.initialize(props.startup);},[controller,props.startup]);
 React.useEffect(()=>{if(props.startup&&props.request&&seen.current!==props.request.identity){seen.current=props.request.identity;void controller.start(props.request.track);}},[controller,props.request,props.startup]);
 React.useEffect(()=>()=>{void controller.dispose();},[controller]);
 React.useLayoutEffect(()=>{if(view.visible)props.onVisible();},[view.visible,props.onVisible]);
 if(!view.visible)return view.pendingCount>0?<section aria-label="Retirada pendiente"><p>Hay una retirada pendiente de revisión. Su seguimiento se conserva.</p><button type="button" onClick={event=>{props.onOpen(event.currentTarget);callbacks.show();}}>Revisar retirada pendiente</button></section>:null;
 return <LocalCopyRemovalPanel state={view.state} title={view.title} summary={view.summary} reason={view.reason}
  primaryMessage={view.message} secondaryMessages={view.secondary} outcome={view.outcome} planRevision={view.revision}
  declaration={view.declaration} confirmed={view.confirmed} onDeclarationChange={callbacks.declaration} onConfirmedChange={callbacks.confirmed}
  onConfirm={consent=>{void callbacks.confirm(consent);}} onContinue={consent=>{void callbacks.continue(consent);}}
  onCancel={()=>{void callbacks.cancel();}} onInspect={()=>{void callbacks.inspect();}}
  onClose={()=>{if(callbacks.close())props.onClose();}} canUse={props.canUse} canConfirm={view.canConfirm} canContinue={view.canContinue}
  canInspect={view.canInspect} canCancel={view.working||view.state==='ready'} canClose={!view.working} pending={view.working} headingRef={props.headingRef}/>;
}
