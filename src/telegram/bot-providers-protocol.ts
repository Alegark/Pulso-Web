import {dataArray,dataRecord,isUuid,parseAccountBinding,sourceName,utf8Bytes,type AccountBinding} from './sources-protocol';
export const BOT_PROVIDERS_BOUNDS=Object.freeze({selected:5,offers:64,commandIds:256,dtoBytes:16384,inputChars:128,timeoutMs:15000,settlementMs:2000});
export interface BotEnvelope extends AccountBinding {readonly protocol:'pulso-bot-providers';readonly version:1;readonly sessionId:string;readonly providerRevision:number;readonly operationId:string;readonly requestId:string}
export interface BotProviderRow {readonly providerRef:string;readonly username:string;readonly label:string;readonly status:'verified-profile';readonly compatibility:'unverified'}
export interface BotProvidersSnapshot {readonly revision:number;readonly providers:readonly BotProviderRow[]}
export type BotProvidersCommand=
 |(BotEnvelope&{readonly type:'bots.validate';readonly input:string})
 |(BotEnvelope&{readonly type:'bots.setOrder';readonly expectedRevision:number;readonly providerRefs:readonly string[]})
 |(BotEnvelope&{readonly type:'bots.cancel';readonly targetRequestId:string});
export type BotProvidersError='cancelled'|'timeout'|'busy'|'expired'|'session-expired'|'limit'|'unsupported'|'identity-changed'|'rate-limit'|'network';
export type BotProvidersReply=
 |(BotEnvelope&{readonly type:'bots.validated';readonly offer:BotProviderRow})
 |(BotEnvelope&{readonly type:'bots.ordered';readonly revision:number;readonly changed:boolean;readonly providers:readonly BotProviderRow[]})
 |(BotEnvelope&{readonly type:'bots.cancelled';readonly targetRequestId:string})
 |(BotEnvelope&{readonly type:'bots.error';readonly error:BotProvidersError;readonly retryAt:number|null;readonly retryBlocked:boolean});
const revision=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
/** Lexical admission only: collectible aliases may be short. resolveUsername proves existence,
 * active username and bot flag; neither a minimum five characters nor an ends-bot test does.
 * Exact ASCII URL grammar intentionally avoids URL parser host/percent/backslash aliases. */
export function parseBotUsername(input:unknown):string|null {
 if(typeof input!=='string'||input.length>BOT_PROVIDERS_BOUNDS.inputChars)return null;
 const match=/^(?:@|https:\/\/t\.me\/)?([A-Za-z][A-Za-z0-9_]{0,31})$/.exec(input);
 return match?match[1].toLowerCase():null;
}
const keys=['protocol','version','sessionId','accountRef','accountEpoch','providerRevision','operationId','requestId'] as const;
export function copyBotEnvelope(e:BotEnvelope):BotEnvelope {return Object.freeze({protocol:'pulso-bot-providers',version:1,sessionId:e.sessionId,accountRef:e.accountRef,accountEpoch:e.accountEpoch,providerRevision:e.providerRevision,operationId:e.operationId,requestId:e.requestId});}
function envelope(r:Record<string,unknown>):BotEnvelope|null {
 const b=parseAccountBinding({accountRef:r.accountRef,accountEpoch:r.accountEpoch});
 return b&&r.protocol==='pulso-bot-providers'&&r.version===1&&isUuid(r.sessionId)&&revision(r.providerRevision)&&isUuid(r.operationId)&&isUuid(r.requestId)?copyBotEnvelope(r as unknown as BotEnvelope):null;
}
function row(v:unknown):BotProviderRow|null {
 const r=dataRecord(v,['providerRef','username','label','status','compatibility']);
 return r&&isUuid(r.providerRef)&&parseBotUsername(r.username)===r.username&&typeof r.label==='string'&&r.label.length<=320&&utf8Bytes(r.label)<=640&&sourceName(r.label)===r.label&&r.status==='verified-profile'&&r.compatibility==='unverified'?Object.freeze({providerRef:r.providerRef,username:r.username as string,label:r.label,status:'verified-profile',compatibility:'unverified'}):null;
}
export function copyBotRow(r:BotProviderRow):BotProviderRow {return Object.freeze({providerRef:r.providerRef,username:r.username,label:r.label,status:'verified-profile',compatibility:'unverified'});}
export function parseBotRows(v:unknown):readonly BotProviderRow[]|null {
 const a=dataArray(v,5);if(!a)return null;const r=a.map(row);
 return r.every((x):x is BotProviderRow=>x!==null)&&new Set(r.map(x=>x.providerRef)).size===r.length&&new Set(r.map(x=>x.username)).size===r.length?Object.freeze(r):null;
}
/** Requires structured-clone input. Reflect can reject throwing proxies, but cannot bound time
 * or prevent side effects inside an in-process Proxy trap. Never invokes getters/toJSON. */
export function parseBotProvidersCommand(raw:unknown):BotProvidersCommand|null {
 try{
  const r=dataRecord(raw);if(!r)return null;const e=envelope(r);if(!e)return null;let extra:string[],out:BotProvidersCommand;
  switch(r.type){
   case 'bots.validate':if(!parseBotUsername(r.input))return null;extra=['input'];out={...e,type:'bots.validate',input:r.input as string};break;
   case 'bots.setOrder':{const a=dataArray(r.providerRefs,5);if(!revision(r.expectedRevision)||r.expectedRevision!==e.providerRevision||!a||!a.every(isUuid)||new Set(a).size!==a.length)return null;extra=['expectedRevision','providerRefs'];out={...e,type:'bots.setOrder',expectedRevision:r.expectedRevision,providerRefs:Object.freeze(a.slice())};break;}
   case 'bots.cancel':if(!isUuid(r.targetRequestId))return null;extra=['targetRequestId'];out={...e,type:'bots.cancel',targetRequestId:r.targetRequestId};break;
   default:return null;
  }
  return dataRecord(raw,[...keys,'type',...extra])&&utf8Bytes(JSON.stringify(out))<=BOT_PROVIDERS_BOUNDS.dtoBytes?Object.freeze(out):null;
 }catch{return null;}
}
export function parseBotProvidersReply(raw:unknown,expected:BotEnvelope):BotProvidersReply|null {
 try{
  const r=dataRecord(raw);if(!r)return null;const e=envelope(r);if(!e||keys.some(k=>e[k]!==expected[k]))return null;let extra:string[],out:BotProvidersReply;
  switch(r.type){
   case 'bots.validated':{const offer=row(r.offer);if(!offer)return null;extra=['offer'];out={...e,type:'bots.validated',offer};break;}
   case 'bots.ordered':{const providers=parseBotRows(r.providers);if(!providers||!revision(r.revision)||typeof r.changed!=='boolean'||r.revision!==e.providerRevision+(r.changed?1:0))return null;extra=['revision','changed','providers'];out={...e,type:'bots.ordered',revision:r.revision,changed:r.changed,providers};break;}
   case 'bots.cancelled':if(!isUuid(r.targetRequestId))return null;extra=['targetRequestId'];out={...e,type:'bots.cancelled',targetRequestId:r.targetRequestId};break;
   case 'bots.error':if(!['cancelled','timeout','busy','expired','session-expired','limit','unsupported','identity-changed','rate-limit','network'].includes(r.error as string)||r.retryAt!==null&&(!revision(r.retryAt)||r.retryAt===0)||typeof r.retryBlocked!=='boolean')return null;extra=['error','retryAt','retryBlocked'];out={...e,type:'bots.error',error:r.error as BotProvidersError,retryAt:r.retryAt as number|null,retryBlocked:r.retryBlocked};break;
   default:return null;
  }
  return dataRecord(raw,[...keys,'type',...extra])&&utf8Bytes(JSON.stringify(out))<=BOT_PROVIDERS_BOUNDS.dtoBytes?Object.freeze(out):null;
 }catch{return null;}
}
