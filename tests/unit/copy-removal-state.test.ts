// Controller settlement regressions: real factory and Activity, with explicit
// synthetic core, runtime, reservation, storage and DOM. Native coverage is separate.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as realCore from '../../src/library/local-copy-removal.ts';
import {Activity} from '../../src/playback/ownership.ts';
import {createCopyRemovalController,readRemovalTracking,clearRemovalTracking} from '../../src/ui/local-copy-removal-state.ts';
const main=readFileSync('src/main.tsx','utf8');
const ref={incarnation:'11111111-1111-4111-8111-111111111111',operationId:'22222222-2222-4222-8222-222222222222'};
const track:any={id:'44444444-4444-4444-8444-444444444444',assetId:'55555555-5555-4555-8555-555555555555',title:'R97 synthetic',revision:1};
const target:any={id:track.assetId};
const summary={bytes:128,tracks:1,favorites:0,playlists:0,playlistEntries:0,persistedQueueOccurrences:0};
function deferred(){let resolve!:(v?:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve};}
function memory(initial:string|null=null){let raw=initial;return {getItem:()=>raw,setItem:(_k:string,v:string)=>{raw=v;},removeItem:()=>{raw=null;}};}
function outcome(patch:any={}){return {tracking:ref,state:'removed',journalRevision:4,publication:'unpublished',physical:'absent',recoveryRequired:false,preparation:'recorded',primary:null,secondary:[],...patch};}
function harness(options:any={}){
 const activity=new Activity();activity.open();let epoch=0,owned=false,blocked=false,live=true;const events:string[]=[];const contexts:any[]=[];
 let confirms=0,continues=0,inspections=0,releases=0;const store=options.store??memory();const plan={};const continuation={};
 const host:any={activity,changed(){},canStart:()=>!blocked&&activity.idle,canRecover:()=>live,
  captureRaw(){const captured=epoch;return()=>captured===epoch&&live;},
  reserve(){assert.equal(activity.idle,true);assert.equal(owned,false);owned=true;epoch++;events.push('reserve');const token=activity.begin()!;return {kind:'reserved',reservation:{current:()=>owned&&token.current()&&live,release(){if(!owned)return;owned=false;releases++;token.end();events.push('release');}}};},
  blocking(b:boolean,inactive:boolean){blocked=b;activity.block('copy-removal',b&&inactive);events.push('gate:'+b+':'+inactive);},
  async refresh(){events.push('refresh');await options.refresh?.();events.push('refreshed');}};
 const core:any={...realCore,
  async discoverCopyRemoval(_input:any,c:any){events.push('discover');assert.equal(activity.count,1);assert.ok(c.current());return {kind:'candidate',candidate:{},target};},
  async planCopyRemoval(_candidate:any,c:any){events.push('plan');assert.ok(c.current(),'fresh guard after reserve changed epoch');assert.ok(c.runtimeProtectionCurrent(target));contexts.push(c);return {kind:'ready',plan,tracking:ref,planRevision:1,summary};},
  releaseCopyRemovalPlan(){events.push('release-plan');},
  async confirmCopyRemoval(_p:any,_consent:any,c:any){confirms++;assert.equal(c,contexts.at(-1));assert.deepEqual(readRemovalTracking(()=>store).tracking,ref,'tracking read back before core dispatch');events.push('confirm');return options.confirm?await options.confirm():outcome();},
  async cancelCopyRemoval(){events.push('cancel');return outcome({publication:'unknown',preparation:'not-dispatched'});},
  async readPendingCopyRemovals(){events.push('scan');return [];},
  async readCopyRemovalTarget(){events.push('target');return options.missing?null:target;},
  async inspectCopyRemoval(tracking:any,c:any){inspections++;events.push('inspect');contexts.push(c);assert.ok(c.current());return options.inspection?options.inspection(tracking):{outcome:outcome({tracking,state:'detached',physical:'present',recoveryRequired:true}),continuation,planRevision:1,summary};},
  async continueCopyRemoval(token:any,_consent:any,c:any){assert.equal(token,continuation);assert.equal(c,contexts.at(-1));continues++;return outcome();},
 };
 const prepare:any=async(_a:any,current:any)=>{events.push('runtime');assert.ok(current());return {kind:'ready',runtime:{current:(a:any)=>a===target&&current(),release(){events.push('runtime-release');}}};};
 const controller=createCopyRemovalController(host,core,prepare,()=>store);controller.initialize({pending:options.pending??[],unknown:options.unknown??false,storageUnavailable:false});
 return {controller,activity,events,contexts,store,get owned(){return owned;},get blocked(){return blocked;},get confirms(){return confirms;},get continues(){return continues;},get inspections(){return inspections;},get releases(){return releases;},stale(){live=false;epoch++;}};
}
function consent(h:any){let v=h.controller.getView();h.controller.callbacks(v).declaration('external-copy-declared');v=h.controller.getView();h.controller.callbacks(v).confirmed(true);v=h.controller.getView();return {callbacks:h.controller.callbacks(v),value:{planRevision:v.revision,declaration:v.declaration,confirmRemoveThisCopy:true}};}
const tick=()=>new Promise(r=>setImmediate(r));

test('outcome remains visible but close and inspect cannot release during refresh',async()=>{
 const wait=deferred();const h=harness({refresh:()=>wait.promise});await h.controller.start(track);const c=consent(h);const work=c.callbacks.confirm(c.value);await tick();
 const view=h.controller.getView();assert.equal(view.state,'result');assert.equal(view.outcome.state,'removed');assert.equal(view.working,true);
 const cb=h.controller.callbacks(view);assert.equal(cb.close(),false);await cb.inspect();assert.equal(h.inspections,0);assert.equal(h.releases,0);assert.equal(h.activity.count,1);assert.equal(h.blocked,true);
 wait.resolve();await work;assert.equal(h.controller.getView().working,false);assert.equal(cb.close(),false,'old view remains invalid after settlement');assert.equal(h.controller.callbacks(h.controller.getView()).close(),true);assert.equal(h.releases,1);assert.equal(h.activity.count,0);assert.equal(h.blocked,false);await h.controller.dispose();
});

test('cancel and dispose retain runtime and reservation through own refresh',async()=>{
 for(const action of ['cancel','dispose']){
  const wait=deferred();const h=harness({refresh:()=>wait.promise});await h.controller.start(track);const c=consent(h);const work=c.callbacks.confirm(c.value);await tick();
  let stopped=false;const stop=(action==='cancel'?h.controller.callbacks(h.controller.getView()).cancel():h.controller.dispose()).then(()=>{stopped=true;});await tick();
  assert.equal(stopped,false);assert.equal(h.releases,0);assert.equal(h.events.includes('runtime-release'),false);assert.equal(h.activity.count,1);
  wait.resolve();await work;await stop;assert.equal(h.releases,1);assert.equal(h.events.filter(e=>e==='runtime-release').length,1);assert.equal(h.activity.count,0);await h.controller.dispose();
 }
});

test('refresh rejection preserves the confirmed outcome and adds only secondary notice',async()=>{
 const confirmed=outcome();const h=harness({confirm:async()=>confirmed,refresh:async()=>{throw Error('synthetic refresh rejected');}});await h.controller.start(track);const c=consent(h);await c.callbacks.confirm(c.value);
 const v=h.controller.getView();assert.equal(v.outcome,confirmed);assert.equal(v.state,'result');assert.equal(v.working,false);assert.equal(v.secondary.length,1);assert.equal(h.releases,0);assert.equal(h.controller.callbacks(v).close(),true);assert.equal(h.releases,1);await h.controller.dispose();
});

test('terminal inspection retains resources through refresh and releases only afterward',async()=>{
 const wait=deferred();const h=harness({pending:[ref],refresh:()=>wait.promise,inspection:()=>({outcome:outcome(),continuation:null,planRevision:null,summary:null})});
 const work=h.controller.callbacks(h.controller.getView()).inspect();await tick();assert.equal(h.controller.getView().working,true);assert.equal(h.controller.callbacks(h.controller.getView()).close(),false);assert.equal(h.releases,0);assert.equal(h.activity.count,1);
 wait.resolve();await work;assert.equal(h.releases,1);assert.equal(h.controller.getView().working,false);assert.equal(h.controller.getView().state,'result');assert.equal(h.blocked,false);await h.controller.dispose();
});

test('unavailable tracking keeps the pending gate until explicit successful inspection',async()=>{
 const backing=memory();let denied=false;const store={...backing,getItem(){if(denied)throw Error('synthetic storage unavailable');return backing.getItem();}};
 const h=harness({store,confirm:async()=>{denied=true;return outcome();},inspection:()=>({outcome:outcome(),continuation:null,planRevision:null,summary:null})});
 await h.controller.start(track);const c=consent(h);await c.callbacks.confirm(c.value);assert.equal(h.controller.getView().state,'uncertain');assert.equal(h.controller.callbacks(h.controller.getView()).close(),true);assert.equal(h.blocked,true);assert.deepEqual(JSON.parse(backing.getItem()!),ref);
 denied=false;await h.controller.callbacks(h.controller.getView()).inspect();assert.equal(backing.getItem(),null);assert.equal(h.controller.getView().state,'result');
 // The unknown flag is conservative until an explicit fresh startup scan.
 assert.equal(h.blocked,true);await h.controller.callbacks(h.controller.getView()).inspect();assert.equal(h.controller.getView().pendingCount,0);assert.equal(h.blocked,false);await h.controller.dispose();
});
test('return focus uses fallback for connected disabled opener',()=>{
 const begin=main.indexOf(' function focusRemoval(){'),end=main.indexOf(' function closeRemoval()',begin);assert.ok(begin>=0&&end>begin);const fragment=main.slice(begin,end);
 const focused:string[]=[];const scrolled:string[]=[];const opener={isConnected:true,disabled:true,getClientRects:()=>[{}],focus(){if(!this.disabled)focused.push('opener');},scrollIntoView(){scrolled.push('opener');}};
 const fallback={focus(){focused.push('fallback');},scrollIntoView(){scrolled.push('fallback');}};
 const env={settingsOpen:false,settingsHeading:{current:null},removalFocus:{current:{kind:'close',current:()=>true,opener}},playerOpen:false,playerHeading:{current:null},page:'biblioteca',document:{getElementById:()=>null},routeHeading:{current:fallback},removalHeading:{current:null}};
 const fn=new Function('env','with(env){'+fragment+';return focusRemoval;}')(env);
 // Adjacent controls distinguish disabled from a legitimately focusable opener.
 opener.disabled=false;fn();assert.deepEqual(focused,['opener']);
 focused.length=0;scrolled.length=0;opener.isConnected=false;env.removalFocus.current={kind:'close',current:()=>true,opener};fn();assert.deepEqual(focused,['fallback']);
 focused.length=0;scrolled.length=0;opener.isConnected=true;opener.disabled=true;env.removalFocus.current={kind:'close',current:()=>true,opener};fn();assert.deepEqual(focused,['fallback']);
});


test('tracking cleanup distinguishes unavailable, corrupt and mismatched values from absence',()=>{
 assert.equal(clearRemovalTracking(ref,()=>({getItem(){throw Error('synthetic unavailable');},setItem(){},removeItem(){throw Error('must not remove');}})),false);
 assert.equal(clearRemovalTracking(ref,()=>memory('{')),false);
 assert.equal(clearRemovalTracking(ref,()=>memory(JSON.stringify({...ref,operationId:'33333333-3333-4333-8333-333333333333'}))),false);
 assert.equal(clearRemovalTracking(ref,()=>memory()),true);
 const saved=memory(JSON.stringify(ref));assert.equal(clearRemovalTracking(ref,()=>saved),true);assert.equal(saved.getItem(),null);
});
