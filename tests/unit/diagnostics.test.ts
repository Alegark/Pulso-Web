import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {SessionSnapshot} from '../../src/diagnostics/session.ts';
import {createDiagnosticSession} from '../../src/diagnostics/session.ts';
import {result,validResult,validEvent,increment,MAX_COUNTER,eventKeys,mapBatch,mapBackup,domFailure,importFailure} from '../../src/diagnostics/contract.ts';
import {projectReview,serializeReviewed,capabilityFields} from '../../src/diagnostics/export.ts';
import type {Capabilities} from '../../src/diagnostics/export.ts';
const caps=Object.fromEntries(capabilityFields.map(k=>[k,k==='storageOperation'?'not-observed':k.startsWith('observed')?'unknown':'available'])) as Capabilities;
const selection={errors:[...eventKeys],capabilities:[],limits:[]};
function setup(){const session=createDiagnosticSession(randomUUID);session.setEnabled(true);return session;}
test('closed validator rejects accessors, prototypes, extras, throwing proxies without conversion',()=>{
 let reads=0;const good=result('read');
 const getter=Object.defineProperty({...good},'code',{get(){reads++;return 'unknown';}});
 const toJSON={...good,toJSON(){reads++;throw Error('canary');}};
 for(const value of [null,[],new Error('canary'),Object.create(good),{...good,x:'canary'},{...good,[Symbol()]:1},getter,toJSON,new Proxy({}, {ownKeys(){throw Error('canary');}}),new Proxy({}, {getPrototypeOf(){throw Error('canary');}}),{...good,count:NaN},{...good,count:Infinity},{...good,count:1n},{...good,count:1001},{...good,count:-1},{...good,phase:'canary'},{...good,code:'__proto__'}])assert.equal(validResult(value),false);
 assert.equal(reads,0);assert.equal(validResult(Object.assign(Object.create(null),good)),true);
 assert.equal(validEvent({...good,sequence:1,correlationId:'business-id',operation:'play'}),false);
});
test('issued handles, one primary and bounded secondary slots; copied values, no refs',()=>{
 const s=setup();s.complete({diagnosticHandle:true},result('read'));assert.equal(s.getSnapshot().events.length,0);
 const handle=s.begin('play',()=>true),input=result('read');s.complete(handle,input);input.code='quota-exceeded';
 s.complete(handle,result('write'));s.complete(handle,result('refresh'),'refresh');s.complete(handle,result('cleanup'),'cleanup');s.complete(handle,result('cleanup'),'cleanup');
 assert.equal(s.getSnapshot().events.length,3);assert.equal(new Set(s.getSnapshot().events.map(e=>e.correlationId)).size,1);assert.equal(s.getSnapshot().events[0].code,'unknown');
 assert.ok(Object.isFrozen(s.getSnapshot().events[0]));s.finish(handle);s.complete(handle,result('read'));assert.equal(s.getSnapshot().events.length,3);
});
test('capture epoch, current guard, clear, disable and scope invalidate pending handles',()=>{
 const s=createDiagnosticSession(randomUUID);const off=s.begin('play',()=>true);s.setEnabled(true);s.complete(off,result('read'));assert.equal(s.getSnapshot().events.length,0);
 for(const reset of [()=>s.clear(),()=>{s.setEnabled(false);s.setEnabled(true);},()=>{s.resetScope();s.setEnabled(true);}] ){
 const old=s.begin('play',()=>true);reset();s.complete(old,result('read'));assert.equal(s.getSnapshot().events.length,0);
 }
 let current=true;const stale=s.begin('play',()=>current);current=false;s.complete(stale,result('read'));assert.equal(s.getSnapshot().events.length,0);
 assert.equal(s.begin('play',()=>false),null);assert.equal(s.begin('play',()=>{throw Error();}),null);
 s.resetScope();assert.equal(s.getSnapshot().enabled,false);
});
test('ring evicts oldest at 100, bytes bounded, rejection/drop counters saturate',()=>{
 const s=setup();for(let i=0;i<120;i++){const h=s.begin('open-library',()=>true);s.complete(h,result('read'));s.finish(h);}
 const snap=s.getSnapshot();assert.equal(snap.events.length,100);assert.equal(snap.events[0].sequence,21);assert.equal(snap.droppedRecords,20);assert.ok(new TextEncoder().encode(JSON.stringify(snap.events)).length<=65536);
 s.complete(s.begin('play',()=>true),{...result('read'),raw:'canary'});assert.equal(s.getSnapshot().rejectedRecords,1);assert.equal(increment(MAX_COUNTER),MAX_COUNTER);assert.equal(increment(MAX_COUNTER-1),MAX_COUNTER);
});
test('review is exact, immutable, selective, bounded and issued; rejects tainted snapshots/selection',()=>{
 const s=setup();s.complete(s.begin('play',()=>true),result('play','autoplay-blocked','autoplay-denied'));
 const review=projectReview(s.getSnapshot(),{errors:['code','phase'],capabilities:['indexedDbApi'],limits:['mode']},caps);const original=serializeReviewed(review);
 assert.deepEqual(JSON.parse(original),{format:'pulso-web-diagnostics',version:1,datasets:{errors:[{phase:'play',code:'autoplay-denied'}],capabilities:{indexedDbApi:'available'},limits:{mode:'local'}}});
 s.clear();assert.equal(serializeReviewed(review),original);assert.ok(Object.isFrozen(review));assert.equal(review.bytes,new TextEncoder().encode(original).length);assert.throws(()=>serializeReviewed({...review}));
 assert.throws(()=>projectReview(s.getSnapshot(),{errors:[],capabilities:[],limits:[]},caps));
 let calls=0;const hostile=Object.defineProperty([],'0',{get(){calls++;return 'code';}});assert.throws(()=>projectReview(s.getSnapshot(),{...selection,errors:hostile},caps));assert.equal(calls,0);
 const events=Array.from({length:101},()=>({}));assert.throws(()=>projectReview({...s.getSnapshot(),events} as unknown as SessionSnapshot,selection,caps));
 const e={...result('read'),sequence:1,correlationId:randomUUID(),operation:'play',toJSON(){calls++;}};assert.throws(()=>projectReview({...s.getSnapshot(),events:[e]} as unknown as SessionSnapshot,selection,caps));assert.equal(calls,0);
 // Worst-case valid full projection stays below the hard byte budget.
 for(let i=0;i<100;i++)s.complete(s.begin('refresh-library',()=>true),result('reconcile','storage-unavailable','storage-unavailable','uncertain'));
 const full=projectReview(s.getSnapshot(),{errors:[...eventKeys],capabilities:[...capabilityFields],limits:['mode','sdk','browserEvidence','physicalEvidence']},caps);assert.ok(full.bytes<=65536);
});
test('closed domain mappings exhaustive and unknown DOM/worker causes remain honest',()=>{
 for(const code of ['invalid-input','conflict','empty','invalid-relation','not-found','busy','retry-required','storage','worker'] as const)assert.ok(validResult(mapBatch(code,'read')));
 for(const code of ['format','version','limits','relations','local-corrupt','busy','imports-unresolved','stale-preview','plan-expired','invalid-choice','fingerprint-conflict','export-reused','cancelled','quota','storage','uncertain'] as const)assert.ok(validResult(mapBackup(code,'commit')));
 assert.equal(mapBackup('quota','write').family,'quota');assert.equal(mapBackup('uncertain','commit').outcome,'uncertain');
 assert.equal(domFailure(new DOMException('canary','QuotaExceededError'),'write').code,'quota-exceeded');assert.equal(domFailure(new DOMException('canary','AbortError'),'write').code,'transaction-aborted');
 assert.equal(domFailure({name:'QuotaExceededError',message:'canary'},'read').code,'unknown');assert.equal(importFailure('import-failed').code,'unknown');assert.equal(importFailure('quota').family,'quota');
});
