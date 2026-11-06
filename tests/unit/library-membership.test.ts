import {test} from 'node:test';
import assert from 'node:assert/strict';
import {copyLibraryMembership,libraryMembershipKey,makeLibraryMembership} from '../../src/library/library-membership';
const id='123e4567-e89b-42d3-a456-426614174000';
test('membership is a closed data-only record',()=>{
 const record=makeLibraryMembership(id,false);assert.deepEqual(libraryMembershipKey(id),['library-membership',1,id]);assert.deepEqual(copyLibraryMembership(record,id),record);
 let invoked=false;const getter={version:1,trackId:id,get added(){invoked=true;return true;}};
 for(const value of [getter,{...record,extra:1},{...record,trackId:'bad'},{...record,added:0},null,[],Object.create(record)])assert.equal(copyLibraryMembership(value,id),null);
 assert.equal(invoked,false);assert.throws(()=>makeLibraryMembership('bad',true));assert.throws(()=>libraryMembershipKey('bad'));
});
