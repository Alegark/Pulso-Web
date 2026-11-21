type DownloadNotificationKind='song'|'album'|'collection'|'test';
export type NotificationSupport='ready'|'install-ios'|'unsupported';
export interface NotificationHost {
 support:()=>NotificationSupport;permission:()=>NotificationPermission;
 request:()=>Promise<NotificationPermission>;
 registration:()=>Promise<{active:unknown;showNotification:(title:string,options:NotificationOptions)=>Promise<void>;getNotifications:()=>Promise<{tag:string;data?:{account?:string;terminal?:boolean};silent?:boolean|null;close:()=>void}[]>}|undefined>;
 read:()=>boolean;write:(enabled:boolean)=>void;now:()=>number;
}
export function createDownloadNotifications(host:NotificationHost){
 let preferred=false,locallyDisabled=false,epoch=0,check=0,error:string|null=null;
 let worker:'checking'|'ready'|'waiting'='checking';
 try{preferred=host.read();}catch{/* Storage unavailable. */}
 const listeners=new Set<()=>void>(),last=new Map<string,{key:unknown;body:string;at:number;terminal:boolean}>();
 let work:Promise<void>=Promise.resolve();
 const emit=()=>listeners.forEach(fn=>fn());
 const valid=(current:()=>boolean)=>{try{return current()===true;}catch{return false;}};
 const state=()=>{
  const support=host.support(),permission=host.permission();
  return {support,permission,preferred,enabled:preferred&&support==='ready'&&permission==='granted',worker,error};
 };
 function refresh(){
  const generation=++check;
  try{preferred=!locallyDisabled&&host.read();}catch{/* Keep the last known preference. */}
  emit();
  if(host.support()!=='ready')return;
  void host.registration().then(registration=>{
   if(generation===check){worker=registration?.active?'ready':'waiting';emit();}
  }).catch(()=>{if(generation===check){worker='waiting';emit();}});
 }
 async function enable(){
  if(host.support()!=='ready'||host.permission()==='denied')return false;
  const token=++epoch;error=null;
  try{
   // Invoke synchronously from the user's button when the system requires consent.
   const permission=host.permission()==='granted'?'granted':await host.request();
   if(token!==epoch)return false;
   if(permission!=='granted'){emit();return false;}
   host.write(true);locallyDisabled=false;preferred=true;refresh();return true;
  }catch{if(token===epoch){error='No se pudieron guardar los avisos de descargas.';emit();}return false;}
 }
 function disable(){const token=++epoch;preferred=false;locallyDisabled=true;last.clear();error=null;try{host.write(false);locallyDisabled=false;}catch{error='Avisos desactivados por ahora. No se pudo guardar la preferencia.';}emit();void host.registration().then(async reg=>{for(const n of await reg?.getNotifications()??[])if(token===epoch&&n.tag.startsWith('pulso-download-'))n.close();}).catch(()=>{});}
 function dismiss(kind:DownloadNotificationKind,key:unknown,current:()=>boolean=()=>true){
  if(last.get(kind)?.key!==key)return;
  last.delete(kind);const token=epoch;
  work=work.catch(()=>{}).then(()=>host.registration()).then(async reg=>{for(const notification of await reg?.getNotifications()??[])if(token===epoch&&valid(current)&&!last.has(kind)&&notification.tag===`pulso-download-${kind}`)notification.close();}).catch(()=>{});
 }
 function clearProgress(kind:DownloadNotificationKind,account:string,current:()=>boolean){
  if(host.support()!=='ready'||!valid(current)||last.has(kind))return;
  const token=epoch;
  work=work.catch(()=>{}).then(async()=>{
   if(token!==epoch||!valid(current)||last.has(kind))return;
   const reg=await host.registration();
   for(const notification of await reg?.getNotifications()??[])
    if(token===epoch&&valid(current)&&!last.has(kind)&&notification.tag===`pulso-download-${kind}`&&
     (!notification.data?.account||notification.data.account===account)&&
     (notification.data?.terminal===false||notification.silent===true))notification.close();
  }).catch(()=>{});
 }
 function notify(kind:DownloadNotificationKind,key:unknown,title:string,body:string,terminal=false,current:()=>boolean=()=>true,pause=false,account?:string){
  if(!preferred||host.support()!=='ready'||host.permission()!=='granted'||!valid(current))return;
  const previous=last.get(kind),now=host.now();
  if(previous&&previous.key===key&&(previous.terminal||!terminal&&(previous.body===body||!pause&&now-previous.at<15000)))return;
  const record={key,body,at:now,terminal};last.set(kind,record);const token=epoch;
  work=work.catch(()=>{}).then(async()=>{
   if(token!==epoch||!preferred||host.permission()!=='granted'||!valid(current)||last.get(kind)!==record)return;
   try{const reg=await host.registration();if(!reg?.active){if(token===epoch){worker='waiting';emit();}if(last.get(kind)===record)last.delete(kind);return;}if(token!==epoch||!preferred||host.permission()!=='granted'||!valid(current)||last.get(kind)!==record)return;
    await reg.showNotification(title.slice(0,160),{body:body.slice(0,300),tag:`pulso-download-${kind}`,icon:'/icons/pulso-192.png',badge:'/icons/pulso-192.png',data:{kind:'pulso-download',version:1,...(account?{account,terminal}:{})},silent:!terminal});
   }catch{if(token!==epoch||last.get(kind)!==record)return;last.delete(kind);error='El navegador no pudo mostrar el aviso. Puedes seguir las descargas dentro de Pulso.';emit();}
  });
 }
 function collectionOutcome(key:unknown,title:string,outcome:'finished'|'paused',saved:number,total:number,current:()=>boolean,account?:string){
  const summary=`${saved} de ${total} guardadas`;
  const detail=outcome==='paused'?' · abre Pulso para continuar':saved<total?` · ${total-saved} sin copia`:'';
  notify('collection',key,title,summary+detail,true,current,false,account);
 }
 return {state,refresh,enable,disable,notify,dismiss,clearProgress,collectionOutcome,settled:()=>work,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},test:()=>notify('test',{},'Pulso','Las notificaciones de descargas están listas.',true)};
}
const preference='pulso:download-notifications:v1';
export const downloadNotifications=createDownloadNotifications({
 support:()=>{
  const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
  const installed=matchMedia('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone===true;
  if(ios&&!installed)return 'install-ios';
  return isSecureContext&&'Notification'in window&&'serviceWorker'in navigator&&typeof ServiceWorkerRegistration!=='undefined'&&'showNotification'in ServiceWorkerRegistration.prototype?'ready':'unsupported';
 },permission:()=>typeof Notification==='undefined'?'default':Notification.permission,
 request:()=>Notification.requestPermission(),registration:async()=>navigator.serviceWorker?.getRegistration(),
 read:()=>localStorage.getItem(preference)==='enabled',
 write:enabled=>localStorage.setItem(preference,enabled?'enabled':'disabled'),now:()=>Date.now(),
});


// Re-read browser permission and the current registration on an iOS app resume.
export function watchDownloadNotificationEnvironment(){
 const refresh=()=>downloadNotifications.refresh();
 const foreground=()=>{if(document.visibilityState==='visible')refresh();};
 const storage=(event:StorageEvent)=>{if(event.key===preference||event.key===null)refresh();};
 window.addEventListener('focus',refresh);
 window.addEventListener('pageshow',refresh);
 window.addEventListener('storage',storage);
 document.addEventListener('visibilitychange',foreground);
 const workers=navigator.serviceWorker;
 workers?.addEventListener('controllerchange',refresh);
 let live=true;
 void workers?.ready.then(()=>{if(live)refresh();}).catch(()=>{});
 refresh();
 return ()=>{
  live=false;
  window.removeEventListener('focus',refresh);
  window.removeEventListener('pageshow',refresh);
  window.removeEventListener('storage',storage);
  document.removeEventListener('visibilitychange',foreground);
  workers?.removeEventListener('controllerchange',refresh);
 };
}
