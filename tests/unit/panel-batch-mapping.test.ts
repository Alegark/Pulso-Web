import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFeatureObservation,featureObservation,panelSuccess,panelFailure,notifyFeature} from '../../src/diagnostics/panel-mapping';
import {makeFailure} from '../../src/errors/app-failure';
import {LocalBatchError,batchErrorObservation,batchDomainError} from '../../src/library/local-batches';

test('closed seven primitive fields, strict pairs and frozen independent copies',()=>{
 const r=panelSuccess();const o=featureObservation(r);assert.deepEqual(Object.keys(o.primary).sort(),['phase','outcome','family','code','backend','transport','count'].sort());
 assert.ok(Object.isFrozen(o)&&Object.isFrozen(o.primary));assert.notEqual(o.primary,r);
 for(const primary of [{...r,extra:'PII'},{...r,count:1001},{...r,family:'quota',code:'asset-missing'},{...r,family:null,outcome:'partial'},{...r,transport:'sw'}])assert.equal(copyFeatureObservation({...o,primary}),null);
 assert.equal(copyFeatureObservation({...o,extra:'PII'}),null);
 assert.ok(copyFeatureObservation(featureObservation(panelFailure(makeFailure('write','quota','quota-exceeded','idb')))));
});
test('unknown, forged, public constructor and hostile errors cannot grant diagnostic provenance',()=>{
 let accessed=0;const hostile=Object.defineProperties({},Object.fromEntries(['code','name','cause','message','constructor'].map(k=>[k,{get(){accessed++;throw Error('PII');}}])));
 for(const value of [null,false,'QuotaExceededError',new LocalBatchError('empty'),Object.create(LocalBatchError.prototype),hostile,new Proxy({},{get(){accessed++;throw Error('PII');},getPrototypeOf(){accessed++;throw Error('PII');}})])assert.equal(batchErrorObservation(value).primary.code,'unknown');
 assert.equal(accessed,0);assert.equal(batchErrorObservation(batchDomainError('empty')).primary.code,'empty-selection');
 assert.equal(batchErrorObservation(new DOMException('PII','QuotaExceededError')).primary.code,'quota-exceeded');
 assert.equal(batchErrorObservation({name:'QuotaExceededError'}).primary.code,'unknown');
});
test('strict DTO accessor rejection and observer failure isolation',()=>{
 let gets=0;const o=featureObservation(panelSuccess());const poisoned={version:1,cleanup:null,get primary(){gets++;return o.primary;}};
 assert.equal(copyFeatureObservation(poisoned),null);assert.equal(gets,0);
 assert.equal(copyFeatureObservation(new Proxy({},{ownKeys(){throw Error('PII');}})),null);
 let calls=0;notifyFeature(()=>{calls++;throw Error('PII');},o);assert.equal(calls,1);
});
