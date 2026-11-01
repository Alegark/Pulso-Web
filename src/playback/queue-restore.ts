import {verifiedAssetDetailed} from '../library/library';
import {AppFailure} from '../errors/app-failure';

export interface Snapshot {
 version:1;entries:{id:string;trackId:string}[];currentEntryId:string|null;position:number;
 repeat:'off'|'one'|'all';shuffleOrder:string[]|null;
}
export function normalizeSnapshot(value:unknown):{snapshot:Snapshot;warnings:string[]}|null {
 if(!value||typeof value!=='object')return null;
 const s=value as Record<string,unknown>;
 if(s.version!==1||!Array.isArray(s.entries)||s.entries.length>1000)return null;
 const entries:Snapshot['entries']=[];const ids=new Set<string>();
 for(const entry of s.entries){
  if(!entry||typeof entry!=='object'||Array.isArray(entry)||typeof entry.id!=='string'||typeof entry.trackId!=='string'||ids.has(entry.id))return null;
  entries.push({id:entry.id,trackId:entry.trackId});ids.add(entry.id);
 }
 if(s.currentEntryId!==null&&typeof s.currentEntryId!=='string')return null;
 const warnings:string[]=[];let shuffleOrder:string[]|null=null;
 if(s.shuffleOrder!==undefined&&s.shuffleOrder!==null){
  if(Array.isArray(s.shuffleOrder)&&s.shuffleOrder.length===entries.length&&new Set(s.shuffleOrder).size===entries.length&&s.shuffleOrder.every(id=>typeof id==='string'&&ids.has(id)))shuffleOrder=[...s.shuffleOrder];
  else warnings.push('El orden aleatorio guardado no era válido; se desactivó.');
 }
 return {snapshot:{version:1,entries,currentEntryId:s.currentEntryId as string|null,position:typeof s.position==='number'&&Number.isFinite(s.position)&&s.position>=0?s.position:0,repeat:s.repeat==='one'||s.repeat==='all'?s.repeat:'off',shuffleOrder},warnings};
}
export async function restoreAssetAvailable(id:string):Promise<boolean>{
 const result=await verifiedAssetDetailed(id,true);
 if(result.state==='unknown')throw AppFailure.create(result.failure);
 return result.state==='valid';
}
export async function planQueueRestore(snapshot:Snapshot,available:(trackId:string)=>Promise<boolean>):Promise<{snapshot:Snapshot;missing:number}>{
 const cache=new Map<string,boolean>();const entries:Snapshot['entries']=[];
 for(const entry of snapshot.entries){
  if(!cache.has(entry.trackId))cache.set(entry.trackId,await available(entry.trackId));
  if(cache.get(entry.trackId))entries.push({...entry});
 }
 const ids=new Set(entries.map(e=>e.id));const survives=snapshot.currentEntryId!==null&&ids.has(snapshot.currentEntryId);
 return {missing:snapshot.entries.length-entries.length,snapshot:{...snapshot,entries,currentEntryId:snapshot.currentEntryId===null?null:survives?snapshot.currentEntryId:entries[0]?.id??null,position:survives?snapshot.position:0,shuffleOrder:snapshot.shuffleOrder?.filter(id=>ids.has(id))??null}};
}
