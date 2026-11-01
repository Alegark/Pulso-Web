import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseTelegramApiIdentity,decodeTelegramApiIdentity,API_IDENTITY_INPUT_BYTES} from '../../src/telegram/api-identity';

// Format fixtures only. Never construct a client or claim these are real
// Telegram application credentials; these values are not used by the product.
const hash='Ab'.repeat(16);
test('canonical copy accepts integer or form text and isolates caller mutation',()=>{
 const input={api_id:'12345',api_hash:hash},value=parseTelegramApiIdentity(input);
 assert.deepEqual(value,{apiId:12345,apiHash:hash.toLowerCase()});assert.equal(Object.isFrozen(value),true);
 input.api_hash='';assert.equal(value?.apiHash.length,32);
 assert.equal(parseTelegramApiIdentity({api_id:2147483647,api_hash:hash})?.apiId,2147483647);
});
test('rejects invalid IDs, tokens, personal fields and open shapes',()=>{
 for(const api_id of [0,-1,2147483648,1.5,NaN,Infinity,true,'','01','1e3',' 12 ','+12','999999999999999999'])assert.equal(parseTelegramApiIdentity({api_id,api_hash:hash}),null);
 for(const api_hash of ['', 'a'.repeat(31),'a'.repeat(33),'z'.repeat(32),'123:bot-token',undefined])assert.equal(parseTelegramApiIdentity({api_id:12345,api_hash}),null);
 for(const extra of ['phone','code','password','session','extra'])assert.equal(parseTelegramApiIdentity({api_id:12345,api_hash:hash,[extra]:'private'}),null);
});
test('accessors, inherited properties, hidden fields and thrown reflection never authorize',()=>{
 let reads=0;const getter=()=>{reads++;throw Error('untrusted');};
 for(const input of [Object.defineProperty({api_id:12345},'api_hash',{enumerable:true,get:getter}),Object.create({api_id:12345,api_hash:hash}),Object.defineProperty({api_id:12345,api_hash:hash},'hidden',{value:true}),new Proxy({},{getPrototypeOf(){throw Error('reflection');}})])assert.equal(parseTelegramApiIdentity(input),null);
 assert.equal(reads,0);
});
test('bounded JSON rejects oversize before parse and never propagates raw errors',()=>{
 const text=JSON.stringify({api_id:12345,api_hash:hash});assert.equal(decodeTelegramApiIdentity(text)?.apiId,12345);
 for(const input of [null,[],{},'{not-json',text+' '.repeat(API_IDENTITY_INPUT_BYTES), 'é'.repeat(API_IDENTITY_INPUT_BYTES)])assert.equal(decodeTelegramApiIdentity(input),null);
 assert.equal(decodeTelegramApiIdentity(JSON.stringify({api_id:12345,api_hash:hash,code:'never-accepted'})),null);
});
