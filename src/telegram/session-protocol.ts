import {classifyTelegramFailure} from './rpc-failure';
/** Worker-owned authentication. No session export, generic RPC or local-library authority. */
import {parseAccountBinding,type AccountBinding,type SourceRow} from './sources-protocol';
import {parseSaved} from './sources-bridge-protocol';
import {record,uuid} from './auth-protocol';
import {parseBotRows,type BotProviderRow} from './bot-providers-protocol';
import {parseQrLoginChallenge,type QrLoginChallenge} from './qr-login-protocol';
export const sessionPhases=['disconnected','restoring','sending-code','code','qr','password','authorizing','connected','disconnecting','error'] as const;
export const sessionErrors=['configuration','api-invalid','api-restricted','phone-invalid','code-invalid','code-expired','qr-expired','password-invalid','rate-limit','network','unsupported','cancelled','timeout','protocol','logout-unconfirmed','logout-storage-unconfirmed','session-storage','session-expired','internal'] as const;
export type SessionPhase=typeof sessionPhases[number];
export type SessionError=typeof sessionErrors[number];
export type Delivery='app'|'sms'|'call'|'email';
export interface CodeResend {readonly delivery:'sms'|'call';readonly availableAt:number}
export interface SessionState {phase:SessionPhase;error:SessionError|null;retryAt:number|null;delivery:Delivery|null;codeResend?:CodeResend|null}
export interface SessionCommand {version:2;session:string;request:string;type:'begin'|'qr-begin'|'qr-check'|'restore'|'forget'|'code'|'resend'|'password'|'logout';value:string}
export interface SessionReply {version:2;session:string;request:string;phase:SessionPhase;error:SessionError|null;retryAt:number|null;delivery:Delivery|null;binding:AccountBinding|null;saved:SourceRow|null;bots?:readonly BotProviderRow[];codeResend?:CodeResend|null;qr?:QrLoginChallenge}
export const initialSessionState=():SessionState=>({phase:'disconnected',error:null,retryAt:null,delivery:null});
export function parseSessionCommand(value:unknown):SessionCommand|null {
 try{
  if(!record(value,['version','session','request','type','value'])||value.version!==2||!uuid(value.session)||!uuid(value.request)||typeof value.value!=='string')return null;
  const type=value.type;
  if(!['begin','qr-begin','qr-check','restore','forget','code','resend','password','logout'].includes(type as string))return null;
  if(type==='begin'&&!/^\+[1-9][0-9]{5,14}$/.test(value.value))return null;
  if(type==='code'&&!/^[0-9]{1,12}$/.test(value.value))return null;
  if(type==='password'&&(!value.value.length||value.value.length>1024))return null;
  if(['logout','qr-begin','qr-check','restore','forget','resend'].includes(type as string)&&value.value!=='')return null;
  return {version:2,session:value.session,request:value.request,type:type as SessionCommand['type'],value:value.value};
 }catch{return null;}
}
export function parseSessionReply(value:unknown,session:string,request:string):SessionReply|null {
 try{
  if(!record(value,['version','session','request','phase','error','retryAt','delivery','binding','saved','bots','codeResend','qr'],['version','session','request','phase','error','retryAt','delivery','binding','saved'])||value.version!==2||value.session!==session||value.request!==request||!sessionPhases.includes(value.phase as SessionPhase)||!(value.error===null||sessionErrors.includes(value.error as SessionError))||!(value.retryAt===null||typeof value.retryAt==='number'&&Number.isSafeInteger(value.retryAt)&&value.retryAt>=0&&value.retryAt<=8640000000000000)||!(value.delivery===null||['app','sms','call','email'].includes(value.delivery as string)))return null;
  const qr=value.qr===undefined?null:parseQrLoginChallenge(value.qr);
  if(value.phase==='qr'?!qr||value.delivery!==null:value.qr!==undefined)return null;
  const resend=value.codeResend;
  if(resend!==undefined&&resend!==null&&(!record(resend,['delivery','availableAt'])||!['sms','call'].includes(resend.delivery as string)||typeof resend.availableAt!=='number'||!Number.isSafeInteger(resend.availableAt)||resend.availableAt<0||resend.availableAt>8640000000000000||value.phase!=='code'))return null;
  if((value.phase==='connected'||value.phase==='disconnected')&&value.error!==null)return null;
  if((value.phase==='connected'||value.phase==='disconnected')&&(value.retryAt!==null||value.delivery!==null)||value.phase==='error'&&value.error===null)return null;
  if(['restoring','sending-code','authorizing','disconnecting'].includes(value.phase as string))return null;
  const binding=parseAccountBinding(value.binding),saved=parseSaved(value.saved),bots=value.bots===undefined?undefined:parseBotRows(value.bots);
  if(bots===null||value.phase!=='connected'&&bots!==undefined)return null;
  if(value.phase==='connected'?(!binding||!saved):(value.binding!==null||value.saved!==null))return null;
  return {version:2,session,request,binding,saved,...(bots===undefined?{}:{bots}),...(qr?{qr}:{}),...(resend===undefined?{}:{codeResend:resend===null?null:Object.freeze({delivery:resend.delivery as CodeResend['delivery'],availableAt:resend.availableAt as number})}),phase:value.phase as SessionPhase,error:value.error as SessionError|null,retryAt:value.retryAt as number|null,delivery:value.delivery as Delivery|null};
 }catch{return null;}
}
/** SDK error names are examined defensively and never emitted verbatim. */
export function sessionFailure(error:unknown):{error:SessionError;retryAt:number|null;passwordNeeded:boolean} {
 const {error:kind,retryAt}=classifyTelegramFailure(error);
 const errorCode=kind==='password-needed'?'internal':kind==='access'||kind==='invalid-peer'?'network':kind;
 return {error:errorCode,retryAt,passwordNeeded:kind==='password-needed'};
}
export const sessionErrorText:Record<SessionError,string>={
 configuration:'No se pudo cargar o validar la configuración de Telegram de esta instalación.',
 'api-invalid':'Telegram rechazó las claves API de esta instalación. El responsable de Pulso debe revisar su configuración.',
 'api-restricted':'Telegram ha restringido el identificador API de esta aplicación. No se ha confirmado el acceso a tu cuenta.',
 'phone-invalid':'Revisa el número y el prefijo internacional.',
 'code-invalid':'El código no es correcto. Puedes volver a escribirlo.',
 'qr-expired':'La autorización de Telegram caducó. Inicia un nuevo intento de conexión.',
 'code-expired':'El código ha caducado. Cancela e inicia un intento nuevo.',
 'password-invalid':'La contraseña de verificación en dos pasos no es correcta.',
 'rate-limit':'Telegram ha limitado los intentos. Espera antes de volver a enviar.',
 network:'No se pudo completar la conexión con Telegram.',
 unsupported:'Telegram solicita un flujo que esta versión aún no admite. Usa una cuenta existente; no se crean cuentas ni se contratan servicios.',
 cancelled:'Se detuvo la conexión en esta pestaña. Si Telegram llegó a autorizarla, puedes revisar y revocar la sesión en Telegram → Ajustes → Dispositivos.',
 timeout:'La operación no terminó a tiempo. Se detuvo la conexión local; revisa Dispositivos en Telegram si la autorización pudo completarse.',
 protocol:'No se pudo validar la respuesta de la conexión. Se cerró el acceso local.',
 'logout-unconfirmed':'Se cerró el acceso local, pero no se confirmó la revocación remota. Revisa Telegram → Ajustes → Dispositivos.',
 'logout-storage-unconfirmed':'No se confirmó el cierre ni la eliminación de la sesión guardada. Elimina la sesión guardada en Pulso y revisa Telegram → Ajustes → Dispositivos.',
 'session-storage':'No se pudo leer, guardar o eliminar la sesión de Telegram en este navegador. Comprueba el almacenamiento antes de volver a intentarlo.',
 'session-expired':'Telegram revocó o caducó la sesión guardada. Inicia sesión de nuevo.',
 internal:'No se pudo completar este paso de acceso.',
};
