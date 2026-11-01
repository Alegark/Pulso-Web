import test from 'node:test';
import assert from 'node:assert/strict';
import {copyPanelResult,copyFeatureObservation} from '../../src/diagnostics/panel-mapping';
import {mapBackup} from '../../src/diagnostics/contract';
import {OrganizationBackupError,organizationErrorObservation,applyOrganization} from '../../src/library/organization-backup';

test('backup feature pairs are closed and retain the seven-key Result',()=>{
 for(const code of ['format','version','limits','relations','local-corrupt','stale-preview','plan-expired','invalid-choice','fingerprint-conflict','export-reused'] as const){
  const result={...mapBackup(code,'validate'),backend:'none',transport:'none'};
  assert(copyPanelResult(result));assert.equal(Object.keys(result).length,7);
  assert.equal(copyPanelResult({...result,family:'quota'}),null);
  assert.equal(copyPanelResult({...result,title:'PII'}),null);
 }
});
test('public backup constructors and hostile getters cannot confer provenance',()=>{
 let touched=0;
 for(const error of [new OrganizationBackupError('quota'),Object.create(OrganizationBackupError.prototype),Object.defineProperties({},Object.fromEntries(['code','name','cause'].map(k=>[k,{get(){touched++;throw Error('PII');}}]))),new Proxy({},{get(){touched++;throw Error('PII');}})]){
  const observation=organizationErrorObservation(error);assert.equal(observation.primary.code,'unknown');assert(copyFeatureObservation(observation));assert(!JSON.stringify(observation).includes('PII'));
 }
 assert.equal(touched,0);
});
test('issued plan-expired is precise; throwing observer preserves rejection',async()=>{
 const values:unknown[]=[];let first:unknown;
 await assert.rejects(applyOrganization('absent',undefined,v=>values.push(v)),error=>{first=error;return organizationErrorObservation(error).primary.code==='plan-expired';});
 assert.equal(values.length,1);assert.equal(organizationErrorObservation(first).primary.phase,'validate');
 await assert.rejects(applyOrganization('absent',undefined,()=>{throw Error('observer');}),error=>organizationErrorObservation(error).primary.code==='plan-expired');
});
