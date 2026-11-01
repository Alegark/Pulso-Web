import React from 'react';
import type {Activity} from '../playback/ownership';
import type {Track} from '../library/library';
import {rescanLocalAlbum,inspectMetadataRescan,readMetadataRescanPending} from '../library/metadata-rescan';
import {copyMetadataRescanReference,type MetadataRescanReference,type MetadataRescanProgress} from '../library/metadata-rescan-protocol';
import {MetadataRescanPanel,type RescanPanelState,type RescanPanelReason} from './MetadataRescanPanel';

const trackingKey='pulso-web:metadata-rescan:pending';
const historyKey='pulso-web:metadata-rescan:unknown-history';
interface View {state:RescanPanelState;reason:RescanPanelReason|null;progress:MetadataRescanProgress|null;notice:string;canAbandon:boolean}
const idle:View={state:'idle',reason:null,progress:null,notice:'',canAbandon:false};
export interface MetadataRescanControllerProps {
 activity:Activity;
 scopeKey:string;
 canUse:boolean;
 canStart:boolean;
 track:Track|null;
 headingRef?:React.Ref<HTMLHeadingElement>;
 captureCurrent:()=>()=>boolean;
 captureAdmission?:()=>()=>boolean;
 onBlocking:(blocked:boolean,current:()=>boolean)=>void;
 onCommitted:()=>Promise<void>;
 onClose:()=>void;
}
function readTracking():{reference:MetadataRescanReference|null;invalid:boolean;unavailable:boolean}{
 let raw:string|null;
 try{raw=sessionStorage.getItem(trackingKey);}catch{return {reference:null,invalid:false,unavailable:true};}
 if(raw===null)return {reference:null,invalid:false,unavailable:false};
 try{if(raw.length>1024)return {reference:null,invalid:true,unavailable:false};
  const reference=copyMetadataRescanReference(JSON.parse(raw));return {reference,invalid:!reference,unavailable:false};
 }catch{return {reference:null,invalid:true,unavailable:false};}
}
/** Owns one operation; the presentation component has no storage or write API. */
export function MetadataRescanController(props:MetadataRescanControllerProps){
 const latest=React.useRef(props);React.useLayoutEffect(()=>{latest.current=props;});
 const [view,setView]=React.useState<View>(idle);
 const viewRef=React.useRef(view);React.useLayoutEffect(()=>{viewRef.current=view;});
 const [reference,setReference]=React.useState<MetadataRescanReference|null>(null);
 const ref=React.useRef<MetadataRescanReference|null>(null);
 const [invalidTracking,setInvalidTracking]=React.useState(false);
 const [scanned,setScanned]=React.useState(false);
 const [confirmAbandon,setConfirmAbandon]=React.useState(false);
 const active=React.useRef<{abort:AbortController;id:object}|null>(null);
 const mounted=React.useRef(true);
 let admission:()=>boolean;
 try{admission=props.captureAdmission?.()??(()=>true);}catch{admission=()=>false;}
 const admitted=()=>{try{return mounted.current&&admission();}catch{return false;}};
 const scanning=React.useRef(false);
 const setRef=(value:MetadataRescanReference|null)=>{ref.current=value;setReference(value);};
 const remember=(value:MetadataRescanReference|null)=>{
  setRef(value);
  try{if(value)sessionStorage.setItem(trackingKey,JSON.stringify(value));else sessionStorage.removeItem(trackingKey);}
  catch{setView(v=>({...v,notice:'El seguimiento de esta pestaña no pudo guardarse. El registro local se comprobará al volver a abrir.'}));}
 };
 React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;active.current?.abort.abort();};},[]);
 React.useEffect(()=>{if(props.track&&!active.current&&!ref.current&&!invalidTracking)setView(idle);},[props.track?.id]);
 React.useEffect(()=>{
  if(!props.canUse||scanning.current||scanned)return;
  scanning.current=true;let live=true;const guard=props.captureCurrent(),abort=new AbortController();
  const current=()=>live&&mounted.current&&guard();
  props.onBlocking(true,guard);
  const token=props.activity.begin();
  if(!token){scanning.current=false;return;}
  const stored=readTracking();setInvalidTracking(stored.invalid);setRef(stored.reference);
  void (async()=>{
   try{
    const pending=await readMetadataRescanPending({signal:abort.signal,current});
    if(!current())return;
    // A fresh scan may discover a durable intent, but never dismiss an existing
    // unconfirmed reference merely because a terminal slot is now present.
    if(pending&&stored.reference&&(pending.operationId!==stored.reference.operationId||pending.incarnation!==stored.reference.incarnation)){
     setView({...idle,state:'uncertain',notice:'Hay seguimientos distintos sin confirmar. Se conservan; no se iniciará otra revisión.'});return;
    }
    const found=stored.reference??pending;
    if(found){setInvalidTracking(false);remember(found);setView({...idle,state:'uncertain'});}
    else if(stored.invalid){setView({...idle,state:'uncertain',notice:'El seguimiento guardado no es legible. Su resultado histórico sigue desconocido.',canAbandon:true});}
    else{setView({...idle,notice:stored.unavailable?'El seguimiento de pestaña no está disponible; se ha comprobado el registro local.':''});props.onBlocking(false,guard);}
   }catch{if(current())setView({...idle,state:'uncertain',reason:'storage',notice:'No se pudo comprobar el registro local. Reintenta su lectura antes de continuar.'});}
   finally{token.end();scanning.current=false;if(current())setScanned(true);}
  })();
  return()=>{live=false;abort.abort();};
 },[props.canUse,props.scopeKey,scanned]);
 async function finishRefresh(current:()=>boolean){
  try{await latest.current.onCommitted();}
  catch{if(current())setView(v=>({...v,notice:'El cambio está confirmado. No se pudo actualizar la vista; vuelve a comprobar los archivos locales.'}));}
 }
 async function start(){
  const p=latest.current,track=p.track;
  if(!admitted()||!scanned||!p.canUse||!p.canStart||!track||track.assetId===null||ref.current||invalidTracking||active.current)return;
  const guard=p.captureCurrent();if(!guard())return;
  const token=p.activity.begin();if(!token)return;
  const run={id:{},abort:new AbortController()};active.current=run;
  const owns=()=>mounted.current&&active.current===run&&guard();
  p.onBlocking(true,guard);setConfirmAbandon(false);setView({...idle,state:'verifying'});
  let unresolved=false;
  try{
   const outcome=await rescanLocalAlbum({operationId:crypto.randomUUID(),trackId:track.id,expectedRevision:track.revision},{signal:run.abort.signal,current:owns,
    onPending(value){if(!owns())throw new Error('stale-rescan');const safe=copyMetadataRescanReference(value);if(!safe)throw new Error('invalid-rescan-reference');remember(safe);},
    onProgress(progress){if(owns()&&!run.abort.signal.aborted)setView(v=>({...v,state:progress.phase==='verify'?'verifying':progress.phase==='parse'?'parsing':'saving',progress}));},
   });
   if(!owns())return;
   if(outcome.state==='uncertain'){unresolved=true;remember(outcome.reference);setView({...idle,state:'uncertain'});}
   else if(outcome.state==='committed'){
    remember(null);setView({...idle,state:outcome.effect==='updated'?'updated':'no-change'});await finishRefresh(owns);
   }else{remember(null);setView({...idle,state:'not-applied',reason:outcome.reason});}
  }catch{
   if(owns()){unresolved=true;setView({...idle,state:'uncertain',reason:'storage',notice:'Se conserva el seguimiento. Comprueba el resultado antes de repetir.'});}
  }finally{
   token.end();if(active.current===run)active.current=null;
   if(mounted.current&&guard())p.onBlocking(unresolved||ref.current!==null||invalidTracking,guard);
  }
 }
 async function inspect(){
  const p=latest.current;if(!admitted()||!p.canUse||active.current)return;
  if(!ref.current){if(!invalidTracking){setScanned(false);setView({...idle,state:'uncertain'});}return;}
  const guard=p.captureCurrent();if(!guard())return;
  const token=p.activity.begin();if(!token)return;
  const run={id:{},abort:new AbortController()};active.current=run;const current=()=>mounted.current&&active.current===run&&guard();
  let unresolved=true;p.onBlocking(true,guard);
  try{
   const result=await inspectMetadataRescan(ref.current,{signal:run.abort.signal,current});if(!current())return;
   if(result.state==='uncertain')setView({...idle,state:'uncertain',canAbandon:result.reason==='original-library-unavailable',notice:result.reason==='original-library-unavailable'?'La biblioteca original ya no está disponible. No sabemos cuál fue el resultado anterior.':''});
   else{unresolved=false;remember(null);setView({...idle,state:result.state==='committed'?(result.effect==='updated'?'updated':'no-change'):'not-applied',notice:result.state==='not-committed'?'El registro confirma que esa revisión no se aplicó.':''});if(result.state==='committed')await finishRefresh(current);}
  }catch{if(current())setView({...idle,state:'uncertain',reason:'storage'});}
  finally{token.end();if(active.current===run)active.current=null;if(mounted.current&&guard())p.onBlocking(unresolved,guard);}
 }
 function abandon(){
  const p=latest.current,guard=p.captureCurrent();if(!admitted()||!p.canUse||active.current||!view.canAbandon||!confirmAbandon||!guard())return;
  // Archive only the reference and UNKNOWN. This does not assert rollback or
  // erase an audio file, receipt, incarnation or the unknown historical result.
  try{const raw=sessionStorage.getItem(historyKey);let old:unknown[]=[];if(raw&&raw.length<8192){const v:unknown=JSON.parse(raw);if(Array.isArray(v))old=v.slice(-7);}sessionStorage.setItem(historyKey,JSON.stringify([...old,{state:'unknown',reference:ref.current}]));sessionStorage.removeItem(trackingKey);}
  catch{setView(v=>({...v,notice:'No se pudo conservar el historial desconocido en esta pestaña. El seguimiento sigue pendiente.'}));return;}
  setRef(null);setInvalidTracking(false);setConfirmAbandon(false);setView(idle);setScanned(false);
 }
 if(!props.track&&!reference&&!invalidTracking&&view.state==='idle')return null;
 const working=active.current!==null;
 return <>
  <MetadataRescanPanel headingRef={props.headingRef} title={props.track?.title??'Revisión anterior'} eligible={scanned&&props.canUse&&props.canStart&&props.track?.assetId!==null&&!!props.track&&!reference&&!invalidTracking} disabledReason={props.track?.assetId===null?'no-local-copy':!props.canUse||!props.canStart||!scanned?'blocked':null} state={view.state} progress={view.progress} reason={view.reason} canInspect={props.canUse&&!working} onStart={()=>void start()} onCancel={()=>active.current?.abort.abort()} onInspect={()=>void inspect()} onClose={()=>{if(!active.current&&!ref.current&&!invalidTracking&&viewRef.current.state!=='uncertain'){setView(idle);props.onClose();}}}/>
  {view.notice&&<p role="status">{view.notice}</p>}
  {view.canAbandon&&<section aria-label="Seguimiento histórico desconocido"><p>Dejar este seguimiento permite una revisión nueva; el resultado anterior seguirá desconocido. No se borran archivos.</p><label><input type="checkbox" checked={confirmAbandon} onChange={event=>setConfirmAbandon(event.target.checked)}/>Entiendo que el resultado anterior sigue desconocido</label><button disabled={!confirmAbandon||!props.canUse||working} onClick={abandon}>Conservar desconocido y revisar de nuevo</button></section>}
 </>;
}
