import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import Long from 'long';
import {createBotProvidersDriver} from '../../src/telegram/bot-providers-driver';
import {parseSavedBots} from '../../src/telegram/saved-session';

const one={username:'alpha',label:'Alpha',id:101,low:123,high:45};
const two={username:'bravo',label:'Bravo',id:102,low:124,high:45};
test('private schema is closed, bounded and rejects duplicate pins',()=>{
 assert.deepEqual(parseSavedBots({version:1,bots:[one,two]}),[one,two]);
 for(const value of [{version:2,bots:[]},{version:1,bots:[one,one]},{version:1,bots:[{...one,extra:1}]},{version:1,bots:[{...one,low:0,high:0}]},{version:1,bots:Array(6).fill(one)}])assert.equal(parseSavedBots(value),null);
});
test('restore is silent, creates fresh refs, checks pins, and writes before order ACK',async()=>{
 let calls=0,invalidations=0,finish!:(v:boolean)=>void;const save=new Promise<boolean>(r=>{finish=r;});
 const binding={accountRef:randomUUID(),accountEpoch:1},sessionId=randomUUID();
 const pool=createBotProvidersDriver(binding,sessionId,{async resolveIdentity(){calls++;return null;},invalidateSession(){invalidations++;},saveSelection:()=>save},undefined,[one,two]);
 const snapshot=pool.getSnapshot()!;assert.equal(calls,0);assert.deepEqual(snapshot.providers.map(x=>x.username),['alpha','bravo']);
 const second=createBotProvidersDriver(binding,randomUUID(),{async resolveIdentity(){throw Error();},invalidateSession(){}},undefined,[one,two]);assert.notEqual(second.getSnapshot()!.providers[0].providerRef,snapshot.providers[0].providerRef);second.close();
 const capture=pool.captureSearchProvider(snapshot.providers[0].providerRef,0)!;
 const raw={_: 'contacts.resolvedPeer',peer:{_: 'peerUser',userId:one.id},chats:[],users:[{_: 'user',id:one.id,bot:true,username:'alpha',accessHash:new Long(one.low,one.high,false),firstName:'Alpha'}]};
 assert.ok(capture.verifyIdentity(raw));
 const command={protocol:'pulso-bot-providers',version:1,sessionId,...binding,providerRevision:0,operationId:randomUUID(),requestId:randomUUID(),type:'bots.setOrder',expectedRevision:0,providerRefs:[snapshot.providers[1].providerRef,snapshot.providers[0].providerRef]};
 let completed=false;const pending=pool.handle(command,{signal:new AbortController().signal,current:()=>true}).then(r=>{completed=true;return r;});await Promise.resolve();assert.equal(completed,false);assert.equal(capture.current(),false);finish(true);assert.equal((await pending)?.type,'bots.ordered');assert.deepEqual(pool.getSnapshot()!.providers.map(x=>x.username),['bravo','alpha']);
 const fresh=pool.captureSearchProvider(snapshot.providers[0].providerRef,1)!;assert.equal(fresh.verifyIdentity({...raw,users:[{...raw.users[0],accessHash:new Long(1,1,false)}]}),null);assert.equal(invalidations,1);assert.equal(pool.getSnapshot(),null);
});
test('failed save invalidates all capabilities and never acknowledges order',async()=>{
 let invalidations=0;const binding={accountRef:randomUUID(),accountEpoch:1},sessionId=randomUUID();const pool=createBotProvidersDriver(binding,sessionId,{async resolveIdentity(){return null;},invalidateSession(){invalidations++;},async saveSelection(){throw Error();}},undefined,[one]);
 const reply=await pool.handle({protocol:'pulso-bot-providers',version:1,sessionId,...binding,providerRevision:0,operationId:randomUUID(),requestId:randomUUID(),type:'bots.setOrder',expectedRevision:0,providerRefs:[]},{signal:new AbortController().signal,current:()=>true});assert.equal(reply?.type,'bots.error');assert.equal(pool.getSnapshot(),null);assert.equal(invalidations,1);
});
test('close during pending save waits for settlement and cannot publish old order',async()=>{
 let finish!:(v:boolean)=>void;const gate=new Promise<boolean>(resolve=>{finish=resolve;});const binding={accountRef:randomUUID(),accountEpoch:1},sessionId=randomUUID();const pool=createBotProvidersDriver(binding,sessionId,{async resolveIdentity(){return null;},invalidateSession(){},saveSelection:()=>gate},undefined,[one]);
 const command={protocol:'pulso-bot-providers',version:1,sessionId,...binding,providerRevision:0,operationId:randomUUID(),requestId:randomUUID(),type:'bots.setOrder',expectedRevision:0,providerRefs:[]};const pending=pool.handle(command,{signal:new AbortController().signal,current:()=>true});let settled=false;const closing=pool.quiesce().then(()=>{settled=true;});await Promise.resolve();assert.equal(settled,false);finish(true);assert.equal((await pending)?.type,'bots.error');await closing;assert.equal(pool.getSnapshot(),null);
});
