import test from 'node:test';
import assert from 'node:assert/strict';
import {Activity} from '../../src/playback/ownership';
import {TelegramSessionClient,type SessionWorker} from '../../src/telegram/session-client';
import * as protocol from '../../src/telegram/session-protocol';
import type {ConnectionCommand,SessionCommand} from '../../src/telegram/session-protocol';
import {copyBotSearchEnvelope,type BotSearchCommand} from '../../src/telegram/bot-search-protocol';

const lifecyclePath='../../src/telegram/connection-lifecycle';
const lifecycle=await import(lifecyclePath).catch((error:NodeJS.ErrnoException)=>{
 if(error.code==='ERR_MODULE_NOT_FOUND')return null; // Run the same tests on v62.
 throw error;
}) as typeof import('../../src/telegram/connection-lifecycle')|null;
type Command=Parameters<SessionWorker['postMessage']>[0];
const idleMs=180_000;
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
const target={title:'Synthetic recording',artist:null,album:null,durationSeconds:null};

function fixture(){
 let connected=false,cooldown:number|null=null,imports=0,updates=0,terminations=0,vault='synthetic-saved-session';
 const commands:Command[]=[],openedAt:number[]=[],abort=new AbortController();
 const connection=lifecycle&&new lifecycle.TelegramConnection(abort.signal,
  async()=>{connected=false;},
  async()=>{assert.equal(vault,'synthetic-saved-session');imports++;openedAt.push(Date.now());connected=true;},
  ()=>cooldown);
 const provider={providerRef:crypto.randomUUID(),username:'kdmusic_bot',label:'Synthetic bot',status:'verified-profile',compatibility:'unverified'};
 const worker:SessionWorker={
  onmessage:null,onerror:null,onmessageerror:null,
  postMessage(command){
   commands.push(command);
   if(command.type==='suspend')void connection?.suspend();
   if(command.type==='warm')connection?.warm();
   if(command.type==='logout')vault='';
  },
  terminate(){terminations++;abort.abort();},
 };
 const emit=(data:unknown)=>worker.onmessage?.({data} as MessageEvent);
 const activity=new Activity();activity.open();
 const client=new TelegramSessionClient(activity,()=>activity.scope(),()=>{},()=>worker);
 let working=false;
 client.configureConnectionLifecycle?.(true,()=>working);
 client.restore();
 const auth=commands[0] as SessionCommand;
 assert.equal(auth.type,'restore');
 connected=true;
 emit({version:2,session:auth.session,request:auth.request,phase:'connected',error:null,retryAt:null,delivery:null,
  binding:{accountRef:crypto.randomUUID(),accountEpoch:1},saved:{peerRef:crypto.randomUUID(),kind:'saved',name:'Mensajes guardados'},
  vaultGeneration:crypto.randomUUID(),bots:[provider]});
 const searchReply=(command:BotSearchCommand,fields:object)=>emit({
  protocol:command.protocol,version:1,reply:{...copyBotSearchEnvelope(command),...fields},sessionClosed:false,retryAt:null,retryBlocked:false,
 });
 return {
  client,worker,activity,commands,openedAt,provider,searchReply,
  connectionCommands:()=>commands.filter((command):command is ConnectionCommand=>command.type==='suspend'||command.type==='warm'),
  work(value:boolean){working=value;client.revalidate();},
  updatesFromServer(count:number){for(let i=0;i<count;i++)if(connected)updates++;return updates;},
  get connected(){return connected;},get imports(){return imports;},get terminations(){return terminations;},get vault(){return vault;},
  setCooldown(until:number){cooldown=until;},
  demand:async()=>connection?.ensureAvailable(),
  dispose:()=>client.dispose(),
 };
}

test('M1-01 and M1-04 · idle and hidden close the transport and saved authorization warms it again',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:10_000});
 const f=fixture();
 try{
  const downloadAccountCurrent=f.client.captureDownloadAccountCurrent();
  t.mock.timers.tick(idleMs-1);
  assert.equal(f.connected,true);
  t.mock.timers.tick(1);await flush();
  assert.equal(f.connected,false,'transport at three minutes');
  assert.equal(f.client.snapshot().phase,'connected');
  f.client.connectionActivity?.();
  await flush();
  assert.equal(f.connected,true);
  assert.equal(f.imports,1);
  f.client.setConnectionVisibility?.(false);await flush();
  assert.equal(f.connected,false);
  t.mock.timers.tick(1000);
  f.client.setConnectionVisibility?.(true);await flush();
  assert.equal(f.connected,true);
  assert.equal(f.imports,2);
  assert.equal(f.vault,'synthetic-saved-session');
  assert.equal(f.terminations,0);
  assert.ok(downloadAccountCurrent());
  assert.deepEqual(f.commands.filter(command=>['restore','begin','code','logout','forget'].includes(command.type)).map(command=>command.type),['restore']);
 }finally{f.dispose();}
});

test('M1-02 · search, download, preparation, active collection and batch wait keep the transport until settlement',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:10_000});
 const f=fixture();
 try{
  f.client.searchBot({providerRef:f.provider.providerRef,query:target.title,target,consent:true});
  const search=f.commands.at(-1) as BotSearchCommand;
  assert.equal(search.type,'bot-search.search');
  f.client.setConnectionVisibility?.(false);await flush();
  assert.equal(f.connected,true);
  // T24 covers the real collection flight and reconnect wait. The observer
  // supplies the same synchronous busy input across the gap between RPCs.
  f.work(true);
  const rowRef=crypto.randomUUID();
  f.searchReply(search,{type:'bot-search.result',delivery:'acknowledged',rows:[{kind:'option',rowRef,correlation:'reply',label:'Synthetic track'}],expiresAt:Date.now()+2000,expectedTarget:target});
  const downloading=f.client.downloadBot(rowRef,f.client.captureSearchActionCurrent());
  const download=f.commands.at(-1) as BotSearchCommand;
  assert.equal(download.type,'bot-search.download');
  await flush();assert.equal(f.connected,true);
  f.searchReply(download,{type:'bot-search.error',delivery:'acknowledged',error:'network',retryAt:null,retryBlocked:false});
  assert.equal(await downloading,null);
  t.mock.timers.tick(idleMs+1);await flush();
  assert.equal(f.connected,true);
  const unrelatedStorage=f.activity.begin()!;
  const preparing=f.client.holdConnection?.();
  const catalog=f.client.holdConnection?.();
  f.work(false);await flush();assert.equal(f.connected,true);
  preparing?.();await flush();assert.equal(f.connected,true);
  catalog?.();await flush();
  assert.equal(f.connected,false,'hidden transport after the last hold ends');
  unrelatedStorage.end();
  assert.deepEqual(f.connectionCommands().map(command=>command.type),['suspend']);
 }finally{f.dispose();}
});

test('M1-05 and M1-07 · no incoming updates while asleep and only closed lifecycle messages on the bridge',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:10_000});
 const f=fixture();
 try{
  assert.equal(f.updatesFromServer(3),3);
  f.client.setConnectionVisibility?.(false);await flush();
  assert.equal(f.updatesFromServer(9),3);
  f.client.setConnectionVisibility?.(true);await flush();
  assert.equal(f.updatesFromServer(3),6);
  assert.deepEqual(f.connectionCommands().map(command=>Object.keys(command).sort()),Array.from({length:2},()=>['protocol','session','type','version']));
  const raw={...f.connectionCommands()[0],privateContent:'test marker'};
  assert.equal(protocol.parseConnectionCommand?.(raw),null);
  let inspected=0;
  const accessor=Object.defineProperty({...f.connectionCommands()[0]},'type',{get(){inspected++;return 'warm';}});
  assert.equal(protocol.parseConnectionCommand?.(accessor),null);
  assert.equal(inspected,0);
 }finally{f.dispose();}
});

test('M1-06 · cooldown, visibility debounce and four reconnections per rolling minute',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:10_000});
 const f=fixture();
 try{
  const visibility=async(visible:boolean)=>{f.client.setConnectionVisibility?.(visible);await flush();};
  f.setCooldown(12_000);
  await visibility(false);await visibility(true);
  t.mock.timers.tick(1999);await flush();
  assert.deepEqual(f.openedAt,[]);
  await assert.rejects(f.demand,error=>Reflect.get(error as object,'seconds')===1);
  t.mock.timers.tick(1);await flush();
  assert.deepEqual(f.openedAt,[12_000]);
  await visibility(false);await visibility(true);await visibility(false);
  t.mock.timers.tick(999);await flush();assert.equal(f.imports,1);
  t.mock.timers.tick(1);await flush();assert.equal(f.imports,1,'hide cancels a delayed warm');
  await visibility(true);
  for(let i=0;i<2;i++){
   await visibility(false);await visibility(true);
   await flush();assert.equal(f.imports,2+i);
   t.mock.timers.tick(1000);await flush();
  }
  assert.deepEqual(f.openedAt,[12_000,13_000,14_000,15_000]);
  await visibility(false);await visibility(true);
  t.mock.timers.tick(56_999);await flush();
  assert.equal(f.imports,4);
  assert.equal(f.connected,false);
  await assert.rejects(f.demand,error=>Reflect.get(error as object,'seconds')===1);
  t.mock.timers.tick(1);await flush();
  assert.equal(f.imports,5);
  assert.equal(f.openedAt.at(-1),72_000);
 }finally{f.dispose();}
});
