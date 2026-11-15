import React from 'react';
import qrcode from 'qrcode-generator';
import type {QrLoginChallenge} from '../telegram/qr-login-protocol';
interface Props {challenge:QrLoginChallenge;disabled:boolean;current:()=>boolean;onCheck:()=>void}
/** Ticket stays in this ephemeral view; no image server, storage, download or logging. */
export function TelegramQrLogin({challenge,disabled,current,onCheck}:Props){
 const [now,setNow]=React.useState(Date.now),[visible,setVisible]=React.useState(document.visibilityState!=='hidden');
 React.useEffect(()=>{const tick=()=>{setNow(Date.now());setVisible(document.visibilityState!=='hidden');};const timer=setInterval(tick,1000);document.addEventListener('visibilitychange',tick);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',tick);};},[]);
 const image=React.useMemo(()=>{const qr=qrcode(0,'M');qr.addData(challenge.url,'Byte');qr.make();const n=qr.getModuleCount(),parts:string[]=[];for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(qr.isDark(y,x))parts.push(`M${x+4},${y+4}h1v1h-1z`);return {size:n+8,path:parts.join('')};},[challenge]);
 const active=visible&&!disabled&&current(),expired=now>=challenge.expiresAt;
 return <div className="telegram-qr-login"><h3 tabIndex={-1} data-telegram-qr-heading>Autoriza desde Telegram</h3><p>En Telegram de tu teléfono, abre Ajustes → Dispositivos → Vincular dispositivo y escanea este QR.</p>
  {active&&!expired?<><svg className="telegram-login-qr" role="img" aria-label="Código QR para conectar tu cuenta de Telegram" viewBox={`0 0 ${image.size} ${image.size}`}><rect width={image.size} height={image.size} fill="white"/><path d={image.path} fill="black"/></svg><p>Si tienes Telegram en este dispositivo, también puedes abrirlo directamente:</p><a className="telegram-open-app" href={challenge.url} rel="noreferrer" onClick={event=>{if(!current()||disabled||document.visibilityState==='hidden'||Date.now()>=challenge.expiresAt)event.preventDefault();}}>Abrir Telegram para autorizar</a><p role="status">El QR caduca en {Math.max(0,Math.ceil((challenge.expiresAt-now)/1000))} segundos.</p></>:<p role="status">{expired?'Este QR ha caducado. Comprueba la autorización o genera otro.':'La autorización no está disponible mientras esta vista está inactiva.'}</p>}
  <p>Después de aprobar el acceso en Telegram, vuelve aquí y compruébalo. No necesitas recibir un código.</p><button type="button" disabled={disabled} onClick={()=>{if(current()&&!disabled)onCheck();}}>{expired?'Comprobar acceso o generar otro QR':'Ya autoricé el acceso'}</button>
 </div>;
}
