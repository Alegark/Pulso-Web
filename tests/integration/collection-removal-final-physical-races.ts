import {journalKey,markerKey} from '../../src/library/local-copy-removal-contract';
import {registerDatabaseRealmHost} from '../../src/storage/database-realms';
import {openDatabase,closeDatabase,readRecord,writeRecord} from '../../src/storage/database';
import {importFileDetailed} from '../../src/imports/import-file';
import {createPlaylist,changePlaylist,editTrack,type Track} from '../../src/library/library';
import {addTrackToLibrary,libraryMembershipKey} from '../../src/library/library-membership';
import {groupAlbums} from '../../src/library/groups';
import {discoverCopyRemoval,planUnreferencedCopyRemoval,confirmCopyRemoval,acknowledgeUnreferencedCopyRemoval,inspectCopyRemoval,readCopyRemovalTarget,readPendingCopyRemovals} from '../../src/library/local-copy-removal';
import {previewCollectionRemoval,confirmCollectionRemoval,type CollectionCleanupHost} from '../../src/library/collection-removal';
import {createLocalCopyProtection} from '../../src/playback/local-copy-protection';
import {createSourceReviewAdmission} from '../../src/playback/source-review-admission';
import {prepareCopyRemovalRuntime} from '../../src/playback/copy-removal-runtime';
import {Activity} from '../../src/playback/ownership';
import {openAssetReader} from '../../src/storage/asset-reader';
import {persistRemovalTracking,clearRemovalTracking} from '../../src/ui/local-copy-removal-state';
const assert:(v:unknown,m:string)=>asserts v=(v,m)=>{if(!v)throw Error(m);};
registerDatabaseRealmHost({capture:(_kind,current)=>current()?{current,onLifecycle:()=>{},end:()=>{}}:null});
const controller=new AbortController(),ctx={signal:controller.signal,current:()=>!controller.signal.aborted};
const activity=new Activity();activity.open();
const player={entries:[],currentEntryId:null,source:null};
const protection=createLocalCopyProtection({getPlayer:()=>player,captureCurrent:()=>()=>ctx.current()});
const admission=createSourceReviewAdmission({activity,protection,canReserve:()=>ctx.current(),captureCurrent:()=>()=>ctx.current(),changed:()=>{}});
const host:CollectionCleanupHost={record:async t=>persistRemovalTracking(t),forget:async t=>clearRemovalTracking(t),readContext:()=>({signal:ctx.signal,current:admission.captureCurrent()}),async reserve(target){const r=admission.reserve(target);if(r.kind==='blocked')return r;const current=()=>ctx.current()&&r.reservation.current();const runtime=await prepareCopyRemovalRuntime(target,current);if(runtime.kind==='blocked'){r.reservation.release();return runtime;}return {kind:'reserved',context:{signal:ctx.signal,current,runtimeProtectionCurrent:a=>current()&&runtime.runtime.current(a)},async release(){runtime.runtime.release();r.reservation.release();}};}};
function wav(salt:number){const size=16044,b=new Uint8Array(size),v=new DataView(b.buffer);const text=(s:string,p:number)=>[...s].forEach((x,i)=>b[p+i]=x.charCodeAt(0));text('RIFF',0);v.setUint32(4,size-8,true);text('WAVEfmt ',8);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text('data',36);v.setUint32(40,size-44,true);for(let i=44;i<size;i++)b[i]=(i*salt+salt)%251;return new File([b],`own-${salt}.wav`,{type:'audio/wav'});}
// TESTONLY: the prototype hooks synchronize native operations; they do not fabricate results.
type Tracking=Parameters<CollectionCleanupHost['record']>[0];
let saved:Tracking|null=null, heldRelease:(()=>void)|null=null, pending:Promise<unknown>|null=null;
let status={entered:false,dispatched:false,nativeSettled:false,abortedWhileNativePending:false,confirmed:false,released:false,reserves:0,attempts:0};
let originalRemove=FileSystemDirectoryHandle.prototype.removeEntry;
let originalDelete=IDBObjectStore.prototype.delete;
let aborter:AbortController;
async function start(mode:'opfs'|'idb-abort'|'idb-commit'){
 const db=await openDatabase();closeDatabase(db);const tracks:Track[]=[];const assets:import('../../src/library/library').LocalAsset[]=[];
 for(const n of [201,202]){const r=await importFileDetailed(wav(n),ctx.signal,()=>{},{backend:mode==='opfs'?'opfs':'idb',libraryMode:'cache'});assert(r.kind==='confirmed','import '+JSON.stringify(r));tracks.push(r.result.track);const a=await readRecord<import('../../src/library/library').LocalAsset>('assets',r.result.track.assetId!);assert(a&&a.backend===(mode==='opfs'?'opfs':'idb'),'backend');assets.push(a);}
 const list=await createPlaylist('Physical races own');for(let i=0;i<2;i++)await changePlaylist(list.id,i+1,{type:'add',trackId:tracks[i].id});
 aborter=new AbortController();const c={signal:aborter.signal,current:()=>true};const p=await previewCollectionRemoval({kind:'playlist',id:list.id,revision:3},c);assert(p.copiesEligible===2,'eligible');
 const h:CollectionCleanupHost={...host,async record(t){saved=t;return host.record(t);},async reserve(a){status.reserves++;const r=await host.reserve(a);if(r.kind==='blocked')return r;return {...r,async release(){status.released=true;await r.release();}};}};
 if(mode==='opfs'){
  FileSystemDirectoryHandle.prototype.removeEntry=async function(name,opts){status.attempts++;status.entered=true;status.dispatched=true;const native=originalRemove.call(this,name,opts);native.then(()=>{status.nativeSettled=true;},()=>{status.nativeSettled=true;});status.abortedWhileNativePending=!status.nativeSettled;aborter.abort();await new Promise<void>(r=>{heldRelease=r;});return await native;};
 }else{
  IDBObjectStore.prototype.delete=function(key){if(this.name==='chunks') {status.attempts++;if(!status.entered){status.entered=true;if(mode==='idb-abort'){this.transaction.addEventListener('abort',()=>{status.nativeSettled=true;},{once:true});aborter.abort();}else this.transaction.addEventListener('complete',()=>{status.nativeSettled=true;aborter.abort();},{once:true});}}return originalDelete.call(this,key);};
 }
 pending=confirmCollectionRemoval(p.token,{confirm:true,acceptPossibleOnlyCopyLoss:true},c,h).then(out=>{status.confirmed=true;return out;});
 return {tracks,assets};
}
function cancel(){aborter.abort();}
function releaseNative(){assert(heldRelease,'no held native call');heldRelease();}
async function finish(){assert(pending,'no pending');try{return await pending;}finally{FileSystemDirectoryHandle.prototype.removeEntry=originalRemove;IDBObjectStore.prototype.delete=originalDelete;}}
async function checkState(assets:import('../../src/library/library').LocalAsset[],tracks:Track[]){const verified=[];for(let i=0;i<assets.length;i++){const track=await readRecord<Track>('tracks',tracks[i].id);if(track?.assetId===assets[i].id){const r=await openAssetReader(assets[i]);try{verified.push((await r.verifyDetailed(true)).state);}finally{r.release();}}else verified.push('detached');}return {verified,tracking:saved,pointer:sessionStorage.getItem('pulso-web:copy-removal:pending:v1'),status:{...status}};}
async function inspect(tracking:Tracking){const read=host.readContext();const pendingAtStartup=await readPendingCopyRemovals(read);const journalBefore=await readRecord<{state:string}>('settings',journalKey(tracking.operationId));const a=await readCopyRemovalTarget(tracking,read);assert(a,'fresh journal target');const reserved=await host.reserve(a);assert(reserved.kind==='reserved','fresh reservation '+JSON.stringify(reserved));try{const result=await inspectCopyRemoval(tracking,reserved.context);return {outcome:result.outcome,continuation:!!result.continuation,pendingAtStartup,journalBefore};}finally{await reserved.release();}}
Object.assign(window,{physicalStart:start,physicalCancel:cancel,physicalRelease:releaseNative,physicalFinish:finish,physicalState:checkState,physicalInspect:inspect,physicalStatus:()=>({...status})});
