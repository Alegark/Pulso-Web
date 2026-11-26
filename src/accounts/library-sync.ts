import {RateLimited,rateLimitedMessage} from '../http/rate-limit.mjs';
import {readBoundedJson} from './bounded-body.mjs';
import {LibraryDocumentError,validateAccountLibrary,mergeAccountLibraries,type AccountLibraryDocument} from './library-document.mjs';
export interface AccountLibraryRemote {accountId:string;revision:number|null;document:AccountLibraryDocument}
export interface LibrarySyncHost {
 read(id:string,current:()=>boolean):Promise<{document:AccountLibraryDocument;base:AccountLibraryDocument}>;
 apply(id:string,sent:AccountLibraryDocument,cloud:AccountLibraryDocument,current:()=>boolean):Promise<boolean|void|{changed:boolean;needsSync:boolean}>;
 remote(id:string,signal:AbortSignal):Promise<AccountLibraryRemote>;
 save(id:string,revision:number|null,document:AccountLibraryDocument,signal:AbortSignal):Promise<AccountLibraryRemote>;
 ready():boolean;changed():void;
}
export class LibrarySyncConflict extends Error{}
class UnrecognizedLibrary extends Error{}
export const librarySyncMessage={idle:'Biblioteca guardada en este dispositivo.',syncing:'Sincronizando biblioteca…',saved:'Biblioteca sincronizada con tu cuenta.',pending:'Cambios guardados en este dispositivo. Se sincronizarán al recuperar la conexión.',conflict:'La biblioteca cambió en otro dispositivo. Pulsa Sincronizar para combinar los cambios.',unavailable:'No pudimos sincronizar. Tus datos locales se conservan.',rateLimited:rateLimitedMessage+' Tus cambios siguen guardados en este dispositivo.',tooLarge:'La biblioteca supera el límite de sincronización. Quita elementos de la biblioteca o de tus listas para volver a sincronizar.',invalid:'Algunos datos de la biblioteca no se pueden sincronizar. Tus cambios siguen guardados en este dispositivo.',reloadRequired:'Esta versión de Pulso no reconoce la biblioteca de tu cuenta. Recarga la app para volver a sincronizar.'};
const pollMs=20*60_000,debounceMs=700;
const offline=()=>typeof navigator!=='undefined'&&navigator.onLine===false;
const visible=()=>typeof document==='undefined'||document.visibilityState==='visible';

export function createLibrarySync(host:LibrarySyncHost){
 let account:string|null=null,epoch=0,run:Promise<void>|null=null,abort:AbortController|null=null;
 let timer:ReturnType<typeof setTimeout>|null=null,poll:ReturnType<typeof setInterval>|null=null;
 let queued=false,failures=0,retryAt=0;
 let status:keyof typeof librarySyncMessage='idle';const listeners=new Set<()=>void>();
 const publish=(s:keyof typeof librarySyncMessage)=>{status=s;for(const fn of listeners)fn();};
 const rejected=()=>status==='tooLarge'||status==='invalid';
 function clearTimer(){if(timer!==null)clearTimeout(timer);timer=null;}
 function schedule(delay=debounceMs){
  clearTimer();
  if(!account||run||rejected()||status==='reloadRequired'||!visible()||offline())return;
  timer=setTimeout(()=>{
   timer=null;
   if(!visible()||offline())return;
   if(host.ready())void sync();
   else schedule(5000);
  },Math.max(delay,retryAt-Date.now()));
 }
 async function sync(){
  if(run)return run;
  if(!account||rejected()||status==='reloadRequired'||!host.ready()||Date.now()<retryAt)return;
  if(offline()){publish('pending');return;}
  clearTimer();queued=false;
  const id=account,generation=epoch;abort=new AbortController();const signal=abort.signal;
  const sameAccount=()=>generation===epoch&&!signal.aborted;
  const current=()=>sameAccount()&&host.ready();publish('syncing');
  run=(async()=>{try{
   const {document:local,base}=await host.read(id,current);if(!current())return;
   const remote=await host.remote(id,signal);if(!current())return;if(remote.accountId!==id)throw Error('account');
   const merged=mergeAccountLibraries(base,local,remote.document);
   const next=JSON.stringify(merged)===JSON.stringify(remote.document)?remote:await host.save(id,remote.revision,merged,signal);
   if(!current())return;if(next.accountId!==id||JSON.stringify(next.document)!==JSON.stringify(merged))throw Error('response');
   const result=await host.apply(id,local,next.document,current);if(!current())return;
   failures=0;retryAt=0;publish('saved');if(typeof result==='object'&&result.needsSync)queued=true;if(typeof result==='object'?result.changed:result!==false)host.changed();
  }catch(error){
   if(!sameAccount())return;
   if(error instanceof UnrecognizedLibrary){
    publish('reloadRequired');
   }else if(error instanceof LibraryDocumentError){
    publish(error.code==='LIBRARY_TOO_LARGE'?'tooLarge':'invalid');
   }else if(error instanceof RateLimited){
    retryAt=Date.now()+error.retryAfterMs;publish('rateLimited');
   }else if(offline()){
    retryAt=0;publish('pending');
   }else{
    retryAt=Date.now()+Math.min(60_000*2**failures,pollMs);
    failures=Math.min(failures+1,5);
    publish(error instanceof LibrarySyncConflict?'conflict':'unavailable');
   }
  }})().finally(()=>{
   run=null;
   if(queued&&rejected())publish('idle');
   if(status==='syncing'){queued=true;publish('idle');}
   if(queued||retryAt!==0)schedule();
  });
  return run;
 }
 return {getSnapshot:()=>status,subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
  account(id:string|null){
   if(id===account)return;
   account=id;epoch++;abort?.abort();failures=0;retryAt=0;queued=id!==null;publish('idle');schedule();
  },
  changed(){if(!account)return;queued=true;if(rejected())publish('idle');schedule();},
  retry(){if(status==='conflict'||status==='unavailable')retryAt=0;return sync();},
  startPolling(){if(poll===null)poll=setInterval(()=>{if(visible())void sync();},pollMs);},
  sync,
  dispose(){account=null;epoch++;abort?.abort();clearTimer();if(poll!==null)clearInterval(poll);poll=null;listeners.clear();},
 };
}
export async function accountLibraryRequest(id:string,signal:AbortSignal,update?:{revision:number|null;document:AccountLibraryDocument},fetcher:typeof fetch=fetch):Promise<AccountLibraryRemote>{
 const abort=new AbortController(),stop=()=>abort.abort();signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();const timer=setTimeout(stop,18000);
 try{
  const response=await fetcher('/api/account-library',{method:update?'PUT':'GET',credentials:'same-origin',cache:'no-store',signal:abort.signal,headers:update?{'Content-Type':'application/json'}:undefined,body:update?JSON.stringify({accountId:id,...update}):undefined});
  if(response.status===429)throw new RateLimited(response);
  if(response.status===409)throw new LibrarySyncConflict();
  if(response.status===400||response.status===422){
   const problem=await readBoundedJson(response,1024,abort.signal) as {code?:unknown}|null;
   if(response.status===422&&problem?.code==='LIBRARY_UNRECOGNIZED')throw new UnrecognizedLibrary();
   if(response.status===400&&(problem?.code==='LIBRARY_TOO_LARGE'||problem?.code==='LIBRARY_INVALID'))throw new LibraryDocumentError('library-http',problem.code);
  }
  if(!response.ok)throw Error('library-http');
  const row=await readBoundedJson(response,2200000,abort.signal) as {accountId?:unknown;revision:number|null;document?:unknown}|null;
  if(!row||row.accountId!==id||row.revision!==null&&(!Number.isSafeInteger(row.revision)||row.revision<1))throw Error('response');
  try{return {accountId:id,revision:row.revision,document:validateAccountLibrary(row.document)};}
  catch(error){if(error instanceof LibraryDocumentError)throw new UnrecognizedLibrary();throw error;}
 }finally{clearTimeout(timer);signal.removeEventListener('abort',stop);}
}
