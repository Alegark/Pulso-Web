import test from 'node:test';
import assert from 'node:assert/strict';
import {projectBotSearchPage,botSearchKnownMessage,assertBotSearchRawBudget} from '../../src/telegram/bot-search-page';
import {matchingSongRows} from '../../src/library/selected-song';
const target={title:'Own Song (Live)',artist:'Own Artist',album:null,durationSeconds:120};
const button=(label='Own Song (Live) — Own Artist')=>({_:'keyboardInlineButton',text:label,type:{_:'inlineButtonTypeCallback',data:new Uint8Array([1,2,3])}});
const row=(b:unknown)=>({_:'keyboardInlineButtonRow',buttons:[b]});
const msg=(extra:Record<string,unknown>={})=>({_:'message',id:12,peerId:{_:'peerUser',userId:101},message:'',replyMarkup:{_:'replyInlineMarkup',rows:[row(button())]},...extra});
const history=(messages:unknown[])=>({_:'messages.messages',messages,users:[],chats:[]});
test('private incoming message can omit fromId without losing projection or exact readback',()=>{
 const m=msg({replyTo:{_:'messageReplyHeader',replyToMsgId:10}}),raw=history([m]);assertBotSearchRawBudget(raw);
 const p=projectBotSearchPage(raw,101,9,10);assert.equal(p.rows.length,1);assert.equal(p.rows[0].correlation,'reply');assert.equal(botSearchKnownMessage(raw,101,12),m);
});
test('missing sender never authorizes explicit foreign sender, outbound, or a foreign chat',()=>{
 for(const extra of [{fromId:{_:'peerUser',userId:102}},{out:true},{fromId:null},{out:'invalid'}]){
  const raw=history([msg(extra)]);assert.equal(projectBotSearchPage(raw,101,9,10).rows.length,0);assert.equal(botSearchKnownMessage(raw,101,12),undefined);
 }
 assert.throws(()=>projectBotSearchPage(history([msg({peerId:{_:'peerUser',userId:102}})]),101,9,10));
});
test('unthreaded exact metadata may match, but correlation is never relabelled as a reply',()=>{
 const p=projectBotSearchPage(history([msg({fromId:{_:'peerUser',userId:101}})]),101,9,10);assert.equal(p.rows[0].correlation,'recent');assert.equal(matchingSongRows(p.rows,target).length,1);
 const wrong=projectBotSearchPage(history([msg({fromId:{_:'peerUser',userId:101},replyMarkup:{_:'replyInlineMarkup',rows:[row(button('Own Song (Remix) — Own Artist'))]}})]),101,9,10);assert.equal(matchingSongRows(wrong.rows,target).length,0);
});
test('explicit foreign reply remains excluded even when the visible song label matches',()=>{
 for(const replyTo of [{_:'messageReplyHeader',replyToMsgId:8},{_:'messageReplyHeader',replyToMsgId:10,replyToPeerId:{_:'peerUser',userId:102}}])assert.equal(projectBotSearchPage(history([msg({replyTo})]),101,9,10).rows.length,0);
});
test('wide ordinary menu is bounded rather than rejected, exact candidate at end retained',()=>{
 const rows=Array.from({length:25},(_,i)=>row(button(i===24?'Own Song (Live) — Own Artist':`Other song ${i} — Other Artist`)));rows.push(row(button('▶️')));
 const raw=history([msg({message:'Choose a song',fromId:{_:'peerUser',userId:101},replyMarkup:{_:'replyInlineMarkup',rows}})]);assertBotSearchRawBudget(raw);
 const p=projectBotSearchPage(raw,101,9,10,[],target);assert.equal(p.rows.length,20);assert.equal(p.refs.size,20);assert.equal(matchingSongRows(p.rows,target).length,1);assert.equal(p.rows.some(r=>r.kind==='option'&&r.label==='▶️'),false);
});
test('oversized hostile keyboard still rejects; foreign outgoing is detected before truncation',()=>{
 assert.throws(()=>projectBotSearchPage(history([msg({replyMarkup:{_:'replyInlineMarkup',rows:Array.from({length:65},()=>row(button()))}})]),101,9,10));
 const rows=Array.from({length:25},(_,i)=>row(button(i===24?'Own Song (Live) — Own Artist':`Other song ${i} — Other Artist`)));
 const p=projectBotSearchPage(history([msg({fromId:{_:'peerUser',userId:101},replyMarkup:{_:'replyInlineMarkup',rows}}),msg({id:13,out:true})]),101,9,10,[],target);assert.equal(p.concurrent,true);
});
