/** Closed public DTO. Cooldown is account-wide even when cancellation won the first cause. */
import {dataRecord} from './sources-protocol';
import {parseBotSearchReply,type BotSearchCommand,type BotSearchReply} from './bot-search-protocol';
export interface BotSearchBridgeReply {
 readonly protocol:'pulso-bot-search';readonly version:1;readonly reply:BotSearchReply;
 readonly sessionClosed:boolean;readonly retryAt:number|null;readonly retryBlocked:boolean;
}
export function parseBotSearchBridgeReply(raw:unknown,command:BotSearchCommand):BotSearchBridgeReply|null {
 try{
  const r=dataRecord(raw,['protocol','version','reply','sessionClosed','retryAt','retryBlocked']);
  if(!r||r.protocol!=='pulso-bot-search'||r.version!==1||typeof r.sessionClosed!=='boolean'||typeof r.retryBlocked!=='boolean'||r.retryAt!==null&&(typeof r.retryAt!=='number'||!Number.isSafeInteger(r.retryAt)||r.retryAt<=0||r.retryAt>8640000000000000))return null;
  const reply=parseBotSearchReply(r.reply,command);if(!reply)return null;
  if(command.type==='bot-search.cancel'){
   if(reply.type!=='bot-search.cancelled'||reply.targetRequestId!==command.targetRequestId)return null;
  }else if(reply.type==='bot-search.cancelled')return null;
  if(reply.type==='bot-search.sending'&&r.sessionClosed)return null;
  if(reply.type==='bot-search.result'&&JSON.stringify(reply.expectedTarget)!==JSON.stringify(command.type==='bot-search.search'?command.target??null:null))return null;
  return Object.freeze({protocol:'pulso-bot-search',version:1,reply,sessionClosed:r.sessionClosed,retryAt:r.retryAt as number|null,retryBlocked:r.retryBlocked});
 }catch{return null;}
}
