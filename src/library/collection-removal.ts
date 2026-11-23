import {projectSpotifyReleases} from '../playlists/spotify-catalog';
import {ACTIVE_LIBRARY_ACCOUNT} from '../accounts/library-local';
/** Collection metadata CAS and explicit retirement of unreferenced copies.
 * The host supplies real reservations and fresh runtime-bound contexts. */
import {admittedTransaction, closeDatabase, openExistingDatabase, request} from '../storage/database';
import {transactionDone} from '../storage/transaction-done';
import {WRITER_LOCK} from '../storage/asset-reader';
import {readSongAliasesFrom} from './selected-song';
import {libraryAlbumCards,readSavedAlbumsFrom,savedAlbumKey,savedAlbumGroupKey} from './saved-albums';
import {indexCopyProtection,listeningCacheAssets} from './listening-cache';
import {copyLibraryMembership, libraryMembershipKey, makeLibraryMembership} from './library-membership';
import {describeRemovalData, validateTrack} from './local-copy-removal-snapshot';
import {copySourceAsset,sameSourceAsset} from '../playback/local-source-protocol';
import {normalizeSnapshot} from '../playback/queue-restore';
import type {LocalAsset, Playlist, Track} from './library';
import {discoverCopyRemoval,planUnreferencedCopyRemoval,confirmCopyRemoval,acknowledgeUnreferencedCopyRemoval,readCopyRemovalTarget,releaseCopyRemovalPlan,type RemovalContext,type RemovalReadContext,type RemovalTracking} from './local-copy-removal';

export type CollectionSelection = {kind:'playlist'; id:string; revision:number} | {kind:'album'; scope:'global-library'; key:string} | {kind:'cache'; scope:'global-listening-cache'};
export interface CollectionContext {readonly signal:AbortSignal; current():boolean}
declare const previewBrand: unique symbol;
export interface CollectionPreviewToken {readonly [previewBrand]:true}
export interface CollectionConsent {readonly confirm:true; readonly acceptPossibleOnlyCopyLoss:true}
export interface CollectionPreview {readonly token:CollectionPreviewToken; readonly tracks:number; readonly copiesEligible:number; readonly estimatedBytes:number; readonly retainedShared:number; readonly cleanupAvailable:true}
export interface CollectionOutcome {readonly metadata:'committed'|'not-committed'|'unknown'; readonly cleanup:'complete'|'stopped'|'not-started'; readonly freedBytes:number; readonly removed:number; readonly skipped:number; readonly skipReasons:readonly string[]; readonly reason:string|null}
/** Host must create a fresh context AFTER reservation; release settles its resources. */
export interface CollectionCleanupHost {readContext():RemovalReadContext;settlementReadContext?():RemovalReadContext;reserve(target:Readonly<LocalAsset>):Promise<{kind:'reserved';context:RemovalContext;release():Promise<void>}|{kind:'blocked';reason:string}>;record(tracking:RemovalTracking):Promise<boolean>;forget(tracking:RemovalTracking):Promise<boolean>}
type Row={key:IDBValidKey; value:unknown};
type Snapshot={accountId?:string;tracks:Track[]; playlists:Playlist[]; assets:LocalAsset[]; membership:Map<string,boolean>; queued:Set<string>; albumGroup?:ReturnType<typeof libraryAlbumCards>[number]; canonical:string};
type Data={selection:CollectionSelection; snapshot:Snapshot; affected:string[]; targets:{asset:LocalAsset;track:Track}[]; context:CollectionContext};
const previews=new WeakMap<CollectionPreviewToken,Data>();
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
function check(c:CollectionContext):void {if(c.signal.aborted||c.current()!==true)throw new Error('collection-stale');}
async function rows(tx:IDBTransaction, name:string):Promise<Row[]> {
 const store=tx.objectStore(name);const [keys,values]=await Promise.all([request(store.getAllKeys()),request(store.getAll())]);
 if(keys.length>20000||keys.length!==values.length)throw new Error('collection-limit');
 return keys.map((key,i)=>({key,value:values[i]}));
}
async function snapshot(tx:IDBTransaction,c:CollectionContext,selection:CollectionSelection):Promise<Snapshot> {
 const includeCatalog=selection.kind==='album';
 check(c);const [tr,pl,as]=await Promise.all(['tracks','playlists','assets'].map(n=>rows(tx,n)));check(c);
 const tracks=tr.map(r=>validateTrack(r.value,r.key)); const ids=new Set(tracks.map(t=>t.id));
 const playlists=pl.map(({key,value})=>{
  if(!value||typeof value!=='object')throw new Error('collection-invalid');const p=value as Playlist;
  if(!uuid(p.id)||key!==p.id||!Number.isSafeInteger(p.revision)||p.revision<1||typeof p.name!=='string'||!Array.isArray(p.entries)||p.entries.length>20000)throw new Error('collection-invalid');
  const entryIds=new Set<string>();for(const e of p.entries){if(!e||!uuid(e.id)||!uuid(e.trackId)||!ids.has(e.trackId)||entryIds.has(e.id))throw new Error('collection-invalid');entryIds.add(e.id);}return p;
 });
 const assets=as.map(({key,value})=>{const a=copySourceAsset(value);if(!a||a.id!==key)throw new Error('collection-invalid');return a;});
 const generations=new Set(assets.map(a=>JSON.stringify([a.backend,a.storageKey])));if(generations.size!==assets.length)throw new Error('collection-invalid');
 const assetIds=new Set(assets.map(a=>a.id));if(tracks.some(t=>t.assetId!==null&&!assetIds.has(t.assetId)))throw new Error('collection-invalid');
 const membership=new Map(tracks.map(t=>[t.id,true]));
 const store=tx.objectStore('settings');const relevant=(await Promise.all(tracks.map(async t=>{const key=libraryMembershipKey(t.id);const [value,present]=await Promise.all([request(store.get(key)),request(store.getKey(key))]);return present===undefined?null:{key,value};}))).filter(r=>r!==null);
 for(const r of relevant){const key=r.key as [string,number,string];const m=copyLibraryMembership(r.value,key[2]);if(!m)throw new Error('collection-invalid');membership.set(m.trackId,m.added);}
 const rawQueue=await request(store.get('library-playback'));const queued=new Set<string>();if(rawQueue!==undefined){const q=normalizeSnapshot(rawQueue);if(!q||q.warnings.length||describeRemovalData(rawQueue)!==describeRemovalData(q.snapshot)||q.snapshot.entries.some(e=>!ids.has(e.trackId)))throw new Error('collection-invalid');for(const entry of q.snapshot.entries)queued.add(entry.trackId);}
 const accountId=await request<string|undefined>(store.get(ACTIVE_LIBRARY_ACCOUNT));
 const view=includeCatalog&&accountId?await projectSpotifyReleases(store,tracks,accountId):tracks;
 const catalogEvidence=includeCatalog?view.flatMap(t=>t.catalogRelease?[[t.id,t.catalogRelease]]:[]):[];
 const savedAlbums=includeCatalog&&accountId?await readSavedAlbumsFrom(store,accountId):[];
 const owned=view.filter(t=>t.accountId===accountId);
 const albumGroup=selection.kind==='album'?libraryAlbumCards(owned.filter(t=>membership.get(t.id)),savedAlbums,
  savedAlbums.length?await readSongAliasesFrom(store):undefined,owned).find(group=>group.key===selection.key):undefined;
 const selectedAlbum=albumGroup?.saved?savedAlbums.find(album=>savedAlbumGroupKey(album.edition.id)===albumGroup.key):undefined;
 const canonical=describeRemovalData([tr,pl,as,relevant,rawQueue,accountId,catalogEvidence,selectedAlbum??null]);
 return {accountId,tracks:view,playlists,assets,membership,queued,albumGroup,canonical};
}
function affectedFor(s:Snapshot,selection:CollectionSelection):string[] {
 if(selection.kind==='playlist') {const p=s.playlists.find(p=>p.id===selection.id&&p.revision===selection.revision&&p.accountId===s.accountId);if(!p)throw new Error('collection-changed');return [...new Set(p.entries.map(e=>e.trackId))];}
 if(selection.kind==='cache'){
  if(selection.scope!=='global-listening-cache')throw new Error('collection-invalid');
  const assets=listeningCacheAssets({tracks:s.tracks,assets:s.assets,libraryTrackIds:new Set([...s.membership].filter(([,added])=>added).map(([id])=>id)),playlists:s.playlists});
  const ids=new Set(assets.map(a=>a.id));return s.tracks.filter(t=>t.assetId!==null&&ids.has(t.assetId)).map(t=>t.id);
 }
 if(selection.scope!=='global-library')throw new Error('collection-invalid');
 const group=s.albumGroup;
 if(!group)throw new Error('collection-changed');return [...new Set(group.trackIds)];
}
async function read(c:CollectionContext,selection:CollectionSelection):Promise<Snapshot>{check(c);const db=await openExistingDatabase();try{check(c);const tx=admittedTransaction(db,['tracks','playlists','assets','settings']);const done=transactionDone(tx);try{const s=await snapshot(tx,c,selection);await done;check(c);return s;}catch(e){try{tx.abort();}catch{}await done.catch(()=>{});throw e;}}finally{closeDatabase(db);}}
export async function previewCollectionRemoval(selection:CollectionSelection,c:CollectionContext):Promise<CollectionPreview>{
 if(selection.kind==='playlist'&&(!uuid(selection.id)||!Number.isSafeInteger(selection.revision)||selection.revision<1)||selection.kind==='album'&&(selection.scope!=='global-library'||typeof selection.key!=='string')||selection.kind==='cache'&&selection.scope!=='global-listening-cache'||!['playlist','album','cache'].includes(selection.kind))throw new Error('collection-invalid');
 const s=await read(c,selection);const affected=affectedFor(s,selection);const affectedSet=new Set(affected);
 const remainingLists=selection.kind==='playlist'?s.playlists.filter(p=>p.id!==selection.id):s.playlists;
 const protectedIds=new Set(remainingLists.flatMap(p=>p.entries.map(e=>e.trackId)));
 const firstTrackByAsset=new Map<string,Track>();
 for(const t of s.tracks)if(t.assetId!==null&&affectedSet.has(t.id)&&!firstTrackByAsset.has(t.assetId))firstTrackByAsset.set(t.assetId,t);
 const protectedCopy=indexCopyProtection(s.tracks,t=>t.favorite||protectedIds.has(t.id)||s.queued.has(t.id)||s.membership.get(t.id)===true&&!(selection.kind==='album'&&affectedSet.has(t.id)));
 const targets:Data['targets']=[];let eligible=0,estimatedBytes=0,shared=0;
 for(const asset of s.assets){
  const track=firstTrackByAsset.get(asset.id);if(!track)continue;
  targets.push({asset,track});
  if(protectedCopy(asset))shared++;else{eligible++;estimatedBytes+=asset.bytes;}
 }
 const token=Object.freeze({}) as CollectionPreviewToken;previews.set(token,{selection:{...selection},snapshot:s,affected,targets,context:c});
 return Object.freeze({token,tracks:affected.length,copiesEligible:eligible,estimatedBytes,retainedShared:shared,cleanupAvailable:true});
}
export function releaseCollectionRemovalPreview(token:CollectionPreviewToken):void {previews.delete(token);}
export async function confirmCollectionRemoval(token:CollectionPreviewToken,consent:CollectionConsent,c:CollectionContext,host:CollectionCleanupHost):Promise<CollectionOutcome>{
 const d=previews.get(token);previews.delete(token);const rejected=(reason:string):CollectionOutcome=>({metadata:'not-committed',cleanup:'not-started',freedBytes:0,removed:0,skipped:0,skipReasons:[],reason});
 if(!d||d.context!==c||consent?.confirm!==true||consent.acceptPossibleOnlyCopyLoss!==true)return rejected('invalid-preview-or-consent');
 if(!host||typeof host.readContext!=='function'||typeof host.reserve!=='function'||typeof host.record!=='function'||typeof host.forget!=='function')return rejected('invalid-cleanup-host');
 let metadata:CollectionOutcome;
 try{metadata=await navigator.locks.request(WRITER_LOCK,{signal:c.signal},async()=>{
  check(c);const db=await openExistingDatabase();let tx:IDBTransaction|undefined;let done:Promise<void>|undefined;let dispatched=false;
  try{check(c);tx=admittedTransaction(db,['tracks','playlists','assets','settings'],'readwrite');done=transactionDone(tx);const native=tx;
   const abort=()=>{try{native.abort();}catch{}};c.signal.addEventListener('abort',abort,{once:true});
   try{const s=await snapshot(tx,c,d.selection);if(s.canonical!==d.snapshot.canonical)throw new Error('collection-changed');const ids=affectedFor(s,d.selection);if(describeRemovalData(ids)!==describeRemovalData(d.affected))throw new Error('collection-changed');check(c);
    if(d.selection.kind==='playlist')tx.objectStore('playlists').delete(d.selection.id);
    else if(d.selection.kind==='album'){
     const store=tx.objectStore('settings');
     const group=s.albumGroup;
     if(group?.saved&&s.accountId)store.delete(savedAlbumKey(s.accountId,group.editionId));
     for(const id of ids)store.put(makeLibraryMembership(id,false),libraryMembershipKey(id));
    }
    dispatched=true;await done;return {metadata:'committed',cleanup:'not-started',freedBytes:0,removed:0,skipped:0,skipReasons:[],reason:null} as CollectionOutcome;
   }finally{c.signal.removeEventListener('abort',abort);}
  }catch(e){if(tx&&done){try{tx.abort();}catch{}let aborted=false;await done.catch(()=>{aborted=true;});if(dispatched&&!aborted)return {...rejected('commit-settlement-unknown'),metadata:'unknown'} as CollectionOutcome;}return rejected(e instanceof Error?e.message:'collection-failed');}
  finally{closeDatabase(db);}
 });}catch(e){return rejected(e instanceof Error?e.message:'collection-failed');}
 if(metadata.metadata!=='committed')return metadata;
 let freedBytes=0,removed=0,skipped=0;const skipReasons:string[]=[];const skip=(reason:string)=>{skipped++;skipReasons.push(reason);};
 const stop=(reason:string):CollectionOutcome=>({metadata:'committed',cleanup:'stopped',freedBytes,removed,skipped,skipReasons,reason});
 for(const {asset,track} of d.targets){
  try{check(c);
   const discovery=await discoverCopyRemoval({namespace:'local',trackId:track.id,expectedTrackRevision:track.revision},host.readContext());
   if(discovery.kind!=='candidate'){skip(discovery.reason);continue;}
   const reserved=await host.reserve(discovery.target);if(reserved.kind==='blocked'){skip(reserved.reason);continue;}
   try{check(c);const context:RemovalContext={signal:c.signal,current:()=>c.current()&&reserved.context.current(),runtimeProtectionCurrent:a=>c.current()&&reserved.context.runtimeProtectionCurrent(a)};const planned=await planUnreferencedCopyRemoval(discovery.candidate,context);if(planned.kind!=='ready'){skip(planned.reason);continue;}
    if(c.signal.aborted||!c.current()){releaseCopyRemovalPlan(planned.plan);return stop('cancelled');}
    let recorded=false;try{recorded=await host.record(planned.tracking);}catch{/* fail closed */}if(!recorded){releaseCopyRemovalPlan(planned.plan);return stop('tracking-unavailable');}
    const result=await confirmCopyRemoval(planned.plan,{planRevision:planned.planRevision,declaration:'accept-possible-only-original-loss',confirmRemoveThisCopy:true},context);
    if(result.preparation==='not-dispatched'||result.preparation==='aborted'){if(!await host.forget(planned.tracking))return stop('tracking-uncertain');skip(result.primary?`${result.primary.phase}:${result.primary.code}`:'not-committed');continue;}
    if(result.recoveryRequired||result.state!=='removed'&&result.state!=='not-committed')return stop('receipt-uncertain');
    // Keep the durable terminal receipt until the independent tab pointer is
    // cleared. A failed pointer clear can then still be inspected; deleting the
    // journal first could strand a pointer with no recoverable receipt.
    if(!await host.forget(planned.tracking))return stop('tracking-uncertain');
    if(!await acknowledgeUnreferencedCopyRemoval(result,context)){
     // ACK may have committed before its caller observed cancellation. Restore
     // discovery only if a fresh read proves the original journal still exists;
     // never create a pointer to an already-pruned journal or repeat a deletion.
     const settled=host.settlementReadContext?.()??host.readContext();
     const retained=await readCopyRemovalTarget(planned.tracking,settled);
     if(retained&&sameSourceAsset(retained,discovery.target)&&!await host.record(planned.tracking))return stop('tracking-uncertain');
     return stop('acknowledgement-uncertain');
    }
    if(result.state==='removed'){removed++;freedBytes+=asset.bytes+(result.freedArtworkBytes??0);}else skip(result.primary?.code??'not-committed');
   }finally{await reserved.release();}
  }catch{return stop(c.signal.aborted?'cancelled':'cleanup-failed');}
 }
 if(c.signal.aborted||!c.current())return stop('cancelled');return {metadata:'committed',cleanup:'complete',freedBytes,removed,skipped,skipReasons,reason:null};
}
