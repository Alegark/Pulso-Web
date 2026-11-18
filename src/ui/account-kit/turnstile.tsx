import {createContext,useContext,useEffect,useRef,useState} from 'react';
import type {useFetchOptions} from '@better-auth-ui/react';
import {AccountFailure} from '../../accounts/account-controller';

export const TurnstileSiteKey=createContext<string|undefined>(undefined);

type Action='sign-up'|'verify-email'|'password-reset';
type FetchOptions=ReturnType<typeof useFetchOptions>['fetchOptions'];
type Turnstile={
 ready(callback:()=>void):void;
 render(container:HTMLElement,options:{
  sitekey:string;action:Action;language:'es';size:'compact';
  'response-field':false;'refresh-expired':'auto';
  callback:(token:string)=>void;
  'expired-callback':()=>void;
  'timeout-callback':()=>void;
  'error-callback':()=>boolean;
 }):string;
 reset(id:string):void;
 remove(id:string):void;
};
const turnstileApi=()=>(window as Window&{turnstile?:Turnstile}).turnstile;
let loading:Promise<Turnstile>|undefined;
function loadTurnstile(){
 if(loading)return loading;
 loading=new Promise<Turnstile>((resolve,reject)=>{
  const script=document.createElement('script');
  script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  script.async=true;
  const timer=setTimeout(fail,10000);
  function fail(){
   clearTimeout(timer);
   script.remove();
   reject(new Error('Turnstile'));
  }
  script.onerror=fail;
  script.onload=()=>{
   const api=turnstileApi();
   if(!api){fail();return;}
   api.ready(()=>{clearTimeout(timer);resolve(api);});
  };
  document.head.append(script);
 }).catch(error=>{loading=undefined;throw error;});
 return loading;
}

export function useTurnstile(action:Action,needed=true){
 const siteKey=useContext(TurnstileSiteKey);
 const enabled=!!siteKey&&needed;
 const container=useRef<HTMLDivElement>(null);
 const widget=useRef<{api:Turnstile;id:string}|null>(null);
 const token=useRef('');
 const using=useRef(false);
 const [attempt,setAttempt]=useState(0);
 const [status,setStatus]=useState<'loading'|'ready'|'failed'|'expired'>('loading');

 useEffect(()=>{
  if(!siteKey||!needed||!container.current)return;
  let active=true;
  const element=container.current;
  const expired=()=>{if(active){token.current='';setStatus('expired');}};
  const failed=()=>{if(active){token.current='';setStatus('failed');}return true;};
  token.current='';
  setStatus('loading');
  void loadTurnstile().then(api=>{
   if(!active)return;
   const id=api.render(element,{
    sitekey:siteKey,action,language:'es',size:'compact','response-field':false,'refresh-expired':'auto',
    callback:value=>{if(active&&!using.current){token.current=value;setStatus('ready');}},
    'expired-callback':expired,'timeout-callback':expired,'error-callback':failed,
   });
   widget.current={api,id};
  }).catch(failed);
  return ()=>{
   active=false;
   token.current='';
   const current=widget.current;
   widget.current=null;
   if(current)current.api.remove(current.id);
  };
 },[siteKey,action,needed,attempt]);

 async function submit(options:FetchOptions,send:(options:FetchOptions)=>Promise<unknown>){
  if(!siteKey)return send(options);
  if(!token.current||using.current)throw new AccountFailure('TURNSTILE_REQUIRED');
  const value=token.current;
  token.current='';
  const current=widget.current;
  using.current=true;
  try{
   return await send({...options,headers:{...options?.headers,'X-Pulso-Turnstile':value}});
  }finally{
   using.current=false;
   if(current&&widget.current===current){
    setStatus('loading');
    current.api.reset(current.id);
   }
  }
 }

 return {ready:!enabled||status==='ready',submit,view:enabled&&<div className="account-turnstile">
  <div ref={container}/>
  <p role="status">{status==='failed'?'No pudimos cargar la verificación de seguridad.':status==='expired'?'La verificación caducó. Espera a que se renueve.':status==='ready'?'Verificación de seguridad completada.':'Completa la verificación de seguridad para continuar.'}</p>
  {(status==='failed'||status==='expired')&&<button type="button" onClick={()=>setAttempt(value=>value+1)}>Reintentar verificación</button>}
 </div>};
}
