import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Ownership} from '../../src/playback/ownership';
class Channel {
 static all=new Set<Channel>(); onmessage: ((e:{data:unknown})=>void)|null=null;
 constructor(_name:string){Channel.all.add(this);}
 postMessage(data:unknown){for(const c of Channel.all)if(c!==this)queueMicrotask(()=>c.onmessage?.({data}));}
}
class Locks {
 held=new Set<string>(); events:string[]=[]; fail=false;
 async request(name:string, options:unknown, callback?: (lock:unknown)=>unknown){
  const cb=(callback??options) as (lock:unknown)=>unknown;
  await Promise.resolve(); if(this.fail)throw Error('locks');
  if(this.held.has(name))return cb(null);
  this.held.add(name);this.events.push('grant:'+name);
  try{return await cb({name});}finally{this.held.delete(name);this.events.push('release:'+name);}
 }
}
const tick=()=>new Promise(r=>setTimeout(r,0));
async function fixture(run:(locks:Locks,make:(prepare?:()=>Promise<void>,blocked?:()=>boolean,acquired?:()=>Promise<void>,changed?:()=>void)=>Ownership)=>Promise<void>){
 const original=globalThis.BroadcastChannel;globalThis.BroadcastChannel=Channel as unknown as typeof BroadcastChannel;Channel.all.clear();const locks=new Locks(),owners:Ownership[]=[];
 const make=(prepare=async()=>{},blocked=()=>false,acquired=async()=>{},changed=()=>{})=>{const o=new Ownership(changed,acquired,locks as unknown as LockManager,{prepare,blocked});owners.push(o);return o;};
 try{await run(locks,make);}finally{for(const o of owners){o.activity.block('uncertain',false);o.hide(async()=>{},()=>false);}await tick();Channel.all.clear();globalThis.BroadcastChannel=original;}
}
test('direct gesture resolves after restore, before ownership lifetime ends',()=>fixture(async(locks,make)=>{
 let finish!:()=>void;const barrier=new Promise<void>(r=>finish=r);const a=make(undefined,undefined,()=>barrier);let done=false;const task=a.useHere().then(()=>done=true);await tick();assert.equal(a.owner,true);assert.equal(done,false);assert.equal(a.transferState,'acquiring');finish();await task;assert.equal(a.transferState,'acquired');assert.equal(locks.held.size,2);
}));
test('proof release precedes playback release and fresh acquisition',()=>fixture(async(locks,make)=>{
 const a=make(),b=make();await a.acquire();const proof=a.proof;await b.useHere();for(let i=0;i<5&&b.transferState!=='acquired';i++)await tick();assert.equal(b.transferState,'acquired');assert.notEqual(b.proof,proof);const p=locks.events.indexOf('release:'+proof),l=locks.events.indexOf('release:pulso-web:local:playback');assert.ok(p>=0&&p<l);assert.ok(l<locks.events.lastIndexOf('grant:pulso-web:local:playback'));
}));
test('cancel before first real callback prevents admission',()=>fixture(async(locks,make)=>{
 const a=make();const task=a.useHere();a.cancelTransfer();await task;await tick();assert.equal(a.owner,false);assert.equal(a.transferState,'cancelled');assert.equal(locks.held.size,0);
}));
test('R114 active hide refuses, settlement then explicit recovery invalidates old scopes',()=>fixture(async(locks,make)=>{
 const a=make();await a.acquire();const scope=a.activity.scope(),proof=a.proof,token=a.activity.begin()!;a.hide(async()=>{},()=>false);await a.useHere();assert.equal(a.transferState,'refused');assert.equal(locks.held.size,2);token.end();assert.equal(scope(),false);await a.useHere();assert.equal(a.owner,true);assert.notEqual(a.proof,proof);assert.equal(scope(),false);
}));
test('hide during R114 preparation cancels reacquire but preserves own release settlement',()=>fixture(async(locks,make)=>{
 let finish!:()=>void;const a=make(()=>new Promise<void>(r=>finish=r));await a.acquire();a.activity.block('uncertain',true);a.hide(async()=>{},()=>false);a.activity.block('uncertain',false);const task=a.useHere();a.hide(async()=>{},()=>false);finish();await task;assert.equal(a.owner,false);assert.equal(a.transferState,'cancelled');assert.equal(locks.held.size,0);
}));
test('throwing observation hook cannot break release; throwing prepare restores only current owner',()=>fixture(async(locks,make)=>{
 const a=make(undefined,undefined,undefined,()=>{throw Error('changed');});await a.acquire();await assert.rejects(a.cede(async()=>{throw Error('prepare');},()=>false));assert.equal(a.owner,true);assert.equal(locks.held.size,2);assert.equal(await a.cede(async()=>{},()=>{throw Error('blocked');}),false);assert.equal(a.owner,true);assert.equal(await a.cede(async()=>{},()=>false),true);assert.equal(locks.held.size,0);
}));
test('hide plus late failed prepare cannot readmit old generation',()=>fixture(async(locks,make)=>{
 let finish!:()=>void;const a=make(),scope=()=>a.activity.scope();await a.acquire();const old=scope();const task=a.cede(()=>new Promise<void>(r=>finish=r).then(()=>{throw Error('prepare');}),()=>false);a.hide(async()=>{},()=>false);finish();await assert.rejects(task);assert.equal(a.owner,false);assert.equal(old(),false);assert.equal(locks.held.size,2);await a.useHere();assert.equal(a.owner,true);assert.equal(old(),false);
}));
test('legacy acquire never auto requests when occupied',()=>fixture(async(_locks,make)=>{
 const a=make(),b=make();await a.acquire();await b.acquire();await tick();assert.equal(b.owner,false);assert.equal(a.requests.length,0);assert.equal(b.transferState,'idle');
}));
test('no WebLocks reports unsupported without broadcasting',()=>fixture(async(_locks,make)=>{
 const a=make();Object.assign(a,{locks:undefined});await a.useHere();assert.equal(a.transferState,'unsupported');assert.equal(a.owner,false);
}));
test('lock service rejection is failed, never a fabricated pending transfer',()=>fixture(async(locks,make)=>{
 const a=make();locks.fail=true;await a.useHere();assert.equal(a.transferState,'failed');assert.equal(a.owner,false);assert.equal(locks.held.size,0);locks.fail=false;
}));
test('acquired failure with uncertainty retains locks until explicit safe recovery',()=>fixture(async(locks,make)=>{
 let bad=true;let a:Ownership;a=make(undefined,undefined,async()=>{if(bad){a.activity.block('uncertain',true);throw Error('restore');}});await a.useHere();assert.equal(a.transferState,'failed');assert.equal(a.owner,false);assert.equal(locks.held.size,2);await a.useHere();assert.equal(a.transferState,'refused');bad=false;a.activity.block('uncertain',false);await a.useHere();assert.equal(a.owner,true);
}));
test('legacy restore in flight cannot publish acquired through a fresh useHere',()=>fixture(async(_locks,make)=>{
 let finish!:()=>void;const a=make(undefined,undefined,()=>new Promise<void>(r=>finish=r));const task=a.acquire();await tick();await a.useHere();assert.equal(a.transferState,'refused');assert.equal(await a.cede(async()=>{},()=>false),false);finish();await task;await a.useHere();assert.equal(a.transferState,'acquired');
}));
