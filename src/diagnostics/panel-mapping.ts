import {plain,resultKeys,validResult,type Result,type Phase,type Outcome} from './contract';
import {copyFailureV1,type FailureV1} from '../errors/app-failure';

export type FeatureObservationV1=Readonly<{version:1;primary:Readonly<Result>;cleanup:Readonly<Result>|null}>;
export type ObserveFeature=(value:FeatureObservationV1)=>void;
export type PanelOperation='verify-batch'|'recover-batch'|'export-organization'|'preview-organization'|'apply-organization'|'inspect-organization'|'recover-organization';
export type PanelDiagnosticAttempt={complete:ObserveFeature;refreshFailed:(failure:FailureV1)=>void;finish:()=>void};
export type BeginPanelDiagnostic=(operation:PanelOperation,current:()=>boolean)=>PanelDiagnosticAttempt|null;
// Feature-only pairs, deliberately independent of the foundation FailureV1 pairs.
const pairs={'backup-format':'integrity','backup-version':'unsupported-format','backup-limits':'internal','stale-preview':'internal','plan-expired':'internal','invalid-choice':'internal','fingerprint-conflict':'integrity','export-reused':'integrity',unknown:'internal','input-invalid':'internal','empty-selection':'internal',conflict:'internal','retry-required':'internal','owner-unavailable':'internal','relations-invalid':'integrity','asset-missing':'integrity','asset-changed':'integrity','length-mismatch':'integrity','digest-mismatch':'integrity','local-corrupt':'integrity','quota-exceeded':'quota','storage-denied':'storage-unavailable','storage-unavailable':'storage-unavailable','database-blocked':'storage-unavailable','transaction-aborted':'storage-unavailable',cancelled:'cancelled','worker-failed':'internal','worker-protocol':'internal','write-uncertain':'write-uncertain','close-uncertain':'write-uncertain','commit-uncertain':'write-uncertain','cleanup-failed':'internal','imports-unresolved':'write-uncertain'} as const;
export function copyPanelResult(value:unknown):Readonly<Result>|null {
 const r=plain(value,resultKeys);
 if(!r||!validResult(r)||r.transport!=='none')return null;
 if(r.family!==null&&(typeof r.code!=='string'||!Object.hasOwn(pairs,r.code)||pairs[r.code as keyof typeof pairs]!==r.family))return null;
 return Object.freeze({...r}) as unknown as Readonly<Result>;
}
export function copyFeatureObservation(value:unknown):FeatureObservationV1|null {
 const o=plain(value,['version','primary','cleanup']);if(!o||o.version!==1)return null;
 const primary=copyPanelResult(o.primary),cleanup=o.cleanup===null?null:copyPanelResult(o.cleanup);
 return primary&&(o.cleanup===null||cleanup)?Object.freeze({version:1,primary,cleanup}):null;
}
export function panelFailure(failure:FailureV1,outcome:Outcome='failed',fallback:Phase='validate'):Readonly<Result> {
 const f=copyFailureV1(failure);if(!f)throw new TypeError('Invalid panel failure');
 const r=copyPanelResult({phase:f.phase??fallback,outcome,family:f.family,code:f.code,backend:f.backend,transport:'none',count:0});
 if(!r)throw new TypeError('Invalid panel result');return r;
}
export function panelSuccess(phase:Phase='commit',outcome:'succeeded'|'recovered'='succeeded'):Readonly<Result> {
 return Object.freeze({phase,outcome,family:null,code:'none',backend:'idb',transport:'none',count:0});
}
export function featureObservation(primary:Readonly<Result>,cleanup:Readonly<Result>|null=null):FeatureObservationV1 {
 const o=copyFeatureObservation({version:1,primary,cleanup});if(!o)throw new TypeError('Invalid feature observation');return o;
}
export function notifyFeature(observe:ObserveFeature|undefined,value:FeatureObservationV1):void {
 try{observe?.(featureObservation(value.primary,value.cleanup));}catch{/* Observability never owns product effects. */}
}
