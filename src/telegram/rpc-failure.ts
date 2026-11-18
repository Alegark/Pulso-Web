import type {SessionError} from './session-protocol';

type ErrorKind=SessionError|'password-needed'|'invalid-peer'|'access';
interface RpcFailure {error:ErrorKind;retryAt:number|null;retryBlocked:boolean}
const failure=(error:ErrorKind):RpcFailure=>({error,retryAt:null,retryBlocked:false});
const kinds:readonly [RegExp,ErrorKind][]=[
 [/SESSION_PASSWORD_NEEDED/,'password-needed'],
 [/session-expired|\b(?:AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED(?:_BAN)?)\b/,'session-expired'],
 [/^(CHANNEL_PRIVATE|CHAT_FORBIDDEN|USER_BANNED_IN_CHANNEL|CHAT_ADMIN_REQUIRED)$/,'access'],
 [/^(USERNAME_INVALID|USERNAME_NOT_OCCUPIED|PEER_ID_INVALID)$/,'invalid-peer'],
 [/qr-expired/,'qr-expired'],[/session-storage/,'session-storage'],[/PHONE_NUMBER_INVALID/,'phone-invalid'],
 [/PHONE_CODE_INVALID|PHONE_CODE_EMPTY/,'code-invalid'],[/PHONE_CODE_EXPIRED|PHONE_CODE_HASH/,'code-expired'],
 [/PASSWORD_HASH_INVALID/,'password-invalid'],[/API_ID_INVALID/,'api-invalid'],[/API_ID_PUBLISHED_FLOOD/,'api-restricted'],
 [/configuration/,'configuration'],[/SIGN_UP_REQUIRED|AUTH_RESTART|EMAIL_|Payment|payment|unsupported|PHONE_NUMBER_BANNED/,'unsupported'],
 [/Abort|cancelled/,'cancelled'],[/timeout|timed out/i,'timeout'],
];

/** Own data fields only. Never forward raw SDK text or execute an error accessor. */
export function classifyTelegramFailure(error:unknown,now=Date.now()):RpcFailure {
 try{
  if(!error||typeof error!=='object')return failure('network');
  const field=(key:string):unknown=>Object.getOwnPropertyDescriptor(error,key)?.value;
  for(const key of ['text','errorMessage','message']){
   const value=field(key);if(typeof value!=='string'||value.length>512)continue;
   if(/FLOOD_(?:PREMIUM_)?WAIT|Too Many Requests/i.test(value)){
    const match=/FLOOD_(?:PREMIUM_)?WAIT_(\d+)/i.exec(value),seconds=match?Number(match[1]):field('seconds');
    const until=typeof seconds==='number'&&Number.isSafeInteger(seconds)&&seconds>=0?now+Math.max(1,seconds)*1000:NaN;
    const retryAt=Number.isSafeInteger(until)&&until>now&&until<=8640000000000000?until:null;
    return {error:'rate-limit',retryAt,retryBlocked:retryAt===null};
   }
   const kind=kinds.find(([pattern])=>pattern.test(value))?.[1];
   if(kind)return failure(kind);
  }
 }catch{/* An unrecognized or hostile error has no diagnostic authority. */}
 return failure('network');
}
