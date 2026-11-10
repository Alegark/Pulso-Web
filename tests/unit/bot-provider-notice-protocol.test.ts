import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {botSearchText,parseBotSearchReply} from '../../src/telegram/bot-search-protocol';
test('synthetic provider notice is a bounded closed data-only DTO with original envelope',()=>{
 const e={protocol:'pulso-bot-search' as const,version:1 as const,sessionId:randomUUID(),accountRef:randomUUID(),accountEpoch:1,providerRevision:1,queryId:randomUUID(),requestId:randomUUID()};
 const raw={...e,type:'bot-search.provider-notice',text:'<script> https://example.invalid'};
 assert.ok(parseBotSearchReply(raw,e));
 for(const change of [{text:''},{text:'x'.repeat(501)},{text:'  x'},{text:'x\ny'},{requestId:randomUUID()},{extra:true}])assert.equal(parseBotSearchReply({...raw,...change},e),null);
 let reads=0;const hostile={...raw};Object.defineProperty(hostile,'text',{enumerable:true,get(){reads++;return 'x';}});assert.equal(parseBotSearchReply(hostile,e),null);assert.equal(reads,0);
 assert.equal(botSearchText('  '+ 'a'.repeat(600)+'  ',500),'a'.repeat(500));assert.equal(botSearchText('x'.repeat(8193),500),null);
});
