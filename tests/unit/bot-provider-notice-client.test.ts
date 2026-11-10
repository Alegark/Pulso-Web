import test from 'node:test';
import assert from 'node:assert/strict';
import {Activity} from '../../src/playback/ownership';
import {TelegramSessionClient,type SessionWorker,type BotSearchSnapshot} from '../../src/telegram/session-client';
import {copyBotSearchEnvelope,type BotSearchCommand} from '../../src/telegram/bot-search-protocol';
import {copyBotEnvelope,type BotProvidersCommand,type BotProviderRow} from '../../src/telegram/bot-providers-protocol';
import type {SessionCommand} from '../../src/telegram/session-protocol';
import type {SourcesCommand} from '../../src/telegram/sources-protocol';
import {parseBotSearchBridgeReply} from '../../src/telegram/bot-search-bridge-protocol';
const id=()=>crypto.randomUUID();
type Command=SessionCommand|SourcesCommand|BotProvidersCommand|BotSearchCommand;
class Fixture implements SessionWorker {
 onmessage:SessionWorker['onmessage']=null;onerror:SessionWorker['onerror']=null;onmessageerror:SessionWorker['onmessageerror']=null;
 messages:Command[]=[];terminations=0;binding={accountRef:id(),accountEpoch:1};saved={peerRef:id(),kind:'saved' as const,name:'Mensajes guardados'};
 postMessage(c:Command){this.messages.push(c);}terminate(){this.terminations++;}emit(data:unknown){this.onmessage?.({data} as MessageEvent);}
 auth(phase='connected'){const c=this.messages.findLast(c=>'session'in c)! as SessionCommand;this.emit({version:2,session:c.session,request:c.request,phase,error:null,retryAt:null,delivery:null,binding:phase==='connected'?this.binding:null,saved:phase==='connected'?this.saved:null});}
 last(){return this.messages.at(-1)! as BotSearchCommand;}
 bot(c:BotProvidersCommand,fields:Record<string,unknown>){this.emit({protocol:c.protocol,version:1,reply:{...copyBotEnvelope(c),...fields},sessionClosed:false});}
 search(c:BotSearchCommand,fields:Record<string,unknown>,extra={}){const raw={protocol:c.protocol,version:1,reply:{...copyBotSearchEnvelope(c),...fields},sessionClosed:false,retryAt:null,retryBlocked:false,...extra};this.emit(raw);return raw;}
 result(c=this.last(),extra={}){return this.search(c,{type:'bot-search.result',delivery:'acknowledged',rows:[{kind:'option',rowRef:id(),correlation:'reply',label:'Synthetic result'}],expiresAt:Date.now()+15000,expectedTarget:c.type==='bot-search.search'?c.target??null:null,...extra});}
 sending(c=this.last()){return this.search(c,{type:'bot-search.sending',delivery:'uncertain'});}
 error(c=this.last(),error='cancelled',delivery='not-dispatched',extra={}){return this.search(c,{type:'bot-search.error',error,delivery,retryAt:null,retryBlocked:false},extra);}
 ack(c=this.last()){assert.equal(c.type,'bot-search.cancel');return this.search(c,{type:'bot-search.cancelled',targetRequestId:c.type==='bot-search.cancel'?c.targetRequestId:''});}
}
function setup(grace=30){const activity=new Activity();activity.open();let generation=0;const workers:Fixture[]=[],notifications:BotSearchSnapshot[]=[];const client=new TelegramSessionClient(activity,()=>{const scope=activity.scope(),g=generation;return()=>scope()&&g===generation&&activity.admitted;},()=>{},()=>{const w=new Fixture();workers.push(w);return w;},1000,()=>{},1000,grace,()=>{},s=>notifications.push(s));client.begin('+15550000000');const w=workers[0];w.auth();return {activity,client,w,workers,notifications,invalidate(){generation++;}};}
function add(s:ReturnType<typeof setup>,username='ivkmbot'){const r:BotProviderRow={providerRef:id(),username,label:'Synthetic bot',status:'verified-profile',compatibility:'unverified'};s.client.addBot(username);s.w.bot(s.w.last() as unknown as BotProvidersCommand,{type:'bots.validated',offer:r});const c=s.w.last() as unknown as BotProvidersCommand;s.w.bot(c,{type:'bots.ordered',providers:[...s.client.botsSnapshot().providers,r],revision:c.providerRevision+1,changed:true});return r;}
function start(s:ReturnType<typeof setup>,r=add(s)){s.client.searchBot({providerRef:r.providerRef,query:'Synthetic song',consent:true});return s.w.last();}
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));

test('notice survives terminal error and clears on clear or reorder; cancellation and late frames cannot revive it',async()=>{
 const s=setup();try{const r=add(s),target={title:'Synthetic song',artist:null,album:null,durationSeconds:null};
 const download=()=>{s.client.searchBot({providerRef:r.providerRef,query:'Synthetic song',target,consent:true});const query=s.w.last();s.w.result(query);const row=s.client.searchSnapshot().rows[0];const promise=s.client.downloadBot(row.rowRef,s.client.captureSearchActionCurrent());return {command:s.w.last(),promise};};
 let d=download();s.w.sending(d.command);s.w.search(d.command,{type:'bot-search.provider-notice',text:'Synthetic notice'});assert.equal(s.activity.count,1);s.w.error(d.command,'unsupported','acknowledged');await d.promise;assert.equal(s.client.searchSnapshot().providerNotice,'Synthetic notice');assert.equal(s.client.searchSnapshot().error,'unsupported');s.client.clearSearch();assert.equal(s.client.searchSnapshot().providerNotice,null);
 d=download();s.client.captureSearchCancel()!();const cancel=s.w.last();s.w.search(d.command,{type:'bot-search.provider-notice',text:'Late synthetic'});s.w.ack(cancel);s.w.error(d.command,'cancelled','acknowledged');await d.promise;assert.equal(s.client.searchSnapshot().providerNotice,null);s.w.search(d.command,{type:'bot-search.provider-notice',text:'Later synthetic'});assert.equal(s.client.searchSnapshot().providerNotice,null);
 d=download();s.w.search(d.command,{type:'bot-search.provider-notice',text:'Synthetic again'});s.w.error(d.command,'timeout','acknowledged');await d.promise;s.client.moveBot(r.providerRef,'up');assert.equal(s.client.searchSnapshot().providerNotice,null);
 }finally{s.client.dispose();}
});

test('admission receipt belongs to its plan and refused admission emits none',()=>{
 const s=setup();try{
  const r=add(s),input={providerRef:r.providerRef,query:'Synthetic song',consent:true as const};
  let first:{queryId:string;cancel:()=>void}|undefined,refused=0,second:{queryId:string;cancel:()=>void}|undefined;
  s.client.searchBot(input,s.client.captureSearchActionCurrent(),receipt=>{first=receipt;});
  assert.ok(first);const firstCommand=s.w.last(),count=s.w.messages.length;
  s.client.searchBot(input,s.client.captureSearchActionCurrent(),()=>{refused++;});
  assert.equal(refused,0);assert.equal(s.w.messages.length,count);
  s.w.result(firstCommand);
  s.client.searchBot(input,s.client.captureSearchActionCurrent(),receipt=>{second=receipt;});
  assert.ok(second);assert.notEqual(second.queryId,first.queryId);const before=s.w.messages.length;
  first.cancel();assert.equal(s.w.messages.length,before);assert.equal(s.client.searchSnapshot().pending,true);
  s.w.result(s.w.last());assert.equal(s.client.searchSnapshot().pending,false);
 }finally{s.client.dispose();}
});
