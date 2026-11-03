import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {formatBotSearchQuery,parseBotSearchCommand,parseBotSearchReply,type BotSearchCommand} from '../../src/telegram/bot-search-protocol';
const e=()=>({protocol:'pulso-bot-search',version:1,sessionId:randomUUID(),accountRef:randomUUID(),accountEpoch:1,providerRevision:1,queryId:randomUUID(),requestId:randomUUID()});
const c=()=>({...e(),type:'bot-search.search',providerRef:randomUUID(),query:'A song',consent:true});
test('closed data-only query admission: explicit consent, no controls/commands/multiline/unknown fields',()=>{
 const good=c();assert.ok(parseBotSearchCommand(good));
 for(const query of ['', ' ', ' a','a ', '/start','/anything','a\nb','a\rb','a\tb','a\u2028b','a\u202eb','a\ud800','x'.repeat(161)])assert.equal(parseBotSearchCommand({...good,query}),null,JSON.stringify(query));
 assert.ok(parseBotSearchCommand({...good,query:'🎵'.repeat(160)}));
 for(const extra of [{consent:false},{consent:1},{query:42},{providerRef:42},{sessionId:randomUUID(),accountEpoch:0},{extra:true},{randomId:'secret'},{target:null}])assert.equal(parseBotSearchCommand({...good,...extra}),null);
 let getters=0;const hostile={...good};Object.defineProperty(hostile,'query',{enumerable:true,get(){getters++;return 'song';}});assert.equal(parseBotSearchCommand(hostile),null);assert.equal(getters,0);
});
test('structured target is copied, closed and bounded; formatter preserves versions and sends no album/duration',()=>{
 const target={title:'Song (Live remix)',artist:'Artist',album:'Album secret',durationSeconds:231};const raw={...c(),target};
 const command=parseBotSearchCommand(raw)! as Extract<BotSearchCommand,{type:'bot-search.search'}>;assert.ok(command);target.title='mutated';assert.equal(command.target!.title,'Song (Live remix)');assert.ok(Object.isFrozen(command.target));
 assert.equal(formatBotSearchQuery(command),'Song (Live remix) Artist');
 for(const extra of [{extra:'x'},{title:''},{artist:undefined},{album:'x'.repeat(161)},{durationSeconds:NaN},{durationSeconds:Infinity},{durationSeconds:-1},{durationSeconds:86401}])assert.equal(parseBotSearchCommand({...raw,target:{...target,...extra}}),null);
 const over=parseBotSearchCommand({...raw,target:{title:'a'.repeat(160),artist:'b',album:null,durationSeconds:null}})! as typeof command;assert.equal(formatBotSearchQuery(over),null);
 const slash=parseBotSearchCommand({...raw,target:{title:'/start',artist:null,album:null,durationSeconds:null}})! as typeof command;assert.equal(formatBotSearchQuery(slash),null);
});
test('reply parser matches every envelope field and rejects raw fields, empty result and mismatched rate ledger',()=>{
 const envelope=e() as never;const result={...envelope,type:'bot-search.result',delivery:'acknowledged',expiresAt:1000,expectedTarget:null,rows:[{kind:'option',rowRef:randomUUID(),correlation:'recent',label:'<img src=x onerror=evil()>Song'}]};
 assert.ok(parseBotSearchReply(result,envelope));
 for(const extra of [{accountRef:randomUUID()},{accountEpoch:2},{providerRevision:2},{queryId:randomUUID()},{requestId:randomUUID()},{rawMessageId:14},{rows:[]},{expectedTarget:undefined},{expiresAt:Infinity},{rows:[{...result.rows[0],callbackData:[1]}]}])assert.equal(parseBotSearchReply({...result,...extra},envelope),null);
 const err={...envelope,type:'bot-search.error',error:'rate-limit',delivery:'uncertain',retryAt:null,retryBlocked:true};assert.ok(parseBotSearchReply(err,envelope));assert.equal(parseBotSearchReply({...err,retryBlocked:false},envelope),null);assert.equal(parseBotSearchReply({...err,error:'timeout'},envelope),null);
});
