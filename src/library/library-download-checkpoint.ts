const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export type PendingDownload={kind:'network';index:number}|{kind:'save';index:number;operationId:string};
export interface LibraryDownloadCheckpoint {
 id:string;trackIds:string[];cursor:number;pending:PendingDownload|null;
}
export function copyLibraryDownloadCheckpoint(value:unknown):LibraryDownloadCheckpoint|null{
 const row=value as LibraryDownloadCheckpoint|null;
 if(!row||!uuid(row.id)||!Array.isArray(row.trackIds)||!row.trackIds.length||row.trackIds.length>5000||
  !row.trackIds.every(uuid)||new Set(row.trackIds).size!==row.trackIds.length||!Number.isInteger(row.cursor)||row.cursor<0||row.cursor>row.trackIds.length)return null;
 const pending=row.pending;
 if(pending!==null&&(!pending||pending.index!==row.cursor||row.cursor>=row.trackIds.length||
  !(pending.kind==='network'||pending.kind==='save'&&uuid(pending.operationId))))return null;
 return {id:row.id,trackIds:[...row.trackIds],cursor:row.cursor,pending:pending===null?null:pending.kind==='network'?
  {kind:'network',index:pending.index}:{kind:'save',index:pending.index,operationId:pending.operationId}};
}
const key=(accountId:string)=>'pulso:library-download:v1:'+accountId;
export function readLibraryDownloadCheckpoint(accountId:string):LibraryDownloadCheckpoint|null{
 if(!uuid(accountId))return null;
 const raw=localStorage.getItem(key(accountId));
 if(raw===null)return null;
 if(raw.length>200000)throw Error('Invalid library download checkpoint');
 const checkpoint=copyLibraryDownloadCheckpoint(JSON.parse(raw));
 if(!checkpoint)throw Error('Invalid library download checkpoint');
 return checkpoint;
}
export function writeLibraryDownloadCheckpoint(accountId:string,checkpoint:LibraryDownloadCheckpoint|null){
 if(!uuid(accountId))throw Error('Invalid library account');
 if(checkpoint)localStorage.setItem(key(accountId),JSON.stringify(checkpoint));
 else localStorage.removeItem(key(accountId));
}

export type HeldDownload={kind:'network'}|{kind:'save';operationId:string};
const heldKey=(accountId:string,trackId:string)=>'pulso:library-download-held:v1:'+accountId+':'+trackId;
export function readHeldLibraryDownload(accountId:string,trackId:string):HeldDownload|null{
 if(!uuid(accountId)||!uuid(trackId))return null;
 const raw=localStorage.getItem(heldKey(accountId,trackId));
 if(raw===null)return null;
 if(raw==='network')return {kind:'network'};
 if(!uuid(raw))throw Error('Invalid held library download');
 return {kind:'save',operationId:raw};
}
export function clearHeldLibraryDownload(accountId:string,trackId:string){
 if(uuid(accountId)&&uuid(trackId))localStorage.removeItem(heldKey(accountId,trackId));
}
export function discardLibraryDownloadCheckpoint(accountId:string,checkpoint:LibraryDownloadCheckpoint):boolean{
 if(readLibraryDownloadCheckpoint(accountId)?.id!==checkpoint.id)return false;
 const pending=checkpoint.pending;
 if(pending){
  const trackId=checkpoint.trackIds[pending.index];
  localStorage.setItem(heldKey(accountId,trackId),pending.kind==='save'?pending.operationId:'network');
 }
 writeLibraryDownloadCheckpoint(accountId,null);
 return true;
}

export function writeHeldLibraryDownload(accountId:string,trackId:string,pending:HeldDownload){
 if(!uuid(accountId)||!uuid(trackId)||pending.kind==='save'&&!uuid(pending.operationId))throw Error('Invalid held library download');
 localStorage.setItem(heldKey(accountId,trackId),pending.kind==='network'?'network':pending.operationId);
}
export function pendingLibraryTrack(accountId:string,trackId:string):HeldDownload|null{
 const batch=readLibraryDownloadCheckpoint(accountId),pending=batch?.pending;
 return pending&&batch.trackIds[pending.index]===trackId?pending:readHeldLibraryDownload(accountId,trackId);
}
/** Release only the exact marker just reviewed. Keep the remaining batch and its cursor. */
export function releaseLibraryTrack(accountId:string,trackId:string,expected:HeldDownload|null):boolean{
 const same=(a:HeldDownload|null,b:HeldDownload|null)=>a?.kind===b?.kind&&
  (a?.kind!=='save'||b?.kind==='save'&&a.operationId===b.operationId);
 if(!same(pendingLibraryTrack(accountId,trackId),expected))return false;
 const batch=readLibraryDownloadCheckpoint(accountId),pending=batch?.pending;
 if(batch&&pending&&batch.trackIds[pending.index]===trackId){
  // Preserve any distinct parked receipt for this track.
  if(same(readHeldLibraryDownload(accountId,trackId),expected))clearHeldLibraryDownload(accountId,trackId);
  writeLibraryDownloadCheckpoint(accountId,{...batch,pending:null});
 }else clearHeldLibraryDownload(accountId,trackId);
 return true;
}
