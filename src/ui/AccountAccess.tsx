import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {accountController} from '../accounts/neon-provider';
import {registerUpdateBlocker} from '../service-worker/update-blockers';
import './account-access.css';
type View='sign-in'|'sign-up'|'forgot'|'reset'|'verify';
const headings:Record<View,string>={'sign-in':'Entra a Pulso','sign-up':'Crea tu cuenta','forgot':'Recupera tu contraseña','reset':'Elige una contraseña nueva','verify':'Verifica tu correo'};

/** Optional Pulso identity. It neither grants nor revokes the device's Telegram
 * authority and it never moves, relabels or deletes local music. */
export function AccountAccess(){
 const state=useSyncExternalStore(accountController.subscribe,accountController.getSnapshot);
 const dialog=useRef<HTMLDialogElement>(null),heading=useRef<HTMLHeadingElement>(null),opener=useRef<HTMLElement|null>(null);
 const [open,setOpen]=useState(false),[view,setView]=useState<View>('sign-in'),[message,setMessage]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[name,setName]=useState(''),[code,setCode]=useState(''),[resetToken,setResetToken]=useState('');
 const locked=state.pending||state.status==='checking';
 function clear(){setPassword('');setCode('');setMessage('');}
 function close(){if(locked)return;dialog.current?.close();setOpen(false);clear();setResetToken('');setEmail('');setName('');const target=opener.current;opener.current=null;requestAnimationFrame(()=>{if(target?.isConnected)target.focus();});}
 function show(target:HTMLElement|null,selected:View='sign-in'){
  opener.current=target;setView(selected);clear();setOpen(true);dialog.current?.showModal();requestAnimationFrame(()=>heading.current?.focus());void accountController.load();
 }
 useEffect(()=>registerUpdateBlocker(()=>dialog.current?.open===true||accountController.getSnapshot().pending),[]);
 useEffect(()=>{
  const url=new URL(window.location.href),entry=url.searchParams.get('pulso-account');
  if(!['callback','reset'].includes(entry??''))return;
  const token=url.searchParams.get('token');
  // Keep a reset credential only in component memory; remove it before any
  // application navigation/update. Never send it to the music or diagnostics UI.
  if(entry==='reset'){
   if(token&&token.length<=512){setResetToken(token);show(null,'reset');}else{show(null,'forgot');setMessage('El enlace ya no es válido. Solicita uno nuevo.');}
   url.searchParams.delete('token');url.searchParams.delete('error');url.searchParams.delete('pulso-account');history.replaceState(history.state,'',url.pathname+url.search+url.hash);
  }else{
   show(null);if(url.searchParams.has('error'))setMessage('No se completó el acceso con Google. Puedes intentarlo de nuevo.');
   // The Neon SDK consumes and clears its one-use session verifier. Leave that
   // parameter to the SDK, but do not retain the public UI marker or raw error.
   url.searchParams.delete('pulso-account');url.searchParams.delete('error');history.replaceState(history.state,'',url.pathname+url.search+url.hash);
  }
 },[]);
 useEffect(()=>{void accountController.load();},[]);
 async function submit(event:React.FormEvent){
  event.preventDefault();if(locked)return;setMessage('');let ok=false;
  if(view==='sign-in')ok=await accountController.signIn(email.trim(),password);
  if(view==='sign-up')ok=await accountController.signUp(name.trim(),email.trim(),password);
  if(view==='forgot'){ok=await accountController.requestReset(email.trim());if(ok)setMessage('Si existe una cuenta con ese correo, recibirás un enlace para recuperar tu contraseña.');}
  if(view==='reset'){ok=await accountController.reset(resetToken,password);if(ok){setResetToken('');setView('sign-in');setMessage('Contraseña actualizada. Ya puedes iniciar sesión.');}}
  if(view==='verify'){ok=await accountController.verify(email.trim(),code);if(ok){setView('sign-in');setMessage('Correo verificado. Ya puedes iniciar sesión.');}}
  setPassword('');setCode('');
  if(view==='sign-up'&&ok&&!accountController.getSnapshot().user){setView('verify');setMessage('Revisa el código que enviamos a tu correo.');}
 }
 function switchView(next:View){if(locked)return;setView(next);clear();}
 const ready=['signed-out','signed-in'].includes(state.status);
 return <>
  <button type="button" className="account-access-button" onClick={event=>show(event.currentTarget)} aria-haspopup="dialog">{state.user?'Mi cuenta':'Iniciar sesión'}</button>
  <dialog ref={dialog} className="account-dialog" aria-labelledby="account-access-heading" onCancel={event=>{event.preventDefault();close();}}>
   <div className="account-dialog__toolbar"><span className="account-dialog__brand">pulso<span aria-hidden="true">●</span></span><button type="button" aria-label="Cerrar cuenta de Pulso" disabled={locked} onClick={close}>Cerrar</button></div>
   <h2 id="account-access-heading" ref={heading} tabIndex={-1}>{state.user?'Tu cuenta de Pulso':headings[view]}</h2>
   {open&&<>
    {state.status==='checking'&&<p role="status">Comprobando tu sesión…</p>}
    {state.status==='disabled'&&<p role="status">Estamos preparando el acceso a cuentas. Puedes seguir escuchando tu música en este navegador.</p>}
    {state.status==='unavailable'&&<><p role="alert">{state.error}</p><button type="button" onClick={()=>void accountController.load()}>Reintentar conexión de cuenta</button></>}
    {state.user?<div className="account-dialog__profile"><p><strong>{state.user.name}</strong><br/>{state.user.email}</p><p>{state.user.verified?'Correo verificado':'Correo pendiente de verificar'}</p><button type="button" disabled={locked} onClick={()=>void accountController.signOut()}>Cerrar sesión de Pulso</button></div>:ready&&<>
     <p className="account-dialog__intro">{view==='sign-up'?'Un lugar para tu cuenta de música.':view==='forgot'?'Te enviaremos un enlace para que puedas volver a entrar.':view==='verify'?'Introduce el código de seis dígitos que llegó a tu correo.':view==='reset'?'Utiliza al menos ocho caracteres.':'Qué bueno tenerte de vuelta.'}</p>
     {['sign-in','sign-up'].includes(view)&&state.google&&<><button type="button" className="account-dialog__google" disabled={locked} onClick={()=>{setPassword('');void accountController.google();}}><span aria-hidden="true">G</span> Continuar con Google</button><p className="account-dialog__separator">o con tu correo</p></>}
     <form onSubmit={event=>void submit(event)}>
      <fieldset disabled={locked}>
       {view==='sign-up'&&<label>Tu nombre<input name="name" autoComplete="name" required maxLength={80} value={name} onChange={event=>setName(event.currentTarget.value)}/></label>}
       {view!=='reset'&&<label>Correo electrónico<input name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} readOnly={view==='verify'} value={email} onChange={event=>setEmail(event.currentTarget.value)}/></label>}
       {['sign-in','sign-up','reset'].includes(view)&&<label>Contraseña<input name="password" type="password" autoComplete={view==='sign-in'?'current-password':'new-password'} required minLength={8} maxLength={128} value={password} onChange={event=>setPassword(event.currentTarget.value)}/></label>}
       {view==='verify'&&<label>Código de verificación<input name="code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} value={code} onChange={event=>setCode(event.currentTarget.value.replace(/\D/g,''))}/></label>}
       <button type="submit" className="account-dialog__primary">{locked?'Un momento…':view==='sign-up'?'Crear cuenta':view==='forgot'?'Enviar enlace':view==='reset'?'Guardar contraseña':view==='verify'?'Verificar correo':'Iniciar sesión'}</button>
      </fieldset>
     </form>
     <div className="account-dialog__switches">
      {view==='sign-in'&&<><button type="button" disabled={locked} onClick={()=>switchView('forgot')}>Olvidé mi contraseña</button><p>¿Aún no tienes cuenta? <button type="button" disabled={locked} onClick={()=>switchView('sign-up')}>Crear cuenta</button></p></>}
      {view!=='sign-in'&&<button type="button" disabled={locked} onClick={()=>switchView('sign-in')}>Volver a iniciar sesión</button>}
      {view==='verify'&&<button type="button" disabled={locked} onClick={()=>void accountController.resend(email).then(ok=>{if(ok)setMessage('Enviamos un nuevo código. Revisa tu correo.');})}>Reenviar código</button>}
      {state.error==='Verifica tu correo antes de iniciar sesión.'&&view==='sign-in'&&<button type="button" disabled={locked} onClick={()=>{switchView('verify');}}>Introducir código de verificación</button>}
     </div>
    </>}
    {state.error&&state.status!=='unavailable'&&<p className="account-dialog__error" role="alert">{state.error}</p>}
    {message&&<p role="status">{message}</p>}
    <p className="account-dialog__local">Tu música y la conexión con Telegram siguen guardadas en este navegador. Este acceso no sincroniza todavía tu biblioteca entre dispositivos.</p>
   </>}
  </dialog>
 </>;
}
