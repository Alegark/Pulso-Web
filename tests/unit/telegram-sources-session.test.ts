/** TESTONLY synthetic worker DTOs. No SDK, real identity, Telegram or storage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Activity} from '../../src/playback/ownership';
import {TelegramSessionClient,type SessionWorker,type SourcesSnapshot} from '../../src/telegram/session-client';
import {SOURCES_BOUNDS} from '../../src/telegram/sources-protocol';
import {parseSessionCommand,parseSessionReply,type SessionCommand} from '../../src/telegram/session-protocol';
import {parseSourcesBridgeReply} from '../../src/telegram/sources-bridge-protocol';
import type {SourcesCommand,SourcesReply,SourceRow} from '../../src/telegram/sources-protocol';
const id=()=>crypto.randomUUID(),saved=():SourceRow=>({peerRef:id(),kind:'saved',name:'Mensajes guardados'});
class Fixture implements SessionWorker {
 onmessage:SessionWorker['onmessage']=null;onerror:SessionWorker['onerror']=null;onmessageerror:SessionWorker['onmessageerror']=null;
 messages:(SessionCommand|SourcesCommand)[]=[];terminations=0;binding={accountRef:id(),accountEpoch:1};saved=saved();
 postMessage(command:SessionCommand|SourcesCommand){this.messages.push(command);}terminate(){this.terminations++;}
 auth(phase='connected',extras:Record<string,unknown>={}){const c=this.messages.findLast(c=>'session'in c)! as SessionCommand;this.emit({version:2,session:c.session,request:c.request,phase,error:null,retryAt:null,delivery:null,binding:phase==='connected'?this.binding:null,saved:phase==='connected'?this.saved:null,...extras});}
 emit(data:unknown){this.onmessage?.({data} as MessageEvent);}
 source(command:SourcesCommand,fields:Record<string,unknown>,closed=false){const {type,...envelope}=command;void type;const {folder,cursor,peerRefs,targetRequestId,...base}=envelope as unknown as Record<string,unknown>;void folder;void cursor;void peerRefs;void targetRequestId;const reply={...base,...fields};this.emit({protocol:'pulso-sources',version:1,reply,sessionClosed:closed,saved:closed?null:this.saved});return reply;}
 page(command=this.last(),items:SourceRow[]=[this.saved],end='exhausted',cursor:string|null=null){return this.source(command,{type:'sources.page',folder:'folder'in command?command.folder:'main',items,end,cursor});}
 last(){return this.messages.at(-1)! as SourcesCommand;}
 error(command:SourcesCommand,error='cancelled',extra={}){return this.source(command,{type:'sources.error',error,retryAt:null,retryBlocked:false,...extra});}
}
function setup(sourceTimeout=1000,grace=50){const activity=new Activity();activity.open();let generation=0;const workers:Fixture[]=[],notifications:SourcesSnapshot[]=[];const client=new TelegramSessionClient(activity,()=>{const scope=activity.scope(),epoch=generation;return()=>epoch===generation&&scope()&&activity.admitted;},()=>{},()=>{const w=new Fixture();workers.push(w);return w;},1000,state=>notifications.push(state),sourceTimeout,grace);client.begin('+15550000000');const w=workers[0];w.auth();return {client,w,workers,activity,notifications,invalidate:()=>generation++};}
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
test('auth v2 requires exact binding and Saved, rejects downgrade/extras/raw data',()=>{
 const c={version:2,session:id(),request:id(),type:'begin',value:'+15550000000'};assert.ok(parseSessionCommand(c));assert.equal(parseSessionCommand({...c,version:1}),null);
 const r={version:2,session:c.session,request:c.request,phase:'connected',error:null,retryAt:null,delivery:null,binding:{accountRef:id(),accountEpoch:1},saved:saved()};assert.ok(parseSessionReply(r,c.session,c.request));
 for(const change of [{version:1},{binding:null},{saved:null},{binding:{...r.binding,rawID:1}},{saved:{...r.saved,content:'private'}},{binding:{...r.binding,accountEpoch:0}},{User:{}}])assert.equal(parseSessionReply({...r,...change},c.session,c.request),null);
});
test('connected has zero source dispatch; Saved selection scope1 ACK and clear preserve bootstrap',()=>{const s=setup();try{const {client,w}=s;assert.equal(w.messages.length,1);const ref=client.sourcesSnapshot().rows[0].peerRef;assert.deepEqual(client.sourcesSnapshot().selected,[]);client.confirm([ref]);const select=w.last();assert.equal(select.listEpoch,1);assert.equal(client.sourcesSnapshot().selected.length,0);w.source(select,{type:'sources.selected',revision:1,peerRefs:[ref]});assert.deepEqual(client.sourcesSnapshot().selected,[ref]);client.clear();w.source(w.last(),{type:'sources.cleared',revision:2});assert.deepEqual(client.sourcesSnapshot().rows,[w.saved]);client.confirm([]);w.source(w.last(),{type:'sources.selected',revision:3,peerRefs:[]});assert.equal(client.sourcesSnapshot().selected.length,0);assert.equal(w.messages.filter(c=>'protocol'in c&&c.type==='sources.page').length,0);}finally{s.client.dispose();}});
test('first list epoch2 replaces Saved scope, continuation keeps scope and never selects',()=>{const s=setup();try{const {client,w}=s,old=client.sourcesSnapshot().rows[0];client.consult('main');const first=w.last();assert.equal(first.listEpoch,2);w.saved=saved();const cursor=id(),row:SourceRow={peerRef:id(),kind:'channel',name:'Canal ficticio'};w.page(first,[w.saved,row],'more',cursor);assert.ok(!client.sourcesSnapshot().rows.some(r=>r.peerRef===old.peerRef));client.more();const next=w.last();assert.equal(next.operationId,first.operationId);assert.equal(next.listEpoch,first.listEpoch);assert.ok('cursor'in next&&next.cursor===cursor);w.page(next,[]);assert.equal(client.sourcesSnapshot().rows.length,2);assert.equal(client.sourcesSnapshot().selected.length,0);assert.equal(client.sourcesSnapshot().end,'exhausted');client.consult('archived');assert.equal(w.last().listEpoch,3);assert.notEqual(w.last().operationId,first.operationId);}finally{s.client.dispose();}});
test('selection bounds20/21, unknown/duplicate and empty; only ACK exact refs/revision succeeds',()=>{const s=setup();try{const {client,w}=s;client.consult('main');w.saved=saved();const rows=Array.from({length:20},(_,i):SourceRow=>({peerRef:id(),kind:'group',name:`Ficticia ${i}`}));w.page(w.last(),[w.saved,...rows]);const before=w.messages.length;client.confirm([w.saved.peerRef,...rows.map(r=>r.peerRef)]);client.confirm([id()]);client.confirm([rows[0].peerRef,rows[0].peerRef]);assert.equal(w.messages.length,before);client.confirm(rows.map(r=>r.peerRef));assert.equal(client.sourcesSnapshot().selected.length,0);w.source(w.last(),{type:'sources.selected',revision:1,peerRefs:rows.map(r=>r.peerRef)});assert.equal(client.sourcesSnapshot().selected.length,20);client.clear();w.source(w.last(),{type:'sources.cleared',revision:1});assert.equal(client.snapshot().error,'protocol');}finally{s.client.dispose();}});
for(const order of ['ack-first','terminal-first'])test(`cancel ${order} retains read token through settlement terminal and rejects late publication`,()=>{const s=setup();try{const {client,w,activity}=s;client.consult('main');const read=w.last();w.saved=saved();client.cancel();const cancel=w.last();assert.equal(activity.count,2);const ack=()=>w.source(cancel,{type:'sources.cancelled',targetRequestId:read.requestId});const terminal=()=>w.page(read,[w.saved,{peerRef:id(),kind:'channel',name:'Late synthetic'}]);if(order==='ack-first'){ack();assert.equal(activity.count,1);assert.equal(client.sourcesSnapshot().pending,true);terminal();}else{terminal();assert.equal(activity.count,1);ack();}assert.equal(activity.count,0);assert.equal(client.sourcesSnapshot().rows.length,1);assert.equal(client.sourcesSnapshot().error,'cancelled');const oldReply={protocol:'pulso-sources',version:1,reply:w.page(read,[w.saved]),sessionClosed:false,saved:w.saved};client.consult('archived');const next=w.last();w.emit(oldReply);assert.equal(w.last(),next);assert.equal(activity.count,1);}finally{s.client.dispose();}});
for(const cause of ['sourceReview reservation→release','foreignMutation busy→release','DB ready→close→ready','proof/scope replacement'])test(`original guard cannot revive: ${cause}`,()=>{const s=setup();try{s.client.consult('main');const command=s.w.last();s.invalidate();s.w.saved=saved();s.w.page(command);assert.equal(s.client.snapshot().error,'cancelled');assert.equal(s.client.sourcesSnapshot().binding,null);assert.equal(s.activity.count,0);}finally{s.client.dispose();}});
test('Activity ABA and stale React callbacks cannot act on new worker/account/list',()=>{const s=setup();try{const old=s.client.captureSourcesCurrent(),late=s.w.onmessage!;s.client.consult('main');const read=s.w.last();s.activity.invalidate();s.activity.open();s.client.revalidate();s.client.begin('+15550000000');const newer=s.workers[1];newer.auth();const count=newer.messages.length;s.client.consult('archived',old);assert.equal(newer.messages.length,count);late({data:{protocol:'pulso-sources',version:1,reply:{...read,type:'sources.error',error:'cancelled',retryAt:null,retryBlocked:false},sessionClosed:true,saved:null}} as MessageEvent);assert.equal(s.client.snapshot().phase,'connected');assert.notEqual(s.client.sourcesSnapshot().binding?.accountRef,s.w.binding.accountRef);}finally{s.client.dispose();}});
test('FLOOD_WAIT >24h and first cause network survive cancel; no retry/reset bypass',()=>{for(const error of ['rate-limit','network']){const s=setup();try{const {client,w}=s;client.consult('main');const read=w.last();w.saved=saved();client.cancel();const cancel=w.last(),until=Date.now()+172800000;w.error(read,error,error==='rate-limit'?{retryAt:until}:{});w.source(cancel,{type:'sources.cancelled',targetRequestId:read.requestId});assert.equal(client.sourcesSnapshot().error,error);if(error==='rate-limit'){assert.equal(client.sourcesSnapshot().retryAt,until);const count=w.messages.length;client.consult('archived');assert.equal(w.messages.length,count);}}finally{s.client.dispose();}}});
test('forged foreign-binding/variant ACK fails closed, models contain no raw fields',()=>{for(const bad of ['binding','variant']){const s=setup();try{s.client.confirm([s.w.saved.peerRef]);const c=s.w.last();s.w.emit({protocol:'pulso-sources',version:1,reply:{...c,...(bad==='binding'?{accountRef:id(),type:'sources.selected',revision:1}:{type:'sources.cleared',revision:1})},sessionClosed:false,saved:s.w.saved});assert.equal(s.client.snapshot().error,'protocol');assert.equal(JSON.stringify(s.client.sourcesSnapshot()).includes('15550000000'),false);}finally{s.client.dispose();}}});
test('closed bridge validates command shape, target, Saved consistency and no incidental data',()=>{const b={accountRef:id(),accountEpoch:1},c:SourcesCommand={protocol:'pulso-sources',version:1,...b,sessionId:id(),listEpoch:2,operationId:id(),requestId:id(),type:'sources.page',folder:'main',cursor:null},row=saved();const {cursor,...e}=c;void cursor;const reply={...e,items:[row],cursor:null,end:'exhausted'} as SourcesReply;const bridge={protocol:'pulso-sources',version:1,reply,sessionClosed:false,saved:row};assert.ok(parseSourcesBridgeReply(bridge,c));for(const change of [{rawMessages:[]},{saved:saved()},{reply:{...reply,folder:'archived'}},{sessionClosed:true}])assert.equal(parseSourcesBridgeReply({...bridge,...change},c),null);});
test('watchdog cancels once; ACK alone cannot release read; exact stuck worker closes after grace',async()=>{const s=setup(10,15);try{s.client.consult('main');const read=s.w.last();await pause(13);const cancel=s.w.last();assert.equal(cancel.type,'sources.cancel');s.w.saved=saved();s.w.source(cancel,{type:'sources.cancelled',targetRequestId:read.requestId});assert.equal(s.activity.count,1);await pause(25);assert.equal(s.w.terminations,1);assert.equal(s.activity.count,0);assert.equal(s.client.snapshot().error,'timeout');}finally{s.client.dispose();}});
test('explicit cancel starts grace immediately even with a long read watchdog',async()=>{const s=setup(1000,10);try{s.client.consult('main');const read=s.w.last();s.client.cancel();s.w.source(s.w.last(),{type:'sources.cancelled',targetRequestId:read.requestId});await pause(20);assert.equal(s.w.terminations,1);assert.equal(s.activity.count,0);}finally{s.client.dispose();}});
test('logout during read purges UI and keeps read token until terminal before remote confirmation',()=>{const s=setup();try{const {client,w,activity}=s;client.consult('main');const read=w.last();w.saved=saved();client.logout();assert.equal(w.messages.at(-1)!.type,'logout');assert.equal(client.sourcesSnapshot().rows.length,0);assert.equal(activity.count,2);w.error(read);assert.equal(activity.count,1);assert.equal(client.snapshot().phase,'disconnecting');w.auth('disconnected');assert.equal(activity.count,0);assert.equal(client.snapshot().phase,'disconnected');}finally{s.client.dispose();}});
test('logout while cancel control pending queues auth until ACK and cannot claim revocation after local close',()=>{const s=setup();try{const {client,w}=s;client.consult('main');const read=w.last();client.cancel();const cancel=w.last(),count=w.messages.length;client.logout();assert.equal(w.messages.length,count);w.saved=saved();w.source(cancel,{type:'sources.cancelled',targetRequestId:read.requestId});assert.equal(w.messages.at(-1)!.type,'logout');w.source(read,{type:'sources.error',error:'cancelled',retryAt:null,retryBlocked:false},true);assert.equal(client.snapshot().error,'logout-unconfirmed');assert.equal(s.activity.count,0);}finally{s.client.dispose();}});
test('stop/dispose purges names/candidates/selection immediately, old callbacks cannot publish',()=>{const s=setup();const late=s.w.onmessage!;s.client.consult('main');const read=s.w.last();s.client.stop();assert.equal(s.client.sourcesSnapshot().rows.length,0);assert.equal(s.client.sourcesSnapshot().binding,null);late({data:read} as MessageEvent);assert.equal(s.activity.count,0);s.client.dispose();assert.equal(s.w.terminations,1);});

test('a selection ACK invalidates prior rendered source callbacks; expiry cannot confirm stale Saved',()=>{const s=setup();try{const old=s.client.captureSourcesCurrent(),ref=s.w.saved.peerRef;s.client.confirm([ref]);s.w.source(s.w.last(),{type:'sources.selected',revision:1,peerRefs:[ref]});const count=s.w.messages.length;s.client.clear(old);assert.equal(s.w.messages.length,count);assert.equal(old(),false);s.client.confirm([ref]);s.w.saved=null as unknown as SourceRow;s.w.error(s.w.last(),'expired');assert.equal(s.client.sourcesSnapshot().rows.length,0);assert.equal(s.client.sourcesSnapshot().selected.length,0);assert.equal(s.client.sourcesSnapshot().error,'expired');assert.equal(s.client.snapshot().phase,'connected');}finally{s.client.dispose();}});

test('old stop/cancel/auth UI closures target their exact session/read; cleanup does not need fresh authority',()=>{const s=setup();try{const oldStop=s.client.captureLocalStop(),oldAuth=s.client.captureSessionCurrent();s.client.consult('main');const oldCancel=s.client.captureCancel(),read=s.w.last();s.w.saved=saved();s.w.page(read);s.client.consult('archived');const count=s.w.messages.length;oldCancel();assert.equal(s.w.messages.length,count);s.client.stop();s.client.begin('+15550000000');const newer=s.workers[1];newer.auth();assert.equal(oldAuth(),false);oldStop();assert.equal(newer.terminations,0);const ownStop=s.client.captureLocalStop();s.invalidate();ownStop();assert.equal(newer.terminations,1);assert.equal(s.activity.count,0);}finally{s.client.dispose();}});
async function withSuspendedTimers(run:(time:{elapse(ms:number):void;fireIdle():void})=>Promise<void>|void){
 const realNow=Date.now,realSet=globalThis.setTimeout,realClear=globalThis.clearTimeout;let now=100000,next=1;
 const timers=new Map<number,{fn:()=>void;ms:number}>();
 try{
  Date.now=()=>now;
  globalThis.setTimeout=((fn:()=>void,ms:number)=>{const key=next++;timers.set(key,{fn,ms});return key;}) as unknown as typeof setTimeout;
  globalThis.clearTimeout=((key:number)=>{timers.delete(key);}) as unknown as typeof clearTimeout;
  await run({elapse(ms){now+=ms;},fireIdle(){const entry=[...timers].find(([,value])=>value.ms===SOURCES_BOUNDS.idleMs);assert.ok(entry);timers.delete(entry[0]);entry[1].fn();}});
 }finally{Date.now=realNow;globalThis.setTimeout=realSet;globalThis.clearTimeout=realClear;}
}
test('public source snapshot expires on read at the deadline without timer delivery or renewing auth',async()=>{
 await withSuspendedTimers(async time=>{const s=setup();try{
  const ref=s.w.saved.peerRef;s.client.confirm([ref]);s.w.source(s.w.last(),{type:'sources.selected',revision:1,peerRefs:[ref]});
  const old=s.client.captureSourcesCurrent(),binding=s.client.sourcesSnapshot().binding,count=s.w.messages.length;
  time.elapse(SOURCES_BOUNDS.idleMs-1);assert.equal(s.client.sourcesSnapshot().selected.length,1);assert.equal(old(),true);
  time.elapse(1);const before=s.notifications.length,expired=s.client.sourcesSnapshot();
  assert.equal(expired.rows.length,0);assert.equal(expired.selected.length,0);assert.equal(expired.error,'expired');assert.deepEqual(expired.binding,binding);
  assert.equal(old(),false);assert.equal(s.client.snapshot().phase,'connected');assert.equal(s.w.messages.length,count);assert.equal(s.activity.count,0);assert.equal(s.w.terminations,0);
  assert.equal(s.notifications.length,before,'snapshot/render-time capture cannot invoke React callbacks synchronously');
  await Promise.resolve();assert.equal(s.notifications.length,before+1);assert.equal(s.notifications.at(-1)?.selected.length,0);
 }finally{s.client.dispose();}});
});
test('expired render capture triggers a deferred purge and never revives after a fresh explicit list',async()=>{
 await withSuspendedTimers(async time=>{const s=setup();try{
  const old=s.client.captureSourcesCurrent(),ref=s.w.saved.peerRef,count=s.w.messages.length;
  time.elapse(SOURCES_BOUNDS.idleMs);assert.equal(old(),false);assert.equal(s.w.messages.length,count);
  await Promise.resolve();assert.equal(s.notifications.at(-1)?.error,'expired');
  s.client.consult('main',old);assert.equal(s.w.messages.length,count);
  s.client.consult('main');const page=s.w.last();assert.equal(page.type,'sources.page');assert.equal(s.w.messages.length,count+1);
  s.w.saved=saved();s.w.page(page);assert.ok(!s.client.sourcesSnapshot().rows.some(row=>row.peerRef===ref));assert.equal(old(),false);
  s.client.confirm([s.w.saved.peerRef]);s.w.source(s.w.last(),{type:'sources.selected',revision:1,peerRefs:[s.w.saved.peerRef]});assert.equal(old(),false);assert.equal(s.client.sourcesSnapshot().selected.length,1);
 }finally{s.client.dispose();}});
});
test('delivered idle callback invalidates old guards while a fresh gesture remains possible',async()=>{
 await withSuspendedTimers(time=>{const s=setup();try{
  const old=s.client.captureSourcesCurrent(),count=s.w.messages.length;time.elapse(SOURCES_BOUNDS.idleMs);time.fireIdle();
  assert.equal(old(),false);assert.equal(s.client.sourcesSnapshot().error,'expired');assert.equal(s.activity.count,0);
  s.client.consult('archived');assert.equal(s.w.messages.length,count+1);assert.equal(old(),false);
 }finally{s.client.dispose();}});
});
test('expiry preserves cooldown and cannot release an active read or publish its late result',async()=>{
 await withSuspendedTimers(time=>{const s=setup();try{
  s.client.consult('main');const read=s.w.last();assert.equal(s.activity.count,1);
  time.elapse(SOURCES_BOUNDS.idleMs);assert.equal(s.client.sourcesSnapshot().rows.length,0);assert.equal(s.activity.count,1);
  s.w.saved=saved();s.w.page(read,[s.w.saved,{peerRef:id(),kind:'channel',name:'Late fixture'}]);
  assert.equal(s.client.sourcesSnapshot().binding,null);assert.equal(s.activity.count,0);assert.equal(s.w.terminations,1);
 }finally{s.client.dispose();}});
 await withSuspendedTimers(time=>{const s=setup();try{
  s.client.consult('main');s.w.saved=saved();const until=Date.now()+172800000;s.w.error(s.w.last(),'rate-limit',{retryAt:until});
  const count=s.w.messages.length;time.elapse(SOURCES_BOUNDS.idleMs);const snapshot=s.client.sourcesSnapshot();assert.equal(snapshot.retryAt,until);assert.equal(snapshot.rows.length,0);
  s.client.consult('archived');assert.equal(s.w.messages.length,count);assert.equal(s.client.snapshot().phase,'connected');
 }finally{s.client.dispose();}});
});
test('deferred expiry notification cannot affect a disposed or replacement session',async()=>{
 await withSuspendedTimers(async time=>{const s=setup();try{
  const old=s.client.captureSourcesCurrent();time.elapse(SOURCES_BOUNDS.idleMs);assert.equal(old(),false);
  s.client.stop();s.client.begin('+15550000000');s.workers[1].auth();const count=s.notifications.length;
  await Promise.resolve();assert.equal(s.notifications.length,count);assert.equal(s.client.sourcesSnapshot().rows.length,1);assert.equal(s.client.snapshot().phase,'connected');assert.equal(old(),false);
  const next=s.client.captureSourcesCurrent();time.elapse(SOURCES_BOUNDS.idleMs);assert.equal(next(),false);s.client.dispose();const disposedCount=s.notifications.length;
  await Promise.resolve();assert.equal(s.notifications.length,disposedCount);
 }finally{s.client.dispose();}});
});
