/** Optional prototype metadata relay. Static hosts retain direct provider access. */
interface RelayConfig {version:1;itunes:boolean;artwork:boolean}
const disabled:RelayConfig=Object.freeze({version:1,itunes:false,artwork:false});
const nativeFetch:typeof fetch=(...args)=>fetch(...args);
function cancelled(signal:AbortSignal|null|undefined){if(signal?.aborted)throw new DOMException('Consulta cancelada.','AbortError');}
async function withSignal<T>(work:Promise<T>,signal:AbortSignal|null|undefined):Promise<T>{
 cancelled(signal);if(!signal)return work;
 let abort!:()=>void;
 const stopped=new Promise<never>((_,reject)=>{abort=()=>reject(new DOMException('Consulta cancelada.','AbortError'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
 try{return await Promise.race([work,stopped]);}finally{signal.removeEventListener('abort',abort);}
}
export function createCatalogTransport(deps:{fetcher?:typeof fetch;origin?:string|null;capabilityTimeoutMs?:number}={}){
 const fetcher=deps.fetcher??nativeFetch;
 const origin=deps.origin===undefined?(typeof location==='undefined'?null:location.origin):deps.origin;
 const timeout=Math.max(1,Math.min(4000,deps.capabilityTimeoutMs??3000));
 let config:RelayConfig|null=origin?null:disabled,probe:Promise<RelayConfig>|null=null;
 function capabilities():Promise<RelayConfig>{
  if(config)return Promise.resolve(config);if(probe)return probe;
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  const expired=new Promise<RelayConfig>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(disabled);},timeout);});
  const load=(async():Promise<RelayConfig>=>{
   const response=await fetcher(new URL('/catalog-config.json',origin!).href,{signal:controller.signal,credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
   if(controller.signal.aborted||!response.ok||!response.body||Number(response.headers.get('content-length'))>1024){void response.body?.cancel().catch(()=>{});return disabled;}
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   const cancel=()=>{void reader.cancel().catch(()=>{});};controller.signal.addEventListener('abort',cancel,{once:true});
   try{while(true){const part=await reader.read();if(controller.signal.aborted)return disabled;if(part.done)break;size+=part.value.length;if(size>1024)return disabled;chunks.push(part.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as Record<string,unknown>;
    return value&&value.version===1&&typeof value.itunes==='boolean'&&typeof value.artwork==='boolean'?{version:1,itunes:value.itunes,artwork:value.artwork}:disabled;
   }finally{controller.signal.removeEventListener('abort',cancel);cancel();try{reader.releaseLock();}catch{/* A timed-out read may still settle. */}}
  })().catch(()=>disabled);
  probe=Promise.race([load,expired]).then(value=>{clearTimeout(timer);config=value;return value;});
  return probe;
 }
 async function request(url:string,init:RequestInit={},direct:typeof fetch=fetcher):Promise<Response>{
  cancelled(init.signal);const address=new URL(url);
  const itunes=address.protocol==='https:'&&address.hostname==='itunes.apple.com'&&!address.port&&!address.username&&!address.password&&['/search','/lookup'].includes(address.pathname);
  const artwork=address.protocol==='https:'&&/^is[1-5]-ssl\.mzstatic\.com$/.test(address.hostname)&&!address.port&&!address.username&&!address.password;
  if(!origin||!itunes&&!artwork||init.method&&init.method!=='GET')return direct(url,init);
  const mode=await withSignal(capabilities(),init.signal);cancelled(init.signal);
  if(itunes&&!mode.itunes||artwork&&!mode.artwork)return direct(url,init);
  const target=itunes?new URL('/catalog/itunes'+address.pathname+address.search,origin):new URL('/catalog/artwork?'+new URLSearchParams({u:address.href}),origin);
  return direct(target.href,{...init,headers:{Accept:itunes?'application/json':'image/png,image/jpeg,image/webp'},credentials:'same-origin',redirect:'error',referrerPolicy:'no-referrer'});
 }
 return {fetch:request,mode:():'unresolved'|'relay'|'direct'=>config===null?'unresolved':config.itunes?'relay':'direct'};
}
const transport=createCatalogTransport();
export const catalogFetch=transport.fetch;
export const catalogTransportMode=transport.mode;
