import {useEffect,useId,useLayoutEffect,useReducer,useRef,useState,type KeyboardEvent,type PointerEvent,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {albumCoordinator,type AlbumCoordinator} from '../library/album-download';
import type {AlbumRow} from '../library/album-acquisition';
import './download-dock.css';

const positionKey='pulso:download-dock-position:v1';
const displayTime=5000;
const dockEvents=new EventTarget();
const arrows:Record<string,Point>={ArrowLeft:{x:-16,y:0},ArrowRight:{x:16,y:0},ArrowUp:{x:0,y:-16},ArrowDown:{x:0,y:16}};
type Point={x:number;y:number};
const reasonLabels={
 'not-found':{row:'No existe en tus bots',summary:'no existe',plural:'no existen'},
 'no-valid-file':{row:'Ningún bot entregó un archivo válido',summary:'sin archivo válido',plural:'sin archivo válido'},
 'missing-metadata':{row:'Faltan datos para buscarla',summary:'sin datos',plural:'sin datos'},
 parked:{row:'Pendiente en Almacenamiento',summary:'pendiente en Almacenamiento',plural:'pendientes en Almacenamiento'},
} satisfies Record<NonNullable<AlbumRow['reason']>,{row:string;summary:string;plural:string}>;

function displayMessage(text?:string){
 return text?.replace(/ ?\[D\d{2}\]/g,'').trim();
}

export function openDownloadDock(){
 dockEvents.dispatchEvent(new Event('open'));
}

export function announceDownloadMessage(text:string){
 dockEvents.dispatchEvent(new CustomEvent('message',{detail:text}));
}

export function useAlbumDownloadState(coordinator=albumCoordinator){
 const [,refresh]=useReducer(n=>n+1,0);
 useLayoutEffect(()=>{
  coordinator.listeners.add(refresh);
  return()=>{coordinator.listeners.delete(refresh);};
 },[coordinator]);
 return coordinator;
}

export function downloadCounts(notice:AlbumCoordinator['notice']){
 const rows=notice?.progress.rows??[];
 return {saved:rows.filter(row=>row.confirmed).length,total:rows.length};
}

export function DownloadIcon({done=false}:{done?:boolean}){
 return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
  <path d={done?'m5 12 4 4L19 6':'M12 4v12m-5-5 5 5 5-5M5 20h14'}/>
 </svg>;
}

function readPosition():Point|null{
 try{
  const value=JSON.parse(localStorage.getItem(positionKey)??'null');
  if(value&&Number.isFinite(value.x)&&Number.isFinite(value.y))return {x:value.x,y:value.y};
 }catch{/* Position is optional. */}
 return null;
}

export function DownloadDock({message,review,onReviewStorage,updateWait,onStopUpdate,pendingDownload}:{updateWait?:'checking'|'updating'|null;onStopUpdate?:()=>void;pendingDownload?:{saved:number;total:number;title?:string;reason?:string;retaking:boolean;onContinue:()=>void};message?:{text:string}|null;review?:ReactNode;onReviewStorage?:()=>void}){
 const {running,active,notice}=useAlbumDownloadState();
 const [finished,setFinished]=useState<{notice:NonNullable<AlbumCoordinator['notice']>;stopped:boolean}|null>(null);
 const [transient,setTransient]=useState('');
 const messageTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const [expanded,setExpanded]=useState(false);
 const [position,setPosition]=useState(readPosition);
 const bounds=useRef<HTMLDivElement>(null),card=useRef<HTMLElement>(null),handle=useRef<HTMLButtonElement>(null);
 const drag=useRef<{id:number;start:Point;origin:Point;last:Point|null}|null>(null);
 const ignoreClick=useRef(false);
 const opener=useRef<HTMLElement|null>(null);
 const panelId=useId(),hintId=useId();
 const updateMessage=updateWait==='updating'?'Actualizando Pulso antes de descargar…':updateWait==='checking'?(pendingDownload?.retaking?'Retomando…':'Comprobando la versión antes de descargar…'):null;
 const reviewing=!!review&&!running&&!updateMessage;
 const showingDetails=reviewing||expanded;

 useLayoutEffect(()=>{
  let run=albumCoordinator.active;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const listener=()=>{
   const next=albumCoordinator.active;
   if(next===run)return;
   clearTimeout(timer);
   if(next){setFinished(null);setExpanded(false);}
   else if(run&&albumCoordinator.notice){
    if(card.current?.contains(document.activeElement))handle.current?.focus({preventScroll:true});
    setFinished({notice:albumCoordinator.notice,stopped:run.abort.signal.aborted||!!albumCoordinator.notice.progress.waiting});
    setExpanded(false);
    timer=setTimeout(()=>setFinished(null),displayTime);
   }
   run=next;
  };
  albumCoordinator.listeners.add(listener);
  return()=>{clearTimeout(timer);albumCoordinator.listeners.delete(listener);};
 },[]);
 function showMessage(text:string){
  clearTimeout(messageTimer.current);
  const message=displayMessage(text)??'';
  setTransient(message);
  if(message)messageTimer.current=setTimeout(()=>setTransient(''),displayTime);
 }
 useEffect(()=>{showMessage(message?.text??'');},[message]);
 useEffect(()=>{
  const receive=(event:Event)=>showMessage((event as CustomEvent<string>).detail);
  dockEvents.addEventListener('message',receive);
  return()=>{clearTimeout(messageTimer.current);dockEvents.removeEventListener('message',receive);};
 },[]);
 useLayoutEffect(()=>{
  const open=()=>{
   opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
   setExpanded(true);
   handle.current?.focus({preventScroll:true});
  };
  dockEvents.addEventListener('open',open);
  return()=>dockEvents.removeEventListener('open',open);
 },[]);
 useLayoutEffect(()=>{
  if(reviewing){
   opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
   card.current?.focus({preventScroll:true});
  }
 },[reviewing]);

 const pendingBatch=!running?pendingDownload:undefined;
 useLayoutEffect(()=>{if(pendingBatch)setFinished(null);},[!!pendingBatch]);
 const pendingMessage=pendingBatch&&(pendingBatch.retaking?'Retomando…':`Descarga pendiente · ${pendingBatch.saved} de ${pendingBatch.total} guardadas`);
 const pauseReason=displayMessage(pendingBatch?.reason);
 const visible=!!updateMessage||running||!!finished||!!transient||reviewing||!!pendingBatch;
 const currentNotice=running?notice:pendingBatch?undefined:finished?.notice;
 const rows=currentNotice?.progress.rows??[];
 const {saved,total}=downloadCounts(currentNotice);
 const remaining=rows.filter(row=>!row.confirmed);
 const reasonCounts=Object.entries(reasonLabels).flatMap(([reason,labels])=>{
  const count=remaining.filter(row=>row.reason===reason).length;
  return count?[`${count} ${count===1?labels.summary:labels.plural}`]:[];
 });
 const unavailable=remaining.filter(row=>!row.reason&&row.state==='failed').length;
 const pending=remaining.filter(row=>!row.reason&&row.state!=='failed').length;
 const summary=[`${saved} de ${total} guardadas`,...reasonCounts,
  ...(unavailable?[`${unavailable} no disponible${unavailable===1?'':'s'}`]:[]),
  ...(pending?[`${pending} pendiente${pending===1?'':'s'}`]:[]),
 ].join(' · ');
 const currentIndex=rows.findIndex(row=>!row.confirmed&&!row.reason&&(row.state==='unattempted'||row.state==='ready'));
 const progressMessage=pauseReason??((running||finished?.stopped)?displayMessage(currentNotice?.progress.message):undefined);
 const detailMessage=pauseReason&&transient?`${transient} ${pauseReason}`:transient||progressMessage;

 function clamp(point:Point):Point{
  const area=bounds.current,node=card.current;
  if(!area||!node)return point;
  return {
   x:Math.max(0,Math.min(point.x,area.clientWidth-node.offsetWidth)),
   y:Math.max(0,Math.min(point.y,area.clientHeight-node.offsetHeight)),
  };
 }
 function origin():Point{
  const rect=card.current!.getBoundingClientRect(),area=bounds.current!.getBoundingClientRect();
  return {x:rect.left-area.left,y:rect.top-area.top};
 }
 function remember(point:Point){
  setPosition(point);
  try{localStorage.setItem(positionKey,JSON.stringify(point));}catch{/* Storage can be unavailable. */}
 }
 useLayoutEffect(()=>{
  const node=card.current,area=bounds.current;
  if(!position||!node||!area)return;
  // Clamp the rendered position. Keep the preference for when the viewport grows again.
  const adjust=()=>{
   const next=clamp(position);
   node.style.left=`${next.x}px`;
   node.style.top=`${next.y}px`;
  };
  adjust();
  const observer=new ResizeObserver(adjust);
  observer.observe(area);observer.observe(node);
  return()=>observer.disconnect();
 },[position,showingDetails,visible]);

 function pointerDown(event:PointerEvent<HTMLButtonElement>){
  if(event.button!==0||!event.isPrimary)return;
  ignoreClick.current=false;
  drag.current={id:event.pointerId,start:{x:event.clientX,y:event.clientY},origin:origin(),last:null};
  event.currentTarget.setPointerCapture(event.pointerId);
 }
 function pointerMove(event:PointerEvent<HTMLButtonElement>){
  const moving=drag.current;
  if(!moving||moving.id!==event.pointerId)return;
  const dx=event.clientX-moving.start.x,dy=event.clientY-moving.start.y;
  if(!moving.last&&Math.hypot(dx,dy)<6)return;
  moving.last=clamp({x:moving.origin.x+dx,y:moving.origin.y+dy});
  ignoreClick.current=true;setPosition(moving.last);
 }
 function endPointer(event:PointerEvent<HTMLButtonElement>){
  if(drag.current?.id!==event.pointerId)return;
  if(drag.current.last)remember(drag.current.last);
  drag.current=null;
 }
 function moveWithKey(event:KeyboardEvent<HTMLButtonElement>){
  const direction=arrows[event.key];
  if(!direction)return;
  event.preventDefault();
  const point=origin();
  remember(clamp({x:point.x+direction.x,y:point.y+direction.y}));
 }

 // Restore focus only when the disappearing panel held it.
 useLayoutEffect(()=>{
  const node=card.current;
  if(!node)return;
  return()=>{
   if(node.contains(document.activeElement)&&opener.current?.isConnected)opener.current.focus({preventScroll:true});
  };
 },[visible]);

 return createPortal(<>
  <div className="pulso-visually-hidden" role="status">{updateMessage||(pendingMessage?[pendingMessage,transient,pauseReason].filter(Boolean).join(' · '):null)||transient||(running?`Descargando · ${summary}`:finished?`${finished.stopped?'Descarga detenida':'Descarga finalizada'} · ${summary}`:'')}</div>
  {visible&&<div ref={bounds} className="download-dock-area">
   <section ref={card} className="download-dock" aria-label={reviewing?'Revisión de descarga':'Descargas'} tabIndex={-1}
    data-positioned={!!position} data-expanded={showingDetails} data-pending={!!pendingBatch&&!updateMessage&&!reviewing&&!showingDetails&&!transient&&!pauseReason}>
    {updateMessage?<p className="download-dock__message">{updateMessage}</p>:reviewing?review:pendingBatch||currentNotice||running?<><button ref={handle} type="button" className="download-dock__handle"
     aria-expanded={expanded} aria-controls={expanded?panelId:undefined} aria-describedby={hintId}
     aria-label={running?`${expanded?'Plegar':'Ver'} descargas · ${saved} de ${total} guardadas`:undefined}
     onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={endPointer} onPointerCancel={endPointer} onLostPointerCapture={endPointer}
     onKeyDown={moveWithKey} onClick={event=>{if(event.detail&&ignoreClick.current){ignoreClick.current=false;return;}setExpanded(value=>!value);}}>
      <DownloadIcon done={!pendingBatch&&!running&&saved===total}/>
      {running?<><span>{saved}/{total}</span><progress aria-hidden="true" value={saved} max={Math.max(1,total)}/></>:<span>{pendingMessage??summary}</span>}
      <span className="download-dock__chevron" aria-hidden="true">{expanded?'⌃':'⌄'}</span>
     </button>
     <span id={hintId} className="pulso-visually-hidden">Usa las flechas para mover la ventana.</span>
     {expanded&&<div id={panelId} className="download-dock__panel">
      <strong><bdi dir="auto">{pendingBatch?.title??currentNotice?.title??active?.title??'Selección de Biblioteca'}</bdi></strong>
      {!pendingBatch&&<p>{running?summary:finished?.stopped?'Descarga detenida':'Descarga finalizada'}</p>}
      {running&&currentIndex>=0&&<p><bdi dir="auto">{currentNotice?.titles?.[currentIndex]??`Canción ${currentIndex+1}`}</bdi></p>}
      {detailMessage&&<p>{detailMessage}</p>}
      {rows.length>0&&<ol>{rows.map((row,index)=>{
       const failed=!row.confirmed&&(row.state==='failed'||row.state==='uncertain');
       const reason=!row.confirmed&&row.reason?reasonLabels[row.reason].row:null;
       const message=reason??displayMessage(row.message);
       const state=row.confirmed?'Guardada':reason?null:row.state==='failed'?'No disponible':row.state==='uncertain'?'Por comprobar':'Pendiente';
       return <li key={index} data-failed={failed}>{state&&<span className="pulso-visually-hidden">{state}</span>}<span className="download-dock__row-icon" aria-hidden="true">{row.confirmed?'✓':failed?'⚠':'·'}</span>
        <div><strong><bdi dir="auto">{currentNotice?.titles?.[index]??`Canción ${index+1}`}</bdi></strong>{message&&<span>{message}</span>}</div></li>;
      })}</ol>}
      {!running&&onReviewStorage&&remaining.some(row=>row.reason==='parked')&&
       <button type="button" className="download-dock__storage" onClick={()=>{setFinished(null);onReviewStorage();}}>Revisar en Almacenamiento</button>}
     </div>}
     {!expanded&&(transient||pauseReason||currentNotice?.progress.waiting&&progressMessage)&&<p className="download-dock__message" role={pauseReason?undefined:'status'}>{detailMessage}</p>}
    </>:<p className="download-dock__message">{transient}</p>}
    {!updateMessage&&!reviewing&&pendingBatch&&!pendingBatch.retaking&&<div className="download-dock__footer"><button type="button" onClick={pendingBatch.onContinue}>Continuar</button></div>}
    {(updateMessage||!reviewing&&expanded&&running&&active)&&<div className="download-dock__footer"><button type="button" onClick={()=>{
     if(updateMessage)onStopUpdate?.();
     else if(active&&albumCoordinator.active===active){if(active.stop)active.stop();else active.abort.abort();}
    }}>Detener</button></div>}
   </section>
  </div>}
 </>,document.body);
}

export function CollectionDownloadButton({label,disabled,complete,onStart,coordinator=albumCoordinator}:{
 label:string;disabled?:boolean;complete?:boolean;onStart:()=>void;coordinator?:AlbumCoordinator;
}){
 const {running,notice}=useAlbumDownloadState(coordinator);
 const {saved,total}=downloadCounts(notice);
 const name=running?`Ver descargas · ${saved} de ${total} guardadas`:complete?'Todas las canciones descargadas':label;
 return <button type="button" className="collection-download" aria-label={name} title={name}
  disabled={!running&&(disabled||complete)} onClick={running?openDownloadDock:onStart}>
  <DownloadIcon done={!running&&complete}/>
  {running&&<span aria-hidden="true">{saved}/{total}</span>}
 </button>;
}
