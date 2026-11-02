import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import Long from 'long';
import {createBotProvidersDriver,botProvidersFailure,type BotProvidersClock} from '../../src/telegram/bot-providers-driver';
import {parseBotProvidersReply,type BotProvidersReply} from '../../src/telegram/bot-providers-protocol';
const deferred=<T=unknown>()=>{let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise<void>(r=>setImmediate(r));
function fakeClock(){let now=1000,id=0;const timers=new Map<number,{at:number;fn:()=>void}>();return {now:()=>now,setTimeout(fn:()=>void,ms:number){const n=++id;timers.set(n,{at:now+ms,fn});return n;},clearTimeout(n:number){timers.delete(n);},jump(ms:number){now+=ms;},advance(ms:number){const end=now+ms;for(;;){const due=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();}now=end;},timers} as unknown as BotProvidersClock&{jump(ms:number):void;advance(ms:number):void;timers:Map<number,unknown>};}
function raw(username='alpha',id=101,extra:Record<string,unknown>={}){return {_: 'contacts.resolvedPeer',peer:{_: 'peerUser',userId:id},chats:[],users:[{_: 'user',id,bot:true,username,accessHash:new Long(123,45,false),firstName:'\u202eNombre\n de prueba',...extra}]};}
function setup(resolver:(username:string,signal:AbortSignal)=>Promise<unknown>=async u=>raw(u)){
 const binding={accountRef:randomUUID(),accountEpoch:3},sessionId=randomUUID(),time=fakeClock();let calls=0,invalidations=0;
 const driver=createBotProvidersDriver(binding,sessionId,{async resolveIdentity(u,s){calls++;return resolver(u,s);},invalidateSession(){invalidations++;}},time);
 const ctx={signal:new AbortController().signal,current:()=>true};
 const e=(providerRevision=driver.getSnapshot()?.revision??0,operationId=randomUUID())=>({protocol:'pulso-bot-providers' as const,version:1 as const,...binding,sessionId,providerRevision,operationId,requestId:randomUUID()});
 const command=async (x:Record<string,unknown>,context=ctx)=>{const v={...e(),...x};const r=await driver.handle(v,context);if(r)assert.ok(parseBotProvidersReply(r,v as never));return r!;};
 const validate=async(input:string)=>{const r=await command({type:'bots.validate',input});assert.equal(r.type,'bots.validated');return (r as Extract<BotProvidersReply,{type:'bots.validated'}>).offer;};
 const order=(refs:string[],extra:Record<string,unknown>={})=>command({type:'bots.setOrder',expectedRevision:driver.getSnapshot()!.revision,providerRefs:refs,...extra});
 return {driver,time,ctx,e,command,validate,order,get calls(){return calls;},get invalidations(){return invalidations;}};
}
test('empty construction/order/access make no RPC; validation is an offer, not pool ACK',async()=>{
 const s=setup();assert.deepEqual(s.driver.getSnapshot(),{revision:0,providers:[]});const zero=await s.order([]);assert.equal(zero.type,'bots.ordered');assert.equal('changed'in zero&&zero.changed,false);assert.equal(s.calls,0);
 const offer=await s.validate('@Alpha');assert.equal(offer.compatibility,'unverified');assert.equal(offer.label,'Nombre de prueba');assert.deepEqual(s.driver.getSnapshot(),{revision:0,providers:[]});assert.equal(s.calls,1);
 await s.order([offer.providerRef]);assert.equal(s.calls,1);assert.equal(s.driver.getSnapshot()!.revision,1);assert.equal(s.driver.getSnapshot()!.providers.length,1);
 s.time.jump(10**9);assert.equal(s.driver.getSnapshot()!.providers.length,1,'order has no arbitrary TTL');s.driver.close();
});
test('five unique bots ACK, sixth/duplicates rejected; no RPC for order/remove/reorder',async()=>{
 let id=100;const s=setup(async u=>raw(u,++id));const offers=[];for(const u of ['alpha','bravo','charlie','delta','echo','foxtrot'])offers.push(await s.validate(u));
 assert.equal(await s.driver.handle({...s.e(),type:'bots.setOrder',expectedRevision:0,providerRefs:offers.map(x=>x.providerRef)},s.ctx),null);
 assert.equal(await s.driver.handle({...s.e(),type:'bots.setOrder',expectedRevision:0,providerRefs:[offers[0].providerRef,offers[0].providerRef]},s.ctx),null);
 await s.order(offers.slice(0,5).map(x=>x.providerRef));const before=s.calls;await s.order(s.driver.getSnapshot()!.providers.map(x=>x.providerRef).reverse());await s.order([]);assert.equal(s.calls,before);assert.equal(s.driver.getSnapshot()!.revision,3);s.driver.close();
});
test('aliases deduplicate by internal bot id; inactive alias/human/min/deleted/hash unsafe rejected',async()=>{
 const s=setup(async u=>raw('alpha',101,{usernames:[{_: 'username',username:u,active:true}]}));const a=await s.validate('Alpha'),b=await s.validate('short');assert.equal(a.providerRef,b.providerRef);assert.deepEqual(Object.keys(a).sort(),['compatibility','label','providerRef','status','username']);
 s.driver.close();
 for(const extra of [{bot:false},{min:true},{deleted:true},{id:0},{accessHash:Long.ZERO},{accessHash:123},{accessHash:{low:1,high:0,unsigned:false}},{accessHash:new Long(1,0,true)},{username:'other'},{username:'other',usernames:[{_: 'username',username:'alpha',active:false}]}]){
  const t=setup(async()=>raw('alpha',101,extra));const r=await t.command({type:'bots.validate',input:'alpha'});assert.equal(r.type==='bots.error'&&r.error,'unsupported');t.driver.close();
 }
});
test('wrong peer, duplicate/missing user, unsupported shape/accessor/budgets rejected without getters',async()=>{
 let getter=0;const access=raw();Object.defineProperty(access.users[0],'firstName',{enumerable:true,get(){getter++;return 'x';}});
 const wrong=raw();wrong.peer._='peerChannel';const dup=raw();dup.users.push({...dup.users[0]});
 for(const value of [wrong,dup,{...raw(),users:[]},access,{...raw(),other:()=>{}},{...raw(),users:Array(65).fill(null)},{...raw(),incidental:'x'.repeat(1100000)},new Proxy({}, {getPrototypeOf(){throw Error('proxy');}})]){
  const t=setup(async()=>value);assert.equal((await t.command({type:'bots.validate',input:'alpha'}) as {error:string}).error,'unsupported');t.driver.close();
 }assert.equal(getter,0);
});
test('username transfer closes exact driver instead of replacing selected identity',async()=>{
 let id=101;const s=setup(async u=>raw(u,id));const a=await s.validate('alpha');await s.order([a.providerRef]);id=202;
 const r=await s.command({type:'bots.validate',input:'alpha'});assert.equal(r.type==='bots.error'&&r.error,'identity-changed');assert.equal(s.invalidations,1);assert.equal(s.driver.getSnapshot(),null);
});
test('CAS/noop/ABA, discarded offers, forged refs, cross-driver/binding and replay',async()=>{
 let id=100;const s=setup(async u=>raw(u,++id));const a=await s.validate('alpha'),b=await s.validate('bravo'),c=await s.validate('charlie');
 await s.order([a.providerRef,b.providerRef]);const capture=s.e();await s.order([b.providerRef,a.providerRef]);await s.order([a.providerRef,b.providerRef]);assert.equal(s.driver.getSnapshot()!.revision,3);
 assert.equal((await s.command({...capture,type:'bots.setOrder',expectedRevision:1,providerRefs:[]} ) as {error:string}).error,'expired');
 assert.equal((await s.order([a.providerRef,c.providerRef]) as {error:string}).error,'expired');assert.equal((await s.order([randomUUID()]) as {error:string}).error,'expired');
 const no=await s.order([a.providerRef,b.providerRef]);assert.equal(no.type==='bots.ordered'&&no.changed,false);assert.equal(s.driver.getSnapshot()!.revision,3);
 const request={...s.e(),type:'bots.setOrder',expectedRevision:3,providerRefs:[]};await s.driver.handle(request,s.ctx);assert.equal((await s.driver.handle(request,s.ctx) as {error:string}).error,'expired');
 const t=setup();assert.equal((await t.order([a.providerRef]) as {error:string}).error,'expired');assert.equal((await s.driver.handle({...s.e(),accountRef:randomUUID(),type:'bots.validate',input:'x'},s.ctx) as {error:string}).error,'session-expired');assert.equal(t.calls,0);s.driver.close();t.driver.close();
});
test('detached snapshots and same-gesture validate→setOrder plan allowed, repeated plan step rejected',async()=>{
 const s=setup();const operationId=randomUUID();const v=await s.command({operationId,type:'bots.validate',input:'alpha'});assert.equal(v.type,'bots.validated');const ref=v.type==='bots.validated'?v.offer.providerRef:'';
 const r=await s.order([ref],{operationId});assert.equal(r.type,'bots.ordered');assert.equal((await s.order([],{operationId}) as {error:string}).error,'expired');
 const snap=s.driver.getSnapshot()!;assert.throws(()=>{(snap.providers as unknown[]).push({});});assert.equal(s.driver.getSnapshot()!.providers.length,1);assert.notEqual(snap.providers,s.driver.getSnapshot()!.providers);s.driver.close();
});
test('captured root epochs do not revive after ABA; no IO with false/throwing guard',async()=>{
 const gate=deferred(),s=setup(()=>gate.promise);let epoch=1;const captured=epoch;
 const p=s.command({type:'bots.validate',input:'alpha'},{signal:s.ctx.signal,current:()=>epoch===captured});await tick();epoch++;epoch++;gate.resolve(raw());assert.equal((await p as {error:string}).error,'cancelled');assert.equal(s.driver.getSnapshot()!.providers.length,0);
 const n=s.calls;await s.command({type:'bots.validate',input:'alpha'},{signal:s.ctx.signal,current:()=>false});await s.command({type:'bots.validate',input:'alpha'},{signal:s.ctx.signal,current:()=>{throw Error();}});assert.equal(s.calls,n);s.driver.close();
});
test('cancel ACK does not release settlement or permit another validation; cooperative settlement true',async()=>{
 const gate=deferred(),s=setup(()=>gate.promise),e=s.e();const p=s.command({...e,type:'bots.validate',input:'alpha'});await tick();
 const c=await s.command({operationId:e.operationId,type:'bots.cancel',targetRequestId:e.requestId});assert.equal(c.type,'bots.cancelled');assert.equal((await p as {error:string}).error,'cancelled');let settled=false;void s.driver.whenSettled().then(()=>{settled=true;});await tick();assert.equal(settled,false);
 assert.equal((await s.command({type:'bots.validate',input:'bravo'}) as {error:string}).error,'busy');assert.equal(s.calls,1);gate.resolve(raw());assert.equal(await s.driver.whenSettled(),true);s.driver.close();
});
test('uncooperative transport closes after grace; settlement stays false after late response',async()=>{
 const gate=deferred(),s=setup(()=>gate.promise),abort=new AbortController();const p=s.command({type:'bots.validate',input:'alpha'},{signal:abort.signal,current:()=>true});await tick();abort.abort();assert.equal((await p as {error:string}).error,'cancelled');s.time.advance(1999);assert.ok(s.driver.getSnapshot());s.time.advance(1);assert.equal(await s.driver.whenSettled(),false);assert.equal(s.invalidations,1);gate.resolve(raw());await tick();assert.equal(await s.driver.whenSettled(),false);assert.equal(s.driver.getSnapshot(),null);
});
test('absolute deadline survives suspended timer; timeout abort and grace tested separately',async()=>{
 const gate=deferred(),s=setup(()=>gate.promise);const p=s.command({type:'bots.validate',input:'alpha'});await tick();s.time.jump(15001);gate.resolve(raw());assert.equal((await p as {error:string}).error,'timeout');assert.equal(await s.driver.whenSettled(),true);assert.equal(s.driver.getSnapshot()!.providers.length,0);s.driver.close();
 let signal:AbortSignal;const t=setup(async(_u,a)=>{signal=a;return new Promise(()=>{});});const q=t.command({type:'bots.validate',input:'alpha'});await tick();t.time.advance(15000);assert.equal((await q as {error:string}).error,'timeout');assert.ok(signal!.aborted);t.time.advance(2000);assert.equal(await t.driver.whenSettled(),false);
});
test('late SDK revocation independently invalidates after cancel; first SDK cause beats late cancel',async()=>{
 const gate=deferred(),s=setup(()=>gate.promise),e=s.e();const p=s.command({...e,type:'bots.validate',input:'alpha'});await tick();await s.command({operationId:e.operationId,type:'bots.cancel',targetRequestId:e.requestId});assert.equal((await p as {error:string}).error,'cancelled');gate.reject({text:'SESSION_REVOKED'});await tick();assert.equal(s.invalidations,1);assert.equal(s.driver.getSnapshot(),null);assert.equal(await s.driver.whenSettled(),true);
 const t=setup(async()=>{throw {text:'AUTH_KEY_UNREGISTERED'};});assert.equal((await t.command({type:'bots.validate',input:'alpha'}) as {error:string}).error,'session-expired');assert.equal(t.invalidations,1);
});
test('late account flood retained; >24h absolute deadline, unknown flood blocks, no order/list bypass',async()=>{
 const gate=deferred(),s=setup(()=>gate.promise),e=s.e();const p=s.command({...e,type:'bots.validate',input:'alpha'});await tick();await s.command({operationId:e.operationId,type:'bots.cancel',targetRequestId:e.requestId});await p;gate.reject({text:'FLOOD_WAIT_172800'});await tick();
 const f=await s.command({type:'bots.validate',input:'bravo'});assert.equal(f.type==='bots.error'&&f.error,'rate-limit');assert.equal(f.type==='bots.error'&&f.retryAt,172801000);await s.order([]);s.time.jump(86400001);await s.command({type:'bots.validate',input:'bravo'});assert.equal(s.calls,1);s.driver.close();
 const t=setup(async()=>{throw {text:'FLOOD_WAIT_unknown'};});const q=await t.command({type:'bots.validate',input:'alpha'});assert.equal(q.type==='bots.error'&&q.retryBlocked,true);t.time.jump(10**12);await t.order([]);await t.command({type:'bots.validate',input:'bravo'});assert.equal(t.calls,1);t.driver.close();
 assert.equal(botProvidersFailure(new Proxy({}, {getOwnPropertyDescriptor(){throw Error();}}),1000).error,'network');
});
test('offers and command IDs bounded; close/quiesce invalidates and purges',async()=>{
 let id=1;const s=setup(async u=>raw(u,++id));for(let i=0;i<64;i++)await s.validate('u'+i);assert.equal((await s.command({type:'bots.validate',input:'next'}) as {error:string}).error,'limit');assert.equal(s.calls,64);assert.equal(await s.driver.quiesce(),true);assert.equal(s.driver.getSnapshot(),null);
 const t=setup();for(let i=0;i<256;i++)await t.order([]);assert.equal((await t.order([]) as {error:string}).error,'limit');assert.equal(t.invalidations,1);assert.equal(t.calls,0);
});

test('guard function itself stays captured; root authority dimensions use monotonic epochs',async()=>{
 for(const dimension of ['review','foreignMutation','scopeProof','activity','database','worker','binding']){
  const gate=deferred(),s=setup(()=>gate.promise),epochs={[dimension]:1},captured=epochs[dimension];
  const context={signal:s.ctx.signal,current:()=>epochs[dimension]===captured};
  const p=s.command({type:'bots.validate',input:'alpha'},context);await tick();epochs[dimension]++;epochs[dimension]++;context.current=()=>true;
  gate.resolve(raw());assert.equal((await p as {error:string}).error,'cancelled',dimension);assert.equal(s.driver.getSnapshot()!.providers.length,0);s.driver.close();
 }
});
test('deadline is rechecked after projection and pre-dispatch aborted work performs zero RPC',async()=>{
 const gate=deferred(),s=setup(()=>gate.promise);let now=1000,reads=0;
 s.time.now=()=>{reads++;return reads>=4?17000:now;};
 const p=s.command({type:'bots.validate',input:'alpha'});await tick();now=1001;gate.resolve(raw());assert.equal((await p as {error:string}).error,'timeout');assert.equal(s.driver.getSnapshot()!.providers.length,0);s.driver.close();
 const t=setup(),a=new AbortController();a.abort();assert.equal((await t.command({type:'bots.validate',input:'alpha'},{signal:a.signal,current:()=>true}) as {error:string}).error,'cancelled');assert.equal(t.calls,0);t.driver.close();
});
