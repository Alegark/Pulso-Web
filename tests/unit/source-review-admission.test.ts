import test from 'node:test';
import assert from 'node:assert/strict';
import {Activity} from '../../src/playback/ownership';
import {createLocalCopyProtection} from '../../src/playback/local-copy-protection';
import {createSourceReviewAdmission} from '../../src/playback/source-review-admission';
import type {LocalAsset} from '../../src/library/library';

const target:LocalAsset={id:'00000000-0000-4000-8000-000000000001',namespace:'local',storageKey:'00000000-0000-4000-8000-000000000002',bytes:1,sha256:'a'.repeat(64),mime:'audio/wav',chunks:1,state:'complete',revision:1,chunkSize:65536,retention:'kept',backend:'idb'};
function fixture(){
 const activity=new Activity();activity.open();let ready=true,allowed=true,notifications=0,throwNotify=false;
 const captureCurrent=()=>{const scope=activity.scope();return()=>ready&&scope();};
 const protection=createLocalCopyProtection({getPlayer:()=>({entries:[],currentEntryId:null,source:null}),captureCurrent});
 const admission=createSourceReviewAdmission({activity,protection,canReserve:()=>allowed,captureCurrent,changed(){notifications++;if(throwNotify)throw new Error('Notification failure');}});
 return {activity,protection,admission,setReady(v:boolean){ready=v;},setAllowed(v:boolean){allowed=v;},throwNotify(){throwNotify=true;},notifications:()=>notifications};
}
test('existing activity and unresolved outcomes deny reservation without taking another token',()=>{
 const f=fixture(),work=f.activity.begin()!;assert.deepEqual(f.admission.reserve(target),{kind:'blocked',reason:'busy'});assert.equal(f.activity.count,1);work.end();
 f.activity.block('uncertain',true);assert.equal(f.admission.reserve(target).kind,'blocked');assert.equal(f.activity.count,0);assert.equal(f.admission.hasReservation(),false);
 f.activity.block('uncertain',false);f.setAllowed(false);assert.equal(f.admission.reserve(target).kind,'blocked');assert.equal(f.notifications(),0);
});
test('reservation excludes queue before work and permanently invalidates prior feature guards',()=>{
 const f=fixture(),old=f.admission.captureCurrent();assert.equal(old(),true);assert.equal(f.admission.canPrepare(),true);
 const result=f.admission.reserve(target);assert.equal(result.kind,'reserved');if(result.kind!=='reserved')return;
 assert.equal(result.reservation.current(),true);assert.equal(f.admission.canPrepare(),false);assert.equal(f.activity.count,1);assert.equal(old(),false);
 const during=f.admission.captureCurrent();assert.equal(during(),false);result.reservation.release();result.reservation.release();
 assert.equal(f.activity.count,0);assert.equal(f.admission.canPrepare(),true);assert.equal(old(),false);assert.equal(during(),false);assert.equal(f.admission.captureCurrent()(),true);assert.equal(f.notifications(),2);
});
test('scope invalidation retains exclusion; release ends only its original activity across ABA',()=>{
 const f=fixture(),result=f.admission.reserve(target);assert.equal(result.kind,'reserved');if(result.kind!=='reserved')return;
 f.activity.invalidate();f.protection.invalidateScope();f.activity.open();const freshWork=f.activity.begin()!;
 assert.equal(result.reservation.current(),false);assert.equal(f.admission.hasReservation(),true);assert.equal(f.admission.canPrepare(),false);assert.equal(f.admission.reserve(target).kind,'blocked');
 result.reservation.release();assert.equal(f.activity.count,1);assert.equal(freshWork.current(),true);freshWork.end();
 const next=f.admission.reserve(target);assert.equal(next.kind,'reserved');if(next.kind!=='reserved')return;
 result.reservation.release();assert.equal(next.reservation.current(),true);assert.equal(f.activity.count,1);next.reservation.release();assert.equal(f.activity.count,0);
});
test('pending source preparation denies root reservation and settles the temporary admission token',async()=>{
 const f=fixture(),work=f.protection.beginPreparation(['pending'],()=>true);assert.deepEqual(f.admission.reserve(target),{kind:'blocked',reason:'queue-pending'});assert.equal(f.activity.count,0);assert.equal(f.notifications(),0);await work.settle();
 const result=f.admission.reserve(target);assert.equal(result.kind,'reserved');if(result.kind==='reserved')result.reservation.release();
});
test('notification failure neither loses reservation nor its own cleanup',()=>{
 const f=fixture();f.throwNotify();const result=f.admission.reserve(target);assert.equal(result.kind,'reserved');if(result.kind!=='reserved')return;
 f.setReady(false);assert.equal(result.reservation.current(),false);assert.equal(f.admission.canPrepare(),false);f.setReady(true);assert.equal(result.reservation.current(),false);
 result.reservation.release();assert.equal(f.activity.count,0);assert.equal(f.admission.canPrepare(),true);
});
