const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export type SavedCandidate={digest:string;rowKey:string};
function copyCandidates(value:unknown):SavedCandidate[]|null{
 if(!Array.isArray(value)||value.length<1||value.length>2)return null;
 return value.every(item=>item&&digest(item.digest)&&digest(item.rowKey))?value.map(({digest,rowKey})=>({digest,rowKey})):null;
}
export type PendingDownload={kind:'network';index:number}|{kind:'save';index:number;operationId:string;attempts?:SavedCandidate[]};
export interface LibraryDownloadCheckpoint {
 id:string;trackIds:string[];cursor:number;pending:PendingDownload|null;telegramRetryAt?:number;
}
export function copyLibraryDownloadCheckpoint(value:unknown):LibraryDownloadCheckpoint|null{
 const row=value as LibraryDownloadCheckpoint|null;
 if(!row||!uuid(row.id)||!Array.isArray(row.trackIds)||!row.trackIds.length||row.trackIds.length>5000||
  !row.trackIds.every(uuid)||!Number.isInteger(row.cursor)||row.cursor<0||row.cursor>row.trackIds.length)return null;
 const {telegramRetryAt}=row;
 if(telegramRetryAt!==undefined&&(!Number.isSafeInteger(telegramRetryAt)||telegramRetryAt<=0||telegramRetryAt>8640000000000000))return null;
 const pending=row.pending;
 if(pending!==null&&(!pending||pending.index!==row.cursor||row.cursor>=row.trackIds.length||
  !(pending.kind==='network'||pending.kind==='save'&&uuid(pending.operationId))))return null;
 const attempts=pending?.kind==='save'&&pending.attempts!==undefined?copyCandidates(pending.attempts):undefined;
 if(attempts===null)return null;
 return {id:row.id,trackIds:[...row.trackIds],cursor:row.cursor,...(telegramRetryAt?{telegramRetryAt}:{}),pending:pending===null?null:pending.kind==='network'?
  {kind:'network',index:pending.index}:{kind:'save',index:pending.index,operationId:pending.operationId,...(attempts?{attempts}:{})}};
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

export type HeldDownload={kind:'network'}|{kind:'save';operationId:string;attempts?:SavedCandidate[]};
const heldKey=(accountId:string,trackId:string)=>'pulso:library-download-held:v1:'+accountId+':'+trackId;
export function readHeldLibraryDownload(accountId:string,trackId:string):HeldDownload|null{
 if(!uuid(accountId)||!uuid(trackId))return null;
 const raw=localStorage.getItem(heldKey(accountId,trackId));
 if(raw===null)return null;
 if(raw==='network')return {kind:'network'};
 if(!uuid(raw))throw Error('Invalid held library download');
 const extra=localStorage.getItem(heldKey(accountId,trackId)+':candidates');
 let attempts:SavedCandidate[]|null=null;
 if(extra&&extra.length<600)try{
  const detail=JSON.parse(extra);
  if(detail?.operationId===raw)attempts=copyCandidates(detail.attempts);
 }catch{/* Older receipts and unverifiable candidate details stay readable. */}
 return {kind:'save',operationId:raw,...(attempts?{attempts}:{})};
}
export function clearHeldLibraryDownload(accountId:string,trackId:string){
 if(uuid(accountId)&&uuid(trackId)){
  const key=heldKey(accountId,trackId);
  localStorage.removeItem(key);localStorage.removeItem(key+':candidates');
 }
}
export function discardLibraryDownloadCheckpoint(accountId:string,checkpoint:LibraryDownloadCheckpoint):boolean{
 if(readLibraryDownloadCheckpoint(accountId)?.id!==checkpoint.id)return false;
 const pending=checkpoint.pending;
 if(pending){
  const trackId=checkpoint.trackIds[pending.index];
  writeHeldLibraryDownload(accountId,trackId,pending);
 }
 writeLibraryDownloadCheckpoint(accountId,null);
 return true;
}

export function writeHeldLibraryDownload(accountId:string,trackId:string,pending:HeldDownload){
 if(!uuid(accountId)||!uuid(trackId)||pending.kind==='save'&&!uuid(pending.operationId))throw Error('Invalid held library download');
 const key=heldKey(accountId,trackId);
 if(pending.kind==='save'&&pending.attempts)localStorage.setItem(key+':candidates',JSON.stringify({operationId:pending.operationId,attempts:pending.attempts}));
 else localStorage.removeItem(key+':candidates');
 localStorage.setItem(key,pending.kind==='network'?'network':pending.operationId);
}
export function pendingLibraryTrack(accountId:string,trackId:string):HeldDownload|null{
 const batch=readLibraryDownloadCheckpoint(accountId),pending=batch?.pending;
 return pending&&batch.trackIds[pending.index]===trackId?pending:readHeldLibraryDownload(accountId,trackId);
}
export function sameHeldDownload(a:HeldDownload|null,b:HeldDownload|null):boolean{
 return a?.kind===b?.kind&&(a?.kind!=='save'||b?.kind==='save'&&a.operationId===b.operationId);
}
/** Release only the exact marker just reviewed. Keep the remaining batch and its cursor. */
export function releaseLibraryTrack(accountId:string,trackId:string,expected:HeldDownload|null):boolean{
 if(!sameHeldDownload(pendingLibraryTrack(accountId,trackId),expected))return false;
 const batch=readLibraryDownloadCheckpoint(accountId),pending=batch?.pending;
 if(batch&&pending&&batch.trackIds[pending.index]===trackId){
  // Preserve any distinct parked receipt for this track.
  if(sameHeldDownload(readHeldLibraryDownload(accountId,trackId),expected))clearHeldLibraryDownload(accountId,trackId);
  writeLibraryDownloadCheckpoint(accountId,{...batch,pending:null});
 }else clearHeldLibraryDownload(accountId,trackId);
 return true;
}
