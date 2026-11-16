export interface AccountUser { readonly id:string; readonly name:string; readonly email:string; readonly verified:boolean }
export interface AccountProvider {
 session():Promise<AccountUser|null>;
 signIn(email:string,password:string):Promise<void>;
 signUp(name:string,email:string,password:string):Promise<void>;
 google():Promise<void>;
 signOut():Promise<void>;
 requestReset(email:string):Promise<void>;
 reset(token:string,password:string):Promise<void>;
 verify(email:string,code:string):Promise<void>;
 resend(email:string):Promise<void>;
}
export type AccountStatus='initial'|'checking'|'disabled'|'signed-out'|'signed-in'|'unavailable';
export interface AccountState {readonly status:AccountStatus;readonly pending:boolean;readonly google:boolean;readonly user:AccountUser|null;readonly error:string|null}
export class AccountFailure extends Error {constructor(readonly code:string){super(code);}}
export function accountError(error:unknown):string {
 // Neon throws HTTP errors as well as returning {error}; its nested .error
 // retains the original Better Auth code. Never use either raw message.
 const record=error&&typeof error==='object'?error as {code?:unknown;error?:{code?:unknown}}:null;
 const value=error instanceof AccountFailure?error.code:record?.error?.code??record?.code;
 const code=typeof value==='string'&&value.length<=80?value.toUpperCase():'';
 if(['INVALID_EMAIL_OR_PASSWORD','INVALID_PASSWORD','USER_NOT_FOUND','INVALID_CREDENTIALS'].includes(code))return 'El correo o la contraseña no son correctos.';
 if(code==='EMAIL_NOT_VERIFIED')return 'Verifica tu correo antes de iniciar sesión.';
 if(code==='USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'||code==='USER_ALREADY_EXISTS')return 'No se pudo crear la cuenta con ese correo. Prueba iniciar sesión o recuperar tu contraseña.';
 if(code==='TOO_MANY_REQUESTS'||code==='TOO_MANY_ATTEMPTS')return 'Hay demasiados intentos. Espera unos minutos antes de volver a intentarlo.';
 if(code==='INVALID_TOKEN'||code==='TOKEN_EXPIRED')return 'El enlace ya no es válido. Solicita otro para recuperar tu contraseña.';
 if(code==='INVALID_OTP')return 'El código no es válido o ha caducado.';
 if(code==='DISABLED')return 'El acceso a cuentas todavía no está habilitado.';
 return 'No pudimos completar la conexión. Comprueba tu conexión e inténtalo de nuevo.';
}
export interface AccountHost {config():Promise<{enabled:boolean;google:boolean}>;provider():Promise<AccountProvider>}
/** Only public profile data lives here. Passwords, codes and tokens are never
 * persisted, logged or passed to the music/Telegram controllers. */
export function createAccountController(host:AccountHost){
 let state:AccountState={status:'initial',pending:false,google:false,user:null,error:null};
 let generation=0,provider:AccountProvider|null=null,loading:Promise<void>|null=null;
 const listeners=new Set<()=>void>();
 const publish=(next:AccountState)=>{state=next;for(const fn of listeners)fn();};
 async function load(){
  if(state.pending)return;
  if(loading)return loading;
  const attempt=++generation;publish({...state,status:'checking',pending:true,error:null});
  loading=(async()=>{try{
   const config=await host.config();if(attempt!==generation)return;
   if(!config.enabled){publish({status:'disabled',pending:false,google:false,user:null,error:null});return;}
   provider??=await host.provider();const user=await provider.session();if(attempt!==generation)return;
   publish({status:user?'signed-in':'signed-out',pending:false,google:config.google,user,error:null});
  }catch(error){if(attempt===generation)publish({...state,status:'unavailable',pending:false,error:accountError(error)});}
  finally{loading=null;}})();await loading;
 }
 async function perform(action:(p:AccountProvider)=>Promise<void>,refresh=false):Promise<boolean>{
  if(!provider||state.pending||!['signed-in','signed-out'].includes(state.status))return false;
  const attempt=++generation;publish({...state,pending:true,error:null});
  try{await action(provider);const user=refresh?await provider.session():state.user;if(attempt!==generation)return false;
   publish({...state,status:user?'signed-in':'signed-out',user,pending:false});return true;
  }catch(error){if(attempt===generation)publish({...state,pending:false,error:accountError(error)});return false;}
 }
 return {
  getSnapshot:()=>state,
  subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
  load,
  signIn:(email:string,password:string)=>perform(p=>p.signIn(email,password),true),
  signUp:(name:string,email:string,password:string)=>perform(p=>p.signUp(name,email,password),true),
  google:()=>state.google?perform(p=>p.google()):Promise.resolve(false),
  signOut:()=>perform(p=>p.signOut(),true),
  requestReset:(email:string)=>perform(p=>p.requestReset(email)),
  reset:(token:string,password:string)=>perform(p=>p.reset(token,password)),
  verify:(email:string,code:string)=>perform(p=>p.verify(email,code),true),
  resend:(email:string)=>perform(p=>p.resend(email)),
 };
}
