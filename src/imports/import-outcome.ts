import {plain,type Backend} from '../diagnostics/contract';
import {copyFailureV1,makeFailure,type FailureV1} from '../errors/app-failure';
import type {ImportResult,ImportOperation} from '../storage/import-operations';
import type {ArtworkFailure} from './artwork';
import type {ImportLyricsWarning} from './import-file';
import type {EmbeddedLyricsStoreResult} from '../library/lyrics';
export interface OutcomeV1 {
 readonly version:1;readonly status:'confirmed'|'failed'|'cancelled'|'uncertain';
 readonly primary:FailureV1|null;readonly cleanup:FailureV1|null;readonly reconcile:FailureV1|null;
 readonly writeState:'not-started'|'not-published'|'published'|'unknown';
 readonly closeState:'not-applicable'|'not-attempted'|'acknowledged'|'unknown';readonly recoveryRequired:boolean;
}
export type DetailedImportResult=ImportResult & {artworkWarning?:ArtworkFailure;lyricsWarning?:ImportLyricsWarning;lyricsInspection?:EmbeddedLyricsStoreResult};
export type ImportAttemptResult={kind:'confirmed';result:DetailedImportResult;outcome:OutcomeV1}|{kind:'failed';outcome:OutcomeV1};
export type RecoveryAttemptResult={kind:'confirmed';operation:ImportOperation;outcome:OutcomeV1}|{kind:'failed';outcome:OutcomeV1};
export function copyOutcomeV1(value:unknown):OutcomeV1|null {
 const o=plain(value,['version','status','primary','cleanup','reconcile','writeState','closeState','recoveryRequired']);if(!o||o.version!==1)return null;
 const primary=o.primary===null?null:copyFailureV1(o.primary),cleanup=o.cleanup===null?null:copyFailureV1(o.cleanup),reconcile=o.reconcile===null?null:copyFailureV1(o.reconcile);
 if(o.primary!==null&&!primary||o.cleanup!==null&&!cleanup||o.reconcile!==null&&!reconcile||cleanup&&cleanup.phase!=='cleanup'||reconcile&&reconcile.phase!=='reconcile')return null;
 if(typeof o.status!=='string'||typeof o.writeState!=='string'||typeof o.closeState!=='string'||!['confirmed','failed','cancelled','uncertain'].includes(o.status)||!['not-started','not-published','published','unknown'].includes(o.writeState)||
 !['not-applicable','not-attempted','acknowledged','unknown'].includes(o.closeState)||typeof o.recoveryRequired!=='boolean')return null;
 if(o.status==='uncertain'&&(o.recoveryRequired!==true||!['unknown','published'].includes(o.writeState))||o.writeState==='unknown'&&o.status!=='uncertain'||
 o.status==='confirmed'&&(o.recoveryRequired||!['published','not-published'].includes(o.writeState))||
 o.status!=='confirmed'&&!primary||o.status==='cancelled'&&primary?.family!=='cancelled'||o.status==='failed'&&primary?.family==='cancelled'||
 o.writeState==='published'&&!['confirmed','uncertain'].includes(o.status)||o.status!=='uncertain'&&o.recoveryRequired)return null;
 return Object.freeze({...o,primary,cleanup,reconcile}) as unknown as OutcomeV1;
}
export const validOutcomeV1=(v:unknown):v is OutcomeV1=>copyOutcomeV1(v)!==null;
export function makeOutcome(value:Omit<OutcomeV1,'version'>):OutcomeV1 {
 const copy=copyOutcomeV1({version:1,...value});if(!copy)throw new TypeError('Invalid outcome contract');return copy;
}
/** Local attempt ledger, never sent over the wire. First causes are immutable. */
export class Attempt {
 primary:FailureV1|null=null;cleanup:FailureV1|null=null;reconcile:FailureV1|null=null;
 backend:Backend='unknown';closeState:OutcomeV1['closeState']='not-applicable';started=false;cleaned=false;pendingPublication=false;
 failure(f:FailureV1){this.primary??=f;}
 secondary(slot:'cleanup'|'reconcile',f:FailureV1){this[slot]??=Object.freeze({...f,phase:slot});}
 outcome(state:OutcomeV1['writeState']):OutcomeV1 {
 return makeOutcome({status:this.pendingPublication?'uncertain':state==='published'?'confirmed':state==='unknown'?'uncertain':this.primary?.family==='cancelled'?'cancelled':'failed',primary:this.primary,cleanup:this.cleanup,reconcile:this.reconcile,writeState:this.pendingPublication?'published':state,closeState:this.closeState,recoveryRequired:this.pendingPublication||state==='unknown'});
 }
 confirmed(published=true):OutcomeV1{return makeOutcome({status:'confirmed',primary:this.primary,cleanup:this.cleanup,reconcile:this.reconcile,writeState:published?'published':'not-published',closeState:this.closeState,recoveryRequired:false});}
}

/** Main transport failures have no evidence of a storage subphase. Never retry or delete on this DTO. */
export function workerFailureOutcome(code:'worker-failed'|'worker-protocol',mayHaveWritten=true):OutcomeV1 {
 return makeOutcome({status:mayHaveWritten?'uncertain':'failed',primary:makeFailure(null,'internal',code,'unknown'),cleanup:null,reconcile:null,writeState:mayHaveWritten?'unknown':'not-started',closeState:mayHaveWritten?'unknown':'not-applicable',recoveryRequired:mayHaveWritten});
}
