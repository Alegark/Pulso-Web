import {AUDIO_FILE_MAX_BYTES,AUDIO_BLOB_TOTAL_MAX_BYTES} from '../storage/audio-limits';
import {claimBlobCredit} from './local-copy-protection';
import {readRecord} from '../storage/database';
import {openAssetReader} from '../storage/asset-reader';
import {validAsset,type LocalAsset} from '../library/library';
import {AppFailure,atBoundary,fail,issuedFailure,makeFailure} from '../errors/app-failure';
export const MAX_BLOB_ASSET=AUDIO_FILE_MAX_BYTES;
export const MAX_BLOB_QUEUE=AUDIO_BLOB_TOTAL_MAX_BYTES;
import {copySourceAsset,sameSourceAsset,copySourceIds,sourceProof,type PreparedLocalSource,type PreparedLocalSources,type BlobCredit,type SourceAllocation} from './local-source-protocol';
export function validateBlobBudget(assets:LocalAsset[]) {
 if(assets.some(asset=>!validAsset(asset)))fail('validate','internal','input-invalid','none');
 if(assets.some(asset=>asset.bytes>MAX_BLOB_ASSET)||assets.reduce((size,asset)=>size+asset.bytes,0)>MAX_BLOB_QUEUE)fail('admit','internal','limit-exceeded','none');
}
export type BlobPreparationControl={expected:readonly Readonly<LocalAsset>[];signal:AbortSignal;deadlineAt:number;credit:BlobCredit};
const cleanupFailures=new WeakSet<object>();
export const blobCleanupUncertain=(error:unknown)=>typeof error==='object'&&error!==null&&cleanupFailures.has(error);
const provenance=new WeakMap<PreparedLocalSources,Readonly<{allocations:readonly SourceAllocation[];current():boolean}>>();
/** Read-only attestation; callers cannot sign arbitrary bundles or allocation DTOs. */
export const blobSourceProvenance=(bundle:PreparedLocalSources)=>provenance.get(bundle)??null;
function issuedBlobBundle(sources:readonly PreparedLocalSource[],urls:readonly string[]):PreparedLocalSources {
 let released:Promise<void>|null=null;
 const bundle=Object.freeze({sources:Object.freeze([...sources]),release:()=>released??=(async()=>{
  // Strict cleanup for accounted bundles. A thrown revoke is not zero bytes.
  for(const url of urls)URL.revokeObjectURL(url);
 })()});
 const allocations=Object.freeze(sources.map((s,i)=>Object.freeze({sourceIndex:i,allocationId:s.url,kind:'blob' as const,bytes:s.protection==='pinned'?s.asset.bytes:0})));
 provenance.set(bundle,Object.freeze({allocations,current:()=>released===null}));return bundle;
}
export async function prepareBoundedBlobSources(assetIds:string[],ownerProof:string,current:()=>boolean=()=>true,control?:BlobPreparationControl):Promise<PreparedLocalSources> {
 let claim:ReturnType<typeof claimBlobCredit>=null;
 const check=()=>{
 if(control&&(control.signal.aborted||performance.now()>=control.deadlineAt))fail('transport','internal','cancelled','none');
 if(claim&&!claim.current())fail('transport','internal','owner-unavailable','none');
 let active:boolean;
 try{active=current();}catch(error){const guard=issuedFailure(error);throw guard&&(guard.code==='cancelled'||guard.code==='owner-unavailable')?error:AppFailure.create(makeFailure('transport','internal','unknown','none'));}
 if(!active)fail('transport','internal','owner-unavailable','none');
 };check();
 const ids=copySourceIds(assetIds);if(!ids||!sourceProof(ownerProof))fail('validate','internal','input-invalid','none');
 assetIds=ids;
 const fixed=control?control.expected.map(copySourceAsset):null;
 if(control&&(!fixed||fixed.length!==ids.length||fixed.some((a,i)=>!a||a.id!==ids[i])))fail('validate','internal','input-invalid','none');
 check();const locks=await atBoundary('transport','none',()=>navigator.locks.query());check();
 const proof=locks.held?.find(lock=>lock.name===ownerProof);
 const allowed=(held:typeof locks.held)=>!!proof&&!!held?.some(lock=>lock.name===ownerProof&&lock.clientId===proof.clientId)&&!!held?.some(lock=>lock.name==='pulso-web:local:playback'&&lock.clientId===proof.clientId);
 if(!allowed(locks.held))fail('transport','internal','owner-unavailable','none');
 const checkOwner=async()=>{check();const now=await atBoundary('transport','none',()=>navigator.locks.query());check();if(!allowed(now.held))fail('transport','internal','owner-unavailable','none');};
 const assets:LocalAsset[]=[];
 for(const id of assetIds){
 check();const record=await atBoundary('read','idb',()=>readRecord<unknown>('assets',id));check();
 if(record===undefined)fail('read','integrity','asset-missing','idb');
 const asset=copySourceAsset(record);
 if(!asset||asset.id!==id)fail('read','integrity','local-corrupt','idb');
 if(fixed&&!sameSourceAsset(asset,fixed[assets.length]!))fail('read','integrity','asset-changed','idb');
 assets.push(asset);
 }
 validateBlobBudget(assets);
 if(control){claim=claimBlobCredit(control.credit,assets);if(!claim)fail('admit','internal','limit-exceeded','none');}
 const urls:string[]=[];const sources:PreparedLocalSource[]=[];
 try{
 for(const asset of assets){
 check();const reader=await openAssetReader(asset,true,control?{signal:control.signal}:undefined);
 try{
 check();const actual=copySourceAsset(await atBoundary('read','idb',()=>readRecord<unknown>('assets',asset.id)));check();if(!actual||!sameSourceAsset(actual,asset))fail('read','integrity','asset-changed','idb');
 const chunks:Uint8Array[]=[];
 const result=await reader.verifyDetailed(true,{check,onChunk:chunk=>{chunks.push(chunk);}});check();
 if(result.state!=='valid')throw AppFailure.create(result.failure);
 const verified=copySourceAsset(await atBoundary('read','idb',()=>readRecord<unknown>('assets',asset.id)));check();if(!verified||!sameSourceAsset(verified,asset))fail('read','integrity','asset-changed','idb');
 await checkOwner();
 check();
 // Capture the exact reader manifest in the same verified pass, never a later lookup.
 const snapshot=copySourceAsset(reader.asset);if(!snapshot)fail('read','integrity','local-corrupt','idb');
 // Blob/URL failures belong to materialization, never to audio integrity.
 const blob=await atBoundary('transport','none',()=>new Blob(chunks as BlobPart[],{type:asset.mime}));check();
 await atBoundary('transport','none',()=>{
 check();const url=URL.createObjectURL(blob);urls.push(url);return url;
 });
 // Retain the URL before checking: even synchronous ownership loss in a
 // platform wrapper must revoke this attempt's URL.
 sources.push(Object.freeze({url:urls[urls.length-1],protection:'pinned',asset:snapshot}));check();
 }finally{reader.release();}
 }
 await checkOwner();check();const bundle=issuedBlobBundle(sources,urls);claim?.complete(bundle);return bundle;
 }catch(error){
  // Capture every owned URL, including one delivered during synchronous revoke.
  const failed=issuedBlobBundle(sources,urls);
  try{await failed.release();claim?.complete();}
  catch{claim?.complete(failed);if(typeof error==='object'&&error!==null)cleanupFailures.add(error);}
  throw error;
 }
}
export function releaseBlobSources(urls:string[]){for(const url of urls)if(url.startsWith('blob:'))try{URL.revokeObjectURL(url);}catch{/* Best effort per own URL; preserve the original failure and continue. */}}

/** Legacy wrapper owns the returned URLs as before. */
export async function boundedBlobSources(assetIds:string[],ownerProof:string,current:()=>boolean=()=>true):Promise<string[]> {
 return (await prepareBoundedBlobSources(assetIds,ownerProof,current)).sources.map(source=>source.url);
}
