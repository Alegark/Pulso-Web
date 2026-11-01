import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSnapshot,planQueueRestore,type Snapshot} from '../../src/playback/queue-restore.ts';
import {Player,type Media} from '../../src/playback/player.ts';
const saved:Snapshot={version:1,entries:['A','B','A'].map((trackId,i)=>({id:`q${i}`,trackId})),currentEntryId:'q2',position:7,repeat:'all',shuffleOrder:['q2','q1','q0']};
test('normalization rejects malformed structures and duplicate occurrences before IO',()=>{
 for(const value of [null,{},[],{...saved,version:2},{...saved,entries:[null]},{...saved,entries:[[]]},{...saved,entries:[{id:'a',trackId:1}]},{...saved,entries:[saved.entries[0],saved.entries[0]]},{...saved,entries:Array(1001).fill(saved.entries[0])},{...saved,currentEntryId:4}])assert.equal(normalizeSnapshot(value),null);
 assert.ok(normalizeSnapshot({...saved,entries:Array.from({length:1000},(_,i)=>({id:String(i),trackId:'A'})),currentEntryId:null,shuffleOrder:null}));
});
test('finite nonnegative positions, repeat defaults, shuffle validated against originals',()=>{
 for(const position of [NaN,Infinity,-1,'2',null])assert.equal(normalizeSnapshot({...saved,position})!.snapshot.position,0);
 for(const repeat of [undefined,'bad',null])assert.equal(normalizeSnapshot({...saved,repeat})!.snapshot.repeat,'off');
 for(const shuffleOrder of [['q0','q2'],['q0','q0','q2'],['q0','q2',4],{}]){const result=normalizeSnapshot({...saved,shuffleOrder})!;assert.equal(result.snapshot.shuffleOrder,null);assert.equal(result.warnings.length,1);}
 assert.deepEqual(normalizeSnapshot(saved)!.snapshot,saved);
});
test('partial A/B/A retains occurrence IDs, second A selection, position and filtered shuffle',async()=>{
 const calls:string[]=[];const plan=await planQueueRestore(saved,async id=>{calls.push(id);return id==='A';});
 assert.deepEqual(calls,['A','B']);assert.deepEqual(plan.snapshot,{...saved,entries:[saved.entries[0],saved.entries[2]],shuffleOrder:['q2','q0']});assert.equal(plan.missing,1);assert.equal(saved.entries.length,3);
});
test('missing current resets to first survivor at zero; null stays unselected; none retains original',async()=>{
 const result=await planQueueRestore({...saved,currentEntryId:'q1'},async id=>id==='A');assert.equal(result.snapshot.currentEntryId,'q0');assert.equal(result.snapshot.position,0);
 const unknown=await planQueueRestore({...saved,currentEntryId:'unknown'},async()=>true);assert.equal(unknown.snapshot.currentEntryId,'q0');assert.equal(unknown.snapshot.position,0);
 const noSelection=await planQueueRestore({...saved,currentEntryId:null},async()=>true);assert.equal(noSelection.snapshot.currentEntryId,null);assert.equal(noSelection.snapshot.position,0);
 const none=await planQueueRestore(saved,async()=>false);assert.equal(none.snapshot.entries.length,0);assert.equal(none.missing,3);assert.equal(saved.currentEntryId,'q2');
});
test('global IO failure rejects entire restoration, never treats error as absence',async()=>{
 await assert.rejects(planQueueRestore(saved,async()=>{throw new Error('storage-unavailable');}),/storage-unavailable/);assert.equal(saved.entries.length,3);
});
class Audio extends EventTarget implements Media {src='';currentTime=0;duration=4;ended=false;plays=0;play(){this.plays++;return Promise.resolve();}pause(){}load(){this.currentTime=0;}}
test('metadata clamps oversized restored seek and modes reset invalid previous values',()=>{
 const audio=new Audio(),player=new Player(audio);player.setQueue(saved.entries.map(e=>({...e,title:e.trackId,src:`https://test.invalid/${e.id}`})));player.restoreModes('all',saved.shuffleOrder);player.restoreModes(undefined,['q0']);assert.equal(player.repeat,'off');assert.equal(player.shuffleOrder,null);
 player.select(2,false,1e100);audio.dispatchEvent(new Event('loadedmetadata'));assert.equal(audio.currentTime,4);assert.equal(player.state,'paused');assert.equal(audio.plays,0);
});
