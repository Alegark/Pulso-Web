import React from 'react';
import type {Activity} from '../playback/ownership';
import {TelegramSessionClient} from '../telegram/session-client';
import {initialSessionState,sessionErrorText,type SessionState} from '../telegram/session-protocol';
import './telegram.css';
export interface TelegramPanelProps {activity:Activity;canConnect:boolean;scopeKey:string;captureCurrent:()=>()=>boolean}
export function TelegramPanel({activity,canConnect,scopeKey,captureCurrent}:TelegramPanelProps){
 const [state,setState]=React.useState<SessionState>(initialSessionState);const [phone,setPhone]=React.useState('');const [code,setCode]=React.useState('');const [password,setPassword]=React.useState('');const [consent,setConsent]=React.useState(false);
 const [now,setNow]=React.useState(Date.now);const client=React.useRef<TelegramSessionClient|null>(null);const heading=React.useRef<HTMLHeadingElement>(null);const input=React.useRef<HTMLInputElement>(null);const current=React.useRef(captureCurrent);current.current=captureCurrent;
 const panel=React.useRef<HTMLElement>(null),focusIntent=React.useRef(false);
 React.useEffect(()=>{let live=true;const service=new TelegramSessionClient(activity,()=>current.current(),value=>{if(live)setState(value);});client.current=service;setState(initialSessionState());return()=>{live=false;client.current=null;service.dispose();};},[activity,scopeKey]);
 React.useEffect(()=>{client.current?.revalidate();if(!canConnect){client.current?.stop(null);setPhone('');setCode('');setPassword('');setConsent(false);}},[canConnect,scopeKey]);
 React.useEffect(()=>{client.current?.revalidate();});
 React.useEffect(()=>{const close=()=>client.current?.stop('cancelled');addEventListener('pagehide',close);return()=>removeEventListener('pagehide',close);},[]);
 React.useEffect(()=>{const pointer=()=>{focusIntent.current=false;};const key=(event:KeyboardEvent)=>{if(event.key==='Tab')focusIntent.current=false;};const focus=(event:FocusEvent)=>{if(event.target instanceof Element&&event.target!==document.body&&event.target!==document.documentElement&&!panel.current?.contains(event.target))focusIntent.current=false;};addEventListener('pointerdown',pointer,true);addEventListener('keydown',key,true);addEventListener('focusin',focus,true);return()=>{focusIntent.current=false;removeEventListener('pointerdown',pointer,true);removeEventListener('keydown',key,true);removeEventListener('focusin',focus,true);};},[]);
 React.useEffect(()=>{if(!state.retryAt)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[state.retryAt]);
 React.useEffect(()=>{if(state.phase==='connected'){setPhone('');setCode('');setPassword('');}if(!focusIntent.current)return;if(state.phase==='code'||state.phase==='password')input.current?.focus();else if(state.phase==='connected')heading.current?.focus();if(['code','password','connected'].includes(state.phase))focusIntent.current=false;},[state.phase]);
 const pending=['sending-code','authorizing','disconnecting'].includes(state.phase),retrying=state.retryAt!==null&&now<state.retryAt;
 const actionCurrent=captureCurrent();
 const start=(event:React.FormEvent)=>{event.preventDefault();if(!actionCurrent()||!canConnect||!consent||pending||retrying)return;focusIntent.current=true;client.current?.begin(phone.replace(/[\s()-]/g,''));setCode('');setPassword('');};
 const submit=(event:React.FormEvent)=>{event.preventDefault();if(!actionCurrent()||!canConnect||pending||retrying)return;focusIntent.current=true;if(state.phase==='code'){client.current?.submit('code',code);setCode('');}else if(state.phase==='password'){client.current?.submit('password',password);setPassword('');}};
 return <section ref={panel} className="telegram-panel" aria-label="Conexión a Telegram"><h2 ref={heading} tabIndex={-1}>Tu cuenta de Telegram</h2>
 <p>Conecta tu propia cuenta. Esta primera conexión es temporal: al cerrar o recargar la pestaña tendrás que volver a entrar. No se guarda la sesión ni se modifica tu biblioteca local.</p>
 <p>La selección de fuentes, la búsqueda y la descarga de canciones aún están en preparación.</p>
 {!canConnect&&<p>El acceso está en pausa mientras esta pestaña no tenga el control o haya una operación incompatible.</p>}
 {(state.phase==='disconnected'||state.phase==='error')&&<form onSubmit={start}><label>Número de Telegram con prefijo internacional<input type="tel" autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} maxLength={32} placeholder="+…" required disabled={!canConnect||pending}/></label><label className="telegram-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={!canConnect}/>Autorizo conectar esta pestaña con Telegram y enviar mi número para iniciar sesión.</label><button disabled={!canConnect||!consent||pending||retrying}>Enviar código de acceso</button></form>}
 {state.phase==='code'&&<form onSubmit={submit}><p>{state.delivery==='sms'?'Telegram envió el código por SMS.':state.delivery==='call'?'Telegram enviará el código mediante una llamada.':state.delivery==='email'?'Comprueba el código enviado por Telegram a tu correo.':'Abre Telegram y busca el código de acceso en el mensaje de servicio.'}</p><label>Código de Telegram<input ref={input} type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)} pattern="[0-9]{1,12}" maxLength={12} required disabled={!canConnect||pending}/></label><button disabled={!canConnect||pending||retrying}>Confirmar código</button></form>}
 {state.phase==='password'&&<form onSubmit={submit}><label>Contraseña de verificación en dos pasos<input ref={input} type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} maxLength={1024} required disabled={!canConnect||pending}/></label><button disabled={!canConnect||pending||retrying}>Verificar contraseña</button></form>}
 {pending&&<p role="status">{state.phase==='sending-code'?'Conectando con Telegram…':state.phase==='disconnecting'?'Solicitando el cierre de sesión en Telegram…':'Comprobando el acceso…'}</p>}
 {state.phase==='connected'&&<><p role="status">Cuenta autenticada en esta pestaña. Todavía no se han consultado chats ni descargado canciones.</p><button disabled={!canConnect||pending} onClick={()=>{if(actionCurrent())client.current?.logout();}}>Cerrar sesión en Telegram</button></>}
 {state.error&&<p role="alert">{sessionErrorText[state.error]}{retrying?` Podrás volver a intentarlo en ${Math.ceil((state.retryAt!-now)/1000)} segundos.`:''}</p>}
 {!['disconnected','error'].includes(state.phase)&&<button onClick={()=>{client.current?.stop('cancelled');setPhone('');setCode('');setPassword('');}}>Detener conexión local</button>}
 </section>;
}
