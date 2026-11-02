import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSourcesDriver,sourcesFailure,type SourcesClock,type DialogsRequest} from '../../src/telegram/sources-driver';
import {parseSourcesReply,SOURCES_BOUNDS as B} from '../../src/telegram/sources-protocol';
import {binding,envelope,page,chat,dialog,message,deferred,tick} from '../integration/check-telegram-sources-foundation-fixtures';
function fakeClock(){let now=100000,id=0;const timers=new Map<number,{at:number;fn:()=>void}>();const clock:SourcesClock={now:()=>now,setTimeout(fn,ms){const key=++id;timers.set(key,{at:now+ms,fn});return key as any;},clearTimeout(key){timers.delete(key as any);}};return {clock,elapse(ms:number){now+=ms;},advance(ms:number){now+=ms;for(const [key,t]of [...timers])if(t.at<=now){timers.delete(key);t.fn();}},timers};}
function setup(getDialogs=(async()=>page()) as (r:DialogsRequest,s:AbortSignal)=>Promise<unknown>){const b=binding(),e=envelope(b),time=fakeClock();let calls=0,invalidations=0;const requests:DialogsRequest[]=[];const driver=createSourcesDriver(b,e.sessionId,{getDialogs(r,s){calls++;requests.push(r);return getDialogs(r,s);},invalidateSession(){invalidations++;}},time.clock);let epoch=1,op=e.operationId;const command=(type='sources.page',extra:Record<string,unknown>={})=>({...e,listEpoch:epoch,operationId:op,requestId:randomUUID(),type,...(type==='sources.page'?{folder:'main',cursor:null}:{}),...extra});const ctx={signal:new AbortController().signal,current:()=>true};return {driver,b,e,time,command,ctx,requests,get calls(){return calls;},get invalidations(){return invalidations;},fresh(){epoch++;op=randomUUID();}};}
test('Saved and explicit selection are RAM-only ACKs; no IO, generic capability or auto-selection',async()=>{
 const h=setup();try{const saved=h.driver.getSaved()!;assert.equal(h.calls,0);assert.deepEqual(Object.keys(h.driver).sort(),['close','getSaved','handle','quiesce','whenSettled']);
 const selected=await h.driver.handle(h.command('sources.select',{peerRefs:[saved.peerRef]}),h.ctx);assert.equal(selected?.type,'sources.selected');assert.equal(h.calls,0);
 const wrong=await h.driver.handle(h.command('sources.select',{peerRefs:[randomUUID()]}),h.ctx);assert.equal(wrong?.type,'sources.error');
 const cleared=await h.driver.handle(h.command('sources.clear'),h.ctx);assert.equal(cleared?.type,'sources.cleared');assert.equal(h.calls,0);
 h.fresh();const p=await h.driver.handle(h.command(),h.ctx);assert.equal(p?.type,'sources.page');assert.equal(h.calls,1);
 if(p?.type==='sources.page'){assert.equal(p.items.length,2);const ack=await h.driver.handle(h.command('sources.select',{peerRefs:p.items.map(x=>x.peerRef)}),h.ctx);assert.equal(ack?.type,'sources.selected');assert.equal(h.calls,1);}
 }finally{h.driver.close();}assert.equal(h.driver.getSaved(),null);assert.equal(h.time.timers.size,0);
});
test('paging once per call, pinned anchors, dedup, archive gesture and opaque single-use cursors',async()=>{
 const h=setup(async r=>page({dialogs:[dialog(101,{folderId:r.folderId})],messages:[message(101,{date:r.offsetDate+1234})]}));try{
 const request=h.command();const a=await h.driver.handle(request,h.ctx);assert.equal(a?.type,'sources.page');assert.ok(a&&parseSourcesReply(a,request as any));
 assert.deepEqual(h.requests[0],{folderId:0,excludePinned:false,offsetId:0,offsetDate:0,offsetPeer:{_: 'inputPeerEmpty'},limit:25});
 if(a?.type!=='sources.page')throw Error();const more=await h.driver.handle(h.command('sources.page',{cursor:a.cursor}),h.ctx);
 assert.equal(more?.type,'sources.page');if(more?.type==='sources.page')assert.equal(more.items.length,0);assert.equal(h.requests[1].excludePinned,true);assert.equal(h.requests[1].offsetId,7);
 const replay=await h.driver.handle(h.command('sources.page',{cursor:a.cursor}),h.ctx);assert.equal(replay?.type,'sources.error');assert.equal(h.calls,2);
 h.fresh();const archived=await h.driver.handle(h.command('sources.page',{folder:'archived'}),h.ctx);assert.equal(archived?.type,'sources.page');assert.equal(h.requests[2].folderId,1);
 const stale=await h.driver.handle({...request,requestId:randomUUID()},h.ctx);assert.equal(stale?.type,'sources.error');assert.equal(h.calls,3);
 }finally{h.driver.close();}
});
test('binding/session/epoch mismatch, replay, cursor folder and TTL never cause RPC',async()=>{
 const h=setup();try{for(const extra of [{accountRef:randomUUID()},{accountEpoch:2},{sessionId:randomUUID()}])assert.equal((await h.driver.handle({...h.command(),...extra},h.ctx))?.type,'sources.error');assert.equal(h.calls,0);
 const first=h.command();const p=await h.driver.handle(first,h.ctx);assert.equal((await h.driver.handle(first,h.ctx))?.type,'sources.error');
 if(p?.type!=='sources.page')throw Error();h.time.advance(B.cursorMs+1);assert.equal((await h.driver.handle(h.command('sources.page',{cursor:p.cursor}),h.ctx))?.type,'sources.error');assert.equal(h.calls,1);
 h.fresh();const fresh=await h.driver.handle(h.command(),h.ctx);if(fresh?.type!=='sources.page')throw Error();assert.equal((await h.driver.handle(h.command('sources.page',{cursor:fresh.cursor,folder:'archived'}),h.ctx))?.type,'sources.error');assert.equal(h.calls,2);
 h.time.advance(B.idleMs+1);assert.equal(h.driver.getSaved(),null);assert.equal((await h.driver.handle(h.command('sources.select',{peerRefs:[]}),h.ctx))?.type,'sources.error');
 }finally{h.driver.close();}
});
test('cancel ACK while active, no second IO until settlement, ignored abort closes after grace',async()=>{
 const barrier=deferred<unknown>();let signal:AbortSignal|undefined;const h=setup(async(_r,s)=>{signal=s;return barrier.promise;});
 try{const req=h.command();const pending=h.driver.handle(req,h.ctx);await tick();assert.equal(h.calls,1);
 const cancel=await h.driver.handle(h.command('sources.cancel',{targetRequestId:req.requestId}),h.ctx);assert.equal(cancel?.type,'sources.cancelled');assert.equal(signal?.aborted,true);assert.equal((await pending)?.type,'sources.error');let settled=false;const waiting=h.driver.whenSettled().then(value=>{settled=true;return value;});await tick();assert.equal(settled,false);
 h.fresh();assert.equal((await h.driver.handle(h.command(),h.ctx))?.type,'sources.error');assert.equal(h.calls,1);
 h.time.advance(B.settlementMs+1);assert.equal(h.invalidations,1);assert.equal(h.driver.getSaved(),null);assert.equal(await waiting,false);assert.equal(h.time.timers.size,0);barrier.resolve(page());await tick();assert.equal(h.time.timers.size,0);
 }finally{barrier.resolve(page());h.driver.close();}
});
test('settled cancellation allows a fresh epoch; late results and old guards cannot revive',async()=>{
 const barrier=deferred<unknown>();let first=true;const h=setup(async()=>{if(first){first=false;return barrier.promise;}return page();});
 try{const req=h.command();const pending=h.driver.handle(req,h.ctx);await tick();await h.driver.handle(h.command('sources.cancel',{targetRequestId:req.requestId}),h.ctx);await pending;
 barrier.resolve(page());await tick();h.fresh();const next=await h.driver.handle(h.command(),h.ctx);assert.equal(next?.type,'sources.page');assert.equal(h.calls,2);h.time.advance(B.settlementMs+1);assert.ok(h.driver.getSaved());
 }finally{h.driver.close();}
 const c=deferred<unknown>(),guarded=setup(async()=>c.promise);let generation=1;const captured=generation;
 try{const p=guarded.driver.handle(guarded.command(),{signal:guarded.ctx.signal,current:()=>generation===captured});await tick();generation++;generation++;c.resolve(page());const reply=await p;assert.equal(reply?.type,'sources.error');assert.equal(guarded.driver.getSaved(),null);assert.equal(guarded.invalidations,1);}finally{guarded.driver.close();}
});
test('signal and deadline after actual await; no SDK retry and eventual cleanup',async()=>{
 for(const mode of ['abort','timeout'] as const){const d=deferred<unknown>(),h=setup(async()=>d.promise),abort=new AbortController();try{const pending=h.driver.handle(h.command(),{signal:abort.signal,current:()=>true});await tick();if(mode==='abort')abort.abort();else h.time.advance(B.timeoutMs);const reply=await pending;assert.equal(reply?.type,'sources.error');if(reply?.type==='sources.error')assert.equal(reply.error,mode==='abort'?'cancelled':'timeout');assert.equal(h.calls,1);d.resolve(page());await tick();assert.equal(h.calls,1);}finally{d.resolve(page());h.driver.close();}}
});
test('FLOOD_WAIT beyond 24h, normalized SDK errors, unknown duration and first real cause',async()=>{
 for(const text of ['FLOOD_WAIT_172800','FLOOD_PREMIUM_WAIT_172800','FLOOD_WAIT_%d']){const h=setup(async()=>{throw {text,seconds:172800};});try{const r=await h.driver.handle(h.command(),h.ctx);assert.equal(r?.type,'sources.error');if(r?.type==='sources.error')assert.equal(r.retryAt,100000+172800000);h.fresh();await h.driver.handle(h.command(),h.ctx);assert.equal(h.calls,1);}finally{h.driver.close();}}
 for(const text of ['FLOOD_WAIT','FLOOD_WAIT_999999999999999999999999999999','FLOOD_WAIT_invalid']){const f=sourcesFailure({text},100000);assert.equal(f.retryBlocked,true);assert.equal(f.retryAt,null);}
 let getters=0;sourcesFailure(Object.defineProperty({},'text',{get(){getters++;return 'FLOOD_WAIT_1';}}),1);assert.equal(getters,0);
 const d=deferred<unknown>(),h=setup(async()=>d.promise),abort=new AbortController();try{const pending=h.driver.handle(h.command(),{signal:abort.signal,current:()=>true});await tick();d.reject({text:'CHANNEL_PRIVATE'});await tick();abort.abort();const r=await pending;assert.equal(r?.type,'sources.error');if(r?.type==='sources.error')assert.equal(r.error,'access');}finally{h.driver.close();}
});
test('session-wide 20 attempts survive list resets and discarded results; fatal raw budget releases capabilities',async()=>{
 const h=setup();try{for(let i=0;i<20;i++){if(i)h.fresh();await h.driver.handle(h.command(),h.ctx);}h.fresh();const denied=await h.driver.handle(h.command(),h.ctx);assert.equal(denied?.type,'sources.error');assert.equal(h.calls,20);}finally{h.driver.close();}
 const oversize=setup(async()=>page({dialogs:Array.from({length:26},(_,i)=>dialog(i+1)),chats:[],messages:[]}));try{const r=await oversize.driver.handle(oversize.command(),oversize.ctx);assert.equal(r?.type,'sources.error');if(r?.type==='sources.error')assert.equal(r.error,'limit');assert.equal(oversize.invalidations,1);assert.equal(oversize.driver.getSaved(),null);}finally{oversize.driver.close();}
});
test('selection max20, offers only, and auth revocation cleanup',async()=>{
 const h=setup(async()=>page({_: 'messages.dialogs',dialogs:Array.from({length:25},(_,i)=>dialog(i+1)),chats:Array.from({length:25},(_,i)=>chat(i+1)),messages:[]}));try{const p=await h.driver.handle(h.command(),h.ctx);if(p?.type!=='sources.page')throw Error();assert.equal(p.items.length,26);
 const twenty=p.items.slice(0,20).map(x=>x.peerRef);assert.equal((await h.driver.handle(h.command('sources.select',{peerRefs:twenty}),h.ctx))?.type,'sources.selected');assert.equal(await h.driver.handle(h.command('sources.select',{peerRefs:p.items.slice(0,21).map(x=>x.peerRef)}),h.ctx),null);assert.equal(h.calls,1);
 }finally{h.driver.close();}
 const revoked=setup(async()=>{throw {text:'SESSION_REVOKED'};});try{const r=await revoked.driver.handle(revoked.command(),revoked.ctx);if(r?.type!=='sources.error')throw Error();assert.equal(r.error,'session-expired');assert.equal(revoked.driver.getSaved(),null);assert.equal(revoked.invalidations,1);}finally{revoked.driver.close();}
});
test('quiesce reports actual settlement separately from forced local close',async()=>{
 for(const settles of [true,false]){const d=deferred<unknown>(),h=setup(async()=>d.promise);try{const pending=h.driver.handle(h.command(),h.ctx);await tick();const stopped=h.driver.quiesce();assert.equal(h.driver.getSaved(),null);if(settles)d.resolve(page());else h.time.advance(B.settlementMs+1);assert.equal(await stopped,settles);const reply=await pending;assert.equal(reply?.type,'sources.error');assert.equal(h.invalidations,settles?0:1);d.resolve(page());await tick();}finally{d.resolve(page());h.driver.close();}}
});
test('20 pages accept 500 dialogs with bounded candidates and no automatic continuation',async()=>{
 let index=0;const h=setup(async()=>{const start=index++*25;return page({dialogs:Array.from({length:25},(_,i)=>dialog(start+i+1)),chats:Array.from({length:25},(_,i)=>chat(start+i+1)),messages:[message(start+25,{date:10000-start})]});});
 try{let cursor:string|null=null,total=0;for(let i=0;i<20;i++){const reply=await h.driver.handle(h.command('sources.page',{cursor}),h.ctx);if(reply?.type!=='sources.page')throw Error('unexpected reply');total+=reply.items.length;assert.equal(h.calls,i+1);assert.equal(reply.end,i===19?'limit':'more');cursor=reply.cursor;}assert.equal(total,501);assert.equal(cursor,null);h.fresh();const denied=await h.driver.handle(h.command(),h.ctx);assert.equal(denied?.type,'sources.error');assert.equal(h.calls,20);}finally{h.driver.close();}
});
test('closed A and separate A/A or A/B sessions cannot reuse binding, offers or callbacks',async()=>{
 const old=setup(),sameAccountNew=setup(),differentAccountNew=setup();try{const p=await old.driver.handle(old.command(),old.ctx);if(p?.type!=='sources.page')throw Error();old.driver.close();for(const target of [sameAccountNew,differentAccountNew]){assert.notEqual(target.b.accountRef,old.b.accountRef);const forged=await target.driver.handle(old.command('sources.select',{peerRefs:p.items.map(x=>x.peerRef)}),target.ctx);assert.equal(forged?.type,'sources.error');assert.equal(target.calls,0);assert.equal((await target.driver.handle(target.command('sources.select',{peerRefs:[p.items[0].peerRef]}),target.ctx))?.type,'sources.error');}}
 finally{old.driver.close();sameAccountNew.driver.close();differentAccountNew.driver.close();}
});
test('non-adjacent repeated anchors stop with cursor-unavailable, never a hidden RPC',async()=>{
 let count=0;const h=setup(async()=>page({messages:[message(101,{date:++count===2?2000:1234})]}));try{let cursor:string|null=null;for(let i=0;i<3;i++){const r=await h.driver.handle(h.command('sources.page',{cursor}),h.ctx);if(r?.type!=='sources.page')throw Error();assert.equal(r.end,i===2?'cursor-unavailable':'more');cursor=r.cursor;}assert.equal(cursor,null);assert.equal(h.calls,3);}finally{h.driver.close();}
});
test('suspended idle cleanup cannot revive an offer by selecting it; fresh gesture replaces refs',async()=>{
 const h=setup();try{
  const page=await h.driver.handle(h.command(),h.ctx);if(page?.type!=='sources.page')throw Error();
  const refs=page.items.map(row=>row.peerRef);h.time.elapse(B.idleMs+1);
  const expired=await h.driver.handle(h.command('sources.select',{peerRefs:refs}),h.ctx);
  assert.equal(expired?.type,'sources.error');if(expired?.type==='sources.error')assert.equal(expired.error,'expired');
  assert.equal(h.driver.getSaved(),null);assert.equal(h.calls,1);assert.equal(h.time.timers.size,0);
  h.fresh();const fresh=await h.driver.handle(h.command(),h.ctx);if(fresh?.type!=='sources.page')throw Error();
  assert.equal(h.calls,2);assert.ok(fresh.items.every(row=>!refs.includes(row.peerRef)));
  const ack=await h.driver.handle(h.command('sources.select',{peerRefs:fresh.items.map(row=>row.peerRef)}),h.ctx);assert.equal(ack?.type,'sources.selected');
 }finally{h.driver.close();}
});
test('Saved access checks the absolute idle deadline without refreshing it or requiring timers',async()=>{
 const h=setup();try{
  const saved=h.driver.getSaved()!;h.time.elapse(B.idleMs-1);assert.equal(h.driver.getSaved(),saved);
  h.time.elapse(1);assert.equal(h.driver.getSaved(),null);assert.equal(h.time.timers.size,0);
  const reply=await h.driver.handle(h.command('sources.select',{peerRefs:[saved.peerRef]}),h.ctx);
  assert.equal(reply?.type,'sources.error');assert.equal(h.calls,0);
 }finally{h.driver.close();}
});
test('late terminal SDK rejection after cancel invalidates once while preserving cancelled and settlement',async()=>{
 for(const text of ['SESSION_REVOKED','AUTH_KEY_UNREGISTERED','SESSION_EXPIRED','USER_DEACTIVATED','USER_DEACTIVATED_BAN']){
  const d=deferred<unknown>(),h=setup(()=>d.promise);try{
   const saved=h.driver.getSaved()!,request=h.command(),pending=h.driver.handle(request,h.ctx);await tick();
   const cancel=await h.driver.handle(h.command('sources.cancel',{targetRequestId:request.requestId}),h.ctx);assert.equal(cancel?.type,'sources.cancelled');
   const first=await pending;if(first?.type!=='sources.error')throw Error();assert.equal(first.error,'cancelled');
   d.reject({text});assert.equal(await h.driver.whenSettled(),true);
   assert.equal(h.invalidations,1);assert.equal(h.driver.getSaved(),null);assert.equal(h.time.timers.size,0);
   const stale=await h.driver.handle(h.command('sources.select',{peerRefs:[saved.peerRef]}),h.ctx);
   if(stale?.type!=='sources.error')throw Error();assert.equal(stale.error,'session-expired');assert.equal(h.calls,1);
   h.driver.close();assert.equal(h.invalidations,1);
  }finally{d.resolve(page());h.driver.close();}
 }
});
test('late terminal after timeout revokes session without replacing the visible timeout',async()=>{
 const d=deferred<unknown>(),h=setup(()=>d.promise);try{
  const pending=h.driver.handle(h.command(),h.ctx);await tick();h.time.advance(B.timeoutMs);
  const first=await pending;if(first?.type!=='sources.error')throw Error();assert.equal(first.error,'timeout');
  d.reject({text:'SESSION_REVOKED'});assert.equal(await h.driver.whenSettled(),true);
  assert.equal(h.invalidations,1);assert.equal(h.driver.getSaved(),null);assert.equal(h.time.timers.size,0);
 }finally{d.resolve(page());h.driver.close();}
});
test('synchronous terminal failure also invalidates; ordinary late network errors keep cancellation local',async()=>{
 const terminal=setup(()=>{throw {text:'AUTH_KEY_UNREGISTERED'};});try{
  const r=await terminal.driver.handle(terminal.command(),terminal.ctx);if(r?.type!=='sources.error')throw Error();
  assert.equal(r.error,'session-expired');assert.equal(terminal.invalidations,1);assert.equal(terminal.driver.getSaved(),null);assert.equal(await terminal.driver.whenSettled(),true);
 }finally{terminal.driver.close();}
 const d=deferred<unknown>(),h=setup(()=>d.promise);try{
  const request=h.command(),pending=h.driver.handle(request,h.ctx);await tick();await h.driver.handle(h.command('sources.cancel',{targetRequestId:request.requestId}),h.ctx);
  const r=await pending;if(r?.type!=='sources.error')throw Error();assert.equal(r.error,'cancelled');
  d.reject({text:'TRANSPORT_FAILURE'});assert.equal(await h.driver.whenSettled(),true);assert.equal(h.invalidations,0);assert.ok(h.driver.getSaved());
 }finally{d.resolve(page());h.driver.close();}
});
