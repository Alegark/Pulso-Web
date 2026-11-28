import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Snapshot} from '../../src/playback/queue-restore';
import {queuePositionRecord,withQueuePosition} from '../../src/ui/queue-position';

const base:Snapshot={version:1,entries:[{id:'a',trackId:'track'},{id:'b',trackId:'track'}],currentEntryId:'a',position:2,repeat:'off',shuffleOrder:['b','a']};

test('restores progress and repeat for the selected occurrence without rewriting structure',()=>{
 const value={currentEntryId:'b',position:20,repeat:'one'} as const;
 const result=withQueuePosition(base,queuePositionRecord(base,value));
 assert.deepEqual(result,{...base,...value});
 assert.equal(result.entries,base.entries);
 assert.equal(result.shuffleOrder,base.shuffleOrder);
});

test('legacy, unrelated and invalid progress records preserve the saved structure',()=>{
 const position=queuePositionRecord(base,{currentEntryId:'b',position:20,repeat:'all'});
 for(const raw of [undefined,{...position,first:'other'},{...position,basePosition:12},{...position,currentEntryId:'stale'},{...position,position:Infinity}]){
  assert.equal(withQueuePosition(base,raw),base);
 }
});
