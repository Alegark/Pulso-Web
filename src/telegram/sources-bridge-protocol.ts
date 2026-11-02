/** Settlement-aware wrapper. Core DTOs remain unchanged and worker-private SDK data stays private. */
import {dataRecord,isUuid,parseSourcesReply,type Envelope,type SourceRow,type SourcesReply,type SourcesCommand} from './sources-protocol';
export interface SourcesBridgeReply {protocol:'pulso-sources';version:1;reply:SourcesReply;sessionClosed:boolean;saved:SourceRow|null}
export function parseSaved(raw:unknown):SourceRow|null {
 try{const r=dataRecord(raw,['peerRef','kind','name']);return r&&isUuid(r.peerRef)&&r.kind==='saved'&&r.name==='Mensajes guardados'?Object.freeze({peerRef:r.peerRef,kind:'saved',name:'Mensajes guardados'}):null;}catch{return null;}
}
export function parseSourcesBridgeReply(raw:unknown,command:SourcesCommand):SourcesBridgeReply|null {
 try{
  const r=dataRecord(raw,['protocol','version','reply','sessionClosed','saved']);if(!r||r.protocol!=='pulso-sources'||r.version!==1||typeof r.sessionClosed!=='boolean')return null;
  const reply=parseSourcesReply(r.reply,command as Envelope),saved=parseSaved(r.saved);if(!reply||(r.sessionClosed?r.saved!==null:r.saved!==null&&!saved))return null;
  if(reply.type!=='sources.error'&&!(command.type==='sources.page'&&reply.type==='sources.page'&&command.folder===reply.folder||command.type==='sources.cancel'&&reply.type==='sources.cancelled'&&command.targetRequestId===reply.targetRequestId||command.type==='sources.select'&&reply.type==='sources.selected'&&command.peerRefs.length===reply.peerRefs.length&&command.peerRefs.every((v,i)=>v===reply.peerRefs[i])||command.type==='sources.clear'&&reply.type==='sources.cleared'))return null;
  if(!r.sessionClosed&&!saved&&(reply.type==='sources.selected'||reply.type==='sources.cleared'))return null;
  if(reply.type==='sources.page'&&!r.sessionClosed){if(!saved)return null;const rows=reply.items.filter(row=>row.kind==='saved');if(command.type!=='sources.page'||(command.cursor===null?(rows.length!==1||rows[0].peerRef!==saved!.peerRef):rows.length!==0))return null;}
  return {protocol:'pulso-sources',version:1,reply,sessionClosed:r.sessionClosed,saved};
 }catch{return null;}
}
