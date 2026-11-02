import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
const dir='.local/tab-transfer-core-r135';await mkdir(dir,{recursive:true});await mkdir('.local/evidence',{recursive:true});
execFileSync('node_modules/.bin/tsc',['--ignoreConfig','--target','ES2022','--module','ES2022','--outDir',dir+'/compiled',process.env.TAB_TRANSFER_BASELINE ? dir+'/ownership-before.ts' : 'src/playback/ownership.ts']);
const js=await readFile(dir+'/compiled/'+(process.env.TAB_TRANSFER_BASELINE?'ownership-before.js':'ownership.js'),'utf8');
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/ownership.js'?'text/javascript':'text/html');res.end(req.url==='/ownership.js'?js:'<!doctype html><title>Ownership native test</title>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const report={scope:'core only; synthetic lifecycle calls; real WebLocks/BC, no Player/audio/Telegram/iPhone',cases:[],errors:[]};let browser;
try {
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browser=browser.version();
 const origin=`http://127.0.0.1:${server.address().port}`;
 async function group(name,run){const context=await browser.newContext();const pages=[];try {
  for(let i=0;i<3;i++){const p=await context.newPage();p.on('pageerror',e=>report.errors.push(String(e)));await p.goto(origin);await p.evaluate(async()=>{
   const {Ownership}=await import('/ownership.js');window.prepares=0;window.acquisitions=0;window.blocked=false;window.throwPrepare=false;window.throwAcquired=false;window.barrier=null;window.restoreBarrier=null;window.events=[];
   window.prepare=async()=>{prepares++;events.push('prepare');if(barrier)await barrier;if(throwPrepare)throw Error('prepare');};
   window.o=new Ownership(()=>{},async()=>{acquisitions++;events.push('restore-start');if(restoreBarrier)await restoreBarrier;if(throwAcquired)throw Error('restore');events.push('restore-end');},navigator.locks,{prepare,blocked:()=>blocked});
  });pages.push(p);}
  await run(...pages);report.cases.push({name,status:'PASS'});console.log('PASS',name);
 }finally{await context.close();}}
 const snap=p=>p.evaluate(async()=>({owner:o.owner,state:o.state,transfer:o.transferState,proof:o.proof,prepares,acquisitions,locks:(await navigator.locks.query()).held.map(x=>x.name)}));
 const wait=(p,s)=>p.waitForFunction(s,{}, {timeout:5000});
 const acquire=async p=>{await p.evaluate(()=>o.acquire());await wait(p,()=>o.owner);assert.equal((await snap(p)).owner,true);};
 const hold=async p=>p.evaluate(()=>{barrier=new Promise(r=>window.unblock=r);});
 if(process.env.TAB_TRANSFER_BASELINE) {
 await group('RED R114 original acquire remains no-op after hidden activity settles',async(a)=>{await acquire(a);await a.evaluate(()=>{window.token=o.activity.begin();o.hide(prepare,()=>false);token.end();});assert.equal((await snap(a)).locks.length,2);await a.evaluate(()=>o.acquire());assert.equal((await snap(a)).owner,true,'R114: explicit reacquisition cannot recover retained locks');});
 throw Error('baseline unexpectedly passed');
 }
 await group('R114 retained busy locks require explicit fresh recovery',async(a,b)=>{
  await acquire(a);const old=await a.evaluate(()=>{window.oldScope=o.activity.scope();window.token=o.activity.begin();const proof=o.proof;o.hide(prepare,()=>blocked);return proof;});
  assert.equal((await snap(a)).locks.length,2);await a.evaluate(()=>o.useHere());assert.equal((await snap(a)).transfer,'refused');
  await a.evaluate(()=>{token.end();});await b.evaluate(()=>o.acquire());assert.equal((await snap(b)).owner,false);
  await a.evaluate(()=>o.useHere());const s=await snap(a);assert.equal(s.owner,true);assert.notEqual(s.proof,old);assert.equal(s.prepares,1);assert.equal(await a.evaluate(()=>oldScope()),false);
 });
 if(process.env.TAB_TRANSFER_BASELINE) throw Error('baseline unexpectedly passed');
 await group('A to B automatic cooperation and fresh proof after actual release',async(a,b)=>{
  await acquire(a);const old=(await snap(a)).proof;await b.evaluate(()=>o.useHere());await wait(b,()=>o.transferState==='acquired');
  const x=await snap(a),y=await snap(b);assert.equal(x.owner,false);assert.equal(y.owner,true);assert.equal(x.prepares,1);assert.notEqual(y.proof,old);assert.equal(y.locks.includes(old),false);assert.equal(y.locks.length,2);
 });
 await group('pending duplicate clicks, B/C race, cancellation before late release',async(a,b,c)=>{
  await acquire(a);await hold(a);await b.evaluate(()=>o.useHere());await wait(a,()=>prepares===1);
  await b.evaluate(()=>Promise.all([o.useHere(),o.useHere(),o.useHere()]));await c.evaluate(()=>o.useHere());await wait(c,()=>o.transferState==='refused');
  await b.evaluate(()=>o.cancelTransfer());await a.evaluate(()=>unblock());await wait(a,()=>o.state==='sin-control');
  assert.equal((await snap(b)).owner,false);assert.equal((await snap(b)).transfer,'cancelled');assert.equal((await snap(a)).prepares,1);await c.evaluate(()=>o.useHere());assert.equal((await snap(c)).owner,true);
 });
 await group('hidden requester ignores late correlated release',async(a,b)=>{
  await acquire(a);await hold(a);await b.evaluate(()=>o.useHere());await wait(a,()=>prepares===1);await b.evaluate(()=>o.hide(prepare,()=>false));await a.evaluate(()=>unblock());await wait(a,()=>o.state==='sin-control');
  await b.waitForTimeout(50);assert.equal((await snap(b)).owner,false);assert.equal((await snap(b)).acquisitions,0);
 });
 await group('busy and uncertain refusal never replays on idle',async(a,b)=>{
  await acquire(a);await a.evaluate(()=>window.token=o.activity.begin());await b.evaluate(()=>o.useHere());await wait(b,()=>o.transferState==='refused');await a.evaluate(()=>token.end());await b.waitForTimeout(40);assert.equal((await snap(a)).prepares,0);
  await a.evaluate(()=>o.activity.block('uncertain',true));await b.evaluate(()=>o.useHere());await wait(b,()=>o.transferState==='refused');await a.evaluate(()=>o.activity.block('uncertain',false));await b.waitForTimeout(40);assert.equal((await snap(a)).owner,true);
  await a.evaluate(()=>blocked=true);await b.evaluate(()=>o.useHere());await wait(b,()=>o.transferState==='refused');assert.equal((await snap(a)).prepares,0);
 });
 await group('hide during prepare never restores old current; own settlement releases',async(a,b)=>{
  await acquire(a);await a.evaluate(()=>window.oldScope=o.activity.scope());await hold(a);await b.evaluate(()=>o.useHere());await wait(a,()=>prepares===1);await a.evaluate(()=>o.hide(prepare,()=>false));await a.evaluate(()=>unblock());await wait(b,()=>o.transferState==='acquired');assert.equal(await a.evaluate(()=>oldScope()),false);assert.equal((await snap(a)).owner,false);
 });
 await group('hide during failed prepare retains then explicit R114 recovery',async(a,b)=>{
  await acquire(a);await hold(a);await b.evaluate(()=>o.useHere());await wait(a,()=>prepares===1);await a.evaluate(()=>{throwPrepare=true;o.hide(prepare,()=>false);unblock();});await wait(b,()=>o.transferState==='refused');assert.equal((await snap(a)).owner,false);assert.equal((await snap(a)).locks.length,2);
  await a.evaluate(()=>{throwPrepare=false;barrier=null;return o.useHere();});assert.equal((await snap(a)).owner,true);
 });
 await group('prepare recheck protects new uncertainty and throwing blocked hooks',async(a,b)=>{
  await acquire(a);await hold(a);await b.evaluate(()=>o.useHere());await wait(a,()=>prepares===1);await a.evaluate(()=>{o.activity.block('late',true);unblock();});await wait(b,()=>o.transferState==='refused');assert.equal((await snap(a)).owner,true);assert.equal((await snap(a)).locks.length,2);
  assert.equal(await a.evaluate(()=>o.cede(prepare,()=>{throw Error('blocked');})),false);
 });
 await group('restore completes before acquired outcome; hide fences late restore',async(a,b)=>{
  await acquire(a);await b.evaluate(()=>{restoreBarrier=new Promise(r=>window.restored=r);return o.useHere();});await wait(b,()=>acquisitions===1);assert.equal(await b.evaluate(()=>o.cede(prepare,()=>false)),false);assert.equal((await snap(b)).transfer,'pending');await b.evaluate(()=>restored());await wait(b,()=>o.transferState==='acquired');
  await b.evaluate(()=>o.cede(prepare,()=>false));await a.evaluate(()=>{restoreBarrier=new Promise(r=>window.restored=r);void o.useHere();});await wait(a,()=>acquisitions===2);assert.equal((await snap(a)).transfer,'acquiring');await a.evaluate(()=>{o.hide(prepare,()=>false);restored();});await a.waitForTimeout(30);assert.equal((await snap(a)).owner,false);assert.equal((await snap(a)).transfer,'cancelled');assert.equal((await snap(a)).locks.length,2);await a.evaluate(()=>o.useHere());assert.equal((await snap(a)).owner,true);
 });
 await group('legacy request does not auto cede; legacy owner manual approval compatible',async(a,b)=>{
  await acquire(a);await b.evaluate(()=>o.request());await wait(a,()=>o.requests.length===1);assert.equal((await snap(a)).prepares,0);await a.evaluate(()=>o.cede(prepare,()=>false));await wait(b,()=>o.owner);
 });
 await group('malformed, duplicate and uncorrelated messages never grant authority',async(a,b)=>{
  await acquire(a);await b.evaluate(()=>{const bc=new BroadcastChannel('pulso-web:local:handoff:v1');for(const m of [null,{}, {version:1,type:'request',tabId:'x',requestId:'x',sender:'different',transfer:true},{version:1,type:'released',tabId:o.tabId,requestId:'wrong',sender:'fake'}])bc.postMessage(m);bc.close();});await a.waitForTimeout(40);assert.equal((await snap(a)).prepares,0);assert.equal((await snap(b)).owner,false);
  await hold(a);await b.evaluate(()=>o.useHere());await wait(a,()=>prepares===1);await b.evaluate(()=>{const bc=new BroadcastChannel('pulso-web:local:handoff:v1');bc.postMessage({version:1,type:'request',tabId:o.tabId,requestId:o.pending,sender:o.tabId,transfer:true});bc.close();});await a.waitForTimeout(40);assert.equal((await snap(a)).prepares,1);await a.evaluate(()=>unblock());await wait(b,()=>o.owner);
 });
 await group('native proof request settles before playback and release notification',async(a,b,c)=>{
  await a.evaluate(async()=>{
   const {Ownership}=await import('/ownership.js');o.channel.close();window.releaseEvents=[];
   const locks={request(...args){const task=navigator.locks.request(...args);task.then(()=>releaseEvents.push(args[0]));return task;}};
   o=new Ownership(()=>{},async()=>{},locks,{prepare,blocked:()=>false});
  });await acquire(a);const proof=(await snap(a)).proof;
  await c.evaluate(()=>{window.acks=[];window.observer=new BroadcastChannel('pulso-web:local:handoff:v1');observer.onmessage=e=>{if(e.data.type==='released')acks.push(e.data);};});
  await b.evaluate(()=>o.useHere());await wait(b,()=>o.transferState==='acquired');await wait(c,()=>acks.length===1);
  const events=await a.evaluate(()=>releaseEvents);assert.deepEqual(events,[proof,'pulso-web:local:playback']);assert.equal((await snap(b)).locks.includes(proof),false);
 });
 await group('old owner broadcasts ACK to B/C; exactly one wins real ifAvailable',async(a,b,c)=>{
  await a.evaluate(()=>o.handoff=undefined);await acquire(a);await Promise.all([b.evaluate(()=>o.useHere()),c.evaluate(()=>o.useHere())]);await wait(a,()=>o.requests.length===2);await a.evaluate(()=>o.cede(prepare,()=>false));
  await wait(b,()=>['acquired','refused'].includes(o.transferState));await wait(c,()=>['acquired','refused'].includes(o.transferState));const x=await snap(b),y=await snap(c);assert.equal(Number(x.owner)+Number(y.owner),1);assert.equal(x.locks.length,2);
 });
 await group('native R114 uncertain/blocked refuses, hide during recovery prepares then releases only',async(a,b)=>{
  await acquire(a);await a.evaluate(()=>{o.activity.block('uncertain',true);o.hide(prepare,()=>false);});await a.evaluate(()=>o.useHere());assert.equal((await snap(a)).transfer,'refused');
  await a.evaluate(()=>{o.activity.block('uncertain',false);blocked=true;});await a.evaluate(()=>o.useHere());assert.equal((await snap(a)).transfer,'refused');assert.equal((await snap(a)).locks.length,2);
  await hold(a);await a.evaluate(()=>{blocked=false;void o.useHere();});await wait(a,()=>prepares===1);await a.evaluate(()=>{o.hide(prepare,()=>false);unblock();});await wait(a,()=>o.proof==='');assert.equal((await snap(a)).owner,false);assert.equal((await snap(a)).transfer,'cancelled');await acquire(b);
 });
 await group('throwing acquired and changed hooks do not orphan locks',async(a,b)=>{
  await a.evaluate(()=>{throwAcquired=true;return o.useHere();});await wait(a,()=>o.proof==='');await acquire(b);assert.equal((await snap(b)).locks.length,2);
 });
 assert.equal(report.errors.length,0);report.status='PASS';
} catch(error){report.status='FAIL';report.failure=String(error);console.error(error);process.exitCode=1;}
finally{await browser?.close();await new Promise(r=>server.close(r));await writeFile(process.env.TAB_TRANSFER_BASELINE?dir+'/RED-original.json':'.local/evidence/tab-transfer-core-r135.json',JSON.stringify(report,null,2));}
