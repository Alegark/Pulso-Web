import {plain} from '../diagnostics/contract';
import {copyFailureV1,type FailureV1} from '../errors/app-failure';
import {copyLocalAlbumMetadata,type LocalAlbumMetadataV1} from './album-metadata';
import {copyAsset} from './local-copy-protocol';
import type {LocalAsset} from './library';
export const METADATA_RESCAN_LIMIT=8388608;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
export {uuid as metadataRescanUUID};
export type MetadataRescanReference=Readonly<{version:1;operationId:string;incarnation:string}>;
export function copyMetadataRescanReference(value:unknown):MetadataRescanReference|null {
 const p=plain(value,['version','operationId','incarnation']);
 return p?.version===1&&uuid(p.operationId)&&uuid(p.incarnation)?Object.freeze({version:1,operationId:p.operationId,incarnation:p.incarnation}):null;
}
export type MetadataRescanProgress=Readonly<{phase:'verify';bytes:number;total:number}|{phase:'parse'|'commit'}>;
export interface MetadataRescanContext {readonly signal:AbortSignal;readonly current:()=>boolean;readonly onPending:(reference:MetadataRescanReference)=>void;readonly onProgress?:(progress:MetadataRescanProgress)=>void}
export interface MetadataRescanRequest {readonly operationId:string;readonly trackId:string;readonly expectedRevision:number}
export type MetadataRescanReason='limit'|'no-local-copy'|'missing'|'corrupt'|'not-inspected'|'changed'|'conflict'|'cancelled'|'timeout'|'storage'|'busy';
export type MetadataRescanResult={state:'committed';reference:MetadataRescanReference;effect:'updated'|'no-change';trackRevision:number;localAlbum:LocalAlbumMetadataV1}|{state:'not-applied';reference:MetadataRescanReference|null;reason:MetadataRescanReason;failure:FailureV1|null;secondary:FailureV1|null}|{state:'uncertain';reference:MetadataRescanReference;failure:FailureV1;secondary:FailureV1|null};
export type MetadataRescanInspection={state:'committed';reference:MetadataRescanReference;effect:'updated'|'no-change';trackRevision:number}|{state:'not-committed';reference:MetadataRescanReference}|{state:'uncertain';reference:MetadataRescanReference;reason:'storage'|'original-library-unavailable'|'receipt-unavailable'|'busy';failure:FailureV1|null};
export type MetadataRescanWorkerRequest={version:1;type:'inspect';requestId:string;token:string;asset:LocalAsset}|{version:1;type:'ack'|'cancel';requestId:string;token:string};
export type MetadataRescanWorkerReply={version:1;requestId:string;token:string}&({type:'progress';bytes:number;total:number}|{type:'parsing'}|{type:'candidate';asset:LocalAsset;localAlbum:LocalAlbumMetadataV1}|{type:'failure';failure:FailureV1});
function head(value:unknown){try{if(!value||typeof value!=='object'||Reflect.ownKeys(value).length>7)return null;return plain(value,Object.keys(value));}catch{return null;}}
export function copyMetadataRescanRequest(value:unknown):MetadataRescanWorkerRequest|null {
 const p=head(value);if(!p||p.version!==1||!uuid(p.requestId)||!uuid(p.token))return null;
 if(p.type==='inspect'){
 const a=copyAsset(p.asset);return a&&a.bytes<=METADATA_RESCAN_LIMIT&&plain(value,['version','type','requestId','token','asset'])?{version:1,type:'inspect',requestId:p.requestId,token:p.token,asset:{...a}}:null;
 }
 return (p.type==='ack'||p.type==='cancel')&&plain(value,['version','type','requestId','token'])?{version:1,type:p.type,requestId:p.requestId,token:p.token}:null;
}
export function copyMetadataRescanReply(value:unknown):MetadataRescanWorkerReply|null {
 const p=head(value);if(!p||p.version!==1||!uuid(p.requestId)||!uuid(p.token))return null;
 const base={version:1 as const,requestId:p.requestId,token:p.token};const keys=['version','type','requestId','token'];
 if(p.type==='parsing'&&plain(value,keys))return {...base,type:'parsing'};
 if(p.type==='failure'&&plain(value,[...keys,'failure'])){const f=copyFailureV1(p.failure);return f?{...base,type:'failure',failure:f}:null;}
 if(p.type==='progress'&&plain(value,[...keys,'bytes','total'])&&Number.isSafeInteger(p.bytes)&&Number.isSafeInteger(p.total)&&Number(p.total)>0&&Number(p.total)<=METADATA_RESCAN_LIMIT&&Number(p.bytes)>0&&Number(p.bytes)<=Number(p.total))return {...base,type:'progress',bytes:Number(p.bytes),total:Number(p.total)};
 if(p.type==='candidate'&&plain(value,[...keys,'asset','localAlbum'])){const a=copyAsset(p.asset),m=copyLocalAlbumMetadata(p.localAlbum);return a&&a.bytes<=METADATA_RESCAN_LIMIT&&m?{...base,type:'candidate',asset:{...a},localAlbum:m}:null;}
 return null;
}
