import {useLayoutEffect,useRef,useState} from 'react';
import type {Activity,ActivityToken} from '../playback/ownership';
import {readLrclib,type LrclibResult,type FieldContrast} from '../library/lrclib';
import './remote-lyrics.css';

export interface RemoteLyricsPanelProps {
 activity:Activity;
 trackId:string|null; title:string|null; artist:string|null; album:string|null;
 durationSeconds:number; timeSeconds:number;
 /** Technical gate only. Keep false in product until D08/identification/CORS approved. */
 available:boolean;
 /** Admission for NEW work; must not become false solely because our token is active. */
 canRequest:boolean;
 /** Capture real caller scope/proof/epoch synchronously; never return a generic true guard. */
 captureCurrent:()=>()=>boolean;
 onStatus:(text:string)=>void;
}
type Attempt={controller:AbortController;token:ActivityToken;current:()=>boolean;cancelled:boolean};
type View={result:LrclibResult;current:()=>boolean};
const safe=(guard:()=>boolean)=>{try{return guard();}catch{return false;}};
const identity=(p:RemoteLyricsPanelProps)=>JSON.stringify([p.trackId,p.title,p.artist,p.album,p.durationSeconds]);
// Only a deadline and a conservative block survive remounts in this document.
// No queue, track data, lyrics cache, cross-tab arbitration or persistence.
const requestWindow={nextAllowed:0,blocked:false};
const contrastText:Record<FieldContrast,string>={unknown:'desconocido','metadata-consistent':'coincide en metadatos',conflict:'diferente'};
function message(result:LrclibResult):string {
 switch(result.state){
  case 'candidate':return 'Candidato de LRCLIB; coincidencia de metadatos, identidad musical sin confirmar.';
  case 'conflict':return 'El candidato difiere de esta canción. No se muestra su letra ni se aplica ningún cambio.';
  case 'instrumental':return 'LRCLIB declara este candidato instrumental; no confirma la identidad musical.';
  case 'not-found':return 'LRCLIB no encontró letras para esta consulta.';
  case 'disabled':return 'Las consultas externas no están disponibles.';
  case 'missing-input':return 'Faltan título o artista válidos para buscar.';
  case 'cancelled':return 'Consulta cancelada. No se conserva ningún resultado.';
  case 'unavailable':return ({network:'No se pudo conectar con LRCLIB. Puedes reintentar expresamente.',
   'protocol-invalid':'LRCLIB devolvió una respuesta no válida. No se muestra su contenido.',
   timeout:'LRCLIB no respondió a tiempo. Puedes reintentar expresamente.',
   'rate-limited':'LRCLIB ha limitado las consultas. Respeta la espera antes de reintentar.',
   'service-unavailable':'LRCLIB no está disponible. Respeta la espera antes de reintentar.'})[result.reason];
 }
}

/** Transient, read-only overlay. Mount only when local/manual/explicit absence allows it.
 * Cooldown survives toggling/remount in this document; caller coordinates tabs.
 * Caller coordinates the single owner across tabs, and must rerender/unmount on revocation.
 * No automatic request, persistence, focus movement, audio interaction or global cache.
 */
export function RemoteLyricsPanel(props:RemoteLyricsPanelProps){
 const latest=useRef(props);latest.current=props;
 const mounted=useRef(false),active=useRef<Attempt|null>(null),accepted=useRef(false);
 const [consent,setConsent]=useState(false),[busy,setBusy]=useState(false);
 const [view,setView]=useState<View|null>(null),[status,setStatus]=useState('');
 const [clock,setClock]=useState(0);
 const key=identity(props),previous=useRef(key);
 function discard(){
  const attempt=active.current;
  if(attempt){attempt.cancelled=true;attempt.controller.abort();}
  setView(null);
 }
 useLayoutEffect(()=>{
  mounted.current=true;
  return ()=>{mounted.current=false;const a=active.current;if(a){a.cancelled=true;a.controller.abort();}};
 },[]);
 // No requests in effects. Revoke results and in-flight publication before browser paint.
 useLayoutEffect(()=>{
  const changed=previous.current!==key;previous.current=key;
  if(changed||!props.available||!props.canRequest||(active.current&&!safe(active.current.current))||(view&&!safe(view.current))){
   discard();setStatus('');
  }
  if(!props.available){accepted.current=false;setConsent(false);}
 });
 // One local UI wake-up only; neither timers nor timeupdate can dispatch a query.
 useLayoutEffect(()=>{
  const delay=requestWindow.nextAllowed-performance.now();
  if(delay<=0||requestWindow.blocked)return;
  const timer=setTimeout(()=>setClock(v=>v+1),Math.ceil(delay));
  return ()=>clearTimeout(timer);
 },[busy,clock,status]);
 function publish(text:string){setStatus(text);try{latest.current.onStatus(text);}catch{/* Caller status must not leak our token. */}}
 async function search(){
  const p=latest.current;
  if(active.current||!mounted.current||!accepted.current||!p.available||!p.canRequest||requestWindow.blocked||performance.now()<requestWindow.nextAllowed)return;
  if(!p.trackId||!p.title?.trim()||!p.artist?.trim()){publish('Faltan título o artista válidos para buscar.');return;}
  let guard:()=>boolean;
  try{guard=p.captureCurrent();}catch{return;}
  const scope=p.activity.scope(),queryKey=identity(p);
  if(!safe(guard)||!safe(scope))return;
  const token=p.activity.begin();if(!token)return;
  const attempt:Attempt={controller:new AbortController(),token,cancelled:false,current:()=>false};
  attempt.current=()=>mounted.current&&latest.current.activity===p.activity&&identity(latest.current)===queryKey&&latest.current.available&&latest.current.canRequest&&accepted.current&&token.current()&&safe(scope)&&safe(guard);
  active.current=attempt;setBusy(true);setView(null);
  requestWindow.nextAllowed=performance.now()+2100;
  try{
   if(!safe(attempt.current))return;
   publish('Consultando LRCLIB…');
   const result=await readLrclib({title:p.title,artist:p.artist,album:p.album,durationSeconds:p.durationSeconds},{enabled:true,signal:attempt.controller.signal,current:attempt.current});
   // Respect server cooldown even if UI authority was revoked after the adapter returned.
   if(result.state==='unavailable'&&(result.reason==='rate-limited'||result.reason==='service-unavailable')){
    if(result.retryAfterSeconds===undefined)requestWindow.blocked=true;
    else requestWindow.nextAllowed=Math.max(requestWindow.nextAllowed,performance.now()+result.retryAfterSeconds*1000);
   }
   if(active.current!==attempt||!safe(attempt.current))return;
   // Preserve the adapter's first observed failure; late Cancel must not mask it.
   if(result.state==='unavailable'){publish(message(result));return;}
   if(attempt.cancelled||attempt.controller.signal.aborted){publish('Consulta cancelada. No se conserva ningún resultado.');return;}
   if(!safe(attempt.current)||attempt.controller.signal.aborted)return;
   setView({result,current:attempt.current});publish(message(result));
  }catch{
   if(active.current===attempt&&safe(attempt.current))publish(attempt.cancelled?'Consulta cancelada. No se conserva ningún resultado.':'No se pudo completar la consulta de letras.');
  }finally{
   // Serial provider pacing also applies after a response slower than 2100 ms.
   requestWindow.nextAllowed=Math.max(requestWindow.nextAllowed,performance.now()+500);
   attempt.controller.abort();token.end();
   if(active.current===attempt){active.current=null;if(mounted.current)setBusy(false);}
  }
 }
 const visible=view&&props.available&&props.canRequest&&consent&&previous.current===key&&safe(view.current)?view.result:null;
 const record=visible&&'record' in visible?visible.record:null;
 const lyrics=visible?.state==='candidate'&&record?(record.syncedLyrics?.kind==='timed'?record.syncedLyrics:record.plainLyrics??record.syncedLyrics):null;
 let currentTime=-1;
 if(lyrics?.kind==='timed'&&Number.isFinite(props.timeSeconds)){
  for(const cue of lyrics.cues){if(cue.timeMs>props.timeSeconds*1000)break;currentTime=cue.timeMs;}
 }
 const waiting=performance.now()<requestWindow.nextAllowed;
 return <section className="remote-lyrics-panel" aria-label="Letras externas opcionales" aria-busy={busy}>
  <h3>Letras externas opcionales</h3>
  <p>Consulta a LRCLIB: se envían título, artista, álbum y duración disponibles. El proveedor recibe tu IP y datos HTTP. No se envían audio, chats ni credenciales.</p>
  <p>Resultado transitorio de esta canción; no se guarda ni cambia la biblioteca.</p>
  {!props.available&&<p>Las letras en línea todavía no están habilitadas.</p>}
  <label><input type="checkbox" checked={consent&&props.available} disabled={!props.available} onChange={e=>{
   const enabled=e.currentTarget.checked&&latest.current.available;
   accepted.current=enabled;setConsent(enabled);
   if(!enabled){discard();setStatus('Consulta desactivada; resultado descartado.');}
  }}/>Acepto consultar a LRCLIB durante esta sesión</label>
  <div className="remote-lyrics-panel__actions">
   <button type="button" disabled={!props.available||!props.canRequest||!consent||busy||waiting||requestWindow.blocked||!props.trackId||!props.title?.trim()||!props.artist?.trim()} onClick={()=>void search()}>Buscar letras de esta canción</button>
   <button type="button" disabled={!busy} onClick={()=>{discard();setStatus('Cancelación solicitada. Esperando el cierre de la consulta.');}}>Cancelar consulta</button>
   <button type="button" disabled={!view&&!busy} onClick={()=>{discard();setStatus('Resultado descartado.');}}>Descartar resultado</button>
  </div>
  {!props.canRequest&&<p>Sin permiso para iniciar una consulta ahora. Puedes cancelar una consulta pendiente.</p>}
  {requestWindow.blocked?<p>LRCLIB no indicó un plazo de reintento válido. Consultas bloqueadas durante esta sesión; desactivar no elimina el bloqueo.</p>:waiting&&<p>Espera antes de volver a buscar. El reintento siempre requiere pulsar Buscar.</p>}
  <p role="status">{status}</p>
  {record&&visible&&'contrast' in visible&&<div className="remote-lyrics-panel__candidate">
   <h4>Candidato de LRCLIB · identidad sin confirmar</h4>
   <p>Procedencia: LRCLIB · registro de letras {record.origin.recordId}. No identifica una edición musical.</p>
   <dl><dt>Título</dt><dd>{record.title} · {contrastText[visible.contrast.title]}</dd>
    <dt>Artista</dt><dd>{record.artist} · {contrastText[visible.contrast.artist]}</dd>
    <dt>Álbum</dt><dd>{record.album??'Desconocido'} · {contrastText[visible.contrast.album]}</dd>
    <dt>Duración</dt><dd>{record.durationSeconds} s · {contrastText[visible.contrast.duration]}</dd></dl>
   {visible.state==='conflict'&&<p>Metadatos diferentes: letra del candidato oculta. No se aplica automáticamente.</p>}
   {lyrics?.kind==='plain'&&<pre className="remote-lyrics-panel__text">{lyrics.text}</pre>}
   {lyrics?.kind==='timed'&&<ol className="remote-lyrics-panel__cues" aria-label="Letra candidata con tiempos">{lyrics.cues.map((cue,index)=><li key={index} aria-current={cue.timeMs===currentTime?'true':undefined}><span>{Math.floor(cue.timeMs/60000)}:{String(Math.floor(cue.timeMs/1000)%60).padStart(2,'0')}</span> {cue.text}</li>)}</ol>}
  </div>}
 </section>;
}
