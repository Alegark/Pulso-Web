import {test} from 'node:test';
import assert from 'node:assert/strict';
import {copyRealmControl,realmControl} from '../../src/storage/database-realm-protocol';
import {beginWorkerAttempt,registerDatabaseRealmHost,activeDatabaseWorkerAttempts,reportDatabaseRealmLifecycle} from '../../src/storage/database-realms';
const id='00000000-0000-4000-8000-000000000001';
test('R44 F11 exact data-only closed control variants and real owner-proof grammar',()=>{
 const variants=[{type:'bind',attempt:id,kind:'import'},{type:'bound',attempt:id},{type:'anomaly',attempt:id,sequence:1,state:'connection-closed'},{type:'revoke',attempt:id,sequence:1},{type:'retired',attempt:id,sequence:1},{type:'not-ready',attempt:id,reason:'schema-not-ready'},{type:'sw-anomaly',state:'versionchange'},{type:'revalidate',requestId:id,ownerProof:`pulso-web:local:owner:${id}`},{type:'revalidated',requestId:id,state:'schema-not-ready'}];
 for(const value of variants){const dto={protocol:'pulso-idb-realm',version:1,...value};assert.deepEqual(copyRealmControl(dto),dto);assert.equal(copyRealmControl({...dto,unexpected:1}),null);}
 assert.equal(copyRealmControl(realmControl({type:'revalidate',requestId:id,ownerProof:id})),null);
 for(const sequence of [0,-1,NaN,Infinity,1.1,Number.MAX_SAFE_INTEGER+1])assert.equal(copyRealmControl(realmControl({type:'revoke',attempt:id,sequence})),null);
 for(const v of [{version:2},{attempt:'old'},{state:'ready'},{type:'grant'}])assert.equal(copyRealmControl({...realmControl({type:'anomaly',attempt:id,sequence:1,state:'blocked'}),...v}),null);
});
test('R44 F11 getters, symbols, exotic objects and throwing proxy traps fail closed',()=>{
 let calls=0;const value=realmControl({type:'bound',attempt:id});
 const getter={...value};Object.defineProperty(getter,'attempt',{get(){calls++;throw Error('private');},enumerable:true});
 assert.equal(copyRealmControl(getter),null);assert.equal(calls,0);
 assert.equal(copyRealmControl({...value,[Symbol('secret')]:1}),null);
 assert.equal(copyRealmControl(Object.assign(Object.create({}),value)),null);
 for(const trap of ['ownKeys','getOwnPropertyDescriptor','getPrototypeOf'])assert.equal(copyRealmControl(new Proxy(value,{[trap](){throw Error('private');}})),null);
 const revoked=Proxy.revocable(value,{});revoked.revoke();assert.equal(copyRealmControl(revoked.proxy),null);
});
class WorkerFixture extends EventTarget {
 port:MessagePort|null=null;terminations=0;fail=false;
 postMessage(value:unknown,ports:Transferable[]){if(this.fail)throw Error('TESTONLY bind failure');const m=copyRealmControl(value);assert(m?.type==='bind');this.port=ports[0] as MessagePort;this.port.postMessage(realmControl({type:'bound',attempt:m.attempt}));}
 terminate(){this.terminations++;this.port?.close();}
}
test('R44 F05/F11/F15 binding capture, stale notices, sequence, no grants, release once',async()=>{
 let ends=0,caller=true,captured=true;const states:string[]=[];
 const unregister=registerDatabaseRealmHost({capture:()=>({current:()=>captured,onLifecycle:s=>states.push(s),end:()=>{ends++;}}),onLifecycle:s=>states.push(s)});
 const w=new WorkerFixture();
 try{
  const a=await beginWorkerAttempt('import',w as unknown as Worker,()=>caller);assert(a.current());assert.equal(activeDatabaseWorkerAttempts(),1);
  const sent=(w.port! as MessagePort);const wait=()=>new Promise(r=>setTimeout(r,20));
  // Read actual attempt from original bind through fixture observation, without business IDs.
  let attempt='';const original=w.postMessage.bind(w);w.postMessage=(value,ports)=>{const m=copyRealmControl(value);if(m&&'attempt'in m)attempt=m.attempt;original(value,ports);};
  a.closeAfterSettlement();a.closeAfterSettlement();assert.equal(ends,1);assert.equal(w.terminations,1);
  const b=await beginWorkerAttempt('recovery',w as unknown as Worker,()=>caller);
  sent.close();caller=false;captured=false;
  w.port!.postMessage(realmControl({type:'anomaly',attempt:id,sequence:1,state:'blocked'}));await wait();assert.equal(states.length,0);
  w.port!.postMessage(realmControl({type:'anomaly',attempt,sequence:1,state:'versionchange'}));await wait();assert.deepEqual(states,['versionchange']);assert(!b.current());
  b.closeAfterSettlement();b.closeAfterSettlement();assert.equal(ends,2);assert.equal(activeDatabaseWorkerAttempts(),0);
  reportDatabaseRealmLifecycle('connection-closed');assert.equal(states.at(-1),'connection-closed');
 }finally{unregister();w.terminate();}
});
test('R44 F11 bind failure before dispatch releases capture once, missing host fails closed',async()=>{
 const w=new WorkerFixture();w.fail=true;let ends=0;
 const unregister=registerDatabaseRealmHost({capture:()=>({current:()=>true,onLifecycle:()=>{},end:()=>{ends++;}})});
 try{await assert.rejects(beginWorkerAttempt('batch',w as unknown as Worker,()=>true));assert.equal(ends,1);assert.equal(activeDatabaseWorkerAttempts(),0);}finally{unregister();}
 await assert.rejects(beginWorkerAttempt('copies',w as unknown as Worker,()=>true));assert.equal(ends,1);
});

test('R44 F11 matching malformed/sequence controls fail transport once; late closed callbacks cannot grant',async()=>{
 let ends=0,attempt='';const notices:string[]=[],failures:string[]=[];
 const unregister=registerDatabaseRealmHost({capture:()=>({current:()=>true,onLifecycle:s=>notices.push(s),end:()=>{ends++;}})});
 const w=new WorkerFixture(),post=w.postMessage.bind(w);w.postMessage=(value,ports)=>{const m=copyRealmControl(value);if(m&&'attempt'in m)attempt=m.attempt;post(value,ports);};
 try{const a=await beginWorkerAttempt('import',w as unknown as Worker,()=>true);a.onTransportFailure(code=>failures.push(code));
 w.port!.postMessage({...realmControl({type:'anomaly',attempt,sequence:1,state:'blocked'}),extra:true});
 await new Promise(r=>setTimeout(r,20));assert(!a.current());assert.deepEqual(failures,['worker-protocol']);assert.deepEqual(notices,[]);
 w.port!.postMessage(realmControl({type:'bound',attempt}));await new Promise(r=>setTimeout(r,20));assert.deepEqual(failures,['worker-protocol']);
 a.closeAfterSettlement();assert.equal(ends,1);assert.equal(activeDatabaseWorkerAttempts(),0);
 }finally{unregister();w.terminate();}
});
