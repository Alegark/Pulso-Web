import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {parseCommand,parseReply,type AuthCommand,type AuthScope} from '../../src/telegram/auth-protocol';
import {AuthCoordinator,type AuthDriverResult,type OfflineAuthDriver} from '../../src/telegram/auth-state';
import type {AuthScopeStore} from '../../src/telegram/auth-scope-store';
const id=()=>randomUUID();
const scope=():AuthScope=>({ownerId:id(),sessionSlotId:id(),generation:id(),accountId:null,namespaceId:null});
const command=(s:AuthScope,type='status',extra:object={},op=id())=>({version:1,requestId:id(),operationId:op,scope:s,type,...extra});
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(v:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function harness(){let now=1000;const calls:{kind:string;signal:AbortSignal;task:ReturnType<typeof deferred<AuthDriverResult>>}[]=[];let bindings=0,deletes=0;
 const driver:OfflineAuthDriver={begin:(_p,signal)=>add('phone',signal),code:(_p,_h,_c,signal)=>add('code',signal),password:(_p,signal)=>add('password',signal),close:async()=>{}};
 function add(kind:string,signal:AbortSignal){const task=deferred<AuthDriverResult>();calls.push({kind,signal,task});return task.promise;}
 const store:AuthScopeStore={register:async(_s,valid)=>{if(!valid())throw 0;},bind:async(s,a,n,valid)=>{if(!valid())throw 0;bindings++;return {...s,accountId:a,namespaceId:n};},tombstone:async()=>{},cleanup:async()=>{deletes++;return true;}};
 const c=new AuthCoordinator(scope(),store,driver,()=>now,id);
 return {c,calls,store,get bindings(){return bindings;},get deletes(){return deletes;},advance(){now+=40000;},send:(type:string,extra:object={},op=id())=>c.handle(command(c.snapshot().scope,type,extra,op)),tick:()=>new Promise(r=>setImmediate(r))};
}
test('bounded closed protocol rejects prototypes, accessors, extras, secrets, versions and budgets',()=>{
 const good=command(scope());assert.ok(parseCommand(good));
 for(const v of [null,[],Object.create(good),{...good,version:2},{...good,scope:{...good.scope,accountId:'123'}},{...good,rpc:'x'},{...good,exportSession:true},{...good,session:'x'},{...good,botToken:'x'},{...good,type:'begin-phone',phone:'x'.repeat(33)},{...good,type:'submit-code',code:'x'.repeat(65)},{...good,type:'submit-password',password:'x'.repeat(1025)},{...good,scope:{...good.scope,ownerId:'bad'}},{...good,scope:{...good.scope,accountId:'1e3',namespaceId:id()}}])assert.equal(parseCommand(v),null);
 const hidden={...good};Object.defineProperty(hidden,'session',{value:'CANARY'});assert.equal(parseCommand(hidden),null);
 const getter={...good};Object.defineProperty(getter,'type',{enumerable:true,get(){throw Error('must not read');}});assert.equal(parseCommand(getter),null);
 const huge:any={...good};for(let i=0;i<100000;i++)huge['x'+i]='';assert.equal(parseCommand(huge),null);
});
test('default disabled, claimed owner/account cannot authenticate, replies validate both sides',async()=>{
 const h=harness(),s=scope(),c=new AuthCoordinator(s,h.store);const cmd=command(s,'begin-phone',{phone:'synthetic'});const r=await c.handle(cmd);assert.equal(r?.type,'error');assert.ok(parseReply(r,cmd as AuthCommand));assert.equal(parseReply({...r,session:'CANARY'},cmd as AuthCommand),null);assert.equal(parseReply(r,{...cmd,requestId:id()} as AuthCommand),null);
 assert.equal((await h.c.handle(command({...h.c.snapshot().scope,ownerId:id()},'begin-phone',{phone:'x'})))?.type,'error');
});
for(const phase of ['phone','code','password'])for(const same of [true,false])for(const late of ['success','error'])test(`stale ${phase} ${late}, A→${same?'A':'B'} cannot publish/bind/finally`,async()=>{
 const h=harness(),op=id();let old=h.send('begin-phone',{phone:'synthetic-A'},op);await h.tick();
 if(phase!=='phone'){h.calls.at(-1)!.task.resolve({kind:'challenge',challenge:'HASH_CANARY'});await old;old=h.send('submit-code',{code:'CODE_CANARY'},op);await h.tick();}
 if(phase==='password'){h.calls.at(-1)!.task.resolve({kind:'password-needed'});await old;old=h.send('submit-password',{password:'PASSWORD_CANARY'},op);await h.tick();}
 const stale=h.calls.at(-1)!;const fresh=h.send('begin-phone',{phone:same?'synthetic-A':'synthetic-B'});await h.tick();assert.equal(stale.signal.aborted,true);
 if(late==='success')stale.task.resolve({kind:'verified-user',accountId:'123',isBot:false});else stale.task.reject(Error('RAW_CANARY'));
 assert.equal(await old,null);assert.equal(h.bindings,0);assert.equal(h.c.snapshot().phase,'connecting');h.calls.at(-1)!.task.resolve({kind:'challenge',challenge:'new'});assert.ok(await fresh);
});
test('only internal verified nonbot binds; cross-cancel, postresponse cancel and timeout do not revoke',async()=>{
 const h=harness(),op=id();const p=h.send('begin-phone',{phone:'synthetic'},op);await h.tick();assert.equal((await h.send('cancel',{targetOperationId:id()},op))?.type,'error');h.calls[0]!.task.resolve({kind:'verified-user',accountId:'123',isBot:false});await p;assert.equal(h.c.snapshot().phase,'ready');assert.equal(h.bindings,1);assert.equal((await h.send('cancel',{targetOperationId:op},op))?.type,'error');assert.equal(h.deletes,0);
 const t=harness(),pending=t.send('begin-phone',{phone:'synthetic'});await t.tick();t.advance();t.c.expire();assert.equal(t.calls[0]!.signal.aborted,true);t.calls[0]!.task.resolve({kind:'verified-user',accountId:'123',isBot:false});assert.equal(await pending,null);assert.equal(t.c.snapshot().revocation,'not-requested');assert.equal(t.deletes,0);
 const b=harness(),bp=b.send('begin-phone',{phone:'synthetic'});await b.tick();b.calls[0]!.task.resolve({kind:'verified-user',accountId:'123',isBot:true} as any);await bp;assert.notEqual(b.c.snapshot().phase,'ready');
});
for(const [code,family,phase,remote] of [['expired','auth-expired','expired','unavailable'],['offline','network','failed','offline'],['unsupported','unsupported','failed','unavailable'],['rate-limit','rate-limited','failed','unavailable']] as const)test(`safe ${code}, no automatic retry`,async()=>{
 const h=harness(),p=h.send('begin-phone',{phone:'synthetic'});await h.tick();h.calls[0]!.task.reject({family,code,...(code==='rate-limit'?{retryAt:2000}:{})});const r=await p;assert.equal(r?.type,'error');assert.equal(h.c.snapshot().phase,phase);assert.equal(h.c.snapshot().remote,remote);assert.equal(h.calls.length,1);if(code==='rate-limit'){await h.send('begin-phone',{phone:'synthetic'});assert.equal(h.calls.length,1);}
});
test('logout closes admission before await, stale auth cannot bind and offline never confirms revocation',async()=>{
 const h=harness(),p=h.send('begin-phone',{phone:'synthetic'});await h.tick();const gate=deferred<void>();h.store.tombstone=()=>gate.promise;
 const logout=h.send('disconnect',{mode:'remote-and-local'});assert.equal(h.c.snapshot().localSession,'cleanup-pending');assert.equal(h.calls[0]!.signal.aborted,true);await h.send('begin-phone',{phone:'B'});assert.equal(h.calls.length,1);h.calls[0]!.task.resolve({kind:'verified-user',accountId:'123',isBot:false});assert.equal(await p,null);gate.resolve();await logout;assert.equal(h.c.snapshot().revocation,'unconfirmed');assert.equal(h.c.snapshot().localSession,'absent');
});
for(const phase of ['phone','code','password'])test(`cancel and timeout suppress late success/error in ${phase}`,async()=>{
 for(const mode of ['cancel','timeout'])for(const outcome of ['success','error']){
  const h=harness(),op=id();let p=h.send('begin-phone',{phone:'SYNTHETIC'},op);await h.tick();
  if(phase!=='phone'){h.calls.at(-1)!.task.resolve({kind:'challenge',challenge:'HASH'});await p;p=h.send('submit-code',{code:'CODE'},op);await h.tick();}
  if(phase==='password'){h.calls.at(-1)!.task.resolve({kind:'password-needed'});await p;p=h.send('submit-password',{password:'PASSWORD'},op);await h.tick();}
  if(mode==='cancel')await h.send('cancel',{targetOperationId:op},op);else {h.advance();h.c.expire();}
  if(outcome==='success')h.calls.at(-1)!.task.resolve({kind:'verified-user',accountId:'123',isBot:false});else h.calls.at(-1)!.task.reject({family:'auth-expired',code:'expired'});
  assert.equal(await p,null);assert.equal(h.bindings,0);assert.equal(h.deletes,0);assert.equal(h.c.snapshot().revocation,'not-requested');
 }
});
test('new account uses its own slot/namespace; current verified slot never inherits B',async()=>{
 const a=harness(),b=harness();const pa=a.send('begin-phone',{phone:'A'}),pb=b.send('begin-phone',{phone:'B'});await a.tick();a.calls[0]!.task.resolve({kind:'verified-user',accountId:'123',isBot:false});b.calls[0]!.task.resolve({kind:'verified-user',accountId:'456',isBot:false});await pa;await pb;
 assert.notEqual(a.c.snapshot().scope.sessionSlotId,b.c.snapshot().scope.sessionSlotId);assert.notEqual(a.c.snapshot().scope.namespaceId,b.c.snapshot().scope.namespaceId);assert.equal((await a.send('begin-phone',{phone:'B'}))?.type,'error');assert.equal(a.c.snapshot().scope.accountId,'123');
});
test('malformed raw errors and unconfirmed connected results never leak or authenticate',async()=>{
 for(const raw of [Error('RAW_SECRET_CANARY'),{family:'network',code:'offline',session:'SESSION_CANARY'},{family:'rate-limited',code:'rate-limit',retryAt:Infinity}]){
 const h=harness(),p=h.send('begin-phone',{phone:'PHONE_CANARY'});await h.tick();h.calls[0]!.task.reject(raw);const reply=await p;assert.equal(reply?.type,'error');assert.ok(!JSON.stringify(reply).includes('CANARY'));assert.notEqual(h.c.snapshot().phase,'ready');}
 const h=harness(),p=h.send('begin-phone',{phone:'synthetic'});await h.tick();h.calls[0]!.task.resolve({kind:'connected'} as any);await p;assert.notEqual(h.c.snapshot().phase,'ready');
});
test('reply parser closes extras, secret fields, invalid state and unbounded errors',()=>{
 const c=command(scope()) as AuthCommand,e={version:1,requestId:c.requestId,operationId:c.operationId,scope:c.scope};
 for(const error of [{family:'other',code:'internal'},{family:'internal',code:'RAW_SECRET'},{family:'network',code:'offline',message:'RAW'},{family:'rate-limited',code:'rate-limit',retryAt:NaN},{family:'rate-limited',code:'rate-limit',retryAt:-1}])assert.equal(parseReply({...e,type:'error',error},c),null);
 assert.equal(parseReply({...e,type:'state',state:{phase:'ready',remote:'connected',revocation:'not-requested',localSession:'present',scope:c.scope}},c),null);
 assert.equal(parseReply({...e,type:'cancelled',password:'X'},c),null);
});
for(const failure of ['tombstone','close'] as const)test(`disconnect ${failure} failure independently stops driver, keeps quarantine and retries safely`,async()=>{
 let marked=false,closes=0,deletes=0,fail=true;
 const store:AuthScopeStore={register:async()=>{},bind:async(s,accountId,namespaceId)=>({...s,accountId,namespaceId}),tombstone:async()=>{if(failure==='tombstone'&&fail)throw Error('fixture');marked=true;},cleanup:async()=>{assert.ok(marked);deletes++;return true;}};
 const driver:OfflineAuthDriver={begin:async()=>({kind:'verified-user',accountId:'123',isBot:false}),code:async()=>({kind:'password-needed'}),password:async()=>({kind:'password-needed'}),close:async()=>{closes++;if(failure==='close'&&fail)throw Error('fixture');}};
 const c=new AuthCoordinator(scope(),store,driver),send=(type:string,extra:object={})=>c.handle(command(c.snapshot().scope,type,extra));
 await send('begin-phone',{phone:'synthetic'});assert.equal(c.snapshot().phase,'ready');const generation=c.snapshot().scope.generation;
 const pending=send('disconnect',{mode:'remote-and-local'});assert.notEqual(c.snapshot().scope.generation,generation);assert.equal(c.snapshot().localSession,'cleanup-pending');
 assert.equal((await pending)?.type,'error');assert.equal(closes,1);assert.equal(marked,failure==='close');assert.equal(deletes,0);assert.equal(c.snapshot().revocation,'unconfirmed');
 const denied=await send('begin-phone',{phone:'synthetic'});assert.equal(denied?.type,'error');if(denied?.type==='error')assert.equal(denied.error.code,'cleanup');
 fail=false;await send('disconnect',{mode:'local-only'});assert.equal(closes,failure==='close'?2:1);assert.equal(deletes,1);assert.equal(c.snapshot().localSession,'absent');
});
test('coordinator close suppresses pending disconnect replies and cleanup after IO',async()=>{
 const h=harness(),gate=deferred<void>();h.store.tombstone=()=>gate.promise;
 const p=h.send('disconnect',{mode:'local-only'});h.c.close();gate.resolve();assert.equal(await p,null);assert.equal(h.deletes,0);
});
