import type {LocalAsset} from '../library/library';
import {copySourceAsset,type PreparedLocalSources,type PreparedLocalSource} from './local-source-protocol';

export interface SourceEntry {readonly id:string;readonly trackId:string;readonly src:string}
export interface ProtectionPlayer {
 readonly entries:readonly SourceEntry[];
 readonly currentEntryId:string|null;
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
export interface SourcePreparation {
 setPlanned(trackIds:readonly string[]):boolean;
 /** Takes ownership even when stale, so settle can clean this exact bundle. */
 stage(bundle:PreparedLocalSources,entries:readonly SourceEntry[]):boolean;
 publish():boolean;
 settle():Promise<void>;
}
interface BundleRecord {
 bundle:PreparedLocalSources;refs:Map<string,ProtectedOccurrence>;sources:readonly PreparedLocalSource[];
 releasing:Promise<void>|null;failed:boolean;retired:boolean;
}
interface PreparationRecord {
 trackIds:readonly string[];planned:boolean;current:()=>boolean;epoch:number;
 bundle:BundleRecord|null;published:boolean;settled:boolean;settlement:Promise<void>|null;
}
const safe=(guard:()=>boolean)=>{try{return guard();}catch{return false;}};
const copyIds=(ids:readonly string[])=>Object.freeze([...ids]);
/** Document-local resource ownership. Observations and opaque captures never
 * authorize deletion. Only the root's actual bundle objects own cleanup. */
export function createLocalCopyProtection(host:{getPlayer():ProtectionPlayer;captureCurrent():()=>boolean}) {
 let serial=0,epoch=0,active:BundleRecord|null=null,playerSignature='';
 const bundles=new Set<BundleRecord>(),pending=new Set<PreparationRecord>();
 const owned=new WeakSet<PreparedLocalSources>();
 const captures=new WeakMap<ProtectionCapture,{serial:number;epoch:number;current:()=>boolean}>();
 const changed=()=>{++serial;};
 function observePlayer(){
  const player=host.getPlayer();
  // Order, titles, time, repeat and shuffle do not change resource identity.
  const signature=JSON.stringify([player.currentEntryId,player.source,player.entries.map(e=>[e.id,e.trackId,e.src]).sort((a,b)=>a[0].localeCompare(b[0]))]);
  if(signature!==playerSignature){playerSignature=signature;changed();}
 }
 function inUse(record:BundleRecord){
  const player=host.getPlayer();
  return record.sources.some(source=>source.url===player.source)||!record.retired&&player.entries.some(entry=>record.refs.get(entry.id)?.src===entry.src);
 }
 async function release(record:BundleRecord){
  if(record.releasing)return record.releasing;
  if(record.failed||record===active||inUse(record))return;
  // Keep every source visible until cleanup has actually settled. A rejection
  // cannot prove resource release, and R81's idempotent promise cannot be retried.
  changed();
  record.releasing=(async()=>{
   try{await record.bundle.release();bundles.delete(record);changed();}
   catch{record.failed=true;changed();}
  })();
  return record.releasing;
 }
 async function releaseUnused(){
  const held=new Set([...pending].filter(p=>!p.settled).map(p=>p.bundle));
  await Promise.all([...bundles].filter(b=>!held.has(b)).map(release));
 }
 function beginPreparation(trackIds:readonly string[],current:()=>boolean):SourcePreparation {
  const rootCurrent=host.captureCurrent();
  const record:PreparationRecord={trackIds:copyIds(trackIds),planned:false,current:()=>safe(current)&&safe(rootCurrent),epoch,bundle:null,published:false,settled:false,settlement:null};
  pending.add(record);changed();
  const live=()=>!record.settled&&record.epoch===epoch&&safe(record.current);
  return Object.freeze({
   setPlanned(ids:readonly string[]){if(!live()||record.bundle)return false;record.trackIds=copyIds(ids);record.planned=true;changed();return true;},
   stage(bundle:PreparedLocalSources,entries:readonly SourceEntry[]){
    if(record.bundle||record.settled||owned.has(bundle))throw new Error('Bundle ownership already assigned');
    owned.add(bundle);
    // Copy the transport snapshot, never re-read the database after issuance.
    const sources=Object.freeze(bundle.sources.map(source=>{
     const asset:Readonly<LocalAsset>|null=source.protection==='pinned'?copySourceAsset(source.asset):null;
     // Invalid data never gains physical protection; still own the bundle so
     // its resources are not lost if a producer violates the typed contract.
     return Object.freeze(asset?{url:source.url,protection:'pinned' as const,asset}:{url:source.url,protection:'unknown' as const,asset:null});
    }));
    const refs=new Map<string,ProtectedOccurrence>();
    entries.forEach((entry,i)=>{if(sources[i])refs.set(entry.id,Object.freeze({id:entry.id,trackId:entry.trackId,src:entry.src,source:sources[i]}));});
    record.bundle={bundle,refs,sources,releasing:null,failed:false,retired:record.epoch!==epoch};bundles.add(record.bundle);changed();
    return live();
   },
   publish(){
    const b=record.bundle;
    if(!live()||!record.planned||record.published||!b||b.sources.length!==record.trackIds.length||b.refs.size!==record.trackIds.length)return false;
    const refs=[...b.refs.values()];
    if(refs.some((ref,i)=>ref.trackId!==record.trackIds[i]||ref.src!==b.sources[i].url))return false;
    active=b;record.published=true;changed();return true;
   },
   settle(){
    if(record.settlement)return record.settlement;
    record.settled=true;changed();
    record.settlement=(async()=>{
     if(!record.published&&record.bundle)await release(record.bundle);
     await releaseUnused();
     pending.delete(record);changed();
    })();return record.settlement;
   },
  });
 }
 function getReadonlySnapshot():ProtectionSnapshot {
  observePlayer();
  const player=host.getPlayer(),scopeCurrent=safe(host.captureCurrent());
  let unknown=!scopeCurrent;
  const matched=new Set<string>(),prepared:ProtectedOccurrence[]=[];let current:ProtectedOccurrence|null=null;
  for(const entry of player.entries){
   const ref=active?.refs.get(entry.id);
   if(!ref||matched.has(entry.id)||ref.trackId!==entry.trackId||ref.src!==entry.src){unknown=true;continue;}
   matched.add(entry.id);
   if(entry.id===player.currentEntryId)current=ref;else prepared.push(ref);
  }
  if(player.currentEntryId!==null&&(!current||player.source!==current.src))unknown=true;
  if(player.currentEntryId===null&&player.source!==null)unknown=true;
  const retainedSources:PreparedLocalSource[]=[];
  for(const b of bundles){
   if(b.failed)unknown=true;
   for(const ref of b.refs.values())if(b!==active||!matched.has(ref.id))retainedSources.push(ref.source);
   if(b.sources.length!==b.refs.size)unknown=true;
  }
  const preparations=Object.freeze([...pending].map(p=>Object.freeze({trackIds:p.trackIds,planned:p.planned})));
  if([...pending].some(p=>!p.planned))unknown=true;
  if([...prepared,...(current?[current]:[])].some(ref=>ref.source.protection==='unknown')||retainedSources.some(source=>source.protection==='unknown'))unknown=true;
  return Object.freeze({serial,scopeCurrent,unknown,current,prepared:Object.freeze(prepared),pending:preparations,retainedSources:Object.freeze(retainedSources)});
 }
 function capture():ProtectionCapture {
  observePlayer();const token=Object.freeze(Object.create(null)) as ProtectionCapture;
  captures.set(token,{serial,epoch,current:host.captureCurrent()});return token;
 }
 function inspect(token:ProtectionCapture):ProtectionSnapshot|null {
  const saved=captures.get(token);if(!saved)return null;
  const snapshot=getReadonlySnapshot();
  return saved.serial===serial&&saved.epoch===epoch&&safe(saved.current)&&snapshot.scopeCurrent?snapshot:null;
 }
 function invalidateScope(){++epoch;active=null;for(const b of bundles)b.retired=true;changed();}
 return Object.freeze({beginPreparation,observePlayer,getReadonlySnapshot,capture,inspect,invalidateScope,releaseUnused});
}
