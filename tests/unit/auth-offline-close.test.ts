import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {AuthCoordinator,type OfflineAuthDriver,type AuthDriverResult} from '../../src/telegram/auth-state';
import type {AuthScopeStore} from '../../src/telegram/auth-scope-store';
import type {AuthScope} from '../../src/telegram/auth-protocol';
const scope=():AuthScope=>({ownerId:id(),sessionSlotId:id(),generation:id(),namespaceId:null,accountId:null});
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(close:()=>Promise<void>,begin:OfflineAuthDriver['begin']=async()=>({kind:'verified-user',accountId:'123',isBot:false})){
 let deletes=0,marks=0,binds=0;
 const store:AuthScopeStore={register:async()=>{},bind:async(s,accountId,namespaceId,current)=>{assert.ok(current());binds++;return {...s,accountId,namespaceId};},tombstone:async()=>{marks++;},cleanup:async()=>{deletes++;return true;}};
 const driver:OfflineAuthDriver={close,begin,code:async()=>({kind:'password-needed'}),password:async()=>({kind:'password-needed'})};
 const c=new AuthCoordinator(scope(),store,driver);
 const send=(type:string,extra:object={})=>c.handle({version:1,scope:c.snapshot().scope,requestId:id(),operationId:id(),type,...extra});
 return {c,store,send,get deletes(){return deletes;},get marks(){return marks;},get binds(){return binds;}};
}
test('close from ready invalidates synchronously, shares one pending close and preserves session/D10',async()=>{
 const gate=deferred<void>();let closes=0;const h=fixture(()=>{closes++;return gate.promise;});await h.send('begin-phone',{phone:'synthetic'});
 const before=h.c.snapshot(),p=h.c.close();assert.notEqual(h.c.snapshot().scope.generation,before.scope.generation);assert.equal(h.c.snapshot().phase,'cancelled');assert.equal(h.c.snapshot().remote,'unavailable');assert.equal(h.c.snapshot().localSession,'present');
 assert.equal(h.c.close(),p);assert.equal(h.c.retryClose(),p);await tick();assert.equal(closes,1);assert.equal(await h.send('disconnect',{mode:'local-only'}),null);
 const after=h.c.snapshot();gate.resolve();assert.equal(await p,true);assert.equal(await h.c.close(),true);assert.equal(closes,1);assert.deepEqual(h.c.snapshot(),after);assert.equal(h.deletes,0);assert.equal(h.marks,0);
});
for(const synchronous of [false,true])test(`close observes ${synchronous?'sync throw':'async rejection'}, explicit retry succeeds without readmission`,async()=>{
 let calls=0;const h=fixture(()=>{if(++calls===1){if(synchronous)throw Error('SECRET_CANARY');return Promise.reject(Error('SECRET_CANARY'));}return Promise.resolve();});
 await h.send('begin-phone',{phone:'synthetic'});h.c.close(); // Deliberately no await; test runner observes unhandled rejections.
 await tick();assert.equal(await h.c.close(),false);assert.equal(calls,1);const s=h.c.snapshot();assert.equal(await h.c.retryClose(),true);assert.equal(calls,2);assert.deepEqual(h.c.snapshot(),s);assert.equal(await h.send('status'),null);assert.equal(h.deletes,0);assert.equal(h.marks,0);
});
test('hanging close remains pending without false confirmation or overlapping retry',async()=>{
 const gate=deferred<void>();let calls=0,settled=false;const h=fixture(()=>{calls++;return gate.promise;});const p=h.c.close();void p.then(()=>settled=true);await tick();assert.equal(settled,false);assert.equal(h.c.retryClose(),p);assert.equal(calls,1);assert.equal(h.c.snapshot().remote,'unavailable');gate.resolve();assert.equal(await p,true);
});
for(const order of ['mark-first','close-first'])test(`close races disconnect ${order}: no duplicate shutdown, cleanup or stale state`,async()=>{
 const gate=deferred<void>(),mark=deferred<void>();let calls=0;const h=fixture(()=>{calls++;return gate.promise;});await h.send('begin-phone',{phone:'synthetic'});h.store.tombstone=()=>mark.promise;
 const disconnect=h.send('disconnect',{mode:'remote-and-local'});await tick();assert.equal(calls,1);
 if(order==='mark-first')mark.resolve();else gate.resolve();
 const p=h.c.close(),s=h.c.snapshot();assert.equal(h.c.close(),p);mark.resolve();gate.resolve();assert.equal(await p,true);assert.equal(await disconnect,null);assert.equal(calls,1);assert.equal(h.deletes,0);assert.deepEqual(h.c.snapshot(),s);
});
for(const stage of ['register','driver','bind'])for(const outcome of ['success','error'])test(`close fences ignored abort and pending ${stage} ${outcome}`,async()=>{
 const gate=deferred<AuthDriverResult>(),io=deferred<void>();let signal:AbortSignal|undefined,calls=0;
 const h=fixture(async()=>{},async(_p,s)=>{signal=s;calls++;return stage==='driver'?gate.promise:{kind:'verified-user',accountId:'123',isBot:false};});
 if(stage==='register')h.store.register=()=>io.promise;
 if(stage==='bind')h.store.bind=async(s,accountId,namespaceId,current)=>{await io.promise;if(outcome==='error')throw Error('SECRET');assert.equal(current(),false);return {...s,accountId,namespaceId};};
 const task=h.send('begin-phone',{phone:'synthetic'});await tick();const p=h.c.close(),after=h.c.snapshot();
 if(stage==='driver'){if(outcome==='error')gate.reject(Error('SECRET'));else gate.resolve({kind:'verified-user',accountId:'123',isBot:false});}
 else if(stage==='register'&&outcome==='error')io.reject(Error('SECRET'));else io.resolve();
 assert.equal(await task,null);assert.equal(await p,true);if(signal)assert.ok(signal.aborted);assert.deepEqual(h.c.snapshot(),after);assert.equal(h.c.snapshot().scope.accountId,null);assert.equal(h.binds,0);assert.equal(h.deletes,0);assert.equal(h.marks,0);if(stage==='register')assert.equal(calls,0);
});
