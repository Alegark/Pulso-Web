import {validAsset,type LocalAsset} from '../library/library';
export const LOCAL_SOURCE_LIMIT=1000;
export const ASSET_FIELDS=['id','namespace','storageKey','bytes','sha256','mime','chunks','state','revision','chunkSize','retention','backend'] as const;
export type PreparedLocalSource={readonly url:string;readonly protection:'pinned';readonly asset:Readonly<LocalAsset>}|{readonly url:string;readonly protection:'unknown';readonly asset:null};
export interface PreparedLocalSources {readonly sources:readonly PreparedLocalSource[];/** Cleans only this bundle. New accounted producers reject unacknowledged cleanup; legacy wrappers may be best effort. Never certifies reader/data retraction. */release():Promise<void>}
export const sourceUUID=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
export const sourceProof=(value:unknown):value is string=>typeof value==='string'&&/^pulso-web:local:owner:[a-f0-9-]{36}$/.test(value);
export function dataObject(value:unknown):Record<string,unknown>|null {
 try{
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return null;
 const result:Record<string,unknown>={};
 for(const key of Reflect.ownKeys(value)){const field=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!field||!('value'in field))return null;Object.defineProperty(result,key,{value:field.value,enumerable:true});}
 return result;
 }catch{return null;}
}
export function closedObject(value:unknown,keys:readonly string[]):Record<string,unknown>|null {
 const m=dataObject(value);return m&&Object.keys(m).length===keys.length&&keys.every(key=>Object.hasOwn(m,key))?m:null;
}
export function copySourceAsset(value:unknown):LocalAsset|null {
 const m=closedObject(value,ASSET_FIELDS);return m&&ASSET_FIELDS.every(key=>['string','number'].includes(typeof m[key]))&&validAsset(m)?Object.freeze(m):null;
}
export function sameSourceAsset(a:LocalAsset,b:LocalAsset):boolean {return ASSET_FIELDS.every(key=>a[key]===b[key]);}
function sourceArray(value:unknown):unknown[]|null {
 try{
 if(!Array.isArray(value))return null;
 const size=Object.getOwnPropertyDescriptor(value,'length');if(!size||!('value'in size)||!Number.isSafeInteger(size.value)||size.value>LOCAL_SOURCE_LIMIT)return null;
 if(Reflect.ownKeys(value).length!==size.value+1)return null;
 const result:unknown[]=[];
 for(let i=0;i<size.value;i++){const field=Object.getOwnPropertyDescriptor(value,String(i));if(!field||!('value'in field))return null;result.push(field.value);}
 return result;
 }catch{return null;}
}
export function copySourceIds(value:unknown):string[]|null {
 const items=sourceArray(value);return items&&items.every(sourceUUID)?items:null;
}
export function copySourceTokens(value:unknown):string[]|null {
 const items=copySourceIds(value);return items&&new Set(items).size===items.length?items:null;
}
export function copySourceAssets(value:unknown):LocalAsset[]|null {
 const items=sourceArray(value);if(!items)return null;
 const result:LocalAsset[]=[];for(const item of items){const asset=copySourceAsset(item);if(!asset)return null;result.push(asset);}return result;
}
export type SourceCause='owner-unavailable'|'asset-changed'|'asset-missing'|'local-corrupt'|'storage-unavailable'|'worker-protocol';
export type PinnedRequest={version:1;type:'pinned-local-sources';requestId:string;ownerProof:string;expected:LocalAsset[];tokens:string[]};
export type ReleaseRequest={version:1;type:'release-local-sources';requestId:string;ownerProof:string;tokens:string[]};
export type SourceReply={version:1;type:'pinned-local-sources';requestId:string;tokens:string[];assets:LocalAsset[]}|{version:1;type:'release-local-sources';requestId:string;released:true}|{version:1;type:'pinned-local-sources'|'release-local-sources';requestId:string;status:403|409|503;cause:SourceCause;notice?:unknown};
export function copySourceRequest(value:unknown):PinnedRequest|ReleaseRequest|null {
 const data=dataObject(value);if(!data)return null;
 const m=closedObject(data,data.type==='pinned-local-sources'?['version','type','requestId','ownerProof','expected','tokens']:['version','type','requestId','ownerProof','tokens']);
 if(!m||m.version!==1||!sourceUUID(m.requestId)||!sourceProof(m.ownerProof))return null;
 const tokens=copySourceTokens(m.tokens);if(!tokens)return null;
 if(m.type==='release-local-sources')return {version:1,type:m.type,requestId:m.requestId,ownerProof:m.ownerProof,tokens};
 const expected=copySourceAssets(m.expected);
 return m.type==='pinned-local-sources'&&expected&&tokens.length===expected.length?{version:1,type:m.type,requestId:m.requestId,ownerProof:m.ownerProof,expected,tokens}:null;
}
export function copySourceReply(value:unknown,type:SourceReply['type'],requestId:string):SourceReply|null {
 const m=dataObject(value);if(!m||m.version!==1||m.type!==type||m.requestId!==requestId)return null;
 if(m.status!==undefined){
 const keys=Object.keys(m);if(keys.length!==(Object.hasOwn(m,'notice')?6:5)||keys.some(k=>!['version','type','requestId','status','cause','notice'].includes(k)))return null;
 const statuses:Record<SourceCause,number>={'owner-unavailable':403,'asset-changed':409,'asset-missing':409,'local-corrupt':409,'storage-unavailable':503,'worker-protocol':503};
 if(typeof m.cause!=='string'||!Object.hasOwn(statuses,m.cause)||statuses[m.cause as SourceCause]!==m.status)return null;
 return {version:1,type,requestId,status:m.status as 403|409|503,cause:m.cause as SourceCause,...(Object.hasOwn(m,'notice')?{notice:m.notice}:{})};
 }
 if(type==='release-local-sources')return closedObject(m,['version','type','requestId','released'])&&m.released===true?{version:1,type,requestId,released:true}:null;
 const tokens=copySourceTokens(m.tokens),assets=copySourceAssets(m.assets);
 return closedObject(m,['version','type','requestId','tokens','assets'])&&tokens&&assets&&tokens.length===assets.length?{version:1,type,requestId,tokens,assets}:null;
}

// Queue composition contracts. These types carry no authority when serialized.
import type {Entry} from './player';
import type {QueueStructure,InsertionRequest,InsertionPlan,InsertResult} from './queue-insertion';
import type {FailureV1} from '../errors/app-failure';
declare const bindingBrand:unique symbol;
declare const creditBrand:unique symbol;
export type SourceBinding=Readonly<{[bindingBrand]:true}>;
export type BlobCredit=Readonly<{[creditBrand]:true;current():boolean}>;
export type SourceAllocation=Readonly<{sourceIndex:number;allocationId:string;kind:'blob'|'sw';bytes:number}>;
export type NewSourceBundle=Readonly<{bundle:PreparedLocalSources;allocations:readonly SourceAllocation[]}>;
export type SourceRouting=Readonly<{
 bindings:readonly (SourceBinding|null)[];
 missing:readonly Readonly<LocalAsset>[];
 missingIndexByOccurrence:readonly (number|null)[];
}>;
export interface InsertionPlayer {
 readonly queueRevision:number;readonly queueEpoch:number;
 structure():QueueStructure;
 insertQueue(request:InsertionRequest,beforeEmit:(plan:InsertionPlan)=>boolean):InsertResult;
}
export type InsertionPreparation=Readonly<{
 setPlanned(trackIds:readonly string[]):boolean;
 reserveSources(expectedByOccurrence:readonly Readonly<LocalAsset>[]):SourceRouting;
 reserveBlob(expectedUnique:readonly Readonly<LocalAsset>[]):BlobCredit|null;
 stageNew(prepared:NewSourceBundle):boolean;
 getSources():readonly PreparedLocalSource[]|null;
 bindEntries(entries:readonly Entry[]):boolean;
 commitInsertion(request:InsertionRequest,player:InsertionPlayer):InsertResult;
 cancel():void;settle():Promise<void>;
}>;
export type SourcePreparationControl=Readonly<{
 signal:AbortSignal;current():boolean;deadlineAt:number;
 reserveBlob(expectedUnique:readonly Readonly<LocalAsset>[]):BlobCredit|null;
}>;
export type SourcePreparationResult=
 | {kind:'prepared';prepared:NewSourceBundle}
 | {kind:'failed';failure:FailureV1;resourceState:'settled'|'settling'|'uncertain'}
 | {kind:'cancelled';resourceState:'settled'|'settling'|'uncertain'};
export type LocalSourcePreparation=Readonly<{result:Promise<SourcePreparationResult>;settled:Promise<void>;cancel():void}>;
