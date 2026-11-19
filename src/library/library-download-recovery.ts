import {attachRestoredAccountTrack} from '../accounts/library-local';
import {WRITER_LOCK} from '../storage/asset-reader';
import {readRecord} from '../storage/database';
import {importOperation} from '../storage/import-operations';
import {verifiedAssetDetailed,type Track} from './library';

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
  if(!live()||source?.accountId!==accountId||source.assetId!==receipt.asset.id)return uncertain;
  const verified=await verifiedAssetDetailed(source.assetId,true);
  if(!live()||verified.state!=='valid'||verified.asset.sha256!==receipt.asset.sha256||verified.asset.bytes!==receipt.asset.bytes)return uncertain;
  const id=await attachRestoredAccountTrack(accountId,trackId,source.id,live,{assetId:source.assetId,revision:source.revision});
  return live()&&id===trackId?{state:'saved',trackId:id}:uncertain;
 }catch{return uncertain;}
}
