import {attachRestoredAccountTrack} from '../accounts/library-local';
import {issuedFailure} from '../errors/app-failure';
import {WRITER_LOCK} from '../storage/asset-reader';
import {admittedTransaction,closeDatabase,openDatabase,readRecord,request} from '../storage/database';
import {transactionDone} from '../storage/transaction-done';
import {importOperation,recoverImportOperation,terminal} from '../storage/import-operations';
import {validAudioFingerprint,verifiedAssetDetailed,type LocalAsset,type Track} from './library';

/** The receipt must belong to this account and its bytes must still verify
 * before binding them to the original playlist row. No Telegram operation. */
export async function reconcileLibraryDownload(accountId:string,operationId:string,trackId:string,signal:AbortSignal,current:()=>boolean):Promise<{state:'saved'|'missing'|'uncertain';trackId:string|null}>{
 const uncertain={state:'uncertain' as const,trackId:null},missing={state:'missing' as const,trackId:null};
 const live=()=>current()&&!signal.aborted;
 if(!live())return uncertain;
 try{
  const receipt=await navigator.locks.request(WRITER_LOCK,{signal},async()=>{
   if(!live())return null;
   const raw=await readRecord<unknown>('jobs',operationId);
   return raw===undefined?undefined:await importOperation(operationId)??null;
  });
  if(!live()||receipt===null||receipt&&receipt.accountId!==accountId)return uncertain;
  if(!receipt||receipt.state==='discarded')return missing;
  if(receipt.state!=='sealed'||receipt.libraryMode!=='cache'||!receipt.result||!receipt.asset)return uncertain;
  const target=await readRecord<Track>('tracks',trackId);
  if(!live()||target?.accountId!==accountId)return uncertain;
  const source=target.assetId===receipt.asset.id?target:await readRecord<Track>('tracks',receipt.result.track.id);
  if(!live()||source?.accountId!==accountId)return uncertain;
  if(source.assetId!==receipt.asset.id){
   return source.id===target.id&&source.assetId===null&&await readRecord('assets',receipt.asset.id)===undefined&&live()?missing:uncertain;
  }
  const verified=await verifiedAssetDetailed(source.assetId,true);
  if(live()&&verified.state==='missing')return missing;
  if(!live()||verified.state!=='valid'||verified.asset.sha256!==receipt.asset.sha256||verified.asset.bytes!==receipt.asset.bytes)return uncertain;
  const id=await attachRestoredAccountTrack(accountId,trackId,source.id,live,{assetId:source.assetId,revision:source.revision});
  return live()&&id===trackId?{state:'saved',trackId:id}:uncertain;
 }catch{return uncertain;}
}

export interface LibraryTrackDownloadReview {
 state:'saved'|'missing'|'uncertain'; settled:boolean; canPreserveRetry:boolean;
}
function matchesFingerprint(track:Track,asset:LocalAsset):boolean{
 return validAudioFingerprint(track.audioFingerprint)&&asset.sha256===track.audioFingerprint.sha256&&asset.bytes===track.audioFingerprint.bytes;
}
/** Preserve the asset and all other references. Recheck this account's exact
 * Track and the old copy under the import writer lock before unlinking it. */
async function unlinkUnusableCopy(track:Track&{assetId:string},signal:AbortSignal,live:()=>boolean,definiteOnly=false):Promise<boolean>{
 return navigator.locks.request(WRITER_LOCK,{signal},async()=>{
  if(!live())return false;
  const copy=await verifiedAssetDetailed(track.assetId,true);
  if(!live()||definiteOnly&&copy.state!=='missing'&&copy.state!=='corrupt'||copy.state==='valid'&&matchesFingerprint(track,copy.asset))return false;
  const db=await openDatabase();
  try{
   const tx=admittedTransaction(db,'tracks','readwrite'),done=transactionDone(tx),tracks=tx.objectStore('tracks');
   const current=await request<Track|undefined>(tracks.get(track.id));
   const same=live()&&current?.accountId===track.accountId&&current?.assetId===track.assetId&&current?.revision===track.revision;
   if(same)tracks.put({...current,assetId:null,revision:track.revision+1},track.id);
   await done;
   return same;
  }finally{closeDatabase(db);}
 });
}
/** Only a proven unusable link may be replaced automatically. Keep all bytes. */
export async function prepareBatchCopyReplacement(track:Track,accountId:string,signal:AbortSignal,current:()=>boolean){
 return track.accountId===accountId&&track.assetId!==null&&
  unlinkUnusableCopy({...track,assetId:track.assetId},signal,()=>current()&&!signal.aborted,true);
}
export async function inspectLibraryTrackDownload(accountId:string,trackId:string,operationId:string|undefined,signal:AbortSignal,current:()=>boolean,repair=false):Promise<LibraryTrackDownloadReview>{
 const live=()=>current()&&!signal.aborted,unknown={state:'uncertain' as const,settled:false,canPreserveRetry:false};
 try{
  if(!live())return unknown;
  const track=await readRecord<Track>('tracks',trackId);
  if(!live()||track?.id!==trackId||track.accountId!==accountId)return unknown;
  if(track.assetId!==null){
   const copy=await verifiedAssetDetailed(track.assetId,true);
   if(!live())return unknown;
   if(copy.state==='valid'&&matchesFingerprint(track,copy.asset)){
    const receipt=operationId?await reconcileLibraryDownload(accountId,operationId,trackId,signal,current):null;
    return live()?{state:'saved',settled:receipt?.state!=='uncertain',canPreserveRetry:false}:unknown;
   }
   const missing=copy.state==='missing'&&await readRecord('assets',track.assetId)===undefined;
   if(!live())return unknown;
   if(!repair){
    if(missing&&!operationId)return {state:'uncertain',settled:true,canPreserveRetry:true};
    return {...unknown,canPreserveRetry:true};
   }
   if(!await unlinkUnusableCopy({...track,assetId:track.assetId},signal,live))return unknown;
  }
  if(!operationId)return {state:'missing',settled:true,canPreserveRetry:true};
  const result=await reconcileLibraryDownload(accountId,operationId,trackId,signal,current);
  return {state:result.state,settled:result.state!=='uncertain',canPreserveRetry:result.state!=='saved'};
 }catch{return unknown;}
}

/** Recover exactly the cache operation recorded for this row. The storage
 * recovery transaction proves staging ownership and excludes published bytes. */
export async function repairBatchLibraryDownload(accountId:string,operationId:string,trackId:string,signal:AbortSignal,current:()=>boolean){
 const live=()=>current()&&!signal.aborted;
 const first=await reconcileLibraryDownload(accountId,operationId,trackId,signal,current);
 if(!live()||first.state!=='uncertain')return first;
 try{
  const track=await readRecord<Track>('tracks',trackId);
  const job=await importOperation(operationId);
  if(!live()||track?.accountId!==accountId||!job||job.accountId!==accountId||job.libraryMode!=='cache'||terminal(job))return first;
  if(job.asset&&job.track){
   try{await recoverImportOperation(operationId,job.revision,'resume',live);}
   catch(error){
    if(!live()||!['asset-missing','digest-mismatch','length-mismatch','local-corrupt'].includes(issuedFailure(error)?.code??''))return first;
   }
  }
  const pending=await importOperation(operationId);
  if(!live()||!pending||pending.accountId!==accountId||pending.libraryMode!=='cache')return first;
  if(!terminal(pending)){
   if(pending.result)return first;
   await recoverImportOperation(operationId,pending.revision,'discard',live);
  }
  return reconcileLibraryDownload(accountId,operationId,trackId,signal,current);
 }catch{return first;}
}
