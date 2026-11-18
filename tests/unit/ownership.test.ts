import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Activity} from '../../src/playback/ownership';
test('admission closes synchronously and includes pending operations through finally',()=>{
 const activity=new Activity();assert.equal(activity.begin(),null);activity.open();const token=activity.begin()!;
 assert.equal(activity.idle,false);activity.close();assert.equal(activity.begin(),null);assert.equal(token.current(),true);
 activity.reopen();assert.equal(token.current(),true);token.end();assert.equal(activity.idle,true);
});
test('uncertain outcomes gate release even with zero active operations',()=>{
 const activity=new Activity();activity.open();activity.block('backup',true);assert.equal(activity.count,0);assert.equal(activity.idle,false);
 activity.block('backup',false);assert.equal(activity.idle,true);
});
test('old tokens cannot become current after reacquisition or finish a new operation',()=>{
 const activity=new Activity();activity.open();const old=activity.begin()!;activity.invalidate();activity.open();const fresh=activity.begin()!;
 assert.equal(old.current(),false);old.end();old.end();assert.equal(activity.count,1);assert.equal(fresh.current(),true);fresh.end();assert.equal(activity.idle,true);
});
test('activity publishes changes to exposed state once',()=>{
 let updates=0;const activity=new Activity(()=>updates++);
 activity.open();activity.reopen();activity.block('a',false);
 assert.equal(updates,1);
 const token=activity.begin()!;
 activity.block('a',true);activity.block('a',true);activity.block('b',true);activity.block('a',false);
 assert.equal(updates,3);
 token.end();token.end();activity.block('b',false);activity.close();activity.close();
 assert.equal(updates,6);
});
