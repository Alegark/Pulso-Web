import {assertDatabaseUse} from '../storage/database';
import {admittedTransaction,closeDatabase} from '../storage/database';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {openDatabase,request} from '../storage/database';
import {transactionDone} from '../storage/transaction-done';
import {validAsset,type LocalAsset,type Track} from './library';
import {ArtworkError,validateArtwork,type ArtworkFailure,type ArtworkInspection} from '../imports/artwork';
export type {ArtworkFailure,ArtworkInspection} from '../imports/artwork';
/** Versioned metadata entity in settings; never an audio LocalAsset or a persisted URL. */
export type Artwork={version:1;trackId:string;assetId:string;audioSha256:string;provenance:'embedded-id3'|'embedded-mp4'|'embedded-riff-id3'|'manual';manual:boolean;updatedAt:string;revision:number}&ArtworkInspection;
export type ArtworkRead={state:'unrecorded';revision:0}|{state:'unavailable';revision:number;failureCode:ArtworkFailure;repairToken?:string}|Artwork;
const key=(id:string)=>`artwork:v1:${id}`;
interface Snapshot {track:Track;asset:LocalAsset;artwork?:Artwork}
async function snapshot(trackId:string):Promise<Snapshot>{
 const db=await openDatabase();try{const tx=admittedTransaction(db,['tracks','assets','settings']);const done=transactionDone(tx);
 const track=await request<Track|undefined>(tx.objectStore('tracks').get(trackId));
 const asset=track?.assetId?await request<LocalAsset|undefined>(tx.objectStore('assets').get(track.assetId)):undefined;
 const artwork=await request<Artwork|undefined>(tx.objectStore('settings').get(key(trackId)));await done;
 if(!track||!validAsset(asset)||track.assetId!==asset.id)throw new ArtworkError('conflict');return {track,asset,artwork};
 }finally{closeDatabase(db);}
}
// All product artwork writers share this per-track commit lock. Decode/inspection and
// hashing stay outside IDB. This coordinates cooperating writers, not hostile same-origin
// JS bypassing locks/revisions and replacing equal-size Blob bytes at the commit boundary.
const artworkLock=(id:string)=>`pulso:artwork:v1:${id}`;
const repairs=new Map<string,{digest:string;revision:number}>();
const safeRevision=(a:Artwork|undefined)=>Number.isSafeInteger(a?.revision)&&a!.revision>0&&a!.revision<Number.MAX_SAFE_INTEGER?a!.revision:0;
/** Fail closed on oversized/unsupported/cyclic snapshots: no token and no repair.
 * <=256 values, depth 8, 128 keys/object, 16 Ki characters, 64 KiB descriptor,
 * and <=2 MiB total Blob bytes, hashed in 64 KiB chunks outside any transaction. */
function describe(value:unknown):{metadata:string;blobs:Blob[]}{
 const blobs:Blob[]=[],seen=new Set<object>();let nodes=0,characters=0,bytes=0;
 function visit(v:unknown,depth:number):unknown{
  if(++nodes>256||depth>8)throw new ArtworkError('conflict');
  if(typeof v==='string'){characters+=v.length;if(characters>16384)throw new ArtworkError('conflict');return ['string',v];}
  if(typeof v==='number')return ['number',Object.is(v,-0)?'-0':String(v)];
  if(v===null||typeof v==='boolean'||v===undefined)return [typeof v,v??null];
  if(!v||typeof v!=='object'||seen.has(v))throw new ArtworkError('conflict');seen.add(v);
  if(v instanceof Blob){bytes+=v.size;if(bytes>2*1024*1024||v.type.length>256)throw new ArtworkError('conflict');blobs.push(v);return ['blob',v.size,v.type];}
  if(!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype)throw new ArtworkError('conflict');
  const keys=Object.keys(v).sort();if(keys.length>128)throw new ArtworkError('conflict');
  return [Array.isArray(v)?'array':'object',keys.map(k=>{characters+=k.length;if(characters>16384)throw new ArtworkError('conflict');return [k,visit((v as Record<string,unknown>)[k],depth+1)];})];
 }
 const metadata=JSON.stringify(visit(value,0));if(new TextEncoder().encode(metadata).length>65536)throw new ArtworkError('conflict');return {metadata,blobs};
}
async function fingerprint(value:unknown):Promise<string>{
 const {metadata,blobs}=describe(value),hash=sha256.create();hash.update(new TextEncoder().encode(metadata));
 for(const blob of blobs)for(let p=0;p<blob.size;p+=65536)hash.update(new Uint8Array(await blob.slice(p,p+65536).arrayBuffer()));
 return bytesToHex(hash.digest());
}
async function unavailable(s:Snapshot,code:ArtworkFailure):Promise<ArtworkRead>{
 const revision=safeRevision(s.artwork),token=crypto.randomUUID();
 try{
  const digest=await fingerprint(s);
  if(repairs.size>=128)repairs.delete(repairs.keys().next().value!);
  repairs.set(token,{digest,revision});return {state:'unavailable',revision,failureCode:code,repairToken:token};
 }catch{return {state:'unavailable',revision,failureCode:'conflict'};}
}
function validRecord(a:Artwork,s:Snapshot):boolean{
 return a?.version===1&&a.trackId===s.track.id&&a.assetId===s.asset.id&&a.audioSha256===s.asset.sha256&&
 Number.isSafeInteger(a.revision)&&a.revision>0&&a.revision<Number.MAX_SAFE_INTEGER&&typeof a.manual==='boolean'&&a.manual===(a.provenance==='manual')&&
 ['manual','embedded-id3','embedded-mp4','embedded-riff-id3'].includes(a.provenance)&&typeof a.updatedAt==='string'&&Number.isFinite(Date.parse(a.updatedAt))&&
 ['ready','absent','not-inspected','invalid','omitted'].includes(a.state);
}
/** No Object URL is created: UI owns createObjectURL/revokeObjectURL and stale selection checks. */
export async function readArtwork(trackId:string):Promise<ArtworkRead>{
 let revision=0;let observed:Snapshot|undefined;
 try{
  const s=await snapshot(trackId),a=s.artwork;observed=s;if(!a)return {state:'unrecorded',revision:0};
  if(!validRecord(a,s))return unavailable(s,'conflict');
  revision=a.revision;
  if(a.state==='ready'){
   if(!(a.blob instanceof Blob))throw new ArtworkError('image-structure');
   const checked=await validateArtwork(a.blob);
   if(checked.sha256!==a.sha256||checked.mime!==a.mime||checked.width!==a.width||checked.height!==a.height)throw new ArtworkError('image-structure');
   const latest=await snapshot(trackId);if(latest.asset.sha256!==s.asset.sha256||latest.artwork?.revision!==a.revision)throw new ArtworkError('conflict');
  }
  return a;
 }catch(error){const code=error instanceof ArtworkError?error.code:'storage-failed';return observed?unavailable(observed,code):{state:'unavailable',revision,failureCode:code};}
}
async function save(s:Snapshot,inspection:ArtworkInspection,manual:boolean,repairMetadata?:string,isCurrent:()=>boolean=()=>true):Promise<Artwork>{
 assertDatabaseUse('publish');if(!isCurrent())throw new ArtworkError('conflict');const db=await openDatabase();try{assertDatabaseUse('publish');if(!isCurrent())throw new ArtworkError('conflict');const tx=admittedTransaction(db,['tracks','assets','settings'],'readwrite');const done=transactionDone(tx);
 try{
 const track=await request<Track|undefined>(tx.objectStore('tracks').get(s.track.id));
 const asset=await request<LocalAsset|undefined>(tx.objectStore('assets').get(s.asset.id));
 const current=await request<Artwork|undefined>(tx.objectStore('settings').get(key(s.track.id)));
 // CAS only relations and revisions. Never write a captured Track over a newer correction.
 if(!track||track.assetId!==s.asset.id||track.revision!==s.track.revision||!validAsset(asset)||asset.revision!==s.asset.revision||asset.sha256!==s.asset.sha256||(!repairMetadata&&(current?.revision??0)!==(s.artwork?.revision??0)))throw new ArtworkError('conflict');
 if(repairMetadata){
  // Metadata-only CAS, no Blob reads/hash/parser/keepAlive inside this short transaction.
  if(describe({track,asset,artwork:current}).metadata!==repairMetadata)throw new ArtworkError('conflict');
 }else if(current&&!validRecord(current,{track,asset}))throw new ArtworkError('conflict');
 if(!manual&&current?.manual){await done;return current;}
 const next:Artwork={...inspection,version:1,trackId:track.id,assetId:asset.id,audioSha256:asset.sha256,manual,provenance:manual?'manual':s.asset.mime==='audio/mp4'?'embedded-mp4':s.asset.mime==='audio/wav'?'embedded-riff-id3':'embedded-id3',updatedAt:new Date().toISOString(),revision:safeRevision(current)+1};
 assertDatabaseUse('publish');if(!isCurrent())throw new ArtworkError('conflict');tx.objectStore('settings').put(next,key(track.id));await done;return next;
 }catch(error){try{tx.abort();}catch{/* settled */}await done.catch(()=>{});throw error;}
 }finally{closeDatabase(db);}
}
/** expectedRevision is readArtwork().revision (0 for unrecorded). null explicitly hides a cover;
 * unavailable.repairToken authorizes repair of exactly that observed snapshot (fourth argument).
 * Tokens are process-local (max 128); reread after reload/eviction. No token on unavailable
 * means the snapshot cannot be inspected safely and is not repairable by this API.
 * this manual choice also survives dedup/reimport. Errors throw ArtworkError or storage errors. */
export async function setManualArtwork(trackId:string,image:Blob|null,expectedRevision:number,repairToken?:string):Promise<Artwork>{
 const s=await snapshot(trackId);describe(s); // enforce inspection budgets even without a repair token
 if(repairToken){const proof=repairs.get(repairToken);if(!proof||proof.revision!==expectedRevision||proof.digest!==await fingerprint(s))throw new ArtworkError('conflict');}
 else if((s.artwork?.revision??0)!==expectedRevision)throw new ArtworkError('conflict');
 const inspection=image===null?{state:'absent'} as const:await validateArtwork(image);
 return navigator.locks.request(artworkLock(trackId),async()=>{
  let repairMetadata:string|undefined;
  if(repairToken){
   const proof=repairs.get(repairToken),latest=await snapshot(trackId);
   if(!proof||proof.digest!==await fingerprint(latest))throw new ArtworkError('conflict');
   repairMetadata=describe(latest).metadata;
  }
  const saved=await save(s,inspection,true,repairMetadata);if(repairToken)repairs.delete(repairToken);return saved;
 });
}
/** Optional post-audio publication only. Stable audio identity survives repaired generations. */
export async function storeEmbeddedArtwork(trackId:string,audioSha256:string,inspect:()=>Promise<ArtworkInspection>,current:()=>boolean=()=>true):Promise<Artwork>{
 assertDatabaseUse('publish');if(!current())throw new ArtworkError('conflict');const s=await snapshot(trackId);if(s.asset.sha256!==audioSha256)throw new ArtworkError('conflict');
 if(s.artwork){if(!validRecord(s.artwork,s))throw new ArtworkError('conflict');if(s.artwork.manual||s.artwork.state==='ready')return s.artwork;}
 assertDatabaseUse('publish');if(!current())throw new ArtworkError('conflict');const inspection=await inspect();assertDatabaseUse('publish');if(!current())throw new ArtworkError('conflict');
 return navigator.locks.request(artworkLock(trackId),()=>{assertDatabaseUse('publish');if(!current())throw new ArtworkError('conflict');return save(s,inspection,false,undefined,current);});
}
