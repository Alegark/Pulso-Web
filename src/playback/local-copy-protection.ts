import {AUDIO_FILE_MAX_BYTES,AUDIO_BLOB_TOTAL_MAX_BYTES} from '../storage/audio-limits';
import type {LocalAsset} from '../library/library';
import type {Entry} from './player';
import type {InsertionRequest,InsertResult} from './queue-insertion';
import {AppFailure,makeFailure} from '../errors/app-failure';
import {preparedSourceProvenance} from './transport';
import {copySourceAsset,copySourceAssets,sameSourceAsset,type PreparedLocalSources,type PreparedLocalSource,type BlobCredit,type SourceAllocation,type NewSourceBundle,type SourceBinding,type SourceRouting,type InsertionPreparation,type InsertionPlayer} from './local-source-protocol';
export type {BlobCredit,SourceAllocation,NewSourceBundle,SourceBinding,SourceRouting,InsertionPreparation,InsertionPlayer} from './local-source-protocol';

export interface SourceEntry {readonly id:string;readonly trackId:string;readonly src:string}
export interface ProtectionPlayer {
 readonly entries:readonly SourceEntry[];readonly currentEntryId:string|null;
 /** Exact installed URL; null only after the element has been unloaded. */
 readonly source:string|null;
}
export interface ProtectedOccurrence extends SourceEntry {readonly source:PreparedLocalSource}
export interface PendingSources {readonly trackIds:readonly string[];readonly planned:boolean}
export interface ProtectionSnapshot {
 readonly serial:number;readonly scopeCurrent:boolean;readonly unknown:boolean;
 readonly current:ProtectedOccurrence|null;readonly prepared:readonly ProtectedOccurrence[];
 readonly pending:readonly PendingSources[];readonly retainedSources:readonly PreparedLocalSource[];
}
declare const captureBrand:unique symbol;
export interface ProtectionCapture {readonly [captureBrand]:true}
declare const reservationBrand:unique symbol;
export interface SourceReservation {readonly [reservationBrand]:true;current():boolean;release():void}
export type SourceReservationBlockedReason='reservation-active'|'invalid-target'|'invalid-capture'|'queue-pending'|'runtime-unknown'|'player-current'|'player-prepared'|'source-retained';
export type SourceReservationResult={readonly kind:'reserved';readonly reservation:SourceReservation}|{readonly kind:'blocked';readonly reason:SourceReservationBlockedReason};
export interface SourcePreparation {
 setPlanned(trackIds:readonly string[]):boolean;
 reserveBlob(expectedUnique:readonly Readonly<LocalAsset>[]):BlobCredit|null;
 stage(bundle:PreparedLocalSources,entries:readonly SourceEntry[]):boolean;
 publish():boolean;settle():Promise<void>;
}
interface BundleRecord {
 bundle:PreparedLocalSources;sources:readonly PreparedLocalSource[];
 allocations:readonly SourceAllocation[]|null;
 releasing:Promise<void>|null;failed:boolean;retired:boolean;
}
interface BindingRecord {record:BundleRecord;sourceIndex:number;ref:ProtectedOccurrence}
interface CreditRecord {
 expected:readonly LocalAsset[];bytes:number;claimed:boolean;adopted:boolean;complete:boolean;
 bundle:PreparedLocalSources|null;done:Promise<void>;finish():void;current:()=>boolean;
 drop():void;
}
// Only minted identities work. There is no DTO issuer or provenance signer.
const credits=new WeakMap<BlobCredit,CreditRecord>();
const rawOwners=new WeakSet<PreparedLocalSources>();
/** Internal producer capability: a credit can be claimed once, before IO. The
 * returned completion closure is held only by that producer, including late IO. */
export function claimBlobCredit(credit:BlobCredit,expected:readonly Readonly<LocalAsset>[]){
 const c=credits.get(credit);
 if(!c||c.claimed||!safe(c.current)||c.expected.length!==expected.length||expected.some((a,i)=>!sameSourceAsset(a,c.expected[i])))return null;
 c.claimed=true;
 return Object.freeze({current:()=>!c.adopted&&safe(c.current),complete(bundle?:PreparedLocalSources){
  if(c.complete)return;c.complete=true;c.bundle=bundle??null;
  if(!bundle)c.drop();c.finish();
 }});
}
interface PreparationRecord {
 trackIds:readonly string[];planned:boolean;current:()=>boolean;epoch:number;
 bundle:BundleRecord|null;published:boolean;settled:boolean;settlement:Promise<void>|null;
 borrowers:Set<BundleRecord>;credit:BlobCredit|null;cancelled:boolean;
}
const safe=(guard:()=>boolean)=>{try{return guard();}catch{return false;}};
const copyIds=(ids:readonly string[])=>Object.freeze([...ids]);
const physical=(a:LocalAsset,b:LocalAsset)=>a.backend===b.backend&&a.storageKey===b.storageKey;
const rejected=():InsertResult=>({kind:'rejected',reason:'protection-rejected'});
const sourceFailure=()=>AppFailure.create(makeFailure('transport','internal','input-invalid','none'));

/** One document-local registry. Raw records alone own release, while occurrences
 * and pending borrowers refer to exact record/index pairs. Observations never
 * authorize deleting bytes. */
export function createLocalCopyProtection(host:{getPlayer():ProtectionPlayer;captureCurrent():()=>boolean}) {
 let serial=0,epoch=0,active=new Map<string,BindingRecord>(),playerSignature='';
 const bundles=new Set<BundleRecord>(),pending=new Set<PreparationRecord>(),reservations=new Set<BlobCredit>();
 const captures=new WeakMap<ProtectionCapture,{serial:number;epoch:number;current:()=>boolean}>();
 const changed=()=>{++serial;};
 let reservation:object|null=null;
 const rootGuard=()=>{try{return host.captureCurrent();}catch{return()=>false;}};
 const hasReservation=()=>reservation!==null;
 const canPrepare=()=>!hasReservation()&&safe(rootGuard());
 function observePlayer(){
  const p=host.getPlayer();
  const signature=JSON.stringify([p.currentEntryId,p.source,p.entries.map(e=>[e.id,e.trackId,e.src]).sort((a,b)=>a[0].localeCompare(b[0]))]);
  if(signature!==playerSignature){playerSignature=signature;changed();}
 }
 const matches=(binding:BindingRecord|undefined,entry:SourceEntry):binding is BindingRecord=>!!binding&&binding.ref.id===entry.id&&binding.ref.trackId===entry.trackId&&binding.ref.src===entry.src;
 function inUse(record:BundleRecord){
  const player=host.getPlayer();
  return record.sources.some(s=>s.url===player.source)||!record.retired&&player.entries.some(e=>matches(active.get(e.id),e)&&active.get(e.id)!.record===record);
 }
 const held=(b:BundleRecord)=>[...pending].some(p=>!p.settled&&(p.bundle===b||p.borrowers.has(b)));
 async function release(record:BundleRecord){
  if(record.releasing)return record.releasing;
  if(record.failed||inUse(record)||held(record))return;
  changed();
  record.releasing=(async()=>{
   try{await record.bundle.release();bundles.delete(record);changed();}
   catch{record.failed=true;changed();}
  })();return record.releasing;
 }
 async function releaseUnused(){await Promise.all([...bundles].map(release));}
 function budgetKnown(){return [...bundles].every(b=>b.allocations!==null&&!b.failed&&(!!b.releasing||preparedSourceProvenance(b.bundle)?.current()===true)&&b.sources.every(s=>s.protection==='pinned'))&&playerKnown();}
 function playerKnown(){
  const p=host.getPlayer(),ids=new Set<string>();
  for(const e of p.entries){if(ids.has(e.id)||!matches(active.get(e.id),e))return false;ids.add(e.id);}
  const ref=p.currentEntryId===null?null:active.get(p.currentEntryId)?.ref;
  return p.currentEntryId===null?p.source===null:!!ref&&ref.src===p.source;
 }
 function reserveBlob(p:PreparationRecord,live:()=>boolean,expected:readonly Readonly<LocalAsset>[]):BlobCredit|null {
  if(!live()||p.credit||!budgetKnown())return null;
  const assets=copySourceAssets(expected);
  if(!assets||!assets.length||assets.some(a=>a.bytes>AUDIO_FILE_MAX_BYTES))return null;
  // Separate URLs are charged separately, including identical historical assets.
  const allocations=new Map<string,number>();
  for(const b of bundles)for(const a of b.allocations!)if(a.kind==='blob')allocations.set(a.allocationId,a.bytes);
  let total=[...allocations.values()].reduce((a,b)=>a+b,0);
  for(const c of reservations)total+=credits.get(c)!.bytes;
  const bytes=assets.reduce((n,a)=>n+a.bytes,0);
  if(total+bytes>AUDIO_BLOB_TOTAL_MAX_BYTES)return null;
  let finish!:()=>void;const done=new Promise<void>(r=>{finish=r;});
  const token=Object.freeze({current:()=>{const c=credits.get(token)!;return !c.adopted&&reservations.has(token)&&live();}}) as BlobCredit;
  credits.set(token,{expected:assets,bytes,claimed:false,adopted:false,complete:false,bundle:null,done,finish,current:live,drop(){if(reservations.delete(token))changed();}});
  reservations.add(token);p.credit=token;changed();return token;
 }
 function own(bundle:PreparedLocalSources):BundleRecord {
  if(rawOwners.has(bundle))throw new Error('Bundle ownership already assigned');rawOwners.add(bundle);
  const sources=Object.freeze(bundle.sources.map(source=>{
   const asset=source.protection==='pinned'?copySourceAsset(source.asset):null;
   return Object.freeze(asset?{url:source.url,protection:'pinned' as const,asset}:{url:source.url,protection:'unknown' as const,asset:null});
  }));
  const provenance=preparedSourceProvenance(bundle);
  const b:BundleRecord={bundle,sources,allocations:provenance?.allocations??null,releasing:null,failed:false,retired:false};
  bundles.add(b);changed();return b;
 }
 function adoptCredit(p:PreparationRecord,b:BundleRecord){
  if(!p.credit)return;
  const c=credits.get(p.credit)!;
  // Until trusted allocation transfer, the full reservation stays occupied.
  if(c.complete&&c.bundle===b.bundle&&b.allocations){c.adopted=true;c.drop();}
 }
 function attempt(trackIds:readonly string[],current:()=>boolean){
  const rootCurrent=rootGuard(),admitted=!hasReservation();
  const p:PreparationRecord={trackIds:copyIds(trackIds),planned:false,current:()=>safe(current)&&safe(rootCurrent),epoch,bundle:null,published:false,settled:false,settlement:null,borrowers:new Set(),credit:null,cancelled:false};
  if(admitted){pending.add(p);changed();}
  const live=()=>admitted&&!hasReservation()&&!p.settled&&!p.cancelled&&p.epoch===epoch&&safe(p.current);
  const stage=(bundle:PreparedLocalSources)=>{
   if(p.bundle||p.settled)throw new Error('Bundle ownership already assigned');
   pending.add(p);p.bundle=own(bundle);p.bundle.retired=p.epoch!==epoch;adoptCredit(p,p.bundle);return p.bundle;
  };
  const settle=()=>{
   if(p.settlement)return p.settlement;
   p.settled=true;if(pending.has(p))changed();
   p.settlement=(async()=>{
    if(p.credit){const c=credits.get(p.credit)!;
     if(c.claimed)await c.done;
     // A producer delivered before stage: retain custody rather than leak it.
     if(c.bundle&&!c.adopted&&!p.bundle){p.bundle=own(c.bundle);adoptCredit(p,p.bundle);}
     if(!c.claimed||!c.bundle)c.drop();
    }
    p.borrowers.clear();
    if(!p.published&&p.bundle)await release(p.bundle);
    await releaseUnused();if(pending.delete(p))changed();
   })();return p.settlement;
  };
  return {p,live,stage,settle,reserve:(a:readonly Readonly<LocalAsset>[])=>reserveBlob(p,live,a)};
 }
 function binding(b:BundleRecord,i:number,entry:SourceEntry):BindingRecord {
  return {record:b,sourceIndex:i,ref:Object.freeze({id:entry.id,trackId:entry.trackId,src:entry.src,source:b.sources[i]})};
 }
 function beginPreparation(trackIds:readonly string[],current:()=>boolean):SourcePreparation {
  const a=attempt(trackIds,current),{p,live}=a;let refs=new Map<string,BindingRecord>();
  return Object.freeze({reserveBlob:a.reserve,
   setPlanned(ids:readonly string[]){if(!live()||p.bundle)return false;p.trackIds=copyIds(ids);p.planned=true;changed();return true;},
   stage(bundle:PreparedLocalSources,entries:readonly SourceEntry[]){const b=a.stage(bundle);refs=new Map();entries.forEach((e,i)=>{if(b.sources[i])refs.set(e.id,binding(b,i,e));});return live();},
   publish(){const b=p.bundle;
    if(!live()||!p.planned||p.published||!b||b.sources.length!==p.trackIds.length||refs.size!==p.trackIds.length)return false;
    if([...refs.values()].some((r,i)=>r.ref.trackId!==p.trackIds[i]||r.ref.src!==b.sources[i].url))return false;
    const issued=preparedSourceProvenance(b.bundle);if(issued&&!issued.current())return false;
    active=refs;p.published=true;changed();return true;
   },settle:a.settle,
  });
 }
 function beginInsertion(trackIds:readonly string[],current:()=>boolean):InsertionPreparation {
  const a=attempt(trackIds,current),{p,live}=a;
  const opaque=new WeakMap<SourceBinding,{record:BundleRecord;sourceIndex:number}>();
  let routing:SourceRouting|null=null,expected:readonly LocalAsset[]|null=null,bound=new Map<string,BindingRecord>(),newValid=false;
  function routeError():never {throw sourceFailure();}
  const sources=():readonly PreparedLocalSource[]|null=>{
   if(!live()||!routing||!expected)return null;
   const result:PreparedLocalSource[]=[];
   for(let i=0;i<expected.length;i++){
    const token=routing.bindings[i],borrow=token?opaque.get(token):null;
    const b=borrow?.record??(newValid?p.bundle:null),index=borrow?.sourceIndex??routing.missingIndexByOccurrence[i];
    if(!b||b.retired||b.releasing||b.failed||preparedSourceProvenance(b.bundle)?.current()!==true||index===null||index===undefined)return null;
    const s=b.sources[index];if(!s||s.protection!=='pinned'||!sameSourceAsset(s.asset,expected[i]))return null;result.push(s);
   }return Object.freeze(result);
  };
  return Object.freeze({
   setPlanned(ids:readonly string[]){
    if(!live()||routing||ids.length!==p.trackIds.length||ids.some((id,i)=>id!==p.trackIds[i]))return false;
    p.planned=true;changed();return true;
   },
   reserveSources(values:readonly Readonly<LocalAsset>[]):SourceRouting {
    if(!live()||!p.planned||routing||!budgetKnown())return routeError();
    const assets=copySourceAssets(values);if(!assets||assets.length!==p.trackIds.length||assets.length===0)return routeError();
    const bindings:(SourceBinding|null)[]=[],missing:LocalAsset[]=[],indices:(number|null)[]=[];
    const borrowed=new Set<BundleRecord>();
    for(const asset of assets){
     let found:{record:BundleRecord;sourceIndex:number}|null=null;
     for(const b of bundles)for(let i=0;i<b.sources.length;i++){
      const s=b.sources[i];if(s.protection!=='pinned'||!physical(s.asset,asset))continue;
      if(!sameSourceAsset(s.asset,asset))return routeError();
      if(!b.retired&&!b.failed&&!b.releasing)found??={record:b,sourceIndex:i};
     }
     if(found){const token=Object.freeze(Object.create(null)) as SourceBinding;opaque.set(token,found);bindings.push(token);indices.push(null);borrowed.add(found.record);}
     else{
      const i=missing.findIndex(a=>physical(a,asset));if(i>=0&&!sameSourceAsset(missing[i],asset))return routeError();
      bindings.push(null);indices.push(i<0?missing.push(asset)-1:i);
     }
    }
    expected=assets;p.borrowers=borrowed;
    routing=Object.freeze({bindings:Object.freeze(bindings),missing:Object.freeze(missing),missingIndexByOccurrence:Object.freeze(indices)});changed();return routing;
   },
   reserveBlob:a.reserve,
   stageNew(prepared:NewSourceBundle){
    const b=a.stage(prepared.bundle),trusted=preparedSourceProvenance(prepared.bundle);
    // The JSON allocations are descriptive only: require the issued array identity.
    newValid=!!routing&&!!trusted&&trusted.current()&&prepared.allocations===trusted.allocations&&b.sources.length===routing.missing.length&&b.sources.every((s,i)=>s.protection==='pinned'&&sameSourceAsset(s.asset,routing!.missing[i]));
    return live()&&newValid;
   },
   getSources:sources,
   bindEntries(entries:readonly Entry[]){
    const list=sources();if(!list||!expected||entries.length!==expected.length||new Set(entries.map(e=>e.id)).size!==entries.length)return false;
    const next=new Map<string,BindingRecord>();
    for(let i=0;i<entries.length;i++){
     const e=entries[i];if(e.trackId!==p.trackIds[i]||e.src!==list[i].url)return false;
     const token=routing!.bindings[i],borrow=token?opaque.get(token):null;
     const b=borrow?.record??p.bundle!,index=borrow?.sourceIndex??routing!.missingIndexByOccurrence[i]!;
     next.set(e.id,binding(b,index,e));
    }bound=next;return true;
   },
   commitInsertion(request:InsertionRequest,player:InsertionPlayer):InsertResult {
    if(!live()||p.published||!sources()||bound.size!==p.trackIds.length||request.entries.length!==bound.size)return rejected();
    const combined=new Map<string,BindingRecord>(),structure=player.structure(),observed=host.getPlayer();
    if(structure.queueRevision!==request.expectedQueueRevision||structure.queueEpoch!==request.expectedQueueEpoch)return {kind:'rejected',reason:'stale-queue'};
    if(!playerKnown()||structure.entries.length!==observed.entries.length||structure.currentEntryId!==observed.currentEntryId)return rejected();
    for(const e of structure.entries){const b=active.get(e.id);if(!matches(b,e)||combined.has(e.id)||!observed.entries.some(o=>o.id===e.id&&o.trackId===e.trackId&&o.src===e.src))return rejected();combined.set(e.id,b);}
    for(const e of request.entries){const b=bound.get(e.id);if(!matches(b,e)||combined.has(e.id))return rejected();combined.set(e.id,b);}
    if(combined.size!==structure.entries.length+bound.size)return rejected();
    // No external callback, IO or await after validation. Player's private hook
    // runs after CAS/planning and before its single coherent notification.
    return player.insertQueue(request,plan=>{
     if(plan.entries.length!==combined.size||plan.entries.some(e=>!matches(combined.get(e.id),e)))return false;
     active=combined;p.published=true;changed();return true;
    });
   },
   cancel(){if(!p.cancelled){p.cancelled=true;changed();}},settle:a.settle,
  });
 }
 function getReadonlySnapshot():ProtectionSnapshot {
  observePlayer();const player=host.getPlayer(),scopeCurrent=safe(rootGuard());
  let unknown=!scopeCurrent;const matched=new Set<string>(),used=new Map<BundleRecord,Set<number>>(),prepared:ProtectedOccurrence[]=[];let current:ProtectedOccurrence|null=null;
  for(const e of player.entries){const b=active.get(e.id);
   if(!matches(b,e)||matched.has(e.id)){unknown=true;continue;}matched.add(e.id);
   let indices=used.get(b.record);if(!indices)used.set(b.record,indices=new Set());indices.add(b.sourceIndex);
   if(e.id===player.currentEntryId)current=b.ref;else prepared.push(b.ref);
  }
  if(player.currentEntryId!==null&&(!current||player.source!==current.src))unknown=true;
  if(player.currentEntryId===null&&player.source!==null)unknown=true;
  const retainedSources:PreparedLocalSource[]=[];
  for(const b of bundles){if(b.failed||!b.releasing&&preparedSourceProvenance(b.bundle)?.current()===false)unknown=true;b.sources.forEach((s,i)=>{if(!used.get(b)?.has(i))retainedSources.push(s);});}
  const preparations=Object.freeze([...pending].map(p=>Object.freeze({trackIds:p.trackIds,planned:p.planned})));
  if([...pending].some(p=>!p.planned))unknown=true;
  if([...prepared,...(current?[current]:[])].some(r=>r.source.protection==='unknown')||retainedSources.some(s=>s.protection==='unknown'))unknown=true;
  return Object.freeze({serial,scopeCurrent,unknown,current,prepared:Object.freeze(prepared),pending:preparations,retainedSources:Object.freeze(retainedSources)});
 }
 function capture():ProtectionCapture {
  observePlayer();const token=Object.freeze(Object.create(null)) as ProtectionCapture;
  captures.set(token,{serial,epoch,current:rootGuard()});return token;
 }
 function inspect(token:ProtectionCapture):ProtectionSnapshot|null {
  const saved=captures.get(token);if(!saved)return null;
  const snapshot=getReadonlySnapshot();
  return saved.serial===serial&&saved.epoch===epoch&&safe(saved.current)&&snapshot.scopeCurrent?snapshot:null;
 }
 /** Only document-local exclusion, never authority to remove bytes. The caller
  * retains this handle until its own attempt has fully settled, including after
  * current() becomes false. No invalidation implicitly releases occupancy. */
 function reserve(token:ProtectionCapture,target:Readonly<LocalAsset>):SourceReservationResult {
  const blocked=(reason:SourceReservationBlockedReason):SourceReservationResult=>Object.freeze({kind:'blocked',reason});
  if(hasReservation())return blocked('reservation-active');
  const asset=copySourceAsset(target);if(!asset)return blocked('invalid-target');
  let snapshot:ProtectionSnapshot|null;
  try{snapshot=inspect(token);}catch{return blocked('invalid-capture');}
  if(!snapshot)return blocked('invalid-capture');
  if(snapshot.pending.length)return blocked('queue-pending');
  if(snapshot.unknown)return blocked('runtime-unknown');
  // Full snapshot validation above; collisions use physical identity, so changing
  // revision/hash/id of the same storage generation never bypasses protection.
  const physical=(source:PreparedLocalSource)=>source.protection==='pinned'&&source.asset.backend===asset.backend&&source.asset.storageKey===asset.storageKey;
  if(snapshot.current&&physical(snapshot.current.source))return blocked('player-current');
  if(snapshot.prepared.some(ref=>physical(ref.source)))return blocked('player-prepared');
  if(snapshot.retainedSources.some(physical))return blocked('source-retained');
  const guard=captures.get(token)!.current,identity=Object.freeze({asset}),savedEpoch=epoch;
  reservation=identity;changed();const savedSerial=serial;
  let released=false,invalid=false;
  const handle=Object.freeze({
   current(){
    if(released||invalid||reservation!==identity)return false;
    try{observePlayer();invalid=serial!==savedSerial||epoch!==savedEpoch||!safe(guard);}
    catch{invalid=true;}
    return !invalid;
   },
   release(){
    if(released)return;released=true;
    if(reservation===identity){reservation=null;changed();}
   },
  }) as SourceReservation;
  return Object.freeze({kind:'reserved',reservation:handle});
 }
 function invalidateScope(){++epoch;active=new Map();for(const b of bundles)b.retired=true;changed();}
 return Object.freeze({beginPreparation,beginInsertion,observePlayer,getReadonlySnapshot,capture,inspect,reserve,hasReservation,canPrepare,invalidateScope,releaseUnused});
}
