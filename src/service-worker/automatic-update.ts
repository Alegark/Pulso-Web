const entryPattern=/^\/releases\/[a-f0-9]{16}\.html$/;
const attemptKey=(entry:string)=>'pulso-shell:automatic-attempt:'+entry;
const bundlePattern=/^\/assets\/[A-Za-z0-9_.-]+\.js$/;
export function updateEntry(value:unknown):string|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const v=value as Record<string,unknown>;
 return v.version===1&&typeof v.entry==='string'&&entryPattern.test(v.entry)?v.entry:null;
}
export function entryBundle(html:string):string|null {
 const scripts=html.match(/<script\b[^>]{0,4096}>/gi)??[];
 const paths=scripts.filter(tag=>/\btype\s*=\s*["']module["']/i.test(tag)).map(tag=>tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]);
 return paths.length===1&&typeof paths[0]==='string'&&bundlePattern.test(paths[0])?paths[0]:null;
}
async function text(response:Response,max:number,signal:AbortSignal):Promise<string>{
 if(!response.ok||!response.body||Number(response.headers.get('content-length'))>max){void response.body?.cancel().catch(()=>{});throw Error('update-response');}
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0,done=false;
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 try{
  for(;;){if(signal.aborted)throw Error('aborted');const r=await reader.read();if(signal.aborted)throw Error('aborted');if(r.done){done=true;break;}size+=r.value.length;if(size>max)throw Error('update-size');parts.push(r.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 }finally{signal.removeEventListener('abort',cancel);if(!done)cancel();try{reader.releaseLock();}catch{/* Original read may still settle. */}}
}
export type UpdateState='checking'|'current'|'available'|'unavailable';
export type UpdateTarget={entry:string;bundle:string};
type DownloadStatus='checking'|'updating'|'idle'|'fallback';
interface DownloadUpdate {
 target?:UpdateTarget;
 current:()=>boolean;
 remember:(target:UpdateTarget)=>()=>void;
 discard:(target:UpdateTarget)=>void;
 finish:(allowed:boolean)=>void;
 deadline:number;
 timer:ReturnType<typeof setTimeout>;
}
interface UpdateHost {
 origin:string;bundle:string;fetcher:typeof fetch;
 ready:(manual:boolean,download?:boolean)=>boolean;prepare:(manual:boolean)=>Promise<boolean>;
 settled?:()=>boolean;
 downloadStatus?:(value:DownloadStatus)=>void;
 cancelNavigation?:()=>void;
 enter:()=>()=>void;navigate:(entry:string)=>void;reload:()=>void;pending:(value:boolean)=>void;
 state?:(value:UpdateState)=>void;manualPending?:(value:boolean)=>void;
 session?:Pick<Storage,'getItem'|'setItem'>;
 now?:()=>number;quietMs?:number;timeoutMs?:number;downloadTimeoutMs?:number;
}
/** New page/hashed assets, without skipWaiting or changing another tab's reader.
 * The installed worker keeps its ordinary lifetime until its clients close. */
export function createAutomaticUpdater(host:UpdateHost){
 const now=host.now??Date.now,quiet=host.quietMs??3000;
 let candidate:UpdateTarget|null=null,idleAt:number|null=null,lastEntry:string|null=null,manual=false;
 let stopped=false,navigating=false;
 let applying:object|null=null;
 let checking:Promise<UpdateTarget|null>|null=null;
 let download:DownloadUpdate|null=null;
 let downloadEpoch=0;
 let clearIntent:(()=>void)|undefined;
 let abort:AbortController|null=null,watchdog:ReturnType<typeof setTimeout>|undefined,release:(()=>void)|null=null;
 const ready=()=>{try{return !stopped&&host.ready(manual||!!download,!!download);}catch{return false;}};
 const reset=()=>{idleAt=null;};
 const attempted=new Set<string>();
 const deferred=new Set<string>();
 function canApply(entry:string){
  try{return !attempted.has(entry)&&host.session?.getItem(attemptKey(entry))!=='1';}
  catch{return false;}
 }
 function recordAttempt(entry:string){
  if(!canApply(entry))return false;
  attempted.add(entry);
  try{host.session?.setItem(attemptKey(entry),'1');return true;}catch{return false;}
 }
 function leave(){
  finishDownload(false);
  if(manual){manual=false;host.manualPending?.(false);}
  clearIntent=undefined; // The destination still needs the handoff.
  clearTimeout(watchdog);release?.();release=null;navigating=false;
 }
 function stop(){stopped=true;abort?.abort();leave();}
 function finishDownload(allowed:boolean,status:DownloadStatus='idle'){
  const request=download;
  if(!request)return;
  download=null;clearTimeout(request.timer);
  request.finish(allowed);host.downloadStatus?.(status);
 }
 function abandonDownload(request:DownloadUpdate,continueDownload:boolean){
  if(download!==request)return;
  if(request.target){
   deferred.add(request.target.entry);
   request.discard(request.target);
   host.pending(false);
  }else{
   if(candidate){deferred.add(candidate.entry);host.pending(false);}
   abort?.abort();
  }
  clearIntent?.();clearIntent=undefined;
  if(navigating){
   try{host.cancelNavigation?.();}catch{/* Release local admission even if navigation could not be stopped. */}
   release?.();release=null;navigating=false;
  }
  applying=null;reset();
  const allowed=continueDownload&&request.current();
  finishDownload(allowed,allowed?'fallback':'idle');
 }
 function cancelDownload(){if(download)abandonDownload(download,false);}
 function check(){
  if(checking)return Promise.resolve(null);
  return probe();
 }
 function probe(timeout=host.timeoutMs??10000):Promise<UpdateTarget|null>{
  if(stopped||navigating||applying&&!download||download?.target)return Promise.resolve(null);
  if(checking)return checking;
  const controller=new AbortController();abort=controller;
  host.state?.('checking');
  const timer=setTimeout(()=>controller.abort(),timeout);
  const expired=new Promise<null>(resolve=>controller.signal.addEventListener('abort',()=>{if(!stopped)host.state?.('unavailable');resolve(null);},{once:true}));
  const work=inspect(controller.signal);
  const result=Promise.race([work,expired]).finally(()=>{
   clearTimeout(timer);if(abort===controller)abort=null;if(checking===result)checking=null;
  });
  checking=result;
  return result;
 }
 async function inspect(signal:AbortSignal):Promise<UpdateTarget|null>{
  try{
   const options:RequestInit={signal,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'};
   const pointer=await host.fetcher(new URL('/latest.json',host.origin),{...options,redirect:'error'});
   const entry=updateEntry(JSON.parse(await text(pointer,1024,signal)));if(!entry)throw Error('update-pointer');if(signal.aborted||stopped)return null;
   // Entries are immutable. Poll only the small static pointer after this entry
   // was inspected, rather than invoking the HTML Worker every minute.
   if(entry===lastEntry){host.state?.(candidate?'available':'current');return candidate;}
   // Fetch as inert text; Cloudflare may canonicalize .html to an extensionless
   // URL. A redirect is acceptable only within this exact same-origin entry.
   const response=await host.fetcher(new URL(entry,host.origin),{...options,redirect:'follow'});
   if(response.url){const u=new URL(response.url);if(u.origin!==host.origin||![entry,entry.slice(0,-5)].includes(u.pathname)||u.search||u.hash)throw Error('update-entry');}
   const bundle=entryBundle(await text(response,65536,signal));if(!bundle)throw Error('update-bundle');if(signal.aborted||stopped)return null;
   lastEntry=entry;
   if(bundle===host.bundle){candidate=null;reset();host.pending(false);host.state?.('current');return null;}
   if(candidate?.entry!==entry){candidate={entry,bundle};reset();host.pending(canApply(entry)&&!deferred.has(entry));}
   host.state?.('available');
   return candidate;
  }catch{if(!stopped&&!signal.aborted)host.state?.('unavailable');return null;}
 }
 async function initialCheck(){
  const target=await probe(Math.min(3000,host.timeoutMs??3000));
  // Readiness is checked before and after persistence, even at startup.
  if(target&&!download&&!manual&&ready())await tick(true);
 }
 function beforeDownload(current:()=>boolean,remember:(target:UpdateTarget)=>()=>void,discard:(target:UpdateTarget)=>void=()=>{}):Promise<boolean>{
  if(stopped||download||navigating||!current())return Promise.resolve(false);
  downloadEpoch++;
  return new Promise(resolve=>{
   const duration=host.downloadTimeoutMs??10000;
   const request:DownloadUpdate={current,remember,discard,finish:resolve,deadline:now()+duration,
    timer:setTimeout(()=>abandonDownload(request,true),duration)};
   download=request;
   if(manual){manual=false;host.manualPending?.(false);}
   host.downloadStatus?.('checking');
   void checkDownload(request);
  });
 }
 async function checkDownload(request:NonNullable<typeof download>){
  const timeout=Math.min(3000,host.timeoutMs??3000);
  let timer:ReturnType<typeof setTimeout>|undefined;
  const target=await Promise.race([probe(timeout),new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),timeout);})]);
  clearTimeout(timer);
  if(stopped||download!==request)return;
  if(!request.current()){finishDownload(false);return;}
  if(!target){finishDownload(true);return;}
  request.target=target;
  if(!canApply(target.entry)||now()>=request.deadline){abandonDownload(request,true);return;}
  host.downloadStatus?.('updating');
  void tick();
 }
 async function tick(immediate=false){
  if(stopped||checking||applying||navigating)return;
  if(download&&!download.current()){abandonDownload(download,false);return;}
  if(download&&!download.target||!candidate&&!manual&&!download)return;
  const selected=download?.target??candidate;
  const request=download;
  if(!ready()||!manual&&!request&&selected&&(!canApply(selected.entry)||deferred.has(selected.entry))){reset();return;}
  if(!manual&&!request&&!immediate){if(idleAt===null){idleAt=now();return;}if(now()-idleAt<quiet)return;}
  const attempt={};applying=attempt;
  try{await apply(selected,request,downloadEpoch);}finally{if(applying===attempt)applying=null;}
 }
 async function apply(selected:UpdateTarget|null,request:typeof download,epoch:number){
  try{
   if(!await host.prepare(manual||!!request)||request!==download||epoch!==downloadEpoch||(!request&&selected!==candidate)||
    !ready()||host.settled?.()===false||request&&!request.current()){reset();return;}
   if(request&&now()>=request.deadline){abandonDownload(request,true);return;}
   if(request&&selected)clearIntent=request.remember(selected);
   if((!manual||request)&&selected&&!recordAttempt(selected.entry)){
    if(request)abandonDownload(request,true);
    else host.pending(false);
    return;
   }
   // The final synchronous guard and admission fence precede navigation.
   release=host.enter();navigating=true;
   if(!request)watchdog=setTimeout(failedNavigation,15000);
   const target=selected?.entry??lastEntry;
   if(target)host.navigate(target);else host.reload();
  }catch{
   if(request){
    if(request===download)abandonDownload(request,true);
   }else if(epoch===downloadEpoch){clearTimeout(watchdog);failedNavigation();}
  }
 }
 function failedNavigation(){
  clearIntent?.();clearIntent=undefined;release?.();release=null;navigating=false;manual=false;candidate=null;lastEntry=null;reset();
  host.manualPending?.(false);host.pending(false);host.state?.('unavailable');
 }
 function reload(){if(stopped||navigating||manual||download)return;manual=true;host.manualPending?.(true);reset();void check();}
 return {check,initialCheck,beforeDownload,cancelDownload,leave,tick,reset,stop,reload};
}
export function runningBundle(){
 const script=document.querySelector<HTMLScriptElement>('script[type="module"][src]');
 return script?new URL(script.src).pathname:'';
}
export function startAutomaticUpdates(host:Omit<UpdateHost,'origin'|'bundle'|'fetcher'|'navigate'|'reload'>) {
 const bundle=runningBundle();if(!bundlePattern.test(bundle))return {reload:()=>location.reload(),dispose:()=>{},beforeDownload:async()=>true,cancelDownload:()=>{}}; // Development is not a deployed release.
 const core=createAutomaticUpdater({...host,origin:location.origin,bundle,fetcher:(...args)=>fetch(...args),navigate:entry=>location.replace(entry),cancelNavigation:()=>window.stop(),reload:()=>location.reload(),
  session:{getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value)}});
 let lastCheck=-Infinity,initial=true;
 const check=()=>{
  if(document.visibilityState!=='visible'||navigator.onLine===false||Date.now()-lastCheck<15000)return;
  lastCheck=Date.now();
  if(initial){initial=false;void core.initialCheck();}
  else void core.check();
 };
 const tick=()=>{if(document.visibilityState!=='visible'||navigator.onLine===false){core.reset();return;}void core.tick();};
 const poll=setInterval(check,60000),idle=setInterval(tick,1000);
 check();
 const visible=()=>{core.reset();check();};
 const interaction=()=>core.reset();
 const pagehide=(event:PageTransitionEvent)=>{if(!event.persisted)dispose();else {core.leave();core.reset();}};
 function dispose(){clearInterval(poll);clearInterval(idle);core.stop();document.removeEventListener('visibilitychange',visible);document.removeEventListener('pointerdown',interaction,true);document.removeEventListener('keydown',interaction,true);window.removeEventListener('focus',check);window.removeEventListener('online',check);window.removeEventListener('pagehide',pagehide);window.removeEventListener('pageshow',visible);}
 document.addEventListener('visibilitychange',visible);document.addEventListener('pointerdown',interaction,true);document.addEventListener('keydown',interaction,true);window.addEventListener('focus',check);window.addEventListener('online',check);window.addEventListener('pagehide',pagehide);window.addEventListener('pageshow',visible);
 return {reload:core.reload,dispose,beforeDownload:core.beforeDownload,cancelDownload:core.cancelDownload};
}
