import {test} from 'node:test';
import assert from 'node:assert/strict';
import Long from 'long';
import {assertRawBudget,projectSourcesPage,ProjectionLimit} from '../../src/telegram/sources-page';
import {chat,dialog,message,page,peer} from '../integration/check-telegram-sources-foundation-fixtures';
test('installed SDK conservative eligibility and auxiliary-peer exclusion',()=>{
 for(const [extra,kind] of [[{},'supergroup'],[{broadcast:true},'channel'],[{gigagroup:true},'gigagroup']] as const){assert.equal(projectSourcesPage(page({chats:[chat(101,extra)]})).candidates[0].kind,kind);}
 const group=projectSourcesPage(page({dialogs:[dialog(101,{peer:{_: 'peerChat',chatId:101}})],chats:[{_: 'chat',id:101,title:'Grupo ficticio'}]}));assert.equal(group.candidates[0].kind,'group');
 for(const extra of [{_: 'channelForbidden'},{left:true},{min:true},{restricted:true},{noforwards:true},{deactivated:true},{migratedTo:{}},{monoforum:true},{_: 'community'},{accessHash:undefined},{accessHash:0},{megagroup:false}])assert.equal(projectSourcesPage(page({chats:[chat(101,extra)]})).candidates.length,0);
 assert.equal(projectSourcesPage(page({dialogs:[],chats:[chat()]})).candidates.length,0);
 const projected=projectSourcesPage(page({chats:[chat(101,{accessHash:12345n})]}));assert.equal(projected.candidates.length,1);assert.ok(Long.isLong((projected.candidates[0].peer as any).accessHash));
});
test('cursor follows last non-pinned ineligible peer and exact message peer+id',()=>{
 const raw=page({dialogs:[dialog(101,{pinned:true}),{_: 'dialog',peer:{_: 'peerUser',userId:202},topMessage:7}],users:[{_: 'user',id:202,accessHash:Long.fromNumber(8)}],messages:[message(101,{date:99}),{_: 'message',id:7,peerId:{_: 'peerUser',userId:202},date:200}]});
 const p=projectSourcesPage(raw);assert.equal(p.end,'more');assert.equal(p.anchor?.offsetDate,200);assert.equal(p.anchor?.offsetPeer._,'inputPeerUser');assert.equal(p.candidates.length,1);
 assert.equal(projectSourcesPage(raw,p.anchor).end,'cursor-unavailable');
 assert.equal(projectSourcesPage(page({dialogs:[dialog(101,{pinned:true})]})).end,'cursor-unavailable');
 assert.equal(projectSourcesPage(page({messages:[message(202)]})).end,'cursor-unavailable');
 assert.equal(projectSourcesPage(page({messages:[]})).end,'cursor-unavailable');
 assert.equal(projectSourcesPage(page({_: 'messages.dialogs'})).end,'exhausted');
 assert.equal(projectSourcesPage(page({dialogs:[]})).end,'exhausted');
 assert.equal(projectSourcesPage(page({chats:[chat(101,{left:true})]})).end,'more');
 assert.equal(projectSourcesPage(page({dialogs:[dialog(),dialog()]})).candidates.length,1);
});
test('raw budgets reject oversized, cycles, getters, deep nesting and foreign hooks without invocation',()=>{
 let invoked=0;const cycle:any={};cycle.self=cycle;
 const deep:any={};let cursor=deep;for(let i=0;i<40;i++){cursor.next={};cursor=cursor.next;}
 const variants=[page({dialogs:Array(26).fill(dialog())}),page({chats:Array.from({length:101},(_,i)=>chat(i+1))}),page({users:Array.from({length:251},()=>({}))}),page({messages:Array.from({length:101},()=>({}))}),page({chats:[chat(101,{title:'x'.repeat(4097)})]}),page({extra:cycle}),page({extra:deep}),page({extra:'x'.repeat(2100000)}),page({extra:Object.defineProperty({},'x',{enumerable:true,get(){invoked++;return 1;}})}),page({extra:{toJSON(){invoked++;return {};}}})];
 for(const raw of variants)assert.throws(()=>projectSourcesPage(raw),ProjectionLimit);assert.equal(invoked,0);
 assert.doesNotThrow(()=>assertRawBudget(page({extra:new Uint8Array(8),unused:Long.ZERO})));
 const projected=projectSourcesPage(page());assert.ok(!JSON.stringify(projected).includes('CONTENIDO'));assert.ok(!JSON.stringify(projected).includes('message'));
 assert.equal(projectSourcesPage(page({messages:[message(101,{peerId:peer(999)})]})).anchor,null);
});
test('pinned entries from another folder are not offered; archives are explicitly scoped',()=>{
 const raw=page({dialogs:[dialog(101,{pinned:true,folderId:1}),dialog(102)],chats:[chat(101),chat(102)],messages:[message(102)]});
 assert.deepEqual(projectSourcesPage(raw).candidates.map(x=>x.key),['channel:102']);
 const archive=page({dialogs:[dialog(101,{folderId:1})]});assert.equal(projectSourcesPage(archive,null,'archived').candidates.length,1);assert.equal(projectSourcesPage(archive).candidates.length,0);assert.equal(projectSourcesPage(archive).end,'cursor-unavailable');
});
