import {LibraryDocumentError,validateAccountLibrary,mergeAccountLibraries,type AccountLibraryDocument} from './library-document.mjs';
export interface AccountLibraryRemote {accountId:string;revision:number|null;document:AccountLibraryDocument}
export interface LibrarySyncHost {
 read(id:string,current:()=>boolean):Promise<{document:AccountLibraryDocument;base:AccountLibraryDocument}>;
 apply(id:string,sent:AccountLibraryDocument,cloud:AccountLibraryDocument,current:()=>boolean):Promise<void>;
 remote(id:string,signal:AbortSignal):Promise<AccountLibraryRemote>;
 save(id:string,revision:number|null,document:AccountLibraryDocument,signal:AbortSignal):Promise<AccountLibraryRemote>;
 ready():boolean;changed():void;
}
export class LibrarySyncConflict extends Error{}
export const librarySyncMessage={idle:'Biblioteca guardada en este dispositivo.',syncing:'Sincronizando biblioteca…',saved:'Biblioteca sincronizada con tu cuenta.',pending:'Cambios guardados en este dispositivo. Se sincronizarán al recuperar la conexión.',conflict:'La biblioteca cambió en otro dispositivo. Pulsa Sincronizar para combinar los cambios.',unavailable:'No pudimos sincronizar. Tus datos locales se conservan.',tooLarge:'La biblioteca supera el límite de sincronización. Quita elementos de la biblioteca o de tus listas para volver a sincronizar.',invalid:'Algunos datos de la biblioteca no se pueden sincronizar. Tus cambios siguen guardados en este dispositivo.'};
export function createLibrarySync(host:LibrarySyncHost){
 let account:string|null=null,epoch=0,run:Promise<void>|null=null,abort:AbortController|null=null,timer:ReturnType<typeof setTimeout>|null=null;
 let status:keyof typeof librarySyncMessage='idle';const listeners=new Set<()=>void>();
 const publish=(s:keyof typeof librarySyncMessage)=>{status=s;for(const fn of listeners)fn();};
 function schedule(){if(timer)clearTimeout(timer);timer=setTimeout(()=>{timer=null;void sync();},700);}
 async function sync(){
  if(run||!account||status==='tooLarge'||status==='invalid'||!host.ready())return;const id=account,generation=epoch;abort=new AbortController();const signal=abort.signal;
  const current=()=>id===account&&generation===epoch&&!signal.aborted&&host.ready();publish('syncing');
  run=(async()=>{try{
   const {document:local,base}=await host.read(id,current);if(!current())return;
   const remote=await host.remote(id,signal);if(!current())return;if(remote.accountId!==id)throw Error('account');
   const merged=mergeAccountLibraries(base,local,remote.document);
   const next=JSON.stringify(merged)===JSON.stringify(remote.document)?remote:await host.save(id,remote.revision,merged,signal);
   if(!current())return;if(next.accountId!==id||JSON.stringify(next.document)!==JSON.stringify(merged))throw Error('response');
   await host.apply(id,local,next.document,current);if(!current())return;
   publish('saved');host.changed();
  }catch(error){if(id===account&&generation===epoch&&!signal.aborted)publish(error instanceof LibraryDocumentError?error.code==='LIBRARY_TOO_LARGE'?'tooLarge':'invalid':error instanceof LibrarySyncConflict?'conflict':typeof navigator!=='undefined'&&navigator.onLine===false?'pending':'unavailable');}
  finally{run=null;if(id!==account&&account)schedule();}})();return run;
 }
 return {getSnapshot:()=>status,subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
  account(id:string|null){if(id===account)return;account=id;epoch++;abort?.abort();if(timer)clearTimeout(timer);timer=null;publish('idle');if(id)schedule();},
  changed(){if(!account)return;if(status==='tooLarge'||status==='invalid')publish('idle');schedule();},sync,
  dispose(){account=null;epoch++;abort?.abort();if(timer)clearTimeout(timer);timer=null;listeners.clear();},
 };
}
export async function accountLibraryRequest(id:string,signal:AbortSignal,update?:{revision:number|null;document:AccountLibraryDocument},fetcher:typeof fetch=fetch):Promise<AccountLibraryRemote>{
 const abort=new AbortController(),stop=()=>abort.abort();signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();const timer=setTimeout(stop,18000);
 try{
  const response=await fetcher('/api/account-library',{method:update?'PUT':'GET',credentials:'same-origin',cache:'no-store',signal:abort.signal,headers:update?{'Content-Type':'application/json'}:undefined,body:update?JSON.stringify({accountId:id,...update}):undefined});
  if(response.status===409)throw new LibrarySyncConflict();
  if(response.status===400){
   const problem=await readResponse(response,1024,abort.signal);
   if(problem?.code==='LIBRARY_TOO_LARGE'||problem?.code==='LIBRARY_INVALID')throw new LibraryDocumentError('library-http',problem.code);
  }
  if(!response.ok)throw Error('library-http');
  const row=await readResponse(response,2200000,abort.signal);
  if(row.accountId!==id||row.revision!==null&&(!Number.isSafeInteger(row.revision)||row.revision<1))throw Error('response');return {accountId:id,revision:row.revision,document:validateAccountLibrary(row.document)};
 }finally{clearTimeout(timer);signal.removeEventListener('abort',stop);}
}

async function readResponse(response:Response,max:number,signal:AbortSignal){
  const length=response.headers.get('Content-Length');if(length&&Number(length)>max)throw Error('limit');
  if(!response.body)throw Error('body');const reader=response.body.getReader(),parts:Uint8Array[]=[];let bytes=0;const stopReader=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',stopReader,{once:true});if(signal.aborted)stopReader();
  try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>max)throw Error('limit');parts.push(value);}}catch(e){void reader.cancel().catch(()=>{});throw e;}finally{signal.removeEventListener('abort',stopReader);reader.releaseLock();}if(signal.aborted)throw Error('aborted');
  const all=new Uint8Array(bytes);let offset=0;for(const p of parts){all.set(p,offset);offset+=p.length;}return JSON.parse(new TextDecoder().decode(all));
}
