import test from 'node:test';import assert from 'node:assert/strict';import Long from 'long';
import {assertBotSearchRawBudget,botSearchMessageFingerprint,botSearchAck,botSearchBaseline,projectBotSearchPage} from '../../src/telegram/bot-search-page';
const bot=101;
const msg=(id=12,extra:Record<string,unknown>={})=>({_: 'message',id,peerId:{_: 'peerUser',userId:bot},fromId:{_: 'peerUser',userId:bot},message:'Reply',...extra});
const history=(messages:unknown[])=>({_: 'messages.messages',messages,chats:[],users:[]});
const button=(text='Actual song label',data=new Uint8Array([1,2]))=>({_: 'keyboardInlineButton',text,type:{_: 'inlineButtonTypeCallback',data}});
const menu=(buttons:unknown[])=>({_: 'replyInlineMarkup',rows:[{_: 'keyboardInlineButtonRow',buttons}]});
test('bounded projection labels from exact callback constructor only; opaque data never becomes metadata',()=>{
 const raw=history([msg(12,{replyMarkup:menu([button('<script>text</script>'),{_: 'keyboardInlineButton',text:'Link',type:{_: 'inlineButtonTypeUrl',url:'https://evil.invalid'}},button('Second',new Uint8Array([47,115,116,97,114,116])),{_: 'keyboardInlineButton',text:'Password',type:{_: 'inlineButtonTypeCallback',requiresPassword:true,data:new Uint8Array([1])}}])})]);
 assertBotSearchRawBudget(raw);const p=projectBotSearchPage(raw,bot,9,10);assert.equal(p.rows.length,3);assert.deepEqual(p.rows.filter(r=>r.kind==='option').map(r=>r.label),['<script>text</script>','Second']);assert.ok(p.rows.every(r=>r.correlation==='recent'));assert.equal(JSON.stringify(p.rows).includes('callback'),false);assert.equal(JSON.stringify(p.rows).includes('https://'),false);assert.equal(p.refs.size,3);
 assert.ok([...p.refs.values()].some(r=>r.callbackData?.[0]===47));
});
test('incoming sender/chat/minId/outgoing/reply correlation verified; concurrent outgoing makes uncertain',()=>{
 const exact=msg(12,{replyTo:{_: 'messageReplyHeader',replyToMsgId:10}});assert.equal(projectBotSearchPage(history([exact]),bot,9,10).rows[0].correlation,'reply');
 assert.equal(projectBotSearchPage(history([msg(12,{replyTo:{_: 'messageReplyHeader',replyToMsgId:8}}),msg(13,{fromId:{_: 'peerUser',userId:102}}),msg(8)]),bot,9,10).rows.length,0);
 assert.throws(()=>projectBotSearchPage(history([msg(12,{peerId:{_: 'peerUser',userId:102}})]),bot,9,10));
 assert.equal(projectBotSearchPage(history([msg(11,{out:true}),exact]),bot,9,10).concurrent,true);
 assert.equal(projectBotSearchPage(history([msg(10,{out:true}),exact]),bot,9,10).concurrent,false);
 assert.equal(botSearchBaseline(history([]),bot),0);assert.equal(botSearchBaseline(history([msg(9)]),bot),9);
});
test('audio projects only declared metadata, no accessHash/fileReference/document id; installed size is number',()=>{
 const doc={_: 'document',id:new Long(1,0),accessHash:new Long(22,0),fileReference:new Uint8Array([5]),size:40000,mimeType:'audio/mpeg',attributes:[{_: 'documentAttributeAudio',duration:230,title:'Track (Live)',performer:'Artist'}]};
 const raw=history([msg(12,{message:'',media:{_: 'messageMediaDocument',document:doc}})]);assertBotSearchRawBudget(raw);
 const r=projectBotSearchPage(raw,bot,9,10).rows[0];assert.deepEqual(Object.keys(r).sort(),['bytes','correlation','durationSeconds','kind','mimeType','performer','rowRef','title']);assert.equal(r.kind==='audio'&&r.title,'Track (Live)');
 for(const extra of [{size:NaN},{size:2**54},{size:new Long(1,0)},{mimeType:'text/html'},{attributes:[{_: 'documentAttributeAudio',duration:230,voice:true}]}]){const p=projectBotSearchPage(history([msg(12,{message:'',media:{_: 'messageMediaDocument',document:{...doc,...extra}}})]),bot,9,10);assert.equal(p.rows.length,0);assert.equal(p.unrecognized,true);}
});
test('post-decoder budget rejects accessors/cycles/oversize/raw long without executing hooks',()=>{
 let getters=0;const x={};Object.defineProperty(x,'text',{enumerable:true,get(){getters++;throw Error();}});
 const badLong=new Long(1,0);Object.defineProperty(badLong,'low',{get(){getters++;return 1;}});
 const typed=new Uint8Array([1]);Object.defineProperty(typed,'length',{get(){getters++;return 1;}});
 const cycle:unknown[]=[];cycle.push(cycle);
 for(const raw of [x,badLong,typed,cycle,{text:'x'.repeat(40000)},{data:new Uint8Array(4097)},new Long(1,0,true),{fn(){}}])assert.throws(()=>assertBotSearchRawBudget(raw));assert.equal(getters,0);
 assert.throws(()=>projectBotSearchPage(history(Array.from({length:21},(_,i)=>msg(i+20))),bot,9,10));
 assert.equal(projectBotSearchPage(history([msg(12,{replyMarkup:menu(Array.from({length:20},()=>button()))})]),bot,9,10).rows.length,20);
});
test('ACK known randomId mapping or exact short response; no guessing ID from unrelated updates',()=>{
 const random=new Long(3,4);assert.equal(botSearchAck({_: 'updateShortSentMessage',out:true,id:10},bot,random),10);
 assert.equal(botSearchAck({_: 'updates',updates:[{_: 'updateMessageID',id:10,randomId:new Long(3,4)}]},bot,random),10);
 assert.equal(botSearchAck({_: 'updates',updates:[{_: 'updateMessageID',id:10,randomId:new Long(9,4)}]},bot,random),null);
 assert.equal(botSearchAck({_: 'updates',updates:[{_: 'updateNewMessage',message:msg(10,{out:true})}]},bot,random),null);
 assert.equal(botSearchAck({_: 'updateShortSentMessage',id:10},bot,random),null);
});

test('installed SDK layer232 inline-button shape projects native callback label (typed primary-source fixture)',()=>{
 const markup={_: 'replyInlineMarkup',rows:[{_: 'keyboardInlineButtonRow',buttons:[{_: 'keyboardInlineButton',text:'Native layer232 label',type:{_: 'inlineButtonTypeCallback',data:new Uint8Array([7,8])}}]}]} satisfies import('@mtcute/core').tl.RawReplyInlineMarkup;
 const raw=history([msg(12,{replyMarkup:markup})]);assertBotSearchRawBudget(raw);
 const projected=projectBotSearchPage(raw,bot,9,10);assert.equal(projected.rows[0].kind,'option');assert.equal(projected.rows[0].kind==='option'&&projected.rows[0].label,'Native layer232 label');
});


test('renewable document reference is validated separately from exact immutable message identity',()=>{
 const doc={_: 'document',id:new Long(1,0),accessHash:new Long(22,0),dcId:2,fileReference:new Uint8Array([5]),size:40000,mimeType:'audio/mpeg',attributes:[{_: 'documentAttributeAudio',duration:230,title:'Track',performer:'Artist'}]};
 const make=(d:unknown=doc)=>msg(12,{message:'',media:{_: 'messageMediaDocument',document:d}});
 const fingerprint=(m:unknown)=>{assertBotSearchRawBudget(m);return botSearchMessageFingerprint(m);};
 const original=fingerprint(make());assert.equal(fingerprint(make({...doc,fileReference:new Uint8Array([9,8,7])})),original);
 for(const delta of [{id:new Long(2,0)},{accessHash:new Long(23,0)},{dcId:3},{size:40001},{mimeType:'audio/ogg'},{attributes:[{_: 'documentAttributeAudio',duration:230,title:'Other',performer:'Artist'}]}])assert.notEqual(fingerprint(make({...doc,...delta})),original);
 for(const delta of [{peerId:{_: 'peerUser',userId:102}},{id:13},{message:'Changed'},{replyMarkup:menu([button()])}])assert.notEqual(fingerprint({...make(),...delta}),original);
 for(const ref of [undefined,null,[5],new Uint8Array(4097)])assert.throws(()=>fingerprint(make({...doc,fileReference:ref})));
 const missing={...doc};delete (missing as Partial<typeof doc>).fileReference;assert.throws(()=>fingerprint(make(missing)));
 let reads=0;const accessor={...doc};Object.defineProperty(accessor,'fileReference',{enumerable:true,get(){reads++;return new Uint8Array([1]);}});assert.throws(()=>botSearchMessageFingerprint(make(accessor)));assert.equal(reads,0);
 assert.notEqual(fingerprint({...make(),replyMarkup:{fileReference:new Uint8Array([1])}}),fingerprint({...make(),replyMarkup:{fileReference:new Uint8Array([2])}}),'Other paths remain exact');
});
