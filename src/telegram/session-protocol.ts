/** Temporary authentication only. No session export, generic RPC or local-library authority. */
import {record,uuid} from './auth-protocol';
export const sessionPhases=['disconnected','sending-code','code','password','authorizing','connected','disconnecting','error'] as const;
export const sessionErrors=['configuration','api-invalid','api-restricted','phone-invalid','code-invalid','code-expired','password-invalid','rate-limit','network','unsupported','cancelled','timeout','protocol','logout-unconfirmed','internal'] as const;
export type SessionPhase=typeof sessionPhases[number];
export type SessionError=typeof sessionErrors[number];
export type Delivery='app'|'sms'|'call'|'email';
export interface SessionState {phase:SessionPhase;error:SessionError|null;retryAt:number|null;delivery:Delivery|null}
export interface SessionCommand {version:1;session:string;request:string;type:'begin'|'code'|'password'|'logout';value:string}
export interface SessionReply {version:1;session:string;request:string;phase:SessionPhase;error:SessionError|null;retryAt:number|null;delivery:Delivery|null}
export const initialSessionState=():SessionState=>({phase:'disconnected',error:null,retryAt:null,delivery:null});
export function parseSessionCommand(value:unknown):SessionCommand|null {
 try{
  if(!record(value,['version','session','request','type','value'])||value.version!==1||!uuid(value.session)||!uuid(value.request)||typeof value.value!=='string')return null;
  const type=value.type;
  if(!['begin','code','password','logout'].includes(type as string))return null;
  if(type==='begin'&&!/^\+[1-9][0-9]{5,14}$/.test(value.value))return null;
  if(type==='code'&&!/^[0-9]{1,12}$/.test(value.value))return null;
  if(type==='password'&&(!value.value.length||value.value.length>1024))return null;
  if(type==='logout'&&value.value!=='')return null;
  return {version:1,session:value.session,request:value.request,type:type as SessionCommand['type'],value:value.value};
 }catch{return null;}
}
export function parseSessionReply(value:unknown,session:string,request:string):SessionReply|null {
 try{
  if(!record(value,['version','session','request','phase','error','retryAt','delivery'])||value.version!==1||value.session!==session||value.request!==request||!sessionPhases.includes(value.phase as SessionPhase)||!(value.error===null||sessionErrors.includes(value.error as SessionError))||!(value.retryAt===null||typeof value.retryAt==='number'&&Number.isSafeInteger(value.retryAt)&&value.retryAt>=0&&value.retryAt<=8640000000000000)||!(value.delivery===null||['app','sms','call','email'].includes(value.delivery as string)))return null;
  if((value.phase==='connected'||value.phase==='disconnected')&&value.error!==null)return null;
  if(['sending-code','authorizing','disconnecting'].includes(value.phase as string))return null;
  return {version:1,session,request,phase:value.phase as SessionPhase,error:value.error as SessionError|null,retryAt:value.retryAt as number|null,delivery:value.delivery as Delivery|null};
 }catch{return null;}
}
/** SDK error names are examined defensively and never emitted verbatim. */
export function sessionFailure(error:unknown):{error:SessionError;retryAt:number|null;passwordNeeded:boolean} {
 let text='',seconds=0;
 try{const e=error as {errorMessage?:unknown;text?:unknown;message?:unknown;seconds?:unknown};for(const v of [e.errorMessage,e.text,e.message])if(typeof v==='string')text+=' '+v.slice(0,512);if(typeof e.seconds==='number'&&Number.isFinite(e.seconds))seconds=e.seconds;}catch{/* Hostile accessors cannot break cleanup. */}
 if(text.includes('SESSION_PASSWORD_NEEDED'))return {error:'internal',retryAt:null,passwordNeeded:true};
 if(/FLOOD_WAIT|FLOOD_PREMIUM_WAIT|Too Many Requests/i.test(text)){
  const match=/FLOOD_(?:PREMIUM_)?WAIT_(\d+)/.exec(text);if(match)seconds=Number(match[1]);
  return {error:'rate-limit',retryAt:seconds>0&&seconds<=86400?Date.now()+Math.ceil(seconds*1000):null,passwordNeeded:false};
 }
 const pairs:readonly [RegExp,SessionError][]=[[/PHONE_NUMBER_INVALID/,'phone-invalid'],[/PHONE_CODE_INVALID|PHONE_CODE_EMPTY/,'code-invalid'],[/PHONE_CODE_EXPIRED|PHONE_CODE_HASH/,'code-expired'],[/PASSWORD_HASH_INVALID/,'password-invalid'],[/API_ID_INVALID/,'api-invalid'],[/API_ID_PUBLISHED_FLOOD/,'api-restricted'],[/configuration/,'configuration'],[/SIGN_UP_REQUIRED|AUTH_RESTART|EMAIL_|Payment|payment|unsupported|PHONE_NUMBER_BANNED/,'unsupported'],[/Abort|cancelled/,'cancelled']];
 return {error:pairs.find(([pattern])=>pattern.test(text))?.[1]??'network',retryAt:null,passwordNeeded:false};
}
export const sessionErrorText:Record<SessionError,string>={
 configuration:'No se pudo cargar o validar la configuración de Telegram de esta instalación.',
 'api-invalid':'Telegram rechazó las claves API de esta instalación. El responsable de Pulso debe revisar su configuración.',
 'api-restricted':'Telegram ha restringido el identificador API de esta aplicación. No se ha confirmado el acceso a tu cuenta.',
 'phone-invalid':'Revisa el número y el prefijo internacional.',
 'code-invalid':'El código no es correcto. Puedes volver a escribirlo.',
 'code-expired':'El código ha caducado. Cancela e inicia un intento nuevo.',
 'password-invalid':'La contraseña de verificación en dos pasos no es correcta.',
 'rate-limit':'Telegram ha limitado los intentos. Espera antes de volver a enviar.',
 network:'No se pudo completar la conexión con Telegram.',
 unsupported:'Telegram solicita un flujo que esta versión aún no admite. Usa una cuenta existente; no se crean cuentas ni se contratan servicios.',
 cancelled:'Se detuvo la conexión en esta pestaña. Si Telegram llegó a autorizarla, puedes revisar y revocar la sesión en Telegram → Ajustes → Dispositivos.',
 timeout:'La operación no terminó a tiempo. Se detuvo la conexión local; revisa Dispositivos en Telegram si la autorización pudo completarse.',
 protocol:'No se pudo validar la respuesta de la conexión. Se cerró el acceso local.',
 'logout-unconfirmed':'Se cerró el acceso local, pero no se confirmó la revocación remota. Revisa Telegram → Ajustes → Dispositivos.',
 internal:'No se pudo completar este paso de acceso.',
};
