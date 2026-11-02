import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {parseAccountBinding,parseSourcesCommand,parseSourcesReply,sourceName,utf8Bytes} from '../../src/telegram/sources-protocol';
const envelope=()=>({protocol:'pulso-sources' as const,version:1 as const,accountRef:randomUUID(),accountEpoch:1,sessionId:randomUUID(),listEpoch:1,operationId:randomUUID(),requestId:randomUUID()});
test('closed commands copy/freeze only approved data and reject every hostile field',()=>{
 const e=envelope(),base={...e,type:'sources.page',folder:'main',cursor:null};
 assert.ok(parseSourcesCommand(base));assert.ok(Object.isFrozen(parseSourcesCommand(base)));
 let getters=0;
 const variants=[{...base,extra:1},{...base,version:2},{...base,listEpoch:NaN},{...base,accountEpoch:Infinity},{...base,requestId:'x'.repeat(100000)},Object.assign(Object.create({}),base),{...base,[Symbol()]:1},Object.defineProperty({...base},'folder',{get(){getters++;throw Error();}})];
 for(const v of variants)assert.equal(parseSourcesCommand(v),null);
 assert.equal(getters,0);assert.equal(parseAccountBinding({...e}),null);
 const ref=randomUUID();assert.ok(parseSourcesCommand({...e,type:'sources.select',peerRefs:[ref]}));
 for(const peerRefs of [[ref,ref],Array(1),Array(21).fill(ref),Object.assign([ref],{x:1}),[ref,()=>{}]])assert.equal(parseSourcesCommand({...e,type:'sources.select',peerRefs}),null);
 const access=Object.defineProperty([ref],'0',{get(){getters++;return ref;}});assert.equal(parseSourcesCommand({...e,type:'sources.select',peerRefs:access}),null);assert.equal(getters,0);
});
test('all reply variants obey exact envelopes, cursor and cooldown invariants',()=>{
 const e=envelope(),ref=randomUUID();const values=[
 {...e,type:'sources.page',folder:'archived',items:[{peerRef:ref,kind:'group',name:'<b>Ficticio</b>'}],cursor:null,end:'exhausted'},
 {...e,type:'sources.selected',revision:1,peerRefs:[ref]}, {...e,type:'sources.cleared',revision:1},
 {...e,type:'sources.cancelled',targetRequestId:ref}, {...e,type:'sources.error',error:'rate-limit',retryAt:null,retryBlocked:true},
 {...e,type:'sources.error',error:'network',retryAt:null,retryBlocked:false}];
 for(const value of values){assert.ok(parseSourcesReply(value,e));assert.equal(parseSourcesReply(value,{...e,requestId:randomUUID()}),null);assert.equal(parseSourcesReply({...value,raw:{}},e),null);}
 assert.equal(parseSourcesReply({...values[0],end:'more'},e),null);
 assert.equal(parseSourcesReply({...values[0],cursor:ref},e),null);
 assert.equal(parseSourcesReply({...values[4],retryBlocked:false},e),null);
 assert.equal(parseSourcesReply({...values[5],retryAt:Date.now()},e),null);
 assert.equal(parseSourcesReply({...values[0],items:[{peerRef:ref,kind:'group',name:'a\u202eb'}]},e),null);
});
test('names remain inert bounded Unicode data, never URLs/markup interpreted',()=>{
 const text=sourceName(' <script>ficticio</script>\u202e\u0000 ');assert.equal(text,'<script>ficticio</script>');
 const emoji=sourceName('🎵'.repeat(5000));assert.equal(Array.from(emoji).length,160);assert.ok(utf8Bytes(emoji)<=640);
 assert.equal(sourceName('\u202e\u0000'),'Fuente sin nombre');assert.equal(sourceName('e\u0301'),'é');
});
