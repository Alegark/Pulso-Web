import test from 'node:test';
import assert from 'node:assert/strict';
import {AppFailure,atBoundary,fromKnownError,issuedFailure,makeFailure,copyFailureV1,nativeDOMName} from '../../src/errors/app-failure';
import {Attempt,copyOutcomeV1,workerFailureOutcome} from '../../src/imports/import-outcome';
import {copyImportResult,copyWorkerResponse,createResponseGate,copyWorkerRequest} from '../../src/imports/import-protocol';
import {toDiagnosticResults} from '../../src/diagnostics/import-mapping';
const quota=makeFailure('write','quota','quota-exceeded','opfs');
const context={phase:'write',backend:'opfs'} as const;
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function hostile(){let calls=0;const getter=()=>{calls++;throw new Error('CANARY');};return {get calls(){return calls;},objects:[new Proxy({}, {getPrototypeOf:getter,ownKeys:getter,get:getter,getOwnPropertyDescriptor:getter}),Object.defineProperty({},'name',{get:getter}),Object.create(DOMException.prototype),Object.assign(new Error('CANARY'),{name:'QuotaExceededError'}),Object.defineProperty(new DOMException('CANARY','QuotaExceededError'),'name',{get:getter})]};}
test('native DOM brand is total; forged names/prototypes/proxies/getters do not escape',()=>{
 const h=hostile();for(const [index,v] of h.objects.entries()){const f=fromKnownError(v,context);assert.equal(f.code,index===4?'quota-exceeded':'unknown');}
 assert.equal(h.calls,0);assert.equal(nativeDOMName(null),null);assert.equal(fromKnownError(new DOMException('private','AbortError'),{phase:'write',backend:'idb'}).code,'transaction-aborted');
});
test('issued WeakMap identity; payload is closed/frozen and raw cause absent',()=>{
 const error=AppFailure.create(quota);assert.equal(issuedFailure(error)?.code,'quota-exceeded');assert.equal(issuedFailure(Object.create(AppFailure.prototype)),null);
 assert.deepEqual(Object.keys(issuedFailure(error)!),['version','phase','family','code','backend']);assert.ok(Object.isFrozen(issuedFailure(error)));assert.ok(!JSON.stringify(error).includes('CANARY'));
});
test('boundary preserves lower known phase and labels only unlocated abort',async()=>{
 const original=AppFailure.create(quota);await assert.rejects(atBoundary('commit','idb',()=>{throw original;}),e=>e===original);
 await assert.rejects(atBoundary('write','idb',()=>{throw AppFailure.create(makeFailure(null,'storage-unavailable','transaction-aborted','idb'));}),e=>issuedFailure(e)?.phase==='write');
});
test('closed failure pairs, exact keys, descriptors, version and hostile inputs',()=>{
 for(const value of [{...quota,family:'internal'},{...quota,version:2},{...quota,cause:'CANARY'},Object.defineProperty({...quota},'phase',{get(){throw Error();}}),null,false])assert.equal(copyFailureV1(value),null);
 assert.deepEqual(copyFailureV1(quota),quota);
});
test('outcome first cause preserved with both independent secondary failures',()=>{
 const a=new Attempt();a.failure(quota);a.failure(makeFailure('close','internal','unknown','opfs'));a.secondary('cleanup',makeFailure('open','internal','unknown','opfs'));a.secondary('reconcile',makeFailure('read','storage-unavailable','storage-denied','idb'));
 const o=a.outcome('unknown');assert.equal(o.primary?.code,'quota-exceeded');assert.equal(o.cleanup?.phase,'cleanup');assert.equal(o.reconcile?.phase,'reconcile');assert.equal(o.recoveryRequired,true);
 const mapped=toDiagnosticResults(o);assert.equal(mapped.primary?.code,'quota-exceeded');assert.equal(mapped.cleanup?.code,'storage-denied');
 assert.equal(copyOutcomeV1({...o,recoveryRequired:false}),null);assert.equal(copyOutcomeV1({...o,status:'confirmed'}),null);
 assert.equal(copyOutcomeV1({...o,version:2}),null);assert.equal(copyOutcomeV1({...o,status:{toString(){throw Error();}}}),null);
});
test('confirmed after reconciliation preserves primary; null phase projects transport',()=>{
 const a=new Attempt();a.failure(makeFailure(null,'internal','unknown','unknown'));const o=a.confirmed();assert.equal(o.status,'confirmed');assert.equal(toDiagnosticResults(o).primary?.phase,'transport');assert.equal(o.writeState,'published');
});
const track={id,assetId:id,title:'Private title',artist:null,album:null,duration:3,favorite:false,revision:1,createdAt:'2026-10-31T00:00:00Z',manualOverrides:{}};
test('strict LinkedTrack allows optional legacy fingerprint and rejects extras/accessors',()=>{
 const r={track,duplicate:true};assert.ok(copyImportResult(r));assert.ok(copyImportResult({...r,track:{...track,audioFingerprint:null}}));
 for(const invalid of [{...r,raw:'CANARY'},{...r,track:{...track,assetId:null}},{...r,track:{...track,audioFingerprint:{algorithm:'sha256',sha256:'a'.repeat(64),bytes:NaN}}},{...r,lyricsWarning:'CANARY'},{...r,lyricsInspection:{state:'preserved',reason:'CANARY'}},{...r,track:{...track,manualOverrides:{raw:'CANARY'}}}])assert.equal(copyImportResult(invalid),null);
});
test('worker response version, outcome/result coherence, matching IDs and monotonic progress',()=>{
 const a=new Attempt();const outcome=a.confirmed();const complete={version:2,operationId:id,type:'complete',result:{track,duplicate:false},outcome};assert.ok(copyWorkerResponse(complete));
 for(const r of [{...complete,version:1},{...complete,error:'CANARY'},{...complete,result:{track,duplicate:'true'}},{...complete,outcome:{...outcome,writeState:'unknown'}}])assert.equal(copyWorkerResponse(r),null);
 // A request File is private legitimate input, never part of Outcome.
 const gate=createResponseGate({version:2,type:'import',operationId:id,file:new File([new Uint8Array(12)],'private.wav')});
 assert.equal(gate({version:2,type:'progress',operationId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',bytes:1}).kind,'ignored');
 assert.equal(gate({version:2,type:'progress',operationId:id,bytes:10}).kind,'accepted');assert.equal(gate({version:2,type:'progress',operationId:id,bytes:9}).kind,'protocol');assert.equal(gate({version:2,type:'progress',operationId:id,bytes:13}).kind,'ignored');
});
test('DTO and request readers never execute accessors/toJSON; bounded arrays reject holes',()=>{
 let calls=0;const getter=()=>{calls++;throw Error('CANARY');};const bad=Object.defineProperty({version:2,type:'error',operationId:id,outcome:{}},'outcome',{get:getter});assert.equal(copyWorkerResponse(bad),null);
 assert.equal(copyWorkerRequest(new Proxy({}, {ownKeys:getter})),null);
 assert.equal(copyImportResult({track,duplicate:false,lyricsInspection:{state:'ready',text:'x',format:'plain',source:{kind:'embedded-id3',tag:'USLT',language:'eng',descriptor:''},warnings:new Array(2)}}),null);assert.equal(calls,1); // ownKeys trap must be caught; no property getter is invoked.
});

test('transport failures stay unlocated; recovery projection has no invented current commit',()=>{
 const o=workerFailureOutcome('worker-protocol');assert.equal(o.primary?.phase,null);assert.equal(o.writeState,'unknown');assert.equal(toDiagnosticResults(o).primary?.phase,'transport');
 const a=new Attempt();const recovered=toDiagnosticResults(a.confirmed(),'recovery');assert.equal(recovered.primary?.phase,'reconcile');assert.equal(recovered.primary?.outcome,'recovered');
});
test('descriptor snapshots cannot change validated version or bypass captured matching',()=>{
 const o=new Attempt().confirmed();let versions=0;
 const value=new Proxy({version:2,type:'complete',operationId:id,result:{track,duplicate:false},outcome:o},{getOwnPropertyDescriptor(target,key){const d=Reflect.getOwnPropertyDescriptor(target,key);return key==='version'&&d?{...d,value:++versions===1?2:1}:d;}});
 assert.equal(copyWorkerResponse(value)?.version,2);assert.equal(versions,1);
 let ids=0;const changing=new Proxy({version:2,type:'progress',operationId:id,bytes:1},{getOwnPropertyDescriptor(target,key){const d=Reflect.getOwnPropertyDescriptor(target,key);return key==='operationId'&&d?{...d,value:++ids===1?id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}:d;}});
 const gate=createResponseGate({version:2,type:'import',operationId:id,file:new File([new Uint8Array(3)],'private')});assert.equal(gate(changing).kind,'protocol');
});
