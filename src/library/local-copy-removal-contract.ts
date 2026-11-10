import {AUDIO_FILE_MAX_BYTES} from '../storage/audio-limits';
import type {LocalAsset} from './library';
import type {FailureV1} from '../errors/app-failure';
import {closedObject,copySourceAsset} from '../playback/local-source-protocol';
export const REMOVAL_PREFIX='local-copy-removal:v1:';
export const REMOVAL_LIMITS=Object.freeze({assets:10000,tracks:20000,playlistEntries:20000,jobs:20000,settings:20000,metadataBytes:8388608,aliases:32,audioBytes:AUDIO_FILE_MAX_BYTES,journals:32,prefixBytes:262144});
export const removalUUID=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
export const positive=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>0;
export interface RemovalTracking {readonly incarnation:string;readonly operationId:string}
export type RemovalDeclaration='external-copy-declared'|'accept-possible-only-original-loss';
export interface RemovalConsent {readonly planRevision:number;readonly declaration:RemovalDeclaration;readonly confirmRemoveThisCopy:true}
export interface RemovalSummary {readonly bytes:number;readonly tracks:number;readonly favorites:number;readonly playlists:number;readonly playlistEntries:number;readonly persistedQueueOccurrences:number}
export type RemovalJournalState='prepared'|'detached'|'deleting'|'removed'|'not-committed';
export interface RemovalJournalV1 extends RemovalTracking {
 version:1;namespace:'local';revision:number;state:RemovalJournalState;target:LocalAsset;planRevision:number;planDigest:string;detachedDigest:string;
 consent:RemovalConsent;tracks:{id:string;beforeRevision:number;afterRevision:number}[];summary:RemovalSummary;
}
export interface RemovalOutcome {
 readonly tracking:RemovalTracking|null;readonly state:RemovalJournalState|'unknown';readonly journalRevision:number|null;
 readonly publication:'linked'|'unpublished'|'unknown';readonly physical:'present'|'absent'|'unknown';readonly recoveryRequired:boolean;
 readonly preparation:'not-dispatched'|'aborted'|'uncertain'|'recorded';
 readonly primary:FailureV1|null;readonly secondary:readonly {phase:'reconcile'|'cleanup'|'refresh';failure:FailureV1}[];
}
declare const candidateBrand:unique symbol,planBrand:unique symbol,continuationBrand:unique symbol;
export interface RemovalCandidate {readonly [candidateBrand]:true}
export interface RemovalPlan {readonly [planBrand]:true}
export interface RemovalContinuation {readonly [continuationBrand]:true}
export interface RemovalReadContext {readonly signal:AbortSignal;current():boolean}
/** Trusted root composition only. Both closures bind the SAME live reservation,
 * owner proof/scope/Activity/database generation. The second also checks the
 * actual pinned runtime/transport; legacy/unknown MUST return false. No JSON or
 * capability flag is accepted as authority. Core never releases this reservation. */
export interface RemovalContext extends RemovalReadContext {runtimeProtectionCurrent(target:Readonly<LocalAsset>):boolean}
export type RemovalBlockedReason='busy'|'changed'|'limit'|'missing'|'corrupt'|'runtime-unknown'|'ineligible'|'cancelled'|'unavailable';
export interface RemovalBlocked {readonly kind:'blocked';readonly reason:RemovalBlockedReason;readonly failure:FailureV1}
export type RemovalDiscovery={readonly kind:'candidate';readonly candidate:RemovalCandidate;readonly target:Readonly<LocalAsset>}|RemovalBlocked;
export type RemovalPreview={readonly kind:'ready';readonly plan:RemovalPlan;readonly planRevision:number;readonly tracking:RemovalTracking;readonly summary:RemovalSummary}|RemovalBlocked;
export interface RemovalInspection {readonly outcome:RemovalOutcome;readonly continuation:RemovalContinuation|null;readonly planRevision:number|null;readonly summary:RemovalSummary|null}
export const journalKey=(operationId:string)=>REMOVAL_PREFIX+'journal:'+operationId;
export const markerKey=(a:LocalAsset)=>REMOVAL_PREFIX+'generation:'+a.backend+':'+a.storageKey;
export function copyRemovalTracking(value:unknown):RemovalTracking|null {
 const m=closedObject(value,['incarnation','operationId']);return m&&removalUUID(m.incarnation)&&removalUUID(m.operationId)?Object.freeze({incarnation:m.incarnation,operationId:m.operationId}):null;
}
export function copyRemovalConsent(value:unknown):RemovalConsent|null {
 const m=closedObject(value,['planRevision','declaration','confirmRemoveThisCopy']);return m&&positive(m.planRevision)&&typeof m.declaration==='string'&&['external-copy-declared','accept-possible-only-original-loss'].includes(m.declaration)&&m.confirmRemoveThisCopy===true?Object.freeze({planRevision:m.planRevision,declaration:m.declaration as RemovalDeclaration,confirmRemoveThisCopy:true}):null;
}
export function copyRemovalSummary(value:unknown):RemovalSummary|null {
 const keys=['bytes','tracks','favorites','playlists','playlistEntries','persistedQueueOccurrences'];const m=closedObject(value,keys);
 return m&&keys.every(k=>Number.isSafeInteger(m[k])&&Number(m[k])>=0)&&positive(m.bytes)&&Number(m.bytes)<=REMOVAL_LIMITS.audioBytes&&positive(m.tracks)&&Number(m.tracks)<=32&&Number(m.favorites)<=Number(m.tracks)&&Number(m.playlistEntries)<=1000&&Number(m.playlists)<=Number(m.playlistEntries)&&Number(m.persistedQueueOccurrences)<=1000?m as unknown as RemovalSummary:null;
}
export function copyRemovalJournal(value:unknown,key:IDBValidKey):RemovalJournalV1|null {
 try{
 const m=closedObject(value,['version','namespace','incarnation','operationId','revision','state','target','planRevision','planDigest','detachedDigest','consent','tracks','summary']);
 if(!m||m.version!==1||m.namespace!=='local'||!removalUUID(m.incarnation)||!removalUUID(m.operationId)||key!==journalKey(m.operationId)||!positive(m.revision)||!positive(m.planRevision)||typeof m.planDigest!=='string'||!/^[a-f0-9]{64}$/.test(m.planDigest)||typeof m.detachedDigest!=='string'||!/^[a-f0-9]{64}$/.test(m.detachedDigest)||(typeof m.state!=='string'||!['prepared','detached','deleting','removed','not-committed'].includes(m.state)))return null;
 if(m.state==='prepared'&&m.revision!==1||m.state==='not-committed'&&m.revision!==2||m.state==='detached'&&m.revision<2||['deleting','removed'].includes(m.state)&&m.revision<3)return null;
 const target=copySourceAsset(m.target),consent=copyRemovalConsent(m.consent),summary=copyRemovalSummary(m.summary);
 if(!target||!removalUUID(target.id)||!removalUUID(target.storageKey)||target.bytes>REMOVAL_LIMITS.audioBytes||!consent||consent.planRevision!==m.planRevision||!summary||summary.bytes!==target.bytes||!Array.isArray(m.tracks)||m.tracks.length<1||m.tracks.length>32||Reflect.ownKeys(m.tracks).length!==m.tracks.length+1)return null;
 const tracks:RemovalJournalV1['tracks']=[];
 for(let i=0;i<m.tracks.length;i++){const d=Object.getOwnPropertyDescriptor(m.tracks,String(i));if(!d||!('value'in d))return null;const t=closedObject(d.value,['id','beforeRevision','afterRevision']);if(!t||!removalUUID(t.id)||!positive(t.beforeRevision)||!positive(t.afterRevision)||t.afterRevision!==t.beforeRevision+1||tracks.some(v=>v.id===t.id))return null;tracks.push({id:t.id,beforeRevision:t.beforeRevision,afterRevision:t.afterRevision});}
 if(summary.tracks!==tracks.length)return null;
 return {version:1,namespace:'local',incarnation:m.incarnation,operationId:m.operationId,revision:m.revision,state:m.state as RemovalJournalState,target,planRevision:m.planRevision,planDigest:m.planDigest,detachedDigest:m.detachedDigest,consent,tracks,summary};
 }catch{return null;}
}
