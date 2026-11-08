import test from 'node:test';import assert from 'node:assert/strict';
import {expectedAudioTagMismatch as mismatch} from '../../src/imports/expected-audio-metadata';
const expected={title:'Own song (Live)',artist:'Own Artist'};
test('one catalogue performer matches a complete member of declared file collaborators',()=>{
 for(const separator of [';','/','\u0000',','])for(const artist of ['Own Artist'+separator+'Guest','Guest'+separator+'Own Artist'])assert.equal(mismatch({title:'Own song (Live)',artist},expected),null);
 assert.equal(mismatch({title:'Own song (Live)',artist:'Guest / Own Artist',artists:['Guest','Own Artist']},expected),null);
});
test('wrong performer, partial names and conflicting versions remain rejected',()=>{
 for(const artist of ['Other Artist','Not Own Artist','Own Artist Junior','Guest;Other Artist'])assert.equal(mismatch({title:expected.title,artist},expected),'artist');
 assert.equal(mismatch({title:'Own song (Remix)',artist:'Own Artist;Guest'},expected),'title');
 assert.equal(mismatch({title:expected.title,artist:'Guest',artists:['Other Artist']},expected),'artist');
});
test('punctuation in an artist name is retained before list matching; requested collaboration is not truncated',()=>{
 assert.equal(mismatch({artist:'AC/DC; Guest'},{title:'Own',artist:'AC/DC'}),null);
 assert.equal(mismatch({artist:'Tyler, The Creator; Guest'},{title:'Own',artist:'Tyler, The Creator'}),null);
 assert.equal(mismatch({artist:'Own Artist'},{title:'Own',artist:'Own Artist; Guest'}),'artist');
});
test('normalization and optional tags preserve existing import behavior',()=>{
 assert.equal(mismatch({title:'Ówn song (Live)',artist:'OWN ARTIST'},expected),null);
 assert.equal(mismatch({},expected),null);assert.equal(mismatch({artist:'Guest'},{title:'Own',artist:null}),null);
});
