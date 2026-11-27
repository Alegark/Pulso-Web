import test from 'node:test';
import assert from 'node:assert/strict';
import {createContinuousCollectionController,planInitialCollectionQueue,shouldTriggerPrefetch,type CollectionSlot,type PlayerSnapshot} from '../../src/playback/continuous-collection';
import {abortPrefetchFlight,albumCoordinator} from '../../src/library/album-download';
const slots:CollectionSlot[]=['a','b','c','d'].map(id=>({kind:'library-track',slotKey:id,trackId:id,title:id,artist:null}));
const snapshot=():PlayerSnapshot=>({queueEpoch:1,state:'playing',currentTrackId:'a',currentTime:60,duration:100,repeat:'off',shuffled:false,hasFollowingInQueue:false,entryTrackIds:['a']});
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('initial queue preserves history and stops at gap',()=>{
 assert.deepEqual(planInitialCollectionQueue(slots,1,id=>id!=='c'),{queueTrackIds:['a','b'],startQueueIndex:1});
 assert.deepEqual(planInitialCollectionQueue(slots,1,()=>true),{queueTrackIds:['a','b','c','d'],startQueueIndex:1});
 assert.deepEqual(planInitialCollectionQueue(slots,1,id=>id!=='a'),{queueTrackIds:['b','c','d'],startQueueIndex:0});
});
test('prefetch thresholds and exclusions',()=>{
 for(const change of [{},{currentTime:55},{currentTime:0,duration:45}])assert.equal(shouldTriggerPrefetch({...snapshot(),...change}),true);
 for(const change of [{currentTime:54},{repeat:'one' as const},{shuffled:true},{hasFollowingInQueue:true},{duration:NaN},{currentTime:-1}])assert.equal(shouldTriggerPrefetch({...snapshot(),...change}),false);
});
test('one prefetch waits at end then inserts contiguous run and plays',async()=>{
 let finish!:(result:{state:'ready';trackId:string})=>void,calls=0;const s=snapshot(),available=new Set(['a','c']),inserted:string[][]=[],played:string[]=[],notices:string[]=[];
 const controller=createContinuousCollectionController({canStartPrefetch:()=>true,isTrackAvailable:id=>available.has(id),resolveSlotTrackId:slot=>slot.trackId,downloadSlot:()=>{calls++;return new Promise(resolve=>{finish=resolve;});},insertNextTracks:async ids=>{inserted.push([...ids]);return 'inserted';},selectAndPlayTrack:id=>played.push(id),pauseCurrent:()=>{},getPlayerSnapshot:()=>s,onStateChange:n=>{if(n.waitingTitle)notices.push(n.waitingTitle);}});
 controller.activate({queueEpoch:1,kind:'playlist',slots});controller.observePlayer('progress');controller.observePlayer('progress');assert.equal(calls,1);
 s.state='ended';controller.observePlayer('state');assert.equal(notices.at(-1),'Preparando siguiente canción…');available.add('b');finish({state:'ready',trackId:'b'});await flush();assert.deepEqual(inserted,[['b','c']]);assert.deepEqual(played,['b']);
});
test('pause or epoch change cancels outstanding request',async()=>{
 const s=snapshot();let signal!:AbortSignal,finish!:(result:{state:'ready';trackId:string})=>void,plays=0;
 const c=createContinuousCollectionController({canStartPrefetch:()=>true,isTrackAvailable:id=>id==='a',resolveSlotTrackId:slot=>slot.trackId,downloadSlot:(_slot,sig)=>{signal=sig;return new Promise(r=>{finish=r;});},insertNextTracks:async()=> 'inserted',selectAndPlayTrack:()=>{plays++;},pauseCurrent:()=>{},getPlayerSnapshot:()=>s,onStateChange:()=>{}});
 c.activate({queueEpoch:1,kind:'playlist',slots});assert.equal(c.requestNextPending(),true);s.state='paused';c.observePlayer('state');assert.equal(signal.aborted,true);finish({state:'ready',trackId:'b'});await flush();assert.equal(plays,0);
 s.state='playing';c.observePlayer('progress');s.queueEpoch=2;c.observePlayer('state');assert.equal(signal.aborted,true);
});
test('channel failure falls forward without retry',async()=>{
 const s=snapshot(),inserted:string[][]=[],played:string[]=[];let calls=0;
 const c=createContinuousCollectionController({canStartPrefetch:()=>true,isTrackAvailable:id=>id==='a'||id==='d',resolveSlotTrackId:slot=>slot.trackId,downloadSlot:async()=>{calls++;return {state:'failed',channelWide:true};},insertNextTracks:async ids=>{inserted.push([...ids]);return 'inserted';},selectAndPlayTrack:id=>played.push(id),pauseCurrent:()=>{},getPlayerSnapshot:()=>s,onStateChange:()=>{}});
 c.activate({queueEpoch:1,kind:'playlist',slots});assert.equal(c.requestNextPending(),true);await flush();assert.deepEqual(inserted,[['d']]);assert.deepEqual(played,['d']);c.observePlayer('progress');await flush();assert.equal(calls,1);
});
test('abort coordinator flight',()=>{let calls=0;albumCoordinator.prefetchFlight={token:{},abort:()=>{calls++;}};abortPrefetchFlight(albumCoordinator);assert.equal(calls,1);delete albumCoordinator.prefetchFlight;});
