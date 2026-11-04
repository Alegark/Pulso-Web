import test from 'node:test';
import assert from 'node:assert/strict';
import {matchingSongRows,songChoiceKey} from '../../src/library/selected-song';
import type {BotSearchRow,BotSearchTarget} from '../../src/telegram/bot-search-protocol';
const target:BotSearchTarget={title:'A Song (Live)',artist:'An Artist',album:'Concert',durationSeconds:120};
const option=(label:string,correlation:'reply'|'recent'='reply'):BotSearchRow=>({kind:'option',rowRef:crypto.randomUUID(),correlation,label});
const audio=(title='A Song (Live)',performer:string|null='An Artist',durationSeconds=120):BotSearchRow=>({kind:'audio',rowRef:crypto.randomUUID(),correlation:'reply',title,performer,durationSeconds,bytes:100,mimeType:'audio/mpeg'});
test('automatic exact title and performer matching retains live/remix and punctuation semantics',()=>{
 const exact=option('A Song (Live) — An Artist');
 const rows=[exact,option('A Song — An Artist'),option('A Song (Live Remix) — An Artist'),option('A Song (Live) — Another Artist'),option('A Song (Live) — An Artist ▶'),option('Next page'),option('A Song (Live) — An Artist','recent')];
 assert.deepEqual(matchingSongRows(rows,target),[exact,rows.at(-1)]);
 assert.equal(matchingSongRows([option('A Sóng (Live) - AN ARTIST')],target).length,1);
});
test('ambiguous options stay ambiguous, unknown or foreign-version audio never automatic',()=>{
 assert.equal(matchingSongRows([option('A Song (Live) – An Artist'),option('A Song (Live) - An Artist')],target).length,2);
 assert.equal(matchingSongRows([audio('A Song'),audio('A Song (Live)',null),audio('A Song (Live)','An Artist',130)],target).length,0);
 assert.equal(matchingSongRows([audio()],{...target,artist:null}).length,0);
 assert.equal(matchingSongRows([audio()],target).length,1);
});
test('durable catalogue keys require public identity and version metadata, never title alone',()=>{
 const base={id:'lrclib:123',source:'lrclib' as const,title:target.title,artist:target.artist,album:target.album,duration:120};
 const key=songChoiceKey(base);assert.ok(key);assert.notEqual(songChoiceKey({...base,id:'lrclib:124'}),key);
 assert.notEqual(songChoiceKey({...base,title:'A Song'}),key);assert.notEqual(songChoiceKey({...base,artist:'Another Artist'}),key);
 assert.equal(songChoiceKey({...base,artist:null}),null);assert.equal(songChoiceKey({...base,id:'arbitrary'}),null);
 const local='local:'+crypto.randomUUID();assert.equal(songChoiceKey({...base,id:local,source:'local',artist:null}),local);
});
