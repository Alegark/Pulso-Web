import React from 'react';
import type {TelegramSessionClient,SourcesSnapshot} from '../telegram/session-client';
import type {SourcesError} from '../telegram/sources-protocol';
import './telegram-sources.css';
const errors:Record<SourcesError,string>={access:'No se puede consultar esta fuente ahora.', 'rate-limit':'Telegram ha limitado las consultas.', network:'No se pudo consultar Telegram. Puedes iniciar otra consulta cuando quieras.',timeout:'La consulta no terminó a tiempo.',cancelled:'Consulta detenida. No se ha consultado otra página.',limit:'Se alcanzó el límite de esta consulta o sesión.',expired:'Las referencias han caducado. Consulta de nuevo para obtener fuentes vigentes.',protocol:'No se pudo validar la respuesta.', 'session-expired':'La conexión temporal ha caducado.',internal:'No se pudo completar la consulta.'};
const ends={more:'Cobertura parcial. Hay otra página disponible.',exhausted:'Fin de la carpeta observada. La lista puede cambiar en Telegram.',limit:'Cobertura parcial: se alcanzó el límite de esta sesión.', 'cursor-unavailable':'Cobertura parcial: no hay un cursor válido para continuar.'};
export function TelegramSourcesPanel({client,state,canConnect}:{client:TelegramSessionClient;state:SourcesSnapshot;canConnect:boolean}){
 const [now,setNow]=React.useState(Date.now);
 const [draft,setDraft]=React.useState<readonly string[]>([]);
 const section=React.useRef<HTMLElement>(null);
 const intent=React.useRef(false),heading=React.useRef<HTMLHeadingElement>(null);
 const allowed=client.captureSourcesCurrent(),cancel=client.captureCancel();
 React.useEffect(()=>{setDraft([]);},[state.operationId,state.binding?.accountRef]);
 React.useEffect(()=>{setDraft(state.selected);},[state.revision]);
 React.useEffect(()=>{setDraft(old=>old.filter(ref=>state.rows.some(row=>row.peerRef===ref)));},[state.rows]);
 React.useEffect(()=>{if(!state.pending&&intent.current){intent.current=false;heading.current?.focus();}},[state.pending]);
 React.useEffect(()=>{const abandon=()=>{intent.current=false;};const key=(event:KeyboardEvent)=>{if(event.key==='Tab')abandon();};const focus=(event:FocusEvent)=>{if(event.target instanceof Element&&!section.current?.contains(event.target))abandon();};addEventListener('focusin',focus,true);addEventListener('pointerdown',abandon,true);addEventListener('keydown',key,true);return()=>{removeEventListener('focusin',focus,true);removeEventListener('pointerdown',abandon,true);removeEventListener('keydown',key,true);};},[]);
 React.useEffect(()=>{if(state.retryAt===null)return;let timer:ReturnType<typeof setTimeout>;const tick=()=>{const now=Date.now();setNow(now);if(state.retryAt!>now)timer=setTimeout(tick,Math.min(60000,state.retryAt!-now));};tick();return()=>clearTimeout(timer);},[state.retryAt]);
 const enabled=canConnect&&!state.pending,limited=state.retryBlocked||state.retryAt!==null&&now<state.retryAt;
 return <section ref={section} className="telegram-sources" aria-label="Fuentes de Telegram" aria-busy={state.pending}>
  <h3 ref={heading} tabIndex={-1}>Fuentes de música</h3>
  <p>Antes de consultar: al listar fuentes, Telegram también envía mensajes incidentales. Pulso muestra nombres sin conservar ese contenido en sus modelos ni diagnósticos. No indexa ni descarga canciones.</p>
  <p>Elige hasta 20 fuentes. La selección sólo vive en esta pestaña; no se guarda ni reconstruye tu biblioteca. Mensajes guardados empieza sin seleccionar.</p>
  <div className="telegram-sources-actions"><button disabled={!enabled||limited} onClick={()=>{if(allowed()){intent.current=true;client.consult('main',allowed);}}}>Consultar fuentes</button><button disabled={!enabled||limited} onClick={()=>{if(allowed()){intent.current=true;client.consult('archived',allowed);}}}>Consultar archivados</button></div>
  <fieldset disabled={!enabled}><legend>Fuentes disponibles ({state.rows.length})</legend>
   {state.rows.map(row=><label className="telegram-source-row" key={row.peerRef}><input type="checkbox" checked={draft.includes(row.peerRef)} disabled={!draft.includes(row.peerRef)&&draft.length>=20} onChange={event=>{if(!allowed())return;setDraft(old=>event.target.checked?old.length<20&&!old.includes(row.peerRef)?[...old,row.peerRef]:old:old.filter(ref=>ref!==row.peerRef));}}/><bdi dir="auto">{row.name}</bdi><span>{row.kind==='saved'?'Personal':row.kind==='channel'?'Canal':'Grupo'}</span></label>)}
  </fieldset>
  <p role="status">{state.pending?state.cancelling?'Deteniendo la consulta; esperando su cierre…':state.reading?'Esperando respuesta de Telegram…':'Esperando confirmación local…':`${draft.length} marcadas; ${state.selected.length} confirmadas en esta pestaña.`}</p>
  {state.folder&&<p>Carpeta: {state.folder==='main'?'principal':'archivados'}. Cada página consulta como máximo 25 diálogos. No se infiere que contengan música.</p>}
  {state.end&&<p role="status">{ends[state.end]}</p>}
  {state.error&&<p role="alert">{errors[state.error]}{state.retryAt!==null?` No se reintentará automáticamente. Disponible a partir de ${new Date(state.retryAt).toLocaleString()}.`:state.retryBlocked?' No se permiten más consultas en esta sesión.':''}</p>}
  <div className="telegram-sources-actions">
   {state.end==='more'&&<button disabled={!enabled||limited} onClick={()=>{if(allowed()){intent.current=true;client.more(allowed);}}}>Ver más</button>}
   {state.reading&&<button disabled={state.cancelling} onClick={cancel}>Detener consulta</button>}
   <button disabled={!enabled} onClick={()=>{if(allowed())client.confirm(draft,allowed);}}>Usar estas fuentes en esta pestaña</button>
   <button disabled={!enabled} onClick={()=>{if(allowed())client.clear(allowed);}}>Quitar selección</button>
  </div>
  <p>Buscar canciones y descargarlas sigue pendiente.</p>
 </section>;
}
