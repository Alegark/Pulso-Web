import React from 'react';
import './collection-removal.css';
import {CollectionRemovalPanel} from './CollectionRemovalPanel';
import type {createCollectionRemovalController} from './collection-removal-state';

export function CollectionRemovalController({controller,headingRef,onVisible,onClose}:{controller:ReturnType<typeof createCollectionRemovalController>;headingRef:React.Ref<HTMLHeadingElement>;onVisible:()=>void;onClose:()=>void}){
 const view=controller.getView(),callbacks=controller.callbacks(view);
 React.useLayoutEffect(()=>{if(view.visible)onVisible();},[view.visible,onVisible]);
 React.useEffect(()=>()=>{void controller.dispose();},[controller]);
 if(!view.visible)return null;
 return <CollectionRemovalPanel state={view.state} title={view.title} kind={view.kind} summary={view.summary&&{tracks:view.summary.tracks,eligibleCopies:view.summary.copiesEligible,estimatedBytes:view.summary.estimatedBytes,retainedShared:view.summary.retainedShared}} accepted={view.accepted} onAccepted={callbacks.accepted} onConfirm={()=>{void callbacks.confirm();}} onCancel={()=>{void callbacks.cancel();}} onClose={()=>{if(callbacks.close())onClose();}} current={callbacks.current} result={view.result} message={view.message} canConfirm={view.state==='ready'} canCancel={view.state==='preparing'||view.state==='ready'||view.state==='working'} canClose={view.state==='done'||view.state==='blocked'||view.state==='uncertain'} headingRef={headingRef}/>;
}
