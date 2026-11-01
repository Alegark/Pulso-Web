import {plain} from '../diagnostics/contract';
import {copyFailureV1,type FailureV1} from '../errors/app-failure';
import {validAsset,type LocalAsset} from './library';
function headRecord(value:unknown):Record<string,unknown>|null {try {if(!value||typeof value!=='object')return null;return plain(value,Object.keys(value));}catch{return null;}}
export const COPY_LIMITS=Object.freeze({pageRows:50,metadataBytes:8*1024*1024,manifests:10000,tracks:20000,playlistEntries:20000,generations:10000,recordsPerOtherStore:20000,chunkRecords:200000,chunkBytes:65536,exportBytes:8*1024*1024});
export const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
export const assetFields=['id','namespace','storageKey','bytes','sha256','mime','chunks','state','revision','chunkSize','retention','backend'] as const;
export function copyAsset(value:unknown):LocalAsset|null {const v=plain(value,assetFields);try{return v&&validAsset(v)?v as unknown as LocalAsset:null;}catch{return null;}}
export function sameAsset(a:LocalAsset,b:LocalAsset):boolean{return assetFields.every(k=>a[k]===b[k]);}
export type Availability='pending'|'present'|'missing'|'corrupt'|'unknown'|'changed';
export type Integrity='not-checked'|'verified'|'invalid'|'unknown';
export interface ReferencesV1 {tracks:number|null;favorites:number|null;playlists:number|null;playlistEntries:number|null;queueOccurrences:number|null}
export interface RawInventoryRow {rowId:string;backend:'idb'|'opfs'|'unknown';classification:'current-kept'|'previous-kept'|'staging'|'unclassified'|'invalid';manifestCount:number;trackIds:string[];logicalBytes:number|null;observedBytes:number|null;availability:Availability;integrity:Integrity;references:ReferencesV1;protection:'kept'|'unknown';asset:LocalAsset|null;failure:FailureV1|null}
export interface RawInventory {rows:RawInventoryRow[];partial:boolean;referencesComplete:boolean;observedBytes:number|null;logicalBytes:number|null;metadataBytes:number;scannedRecords:number;physicalComplete:boolean}
export interface CopyVerificationV1 {availability:Availability;integrity:Integrity;bytes:number;failure:FailureV1|null}
export type WorkerRequest={version:1;requestId:string;token:string;type:'inventory'}|{version:1;requestId:string;token:string;type:'verify'|'export';asset:LocalAsset}|{version:1;requestId:string;token:string;type:'credit'|'ack'|'cancel';offset:number};
export function parseWorkerRequest(value:unknown):WorkerRequest|null {
 const head=headRecord(value);if(!head||head.version!==1||!uuid(head.requestId)||!uuid(head.token))return null;
 if(head.type==='inventory')return plain(value,['version','requestId','token','type']) as WorkerRequest|null;
 if(head.type==='verify'||head.type==='export'){const p=plain(value,['version','requestId','token','type','asset']),asset=copyAsset(p?.asset);return p&&asset?{version:1,requestId:head.requestId,token:head.token,type:head.type,asset}:null;}
 if(['credit','ack','cancel'].includes(head.type as string)&&plain(value,['version','requestId','token','type','offset'])&&Number.isSafeInteger(head.offset)&&Number(head.offset)>=0&&Number(head.offset)<=COPY_LIMITS.exportBytes)return head as unknown as WorkerRequest;
 return null;
}
export type WorkerReply={version:1;requestId:string;token:string}&(
 {type:'inventory';inventory:RawInventory}|{type:'verified';result:CopyVerificationV1}|{type:'progress';bytes:number;total:number}|{type:'start';bytes:number;mime:string}|{type:'chunk';offset:number;buffer:ArrayBuffer}|{type:'materialize';bytes:number}|{type:'ready'}|{type:'failure';failure:FailureV1});
export function parseWorkerReply(value:unknown):WorkerReply|null {
 const p=headRecord(value);if(!p||p.version!==1||!uuid(p.requestId)||!uuid(p.token))return null;
 const fields=['version','requestId','token','type'];let extra:string[]=[];
 switch(p.type){
 case 'ready':break;
 case 'failure':extra=['failure'];if(!copyFailureV1(p.failure))return null;break;
 case 'start':extra=['bytes','mime'];if(!Number.isSafeInteger(p.bytes)||Number(p.bytes)<1||Number(p.bytes)>COPY_LIMITS.exportBytes||!['audio/wav','audio/mpeg','audio/mp4'].includes(p.mime as string))return null;break;
 case 'progress':extra=['bytes','total'];if(!Number.isSafeInteger(p.bytes)||!Number.isSafeInteger(p.total)||Number(p.bytes)<0||Number(p.bytes)>Number(p.total)||Number(p.total)>100*1024*1024)return null;break;
 case 'chunk':extra=['offset','buffer'];if(!Number.isSafeInteger(p.offset)||Number(p.offset)<0||!(p.buffer instanceof ArrayBuffer)||p.buffer.byteLength<1||p.buffer.byteLength>65536)return null;break;
 case 'materialize':extra=['bytes'];if(!Number.isSafeInteger(p.bytes)||Number(p.bytes)<1||Number(p.bytes)>COPY_LIMITS.exportBytes)return null;break;
 case 'verified':{extra=['result'];const r=plain(p.result,['availability','integrity','bytes','failure']);if(!r||!['present','missing','corrupt','unknown','changed'].includes(r.availability as string)||!['verified','invalid','unknown'].includes(r.integrity as string)||!Number.isSafeInteger(r.bytes)||Number(r.bytes)<1||Number(r.bytes)>100*1024*1024||!(r.failure===null||copyFailureV1(r.failure)))return null;const f=copyFailureV1(r.failure);if(r.availability==='present'?(r.integrity!=='verified'||r.failure!==null):!f||r.integrity!==(r.availability==='corrupt'?'invalid':'unknown'))return null;break;}
 case 'inventory':extra=['inventory'];if(!validRawInventory(p.inventory))return null;break;
 default:return null;
 }
 return plain(value,[...fields,...extra]) as WorkerReply|null;
}
export function validRawInventory(value:unknown):value is RawInventory {
 const p=plain(value,['rows','partial','referencesComplete','observedBytes','logicalBytes','metadataBytes','scannedRecords','physicalComplete']);
 const count=(n:unknown)=>n===null||Number.isSafeInteger(n)&&Number(n)>=0;
 if(!p||!Array.isArray(p.rows)||p.rows.length>COPY_LIMITS.generations||typeof p.partial!=='boolean'||typeof p.referencesComplete!=='boolean'||typeof p.physicalComplete!=='boolean'||!count(p.observedBytes)||!count(p.logicalBytes)||!Number.isSafeInteger(p.metadataBytes)||Number(p.metadataBytes)<0||Number(p.metadataBytes)>COPY_LIMITS.metadataBytes||!Number.isSafeInteger(p.scannedRecords)||Number(p.scannedRecords)<0||Number(p.scannedRecords)>100000)return false;
 return p.rows.every(value=>{const r=plain(value,['rowId','backend','classification','manifestCount','trackIds','logicalBytes','observedBytes','availability','integrity','references','protection','asset','failure']);const refs=plain(r?.references,['tracks','favorites','playlists','playlistEntries','queueOccurrences']);return !!r&&uuid(r.rowId)&&['idb','opfs','unknown'].includes(r.backend as string)&&['current-kept','previous-kept','staging','unclassified','invalid'].includes(r.classification as string)&&Number.isSafeInteger(r.manifestCount)&&Number(r.manifestCount)>=0&&Array.isArray(r.trackIds)&&r.trackIds.length<=COPY_LIMITS.tracks&&r.trackIds.every(uuid)&&count(r.logicalBytes)&&count(r.observedBytes)&&['pending','present','missing','corrupt','unknown','changed'].includes(r.availability as string)&&['not-checked','verified','invalid','unknown'].includes(r.integrity as string)&&!!refs&&Object.values(refs).every(count)&&['kept','unknown'].includes(r.protection as string)&&(r.asset===null||!!copyAsset(r.asset))&&(r.failure===null||!!copyFailureV1(r.failure));});
}
