import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import Long from 'long';
import {createBotProvidersDriver,type BotProvidersClock} from '../../src/telegram/bot-providers-driver';
import {createBotSearchSdkDriver} from '../../src/telegram/bot-search-driver';
import {parseBotSearchReply} from '../../src/telegram/bot-search-protocol';
const deferred=()=>{let resolve!:(v:unknown)=>void,reject!:(e:unknown)=>void;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise<void>(r=>setImmediate(r));
function fakeClock(){let now=1000,id=0;const timers=new Map<number,{at:number;fn:()=>void}>();return {now:()=>now,setTimeout(fn:()=>void,ms:number){const n=++id;timers.set(n,{at:now+ms,fn});return n;},clearTimeout(n:number){timers.delete(n);},jump(ms:number){now+=ms;},advance(ms:number){const end=now+ms;for(;;){const due=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();}now=end;},timers} as unknown as BotProvidersClock&{jump(ms:number):void;advance(ms:number):void;timers:Map<number,unknown>};}
const identity=(username='ivkmbot',id=101,hash=123)=>({_: 'contacts.resolvedPeer',peer:{_: 'peerUser',userId:id},chats:[],users:[{_: 'user',id,bot:true,username,accessHash:new Long(hash,45,false),firstName:'Fixture bot'}]});
const history=(messages:unknown[]=[])=>({_: 'messages.messages',messages,users:[],chats:[]});
const msg=(id=12,extra:Record<string,unknown>={})=>({_: 'message',id,peerId:{_: 'peerUser',userId:101},fromId:{_: 'peerUser',userId:101},message:'Fixture recent reply',replyMarkup:{_:'replyInlineMarkup',rows:[{_:'keyboardInlineButtonRow',buttons:[{_:'keyboardInlineButton',text:'Fixture song — Fixture artist',type:{_:'inlineButtonTypeCallback',data:new Uint8Array([1])}}]}]},...extra});
const ack=()=>({_: 'updateShortSentMessage',out:true,id:10});
async function setup(hook?:(request:any,options:any)=>Promise<unknown>,username='ivkmbot'){
 const binding={accountRef:randomUUID(),accountEpoch:1},sessionId=randomUUID(),time=fakeClock(),ctx={signal:new AbortController().signal,current:()=>true};let invalidations=0;
 const pool=createBotProvidersDriver(binding,sessionId,{resolveIdentity:async u=>identity(u),invalidateSession(){invalidations++;}},time);
 const pe=()=>({protocol:'pulso-bot-providers',version:1,...binding,sessionId,providerRevision:pool.getSnapshot()!.revision,operationId:randomUUID(),requestId:randomUUID()});
 const offer=await pool.handle({...pe(),type:'bots.validate',input:username},ctx);assert.equal(offer?.type,'bots.validated');const ref=offer!.type==='bots.validated'?offer!.offer.providerRef:'';
 await pool.handle({...pe(),type:'bots.setOrder',expectedRevision:0,providerRefs:[ref]},ctx);
 const calls:any[]=[],progress:any[]=[];let cooldown:null|{retryAt:number|null;retryBlocked:boolean}=null;
 const driver=createBotSearchSdkDriver(binding,sessionId,{providers:pool,call:async(r:any,o:any)=>{calls.push({request:r,options:o});return hook?hook(r,o):r._==='contacts.resolveUsername'?identity():r._==='messages.sendMessage'?ack():history(r.limit===1?[]:[msg()]);},current(s){if(s.aborted)throw Error('cancelled');},invalidateSession(){invalidations++;},getAccountCooldown:()=>cooldown} as never,time);
 const e=()=>({protocol:'pulso-bot-search' as const,version:1 as const,...binding,sessionId,providerRevision:1,queryId:randomUUID(),requestId:randomUUID()});
 const command=(extra:Record<string,unknown>={},context:any={...ctx,publish:(r:any)=>progress.push(r)})=>{const c={...e(),type:'bot-search.search',providerRef:ref,query:'Fixture song',consent:true,...extra};return {c,p:driver.handle(c,context)};};
 const check=async(p:Promise<any>,c:any)=>{const r=await p;assert.ok(parseBotSearchReply(r,c));return r;};
 const cancel=(c:any)=>driver.handle({...e(),type:'bot-search.cancel',queryId:c.queryId,targetRequestId:c.requestId},ctx);
 return {driver,pool,ref,pe,e,ctx,time,calls,progress,command,check,cancel,setCooldown(v:typeof cooldown){cooldown=v;},get invalidations(){return invalidations;}};
}
test('typed SDK foundation performs exact identity, baseline1, one plaintext stable-Long send, peer-specific20 poll',async()=>{
 const s=await setup();assert.equal(s.calls.length,0);const {c,p}=s.command({target:{title:'Song (Live remix)',artist:'Artist',album:'Album not sent',durationSeconds:222}});const result=await s.check(p,c);assert.equal(result.type,'bot-search.result');assert.equal(result.rows[0].correlation,'recent');assert.equal(result.expectedTarget.album,'Album not sent');assert.equal(s.progress.length,1);
 assert.deepEqual(s.calls.map(x=>x.request._),['contacts.resolveUsername','messages.getHistory','messages.sendMessage','messages.getHistory']);
 const baseline=s.calls[1].request,send=s.calls[2].request,poll=s.calls[3].request;assert.equal(baseline.limit,1);assert.equal(poll.limit,20);assert.equal(poll.minId,0);assert.equal(send.message,'Song (Live remix) Artist');assert.equal(send.noWebpage,true);assert.ok(send.randomId instanceof Long);assert.deepEqual(Object.keys(send).sort(),['_','message','noWebpage','peer','randomId']);assert.equal(send.peer.userId,101);assert.ok(send.peer.accessHash instanceof Long);
 for(const {options:o}of s.calls){assert.equal(o.maxRetryCount,0);assert.equal(o.floodSleepThreshold,0);assert.equal(o.timeout,0);assert.equal(o.abortSignal,undefined);}
 assert.equal(await s.driver.whenSettled(),true);s.driver.close();assert.equal(s.time.timers.size,0);
});
test('unsupported selected provider never substitutes ivkm; missing consent/target query do zero IO',async()=>{
 const other=await setup(undefined,'otherbot');const x=other.command();assert.equal((await other.check(x.p,x.c)).error,'unsupported');assert.equal(other.calls.length,0);other.driver.close();
 const s=await setup();const a=s.command({consent:false});assert.equal(await a.p,null);const b=s.command({target:{title:'/start',artist:null,album:null,durationSeconds:null}});assert.equal((await s.check(b.p,b.c)).error,'limit');assert.equal(s.calls.length,0);s.driver.close();
});
test('fresh identity must match approved id AND signed hash; username transfer invalidates exact session',async()=>{
 for(const raw of [identity('ivkmbot',202),identity('ivkmbot',101,124)]){const s=await setup(async()=>raw);const {c,p}=s.command();assert.equal((await s.check(p,c)).error,'identity-changed');assert.equal(s.calls.length,1);assert.equal(s.pool.getSnapshot(),null);assert.ok(s.invalidations>=1);s.driver.close();}
 const s=await setup(async()=>identity('someoneelse'));const {c,p}=s.command();assert.equal((await s.check(p,c)).error,'unsupported');assert.equal(s.calls.length,1);s.driver.close();
});
test('baseline only before send; nonzero baseline is exact minID, unrelated old rows cannot satisfy query',async()=>{
 let polls=0;const s=await setup(async r=>r._==='contacts.resolveUsername'?identity():r._==='messages.sendMessage'?ack():r.limit===1?history([msg(8)]):(++polls===1?history([msg(8)]):history([msg()])));
 const {c,p}=s.command();await tick();assert.equal(s.calls.at(-1).request.minId,8);s.time.advance(1000);assert.equal((await s.check(p,c)).type,'bot-search.result');assert.equal(polls,2);s.driver.close();
});
test('progress text waits for an edited musical menu on the same message',async()=>{
 let polls=0;const s=await setup(async r=>r._==='contacts.resolveUsername'?identity():r._==='messages.sendMessage'?ack():r.limit===1?history():history([++polls===1?msg(12,{message:'Buscando…',replyMarkup:undefined}):msg(12)]));
 const {c,p}=s.command();await tick();assert.equal(polls,1);let done=false;void p.then(()=>{done=true;});await tick();assert.equal(done,false);
 s.time.advance(1000);const result=await s.check(p,c);assert.equal(result.type,'bot-search.result');assert.ok(result.rows.some((row:{kind:string})=>row.kind==='option'));assert.equal(s.calls.filter(x=>x.request._==='messages.sendMessage').length,1);s.driver.close();
});
test('lost send ACK is uncertain, never empty/retried/fallback; malformed ACK also uncertain',async()=>{
 for(const sendResult of [Promise.reject({text:'NETWORK_ERROR'}),Promise.resolve({_: 'updatesTooLong'})]){void sendResult.catch(()=>{});const s=await setup(async r=>r._==='contacts.resolveUsername'?identity():r._==='messages.sendMessage'?sendResult:history());const {c,p}=s.command();const r=await s.check(p,c);assert.equal(r.error,'uncertain');assert.equal(r.delivery,'uncertain');assert.equal(s.calls.filter(x=>x.request._==='messages.sendMessage').length,1);assert.equal(s.calls.length,3);s.driver.close();}
});
test('cancel ACK does not settle original send or release lane; late successful send does not publish',async()=>{
 const gate=deferred();const s=await setup(async r=>r._==='contacts.resolveUsername'?identity():r._==='messages.sendMessage'?gate.promise:history());const {c,p}=s.command();await tick();assert.equal(s.calls.length,3);assert.equal((await s.cancel(c))?.type,'bot-search.cancelled');const result=await s.check(p,c);assert.equal(result.error,'cancelled');assert.equal(result.delivery,'uncertain');
 let settled=false;void s.driver.whenSettled().then(()=>{settled=true;});await tick();assert.equal(settled,false);const next=s.command();assert.equal((await s.check(next.p,next.c)).error,'busy');gate.resolve(ack());assert.equal(await s.driver.whenSettled(),true);assert.equal(s.progress.length,1);assert.equal(s.calls.length,3);s.driver.close();
});
test('uncooperative send deadline is uncertain; grace quarantines false forever after late completion',async()=>{
 const gate=deferred();const s=await setup(async r=>r._==='contacts.resolveUsername'?identity():r._==='messages.sendMessage'?gate.promise:history());const {c,p}=s.command();await tick();s.time.advance(15000);const r=await s.check(p,c);assert.equal(r.error,'uncertain');assert.equal(r.delivery,'uncertain');s.time.advance(2000);assert.equal(await s.driver.whenSettled(),false);assert.equal(s.invalidations,1);gate.resolve(ack());await tick();assert.equal(await s.driver.whenSettled(),false);assert.equal(s.calls.length,3);assert.equal(s.time.timers.size,0);
});
test('late SESSION_REVOKED invalidates even if cancel won; first session error remains original cause',async()=>{
 const gate=deferred();const s=await setup(async r=>r._==='contacts.resolveUsername'?identity():r._==='messages.sendMessage'?gate.promise:history());const {c,p}=s.command();await tick();await s.cancel(c);assert.equal((await s.check(p,c)).error,'cancelled');gate.reject({text:'SESSION_REVOKED'});await tick();assert.equal(s.invalidations,1);assert.equal(await s.driver.whenSettled(),true);
 const t=await setup(async()=>{throw {text:'SESSION_REVOKED'};});const x=t.command();assert.equal((await t.check(x.p,x.c)).error,'session-expired');assert.equal(t.invalidations,1);
});
test('late FLOOD retained across query, cancel, reordered pool; shared ledger prevents any new RPC',async()=>{
 const gate=deferred();let delayed=true;const s=await setup(async r=>r._==='contacts.resolveUsername'?identity():r._==='messages.sendMessage'&&delayed?gate.promise:history());const {c,p}=s.command();await tick();await s.cancel(c);await p;gate.reject({text:'FLOOD_WAIT_172800'});await tick();delayed=false;
 const next=s.command();const r=await s.check(next.p,next.c);assert.equal(r.error,'rate-limit');assert.equal(r.retryAt,172801000);assert.equal(s.calls.length,3);
 await s.pool.handle({...s.pe(),type:'bots.setOrder',expectedRevision:1,providerRefs:[s.ref]},s.ctx);s.time.jump(86400001);const again=s.command();assert.equal((await s.check(again.p,again.c)).error,'rate-limit');s.driver.close();
 const t=await setup();t.setCooldown({retryAt:null,retryBlocked:true});const x=t.command();assert.equal((await t.check(x.p,x.c)).retryBlocked,true);assert.equal(t.calls.length,0);t.driver.close();
});
test('absolute deadline checks survive suspended timers; no progress after stale root/provider ABA',async()=>{
 const gate=deferred();const s=await setup(async()=>gate.promise);const {c,p}=s.command();await tick();s.time.jump(15001);gate.resolve(identity());assert.equal((await s.check(p,c)).error,'timeout');assert.equal(s.calls.length,1);assert.equal(s.progress.length,0);s.driver.close();
 for(const dimension of ['root','provider']){const g=deferred();const t=await setup(async()=>g.promise);let epoch=0;const captured=epoch;const context={...t.ctx,current:()=>epoch===captured,publish:(r:any)=>t.progress.push(r)};const x=t.command({},context);await tick();
  if(dimension==='root'){epoch++;epoch++;context.current=()=>true;}else await t.pool.handle({...t.pe(),type:'bots.setOrder',expectedRevision:1,providerRefs:[]},t.ctx);
  g.resolve(identity());assert.equal((await t.check(x.p,x.c)).error,'cancelled');assert.equal(t.calls.length,1);assert.equal(t.progress.length,0);t.driver.close();}
});
test('empty history reaches timeout, never no-match; one-second polls are bounded and canceled cleanly',async()=>{
 const s=await setup(async r=>r._==='contacts.resolveUsername'?identity():r._==='messages.sendMessage'?ack():history());const {c,p}=s.command();await tick();for(let n=0;n<15;n++){s.time.advance(1000);await tick();}const r=await s.check(p,c);assert.equal(r.error,'timeout');assert.equal(r.delivery,'acknowledged');assert.ok(s.calls.length<=18);assert.equal(s.calls.filter(x=>x.request._==='messages.sendMessage').length,1);assert.equal(await s.driver.whenSettled(),true);s.driver.close();assert.equal(s.time.timers.size,0);
});
test('concurrent external outgoing makes response uncertain even with a valid bot reply',async()=>{
 const s=await setup(async r=>r._==='contacts.resolveUsername'?identity():r._==='messages.sendMessage'?ack():history(r.limit===1?[]:[msg(11,{out:true}),msg()]));const {c,p}=s.command();assert.equal((await s.check(p,c)).error,'uncertain');s.driver.close();
});
test('raw projection budget accumulates across calls; no send after oversized identity, no truncated success',async()=>{
 const s=await setup(async()=>({...identity(),incidental:'x'.repeat(40000)}));const x=s.command();assert.equal((await s.check(x.p,x.c)).error,'limit');assert.equal(s.calls.length,1);s.driver.close();
 const t=await setup(async r=>r._==='contacts.resolveUsername'?identity():r._==='messages.sendMessage'?ack():history(r.limit===1?[]:[msg(12,{message:'',replyMarkup:undefined,media:{_: 'unknownMedia'}})]));const y=t.command();assert.equal((await t.check(y.p,y.c)).error,'unsupported');assert.equal(t.calls.length,4);t.driver.close();
});
test('request/query IDs finite; replay rejected; static accessors do no IO, quiesce invalidates',async()=>{
 const s=await setup();const x=s.command();await x.p;assert.equal((await s.driver.handle(x.c,s.ctx) as any).error,'expired');const y=s.command({queryId:x.c.queryId});assert.equal((await s.check(y.p,y.c)).error,'expired');const calls=s.calls.length;
 for(let n=0;n<254;n++){const z=s.command({providerRef:randomUUID()});await z.p;}const z=s.command();assert.equal((await s.check(z.p,z.c)).error,'limit');assert.equal(s.invalidations,1);assert.equal(s.calls.length,calls);assert.equal(await s.driver.quiesce(),true);
});
