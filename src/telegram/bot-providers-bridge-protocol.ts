/** Closed, settlement-aware bot transport. No SDK state or private snapshot capability. */
import {dataRecord} from './sources-protocol';
import {parseBotProvidersReply,type BotProvidersCommand,type BotProvidersReply} from './bot-providers-protocol';

export interface BotProvidersBridgeReply {
 readonly protocol:'pulso-bot-providers';
 readonly version:1;
 readonly reply:BotProvidersReply;
 readonly sessionClosed:boolean;
}

/** The caller supplies the original confirmed refs, captured before dispatch.
 * A shape-valid ordered reply is insufficient: variant, exact refs, CAS and no-op must agree.
 */
export function parseBotProvidersBridgeReply(raw:unknown,command:BotProvidersCommand,previousRefs:readonly string[]):BotProvidersBridgeReply|null {
 try{
  const r=dataRecord(raw,['protocol','version','reply','sessionClosed']);
  if(!r||r.protocol!=='pulso-bot-providers'||r.version!==1||typeof r.sessionClosed!=='boolean')return null;
  const reply=parseBotProvidersReply(r.reply,command);if(!reply)return null;
  if(reply.type==='bots.error')return {protocol:'pulso-bot-providers',version:1,reply,sessionClosed:r.sessionClosed};
  if(command.type==='bots.validate'&&reply.type==='bots.validated'||command.type==='bots.cancel'&&reply.type==='bots.cancelled'&&reply.targetRequestId===command.targetRequestId)return {protocol:'pulso-bot-providers',version:1,reply,sessionClosed:r.sessionClosed};
  if(command.type!=='bots.setOrder'||reply.type!=='bots.ordered'||command.expectedRevision!==command.providerRevision)return null;
  const changed=previousRefs.length!==command.providerRefs.length||previousRefs.some((ref,i)=>ref!==command.providerRefs[i]);
  if(reply.changed!==changed||reply.revision!==command.expectedRevision+(changed?1:0)||reply.providers.length!==command.providerRefs.length||reply.providers.some((row,i)=>row.providerRef!==command.providerRefs[i]))return null;
  return {protocol:'pulso-bot-providers',version:1,reply,sessionClosed:r.sessionClosed};
 }catch{return null;}
}
