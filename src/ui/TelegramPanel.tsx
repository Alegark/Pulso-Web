import {AUDIO_FILE_MAX_BYTES} from '../storage/audio-limits';
import type {BotDownloadedAudio} from '../telegram/bot-search-protocol';
import type {SongPlaybackAttempt,SongManagement,SongCopyInspection} from '../library/selected-song';
import React from 'react';
import {createPortal} from 'react-dom';
import type {Track,Playlist} from '../library/library';
import {MusicSearchController} from './MusicSearchController';
import type {Activity} from '../playback/ownership';
import {TelegramSourcesPanel} from './TelegramSourcesPanel';
import {BotProvidersController} from './BotProvidersController';
import {TelegramSessionClient,type SourcesSnapshot,type BotsSnapshot,type BotSearchSnapshot} from '../telegram/session-client';
import {initialSessionState,sessionErrorText,type SessionState} from '../telegram/session-protocol';
import {telegramBlockText,type TelegramBlockReason} from '../telegram/admission';
import {TelegramPhoneFields} from './TelegramPhoneFields';
import {hasSavedTelegramSession} from '../telegram/saved-session';
import {normalizeInternationalTelegramPhone,internationalPhoneNumberErrorText as phoneNumberErrorText} from '../telegram/phone-number';
import './telegram.css';
export interface TelegramPanelProps {activity:Activity;canConnect:boolean;scopeKey:string;captureCurrent:()=>()=>boolean;captureLifetime?:()=>()=>boolean;captureSongPlayback?:()=>SongPlaybackAttempt|null;captureSongCopyInspection?:()=>SongCopyInspection|null;blockedReason?:TelegramBlockReason;libraryPending?:boolean;onCheckControl?:()=>void;onRequestControl?:()=>void;searchTarget?:HTMLElement|null;searchVisible?:boolean;localTracks?:readonly Track[];libraryTrackIds?:ReadonlySet<string>;songPlaylists?:readonly Playlist[];captureSongManagement?:(id:string)=>SongManagement|null;captureDownloadSave?:()=>((audio:BotDownloadedAudio,signal:AbortSignal,onProgress:(bytes:number)=>void)=>Promise<'saved'|'failed'|'uncertain'>)|null}
export function TelegramPanel({activity,canConnect,scopeKey,captureCurrent,captureLifetime=captureCurrent,captureSongPlayback,captureSongCopyInspection,blockedReason='busy',libraryPending=false,onCheckControl,onRequestControl,searchTarget=null,searchVisible=false,localTracks=[],libraryTrackIds,songPlaylists=[],captureSongManagement,captureDownloadSave}:TelegramPanelProps){
 const [searchState,setSearchState]=React.useState<BotSearchSnapshot|null>(null);
 const [sources,setSources]=React.useState<SourcesSnapshot|null>(null);
 const [bots,setBots]=React.useState<BotsSnapshot|null>(null);
 const [savedSession,setSavedSession]=React.useState<'checking'|'present'|'absent'|'unknown'>('checking');
 const resumeTried=React.useRef<TelegramSessionClient|null>(null);
 const [state,setState]=React.useState<SessionState>(initialSessionState);const [phone,setPhone]=React.useState('');const [country,setCountry]=React.useState('');const [code,setCode]=React.useState('');const [password,setPassword]=React.useState('');const [consent,setConsent]=React.useState(false);
 const [now,setNow]=React.useState(Date.now);const client=React.useRef<TelegramSessionClient|null>(null);const heading=React.useRef<HTMLHeadingElement>(null);const input=React.useRef<HTMLInputElement>(null);const current=React.useRef(captureCurrent);current.current=captureCurrent;
 const lifetime=React.useRef(captureLifetime);lifetime.current=captureLifetime;
 const panel=React.useRef<HTMLElement>(null),focusIntent=React.useRef(false);
 React.useEffect(()=>{let live=true;const service=new TelegramSessionClient(activity,()=>lifetime.current(),value=>{if(live)setState(value);},undefined,undefined,value=>{if(live)setSources(value);},undefined,undefined,value=>{if(live)setBots(value);},value=>{if(live)setSearchState(value);},()=>current.current());client.current=service;setState(initialSessionState());setSources(null);setBots(null);setSearchState(null);return()=>{live=false;client.current=null;service.dispose();};},[activity,scopeKey]);
 React.useEffect(()=>{const active=!['disconnected','error'].includes(state.phase);client.current?.revalidate();if(!lifetime.current()()){client.current?.stop(active?'cancelled':null);setCode('');setPassword('');if(active){setCountry('');setPhone('');setConsent(false);}}},[canConnect,scopeKey]);
 React.useEffect(()=>{client.current?.revalidate();});
 React.useEffect(()=>{
  if(!['disconnected','error','connected'].includes(state.phase))return;
  let live=true;void hasSavedTelegramSession().then(present=>{if(live)setSavedSession(present?'present':'absent');}).catch(()=>{if(live)setSavedSession('unknown');});
  return()=>{live=false;};
 },[scopeKey,state.phase]);
 React.useEffect(()=>{
  const service=client.current;if(!service||resumeTried.current===service||savedSession!=='present'||state.phase!=='disconnected'||!canConnect||navigator.onLine===false||!current.current()())return;
  resumeTried.current=service;service.restore();
 },[savedSession,state.phase,canConnect,scopeKey]);
 React.useEffect(()=>{const close=()=>client.current?.stop('cancelled');addEventListener('pagehide',close);return()=>removeEventListener('pagehide',close);},[]);
 React.useEffect(()=>{const pointer=()=>{focusIntent.current=false;};const key=(event:KeyboardEvent)=>{if(event.key==='Tab')focusIntent.current=false;};const focus=(event:FocusEvent)=>{if(event.target instanceof Element&&event.target!==document.body&&event.target!==document.documentElement&&!panel.current?.contains(event.target))focusIntent.current=false;};addEventListener('pointerdown',pointer,true);addEventListener('keydown',key,true);addEventListener('focusin',focus,true);return()=>{focusIntent.current=false;removeEventListener('pointerdown',pointer,true);removeEventListener('keydown',key,true);removeEventListener('focusin',focus,true);};},[]);
 React.useEffect(()=>{if(!state.retryAt)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[state.retryAt]);
 React.useEffect(()=>{if(state.phase==='connected'){setCountry('');setPhone('');setCode('');setPassword('');}if(!focusIntent.current)return;if(state.phase==='code'||state.phase==='password')input.current?.focus();else if(state.phase==='connected')heading.current?.focus();if(['code','password','connected'].includes(state.phase))focusIntent.current=false;},[state.phase]);
 const pending=['restoring','sending-code','authorizing','disconnecting'].includes(state.phase),retrying=state.retryAt!==null&&now<state.retryAt;
 const draft=React.useRef<object|null>(null),draftToken={};
 React.useLayoutEffect(()=>{draft.current=draftToken;return()=>{if(draft.current===draftToken)draft.current=null;};});
 const draftCurrent=()=>draft.current===draftToken&&!pending&&(state.phase==='disconnected'||state.phase==='error');
 const actionCurrent=captureCurrent(),actionClient=client.current,sessionAction=actionClient?.captureSessionCurrent(),localStop=actionClient?.captureLocalStop();
 const normalizedPhone=normalizeInternationalTelegramPhone(phone);
 const draftReason=!normalizedPhone.ok?phoneNumberErrorText[normalizedPhone.error]:!consent?'Marca la autorización para enviar tu número a Telegram.':null;
 const draftHelpId=React.useId(),draftReasonId=React.useId();
 const start=(event:React.FormEvent)=>{event.preventDefault();if(client.current!==actionClient||!sessionAction?.()||!actionCurrent()||!canConnect||!consent||pending||retrying||!normalizedPhone.ok)return;resumeTried.current=actionClient;focusIntent.current=true;client.current?.begin(normalizedPhone.e164);setCode('');setPassword('');};
 const submit=(event:React.FormEvent)=>{event.preventDefault();if(client.current!==actionClient||!sessionAction?.()||!actionCurrent()||!canConnect||pending||retrying)return;focusIntent.current=true;if(state.phase==='code'){client.current?.submit('code',code);setCode('');}else if(state.phase==='password'){client.current?.submit('password',password);setPassword('');}};
 return <section ref={panel} className="telegram-panel" aria-label="Conexión a Telegram"><h2 ref={heading} tabIndex={-1}>Tu cuenta de Telegram</h2>
 <p>Conecta tu propia cuenta. Pulso conserva la autorización de Telegram en este navegador para recuperar la conexión al volver. No guarda tu código ni tu contraseña. «Cerrar sesión en Telegram» elimina la autorización guardada de esta conexión; la música y las playlists se conservan.</p>
 <p>En Buscar puedes consultar sugerencias y enviar una consulta al bot elegido. Al elegir una opción musical puedes obtener su audio y obtener una copia de reproducción de hasta {AUDIO_FILE_MAX_BYTES/1048576} MiB en este navegador. Se elige automáticamente la mejor coincidencia; «Agregar canción» y «Añadir a playlist» son acciones aparte.</p>
 {libraryPending&&<p role="status">Hay una comprobación pendiente de la biblioteca local. Puedes iniciar sesión en Telegram; los cambios en la biblioteca siguen en pausa.</p>}
 {!canConnect&&<div><p role="status">{telegramBlockText[blockedReason??'busy']}</p>{blockedReason==='no-control'&&<div className="controls">{onCheckControl&&<button onClick={onCheckControl}>Comprobar control</button>}{onRequestControl&&<button onClick={onRequestControl}>Usar en esta pestaña</button>}</div>}</div>}
 {(state.phase==='disconnected'||state.phase==='error')&&savedSession==='present'&&<div><p role="status">Hay una sesión de Telegram guardada en este navegador.</p><button disabled={!canConnect||pending||retrying} onClick={()=>{if(client.current!==actionClient||!sessionAction?.()||!actionCurrent()||!canConnect||retrying)return;resumeTried.current=actionClient;actionClient?.restore();}}>Reconectar Telegram</button></div>}
 {(state.phase==='disconnected'||state.phase==='error')&&savedSession==='unknown'&&<p role="alert">No se pudo comprobar la sesión guardada. Puedes eliminarla de este navegador antes de iniciar otra conexión.</p>}
 {(state.phase==='disconnected'||state.phase==='error')&&(savedSession==='present'||savedSession==='unknown'||state.error==='session-storage')&&<button disabled={!canConnect||pending} onClick={()=>{if(client.current!==actionClient||!sessionAction?.()||!actionCurrent()||!canConnect)return;resumeTried.current=actionClient;actionClient?.forgetSavedSession();}}>Eliminar sesión guardada</button>}
 {(state.phase==='disconnected'||state.phase==='error')&&<form onSubmit={start}><TelegramPhoneFields phone={phone} country={country} disabled={pending} helpId={draftHelpId} reasonId={draftReason?draftReasonId:undefined} invalid={phone!==''&&!normalizedPhone.ok} onPhone={value=>{if(draftCurrent())setPhone(value);}} onCountry={value=>{if(draftCurrent())setCountry(value);}}/><p id={draftHelpId} className="telegram-phone-help">Escribe o pega el número internacional con + y prefijo. También puedes buscar un país para insertar su prefijo. Los ceros se conservan.</p><label className="telegram-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={pending}/>Autorizo conectar esta pestaña con Telegram y enviar mi número para iniciar sesión.</label><button disabled={!canConnect||!consent||!normalizedPhone.ok||pending||retrying} aria-describedby={draftReason?draftReasonId:undefined}>Enviar código de acceso</button>{draftReason&&<p id={draftReasonId} role="status">{draftReason}</p>}</form>}
 {state.phase==='code'&&<form onSubmit={submit}><p>{state.delivery==='sms'?'Telegram envió el código por SMS.':state.delivery==='call'?'Telegram enviará el código mediante una llamada.':state.delivery==='email'?'Comprueba el código enviado por Telegram a tu correo.':'Abre Telegram y busca el código de acceso en el mensaje de servicio.'}</p><label>Código de Telegram<input ref={input} type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)} pattern="[0-9]{1,12}" maxLength={12} required disabled={!canConnect||pending}/></label><button disabled={!canConnect||pending||retrying}>Confirmar código</button></form>}
 {state.phase==='password'&&<form onSubmit={submit}><label>Contraseña de verificación en dos pasos<input ref={input} type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} maxLength={1024} required disabled={!canConnect||pending}/></label><button disabled={!canConnect||pending||retrying}>Verificar contraseña</button></form>}
 {pending&&<p role="status">{state.phase==='restoring'?'Recuperando tu sesión de Telegram…':state.phase==='sending-code'?'Conectando con Telegram…':state.phase==='disconnecting'?'Cerrando o eliminando la sesión de Telegram…':'Comprobando el acceso…'}</p>}
 {state.phase==='connected'&&<><p role="status">Cuenta autenticada en esta pestaña. Los perfiles y las otras fuentes sólo se consultan cuando lo pides.</p>{client.current&&bots?.binding&&<BotProvidersController client={client.current} state={bots} canConnect={canConnect}/>}<details><summary>Otras fuentes de Telegram</summary>{client.current&&sources?.binding&&<TelegramSourcesPanel client={client.current} state={sources} canConnect={canConnect}/>}</details><button disabled={!canConnect||pending} onClick={()=>{if(actionCurrent()&&sessionAction?.()&&client.current===actionClient){resumeTried.current=actionClient;actionClient?.logout();}}}>Cerrar sesión en Telegram</button></>}
 {state.error&&<p role="alert">{sessionErrorText[state.error]}{retrying?` Podrás volver a intentarlo en ${Math.ceil((state.retryAt!-now)/1000)} segundos.`:''}</p>}
 {!['disconnected','error'].includes(state.phase)&&<><button onClick={()=>{resumeTried.current=actionClient;if(!localStop?.())return;setCountry('');setPhone('');setCode('');setPassword('');}}>Detener conexión local</button><p>Detener esta pestaña conserva la sesión guardada. Para eliminarla, usa «Cerrar sesión en Telegram» o «Eliminar sesión guardada».</p></>}
 {searchTarget&&createPortal(<MusicSearchController key={scopeKey} visible={searchVisible} scopeKey={scopeKey} client={client.current} phase={state.phase} bots={bots} searchState={searchState} canConnect={canConnect} tracks={localTracks} libraryTrackIds={libraryTrackIds} playlists={songPlaylists} captureSongManagement={captureSongManagement} captureDownloadSave={captureDownloadSave} captureSongPlayback={captureSongPlayback} captureSongCopyInspection={captureSongCopyInspection}/>,searchTarget)}
 </section>;
}
