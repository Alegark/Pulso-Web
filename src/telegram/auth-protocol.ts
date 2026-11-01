/** Offline v1 only. No SDK capability or arbitrary RPC crosses this boundary. */
export interface AuthScope { sessionSlotId:string; namespaceId:string|null; accountId:string|null; generation:string; ownerId:string }
export interface Envelope { version:1; requestId:string; operationId:string; scope:AuthScope }
export type AuthCommand = Envelope & ({type:'status'}|{type:'begin-phone';phone:string}|{type:'submit-code';code:string}|{type:'submit-password';password:string}|{type:'cancel';targetOperationId:string}|{type:'disconnect';mode:'local-only'|'remote-and-local'});
export const phases = ['disabled','disconnected','waiting-phone','connecting','waiting-code','waiting-password','ready','expired','cancelling','cancelled','disconnecting','failed'] as const;
export interface SafeAuthState { phase:typeof phases[number]; remote:'unavailable'|'offline'|'connecting'|'connected'; revocation:'not-requested'|'confirmed'|'unconfirmed'; localSession:'absent'|'present'|'cleanup-pending'; scope:AuthScope }
export const errorCodes = ['invalid','disabled','scope','operation','code-invalid','password-invalid','password-needed','expired','offline','rate-limit','unsupported','timeout','storage','cleanup','internal'] as const;
export const families = ['validation','auth-required','auth-expired','rate-limited','network','storage-unavailable','cleanup-uncertain','unsupported','cancelled','internal'] as const;
export interface SafeAuthError { family:typeof families[number]; code:typeof errorCodes[number]; retryAt?:number }
export type AuthReply = Envelope & ({type:'state';state:SafeAuthState}|{type:'error';error:SafeAuthError}|{type:'cancelled'});
export const uuid = (v:unknown):v is string => typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export const account = (v:unknown):v is string => typeof v==='string' && /^[1-9][0-9]{0,19}$/.test(v);
// Maximum 16 keys per object, depth <= 3, UTF-16 strings <= 1024.
// At most ~8 KiB UTF-8 including envelopes; no JSON stringify/sort of unknown input.
export function record(v:unknown, allowed:readonly string[], required:readonly string[]=allowed):v is Record<string,unknown> {
 if(!v || typeof v!=='object' || Array.isArray(v) || Object.getPrototypeOf(v)!==Object.prototype) return false;
 let n=0; for(const k in v){if(++n>16 || !allowed.includes(k))return false; const d=Object.getOwnPropertyDescriptor(v,k);if(!d || !('value' in d))return false;}
 // Check ordinary enumerable key budget first, before reflecting the full own-key shape.
 if(Object.getOwnPropertyNames(v).length!==n||Object.getOwnPropertySymbols(v).length) return false;
 return required.every(k=>Object.hasOwn(v,k));
}
export function parseScope(v:unknown):AuthScope|null {
 if(!record(v,['sessionSlotId','namespaceId','accountId','generation','ownerId']) || !uuid(v.sessionSlotId)||!uuid(v.ownerId)||!uuid(v.generation)||!(v.namespaceId===null||uuid(v.namespaceId))||!(v.accountId===null||account(v.accountId)) || ((v.accountId===null)!==(v.namespaceId===null)))return null;
 return {sessionSlotId:v.sessionSlotId,namespaceId:v.namespaceId,accountId:v.accountId,generation:v.generation,ownerId:v.ownerId};
}
export function sameScope(a:AuthScope,b:AuthScope):boolean {return a.sessionSlotId===b.sessionSlotId&&a.namespaceId===b.namespaceId&&a.accountId===b.accountId&&a.generation===b.generation&&a.ownerId===b.ownerId;}
const base=['version','requestId','operationId','scope','type'];
function envelope(v:Record<string,unknown>):Envelope|null {const scope=parseScope(v.scope);return v.version===1&&uuid(v.requestId)&&uuid(v.operationId)&&scope?{version:1,requestId:v.requestId,operationId:v.operationId,scope}:null;}
export function parseCommand(v:unknown):AuthCommand|null {
 if(!record(v,[...base,'phone','code','password','targetOperationId','mode'],base))return null;
 const e=envelope(v);if(!e)return null;
 const limits={'begin-phone':['phone',32],'submit-code':['code',64],'submit-password':['password',1024]} as const;
 if(v.type==='status'&&record(v,base))return {...e,type:'status'};
 if(v.type==='cancel'&&record(v,[...base,'targetOperationId'])&&uuid(v.targetOperationId))return {...e,type:'cancel',targetOperationId:v.targetOperationId};
 if(v.type==='disconnect'&&record(v,[...base,'mode'])&&(v.mode==='local-only'||v.mode==='remote-and-local'))return {...e,type:'disconnect',mode:v.mode};
 if(typeof v.type==='string'&&Object.hasOwn(limits,v.type)){
  const [key,max]=limits[v.type as keyof typeof limits],s=v[key];
  if(record(v,[...base,key])&&typeof s==='string'&&s.length>0&&s.length<=max){
   if(v.type==='begin-phone')return {...e,type:'begin-phone',phone:s};
   if(v.type==='submit-code')return {...e,type:'submit-code',code:s};
   return {...e,type:'submit-password',password:s};
  }
 }return null;
}
export function parseSafeError(v:unknown):SafeAuthError|null {
 if(!record(v,['family','code','retryAt'],['family','code'])||!families.includes(v.family as never)||!errorCodes.includes(v.code as never))return null;
 if(v.retryAt!==undefined&&(typeof v.retryAt!=='number'||!Number.isSafeInteger(v.retryAt)||v.retryAt<0||v.retryAt>8640000000000000))return null;
 return {family:v.family as SafeAuthError['family'],code:v.code as SafeAuthError['code'],...(v.retryAt===undefined?{}:{retryAt:v.retryAt as number})};
}
export function parseReply(v:unknown, expected:Envelope):AuthReply|null {
 if(!record(v,[...base,'state','error'],base))return null;
 const e=envelope(v);if(!e||e.requestId!==expected.requestId||e.operationId!==expected.operationId||!sameScope(e.scope,expected.scope))return null;
 if(v.type==='cancelled'&&record(v,base))return {...e,type:'cancelled'};
 if(v.type==='error'&&record(v,[...base,'error'])){const error=parseSafeError(v.error);return error?{...e,type:'error',error}:null;}
 const s=v.state;
 if(v.type!=='state'||!record(v,[...base,'state'])||!record(s,['phase','remote','revocation','localSession','scope']))return null;
 const scope=parseScope(s.scope);
 if(!scope||scope.ownerId!==e.scope.ownerId||scope.sessionSlotId!==e.scope.sessionSlotId||!phases.includes(s.phase as never)||!['unavailable','offline','connecting','connected'].includes(s.remote as string)||!['not-requested','confirmed','unconfirmed'].includes(s.revocation as string)||!['absent','present','cleanup-pending'].includes(s.localSession as string))return null;
 if(s.phase==='ready'&&(!scope.accountId||s.localSession!=='present'||s.remote!=='connected'))return null;
 return {...e,type:'state',state:{phase:s.phase as SafeAuthState['phase'],remote:s.remote as SafeAuthState['remote'],revocation:s.revocation as SafeAuthState['revocation'],localSession:s.localSession as SafeAuthState['localSession'],scope}};
}
