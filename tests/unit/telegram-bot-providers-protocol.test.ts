import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {parseBotUsername,parseBotProvidersCommand,parseBotProvidersReply} from '../../src/telegram/bot-providers-protocol';
import {BOT_CHAT_PROFILES,BOT_CHAT_SUGGESTIONS} from '../../src/telegram/bot-chat-profiles';
const envelope=()=>({protocol:'pulso-bot-providers' as const,version:1 as const,sessionId:randomUUID(),accountRef:randomUUID(),accountEpoch:1,providerRevision:0,operationId:randomUUID(),requestId:randomUUID()});
test('public username grammar: short aliases, case normalization, no ends-bot proof',()=>{
 for(const s of ['A','Ab_c','ivkmbot','@LyDBot','https://t.me/Ab_c','x'.repeat(32)])assert.equal(parseBotUsername(s),s.replace(/^@|^https:\/\/t.me\//,'').toLowerCase());
 for(const s of ['',' abcd','abcd ','a\n','1abc','@','@@foo','a'.repeat(33),'https://t.me/u/1','https://t.me/u?start=x','https://t.me/u#x','https://t.me/+invite','https://telegram.me/user','https://t.me.evil/u','https://t%2eme/user','https://t.me:443/user','https://t.me\\user','https://user@t.me/user','https://t.me/%61','tg://resolve?domain=a','http://t.me/user','https://t.me/s/user'])assert.equal(parseBotUsername(s),null,s);
});
test('closed variants, exact own data keys, 0..5 unique UUIDs and expected revision',()=>{
 const e=envelope();for(const n of [0,5])assert.ok(parseBotProvidersCommand({...e,type:'bots.setOrder',expectedRevision:0,providerRefs:Array.from({length:n},randomUUID)}));
 const ref=randomUUID();for(const extra of [{providerRefs:Array.from({length:6},randomUUID)},{providerRefs:[ref,ref]},{providerRefs:['forged']},{expectedRevision:1}])assert.equal(parseBotProvidersCommand({...e,type:'bots.setOrder',expectedRevision:0,providerRefs:[],...extra}),null);
 for(const type of ['bots.start','bots.search','bots.resolve','call','sources.page'])assert.equal(parseBotProvidersCommand({...e,type,input:'user'}),null);
 const cmd={...e,type:'bots.validate',input:'@x'};assert.ok(parseBotProvidersCommand(cmd));
 for(const bad of [{...cmd,extra:1},{...cmd,[Symbol('x')]:1},Object.assign(Object.create(cmd),{input:'x'}),{...cmd,providerRevision:-1},{...cmd,accountEpoch:0},{...cmd,sessionId:'x'}])assert.equal(parseBotProvidersCommand(bad),null);
});
test('getters never execute; throwing proxies fail closed; no claim to suppress proxy traps',()=>{
 const c={...envelope(),type:'bots.validate',input:'user'};let reads=0;
 Object.defineProperty(c,'input',{enumerable:true,get(){reads++;throw Error('getter');}});assert.equal(parseBotProvidersCommand(c),null);assert.equal(reads,0);
 const p=new Proxy({}, {getPrototypeOf(){reads++;throw Error('trap');}});assert.equal(parseBotProvidersCommand(p),null);assert.equal(reads,1);
 const a=[randomUUID()];Object.defineProperty(a,'0',{get(){reads++;return randomUUID();}});assert.equal(parseBotProvidersCommand({...envelope(),type:'bots.setOrder',expectedRevision:0,providerRefs:a}),null);assert.equal(reads,1);
});
test('reply parsing enforces correlation and detached sanitized projection',()=>{
 const e=envelope(),offer={providerRef:randomUUID(),username:'x',label:'Nombre',status:'verified-profile',compatibility:'unverified'};
 const raw={...e,type:'bots.validated',offer};const reply=parseBotProvidersReply(raw,e);assert.ok(reply);offer.label='Changed';assert.equal(reply.type==='bots.validated'&&reply.offer.label,'Nombre');
 assert.equal(parseBotProvidersReply(raw,{...e,operationId:randomUUID()}),null);
 for(const extra of [{id:123},{accessHash:123},{compatibility:'verified'},{label:'\u202eNombre'}])assert.equal(parseBotProvidersReply({...raw,offer:{...offer,...extra}},e),null);
 assert.equal(parseBotProvidersReply({...e,type:'bots.ordered',revision:1,changed:false,providers:[]},e),null);
});
test('study suggestions have no refs, selection or query generation',()=>{
 assert.deepEqual(BOT_CHAT_SUGGESTIONS,['ivkmbot','LyDBot']);for(const p of BOT_CHAT_PROFILES){assert.equal(p.status,'NO_VERIFICADO');assert.equal(p.queryGenerationEnabled,false);assert.ok(!('providerRef'in p));}
});
