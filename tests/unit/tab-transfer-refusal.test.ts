import test from 'node:test';
import assert from 'node:assert/strict';
import {Ownership} from '../../src/playback/ownership';

// Host-state probes only; native locks/session coverage belongs to the main runner.
for (const busy of [true,false]) test(`refused handoff preserves authority without transient notification (${busy?'active token':'unresolved host'})`,async()=>{
 let notifications=0,prepared=0;
 const original=globalThis.BroadcastChannel;globalThis.BroadcastChannel=class {postMessage(){}} as unknown as typeof BroadcastChannel;
 const control=new Ownership(()=>{notifications++;},async()=>{},undefined);
 control.state='con-control';control.proof='synthetic-host-proof';control.activity.open();
 const scope=control.activity.scope(),token=busy?control.activity.begin():null;
 notifications=0;
 try{
  assert.equal(await control.cede(async()=>{prepared++;},()=>!busy),false);
  assert.equal(control.owner,true);assert.equal(control.state,'con-control');
  assert.equal(control.proof,'synthetic-host-proof');assert.equal(scope(),true);
  assert.equal(token?.current()??true,true);assert.equal(control.activity.count,busy?1:0);
  assert.equal(notifications,0);assert.equal(prepared,0);
 }finally{token?.end();control.hide(async()=>{},()=>true);globalThis.BroadcastChannel=original;}
});
