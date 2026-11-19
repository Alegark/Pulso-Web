import {useEffect,useReducer,useState} from 'react';
import {downloadNotifications,watchDownloadNotificationEnvironment} from '../pwa/download-notifications';

export function DownloadNotificationSettings(){
 const [,refresh]=useReducer(n=>n+1,0);
 const [pending,setPending]=useState(false);
 useEffect(()=>{
  const unsubscribe=downloadNotifications.subscribe(refresh);
  const stop=watchDownloadNotificationEnvironment();
  return()=>{unsubscribe();stop();};
 },[]);
 const {support,permission,preferred,enabled,worker,error}=downloadNotifications.state();
 const status=support==='install-ios'?'Abre Pulso desde su icono en la pantalla de inicio para habilitar los avisos.'
  :support==='unsupported'?'Este navegador no ofrece avisos de descargas.'
  :permission==='denied'?'El sistema tiene bloqueado el permiso. Puedes cambiarlo en los ajustes del dispositivo o del navegador.'
  :permission==='default'&&preferred?'Pulso conserva tu preferencia. El sistema vuelve a pedir permiso.'
  :!preferred?'Avisos desactivados en Pulso.'
  :worker==='ready'?'Avisos activados.'
  :worker==='checking'?'Comprobando los avisos…'
  :'Preferencia guardada. Pulso espera a que el servicio de avisos esté disponible.';
 return <section className="settings-group" aria-label="Notificaciones de descargas">
  <h3>Notificaciones de descargas</h3>
  <div className="settings-group__body">
   <p role="status">{status}</p>
   <p>Los títulos pueden aparecer en la pantalla bloqueada. Si el sistema suspende Pulso, la descarga y sus avisos pueden esperar hasta que vuelvas a abrir la app.</p>
   {error&&<p role="status">{error}</p>}
   {support==='ready'&&permission!=='denied'&&!enabled&&<button type="button" disabled={pending} onClick={()=>{
    setPending(true);void downloadNotifications.enable().finally(()=>setPending(false));
   }}>{pending?'Activando…':preferred?'Volver a permitir avisos':'Activar avisos de descargas'}</button>}
   {preferred&&<button type="button" disabled={pending} onClick={downloadNotifications.disable}>Desactivar avisos en Pulso</button>}
   {enabled&&worker==='ready'&&<button type="button" onClick={downloadNotifications.test}>Enviar aviso de prueba</button>}
  </div>
 </section>;
}
