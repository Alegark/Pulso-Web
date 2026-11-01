import {readRecord} from '../storage/database';
import {openAssetReader} from '../storage/asset-reader';
import {validAsset,type LocalAsset} from '../library/library';
import {AppFailure,atBoundary,fail,issuedFailure,makeFailure} from '../errors/app-failure';
export const MAX_BLOB_ASSET=8*1024*1024;
export const MAX_BLOB_QUEUE=24*1024*1024;
import {copySourceAsset,sameSourceAsset,copySourceIds,sourceProof,type PreparedLocalSource,type PreparedLocalSources} from './local-source-protocol';
export function validateBlobBudget(assets:LocalAsset[]) {
 if(assets.some(asset=>!validAsset(asset)))fail('validate','internal','input-invalid','none');
 if(assets.some(asset=>asset.bytes>MAX_BLOB_ASSET)||assets.reduce((size,asset)=>size+asset.bytes,0)>MAX_BLOB_QUEUE)fail('admit','internal','limit-exceeded','none');
}
export async function prepareBoundedBlobSources(assetIds:string[],ownerProof:string,current:()=>boolean=()=>true):Promise<PreparedLocalSources> {
 const check=()=>{
 let active:boolean;
 try{active=current();}catch(error){const guard=issuedFailure(error);throw guard&&(guard.code==='cancelled'||guard.code==='owner-unavailable')?error:AppFailure.create(makeFailure('transport','internal','unknown','none'));}
 if(!active)fail('transport','internal','owner-unavailable','none');
 };check();
 const ids=copySourceIds(assetIds);if(!ids||!sourceProof(ownerProof))fail('validate','internal','input-invalid','none');
 assetIds=ids;
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
 assets.push(asset);
 }
 validateBlobBudget(assets);const urls:string[]=[];const sources:PreparedLocalSource[]=[];
 try{
 for(const asset of assets){
 check();const reader=await openAssetReader(asset);
 try{
 check();const actual=copySourceAsset(await atBoundary('read','idb',()=>readRecord<unknown>('assets',asset.id)));check();if(!actual||!sameSourceAsset(actual,asset))fail('read','integrity','asset-changed','idb');
 const chunks:Uint8Array[]=[];
 const result=await reader.verifyDetailed(true,{check,onChunk:chunk=>{chunks.push(chunk);}});check();
 if(result.state!=='valid')throw AppFailure.create(result.failure);
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
 check();sources.push(Object.freeze({url:urls[urls.length-1],protection:'pinned',asset:snapshot}));
 }finally{reader.release();}
 }
 await checkOwner();check();let released=false;return Object.freeze({sources:Object.freeze(sources),release:async()=>{if(released)return;released=true;releaseBlobSources(urls);}});
 }catch(error){releaseBlobSources(urls);throw error;}
}
export function releaseBlobSources(urls:string[]){for(const url of urls)if(url.startsWith('blob:'))try{URL.revokeObjectURL(url);}catch{/* Best effort per own URL; preserve the original failure and continue. */}}

/** Legacy wrapper owns the returned URLs as before. */
export async function boundedBlobSources(assetIds:string[],ownerProof:string,current:()=>boolean=()=>true):Promise<string[]> {
 return (await prepareBoundedBlobSources(assetIds,ownerProof,current)).sources.map(source=>source.url);
}
