import test from 'node:test';
import assert from 'node:assert/strict';
import {assertBotSearchRawBudget,BotSearchProjectionError,projectBotSearchPage} from '../../src/telegram/bot-search-page';
import {BOT_SEARCH_LIMIT_DIAGNOSTICS,copyBotSearchEnvelope,parseBotSearchReply,type BotSearchCommand} from '../../src/telegram/bot-search-protocol';
import {parseBotSearchBridgeReply} from '../../src/telegram/bot-search-bridge-protocol';
const id=()=>crypto.randomUUID();
const command:BotSearchCommand={protocol:'pulso-bot-search',version:1,sessionId:id(),accountRef:id(),accountEpoch:1,providerRevision:1,queryId:id(),requestId:id(),type:'bot-search.search',providerRef:id(),query:'Own query',consent:true};
test('each diagnostic is a closed enum with unchanged envelope, no private details or free text',()=>{
 for(const error of Object.keys(BOT_SEARCH_LIMIT_DIAGNOSTICS)){
  const r={...copyBotSearchEnvelope(command),type:'bot-search.error',error,delivery:'acknowledged',retryAt:null,retryBlocked:false};assert.ok(parseBotSearchReply(r,command));
  const bridge={protocol:command.protocol,version:1,reply:r,sessionClosed:false,retryAt:null,retryBlocked:false};assert.ok(parseBotSearchBridgeReply(bridge,command));
  assert.equal(parseBotSearchReply({...r,detail:'PRIVATE'},command),null);assert.equal(parseBotSearchReply({...r,error:'limit-PRIVATE'},command),null);
  assert.equal(parseBotSearchBridgeReply({...bridge,detail:'PRIVATE'},command),null);
 }
 assert.ok(parseBotSearchReply({...copyBotSearchEnvelope(command),type:'bot-search.error',error:'limit',delivery:'acknowledged',retryAt:null,retryBlocked:false},command));
});
test('independent raw budget guards retain limit category and identify only their fixed reason',()=>{
 const shared={n:1};let deep:unknown={};for(let i=0;i<23;i++)deep={child:deep};
 for(const [raw,limit] of [[{text:'x'.repeat(40000)},'limit-raw-bytes'],[{bytes:new Uint8Array(4097)},'limit-binary'],[[shared,shared],'limit-raw-references'],[deep,'limit-raw-depth'],[Object.fromEntries(Array.from({length:2100},(_,i)=>[i,0])),'limit-raw-slots']] as const){
  assert.throws(()=>assertBotSearchRawBudget(raw),e=>e instanceof BotSearchProjectionError&&e.code==='limit'&&e.limit===limit);
 }
});
test('history and keyboard structure limits retain denial without exposing message data',()=>{
 const msg={_:'message',id:12,peerId:{_:'peerUser',userId:101},fromId:{_:'peerUser',userId:101},message:'PRIVATE'};
 assert.throws(()=>projectBotSearchPage({_:'messages.messages',messages:Array.from({length:21},()=>msg)},101,9,10),e=>e instanceof BotSearchProjectionError&&e.limit==='limit-history');
 const raw={_:'messages.messages',messages:[{...msg,replyMarkup:{_:'replyInlineMarkup',rows:Array.from({length:65},()=>({_:'keyboardInlineButtonRow',buttons:[]}))}}]};
 assert.throws(()=>projectBotSearchPage(raw,101,9,10),e=>e instanceof BotSearchProjectionError&&e.limit==='limit-keyboard-rows');
});
