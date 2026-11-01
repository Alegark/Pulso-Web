import type {Result} from './contract';
import {copyOutcomeV1,type OutcomeV1} from '../imports/import-outcome';
import type {FailureV1} from '../errors/app-failure';
export function toDiagnosticResults(value:OutcomeV1,operation:'import'|'recovery'='import'):{primary:Result|null;cleanup:Result|null}{
 const o=copyOutcomeV1(value);if(!o)return {primary:null,cleanup:null};
 const project=(f:FailureV1):Result=>({phase:f.phase??'transport',family:f.family,code:f.code,outcome:o.status==='uncertain'?'uncertain':o.status==='cancelled'?'cancelled':o.status==='confirmed'?'recovered':'failed',backend:f.backend,transport:'unknown',count:0});
 const primary=o.primary?project(o.primary):o.status==='confirmed'?{phase:operation==='recovery'||o.writeState!=='published'?'reconcile':'commit',family:null,code:'none',outcome:operation==='recovery'?'recovered':'succeeded',backend:'unknown',transport:'unknown',count:1} satisfies Result:null;
 const secondary=o.reconcile??o.cleanup;
 const cleanup=secondary?project(secondary):o.recoveryRequired?{phase:'reconcile',family:'write-uncertain',code:'write-uncertain',outcome:'uncertain',backend:'unknown',transport:'unknown',count:0} satisfies Result:null;
 return {primary,cleanup};
}
