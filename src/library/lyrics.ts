import {assertDatabaseUse} from '../storage/database';
import {admittedTransaction,closeDatabase} from '../storage/database';
import {validAsset,type LocalAsset,type Track} from './library';
import type {EmbeddedLyricsInspection,LyricsSource} from '../imports/lyrics';
import {openDatabase,request} from '../storage/database';
import {transactionDone} from '../storage/transaction-done';
import {parseLyrics,parseSyltEvents,LyricsError,type LyricsFormat,type ParsedLyrics,type LyricsFailure} from './lyrics-parser';
export {parseLyrics,lyricsDraft,LyricsError,LYRICS_LIMITS} from './lyrics-parser';
export type {LyricsFormat,ParsedLyrics,LyricsFailure} from './lyrics-parser';
export const LYRICS_PREFIX='lyrics:v1:';
type LyricsFields={version:1;trackId:string;revision:string;format:LyricsFormat|'sylt';text:string|null;cues?:{timeMs:number;text:string}[]};
export type LyricsRecord=LyricsFields&({manual:true;provenance?:'manual'}|{manual:false;provenance:'embedded';source:LyricsSource;assetId:string;audioSha256:string});
export type LyricsProvenance={provenance:'manual'}|{provenance:'embedded';source:LyricsSource};
export type LyricsRead=({state:'absent';revision:string|0}|{state:'ready';revision:string;lyrics:Exclude<ParsedLyrics,{kind:'absent'}>}|{state:'unavailable';revision:string|null;failureCode:LyricsFailure;repairToken?:string}) & {origin?:LyricsProvenance};
const validRevision=(r:unknown):r is string=>typeof r==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(r);
const idOK=(id:unknown):id is string=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
interface Snapshot{assetId:string|null;exists:boolean;raw:unknown;track:Track;asset:LocalAsset|undefined}
/** Bounded structural comparison only; refuses Blob, cycles and exotic objects without IO.
 * Used as CAS in IDB, never calls parser/hash/Blob. Only root cues can have 4000
 * entries (12001 event nodes); all other objects retain 32 keys/128 nodes.
 * 400000 chars bounds duplicate text + events + descriptors/keys. No array sort.
 * Limits also bound corrupt repair tokens. */
function describe(raw:unknown):string{
 let nodes=0,eventNodes=0,chars=0;const seen=new Set<object>();
 function visit(v:unknown,depth:number,eventArray=false,inEvents=false):unknown{
  if((inEvents?++eventNodes>12001:++nodes>128)||depth>5)throw new LyricsError('corrupt');
  if(typeof v==='string'){chars+=v.length;if(chars>400000)throw new LyricsError('corrupt');return ['s',v];}
  if(typeof v==='number')return ['n',Object.is(v,-0)?'-0':String(v)];
  if(v===null||typeof v==='boolean'||v===undefined)return [typeof v,v??null];
  if(typeof v!=='object'||seen.has(v))throw new LyricsError('corrupt');seen.add(v);
  if(Array.isArray(v)&&v.length>(eventArray?4000:32))throw new LyricsError('corrupt');
  if(!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype)throw new LyricsError('corrupt');
  const keys:string[]=[];
  for(const key in v){if(!Object.prototype.hasOwnProperty.call(v,key))continue;
   if(keys.length===(eventArray?4000:32))throw new LyricsError('corrupt');
   chars+=key.length;if(chars>400000)throw new LyricsError('corrupt');keys.push(key);
  }
  if(!eventArray)keys.sort(); // event indices need no sorting; enumeration remains bounded
  return [Array.isArray(v)?['a',v.length]:'o',keys.map(k=>[k,visit((v as Record<string,unknown>)[k],depth+1,depth===0&&k==='cues',inEvents||eventArray)])];
 }
 return JSON.stringify(visit(raw,0));
}
async function snapshot(trackId:string):Promise<Snapshot>{
 if(!idOK(trackId))throw new LyricsError('track');
 const db=await openDatabase();try{const tx=admittedTransaction(db,['tracks','assets','settings']);const done=transactionDone(tx);
 try{const track=await request<Track|undefined>(tx.objectStore('tracks').get(trackId));const store=tx.objectStore('settings');
 const asset=track?.assetId?await request<LocalAsset|undefined>(tx.objectStore('assets').get(track.assetId)):undefined;
 const exists=await request(store.count(LYRICS_PREFIX+trackId));const raw=await request<unknown>(store.get(LYRICS_PREFIX+trackId));await done;
 if(track?.id!==trackId||(track.assetId!==null&&!idOK(track.assetId)))throw new LyricsError('track');return {assetId:track.assetId,exists:exists===1,raw,track,asset};
 }catch(e){try{tx.abort();}catch{}await done.catch(()=>{});throw e;}
 }finally{closeDatabase(db);}
}
function inspect(raw:unknown,trackId:string):{record:LyricsRecord;parsed:ParsedLyrics}{
 const r=raw as LyricsRecord;
 if(!r||r.version!==1||r.trackId!==trackId||(r.manual!==true&&r.manual!==false)||!validRevision(r.revision)||(r.format!=='plain'&&r.format!=='lrc'&&r.format!=='sylt')||r.text!==null&&typeof r.text!=='string')throw new LyricsError('corrupt');
 if(r.manual===false){
  if(r.provenance!=='embedded'||!idOK(r.assetId)||! /^[a-f0-9]{64}$/.test(r.audioSha256)||!r.source||!['embedded-id3','embedded-riff-id3','embedded-mp4'].includes(r.source.kind)||!['USLT','SYLT','©lyr'].includes(r.source.tag)||typeof r.source.descriptor!=='string'||r.source.descriptor.length>8192||(r.source.language!==null&&(!/^[a-z]{3}$/.test(r.source.language)))||r.text===null)throw new LyricsError('corrupt');
  if((r.source.kind==='embedded-mp4')!==(r.source.tag==='©lyr'))throw new LyricsError('corrupt');
  parseLyrics(r.source.descriptor,'plain');
 }else if(r.provenance!==undefined&&r.provenance!=='manual')throw new LyricsError('corrupt');
 if(r.format==='sylt'){
  if(r.manual||r.source.tag!=='SYLT')throw new LyricsError('corrupt');
  const parsed=parseSyltEvents(r.cues);if(r.text!==parsed.text)throw new LyricsError('corrupt');return {record:r,parsed};
 }
 if(r.cues!==undefined)throw new LyricsError('corrupt');
 return {record:r,parsed:r.text===null?{kind:'absent'}:parseLyrics(r.text,r.format)};
}
const repairs=new Map<string,{trackId:string;assetId:string|null;descriptor:string}>();
function normalize(e:unknown):LyricsError{return e instanceof LyricsError?e:new LyricsError(e instanceof DOMException&&e.name==='QuotaExceededError'?'quota':'storage',{cause:e});}
/** revision 0 means no stored key. Corruption never masquerades as revision 0.
 * repairToken is local to this JS module (128 most recent); reread after reload. */
export async function readLyrics(trackId:string):Promise<LyricsRead>{
 let s:Snapshot|undefined;
 try{s=await snapshot(trackId);if(!s.exists)return {state:'absent',revision:0};describe(s.raw);
 const {record,parsed}=inspect(s.raw,trackId);
 if(!record.manual&&(!validAsset(s.asset)||s.asset.id!==s.assetId||s.assetId!==record.assetId||s.asset.sha256!==record.audioSha256))throw new LyricsError('conflict');
 const origin:LyricsProvenance=record.manual?{provenance:'manual'}:{provenance:'embedded',source:record.source};
 return parsed.kind==='absent'?{state:'absent',revision:record.revision,origin}:{state:'ready',revision:record.revision,lyrics:parsed,origin};
 }catch(e){const error=normalize(e);let repairToken:string|undefined;
 if(s?.exists){try{const descriptor=describe(s.raw);repairToken=crypto.randomUUID();if(repairs.size>=128)repairs.delete(repairs.keys().next().value!);repairs.set(repairToken,{trackId,assetId:s.assetId,descriptor});}catch{}}
 return {state:'unavailable',revision:null,failureCode:s?.exists?'corrupt':error.code,...(repairToken?{repairToken}:{})};}
}
/** Manual-only write. Explicit format; null stores absence. Pass read.revision and,
 * for corruption, read.repairToken. Revisions are opaque UUIDs, preventing ABA after repair. On conflict reread. Returns only after commit.
 * Independent of audio bytes/metadata/queue; no URLs, provider or playback calls. */
export async function setManualLyrics(trackId:string,text:string|null,format:LyricsFormat,expectedRevision:string|0|null,repairToken?:string):Promise<LyricsRead>{
 try{
 const parsed=parseLyrics(text===null?'':text,format); // all parsing before lock/IDB
 const s=await snapshot(trackId),descriptor=describe(s.raw);const nextRevision=crypto.randomUUID();
 if(repairToken){const proof=repairs.get(repairToken);if(expectedRevision!==null||!s.exists||!proof||proof.trackId!==trackId||proof.assetId!==s.assetId||proof.descriptor!==descriptor)throw new LyricsError('conflict');
 }else{const revision=s.exists?inspect(s.raw,trackId).record.revision:0;if(expectedRevision!==revision)throw new LyricsError('conflict');}
 const next:LyricsRecord={version:1,trackId,revision:nextRevision,manual:true,provenance:'manual',format,text};
 if(!navigator.locks)throw new LyricsError('locks');
 await navigator.locks.request(`pulso:lyrics:v1:${trackId}`,async()=>{
 const db=await openDatabase();try{const tx=admittedTransaction(db,['tracks','settings'],'readwrite');const done=transactionDone(tx);
 try{const track=await request<{id:string;assetId:string|null}|undefined>(tx.objectStore('tracks').get(trackId));const store=tx.objectStore('settings');const exists=await request(store.count(LYRICS_PREFIX+trackId));const raw=await request<unknown>(store.get(LYRICS_PREFIX+trackId));
 if(track?.id!==trackId||track.assetId!==s.assetId||(exists===1)!==s.exists||describe(raw)!==descriptor)throw new LyricsError('conflict');
 assertDatabaseUse('publish');store.put(next,LYRICS_PREFIX+trackId);await done;
 }catch(e){try{tx.abort();}catch{}await done.catch(()=>{});throw e;}
 }finally{closeDatabase(db);}
 });
 if(repairToken)repairs.delete(repairToken);
 return parsed.kind==='absent'?{state:'absent',revision:nextRevision,origin:{provenance:'manual'}}:{state:'ready',revision:nextRevision,lyrics:parsed,origin:{provenance:'manual'}};
 }catch(e){throw normalize(e);}
}

/** Result carries honest extraction status even when nothing is stored. An unrecorded
 * read (revision 0) never confirms that the file has no lyrics. Only ready text is saved. */
export type EmbeddedLyricsStoreResult={state:'preserved';reason:'manual'|'existing'}|EmbeddedLyricsInspection;
export async function storeEmbeddedLyrics(trackId:string,audioSha256:string,extract:()=>Promise<EmbeddedLyricsInspection>,expectedGeneration?:{trackRevision:number;assetRevision:number},current:()=>boolean=()=>true):Promise<EmbeddedLyricsStoreResult>{
 try{
  assertDatabaseUse('publish');if(!current())throw new LyricsError('conflict');const s=await snapshot(trackId);if(expectedGeneration&&(s.track.revision!==expectedGeneration.trackRevision||s.asset?.revision!==expectedGeneration.assetRevision))throw new LyricsError('conflict');
  if(!validAsset(s.asset)||s.asset.id!==s.assetId||s.asset.sha256!==audioSha256)throw new LyricsError('conflict');
  const descriptor=describe(s.raw);
  if(s.exists){const {record}=inspect(s.raw,trackId);return {state:'preserved',reason:record.manual?'manual':'existing'};}
  // No lock and no transaction while extracting or parsing. No automatic repair.
  assertDatabaseUse('publish');if(!current())throw new LyricsError('conflict');const result=await extract();assertDatabaseUse('publish');if(!current())throw new LyricsError('conflict');if(result.state!=='ready')return result;
  const parsed=result.format==='sylt'?parseSyltEvents(result.cues):parseLyrics(result.text,result.format);if(parsed.kind==='absent')throw new LyricsError('format');
  const source=result.source; // copy only the public source fields; never persist File/URL/provider data
  const next:LyricsRecord={version:1,trackId,revision:crypto.randomUUID(),manual:false,provenance:'embedded',format:result.format,text:parsed.text,...(result.format==='sylt'&&parsed.kind==='timed'?{cues:parsed.cues}:{}),assetId:s.asset.id,audioSha256,source:{kind:source.kind,tag:source.tag,language:source.language,descriptor:source.descriptor}};
  inspect(next,trackId);describe(next);
  if(!navigator.locks)throw new LyricsError('locks');
  await navigator.locks.request(`pulso:lyrics:v1:${trackId}`,async()=>{
   assertDatabaseUse('publish');const db=await openDatabase();try{assertDatabaseUse('publish');const tx=admittedTransaction(db,['tracks','assets','settings'],'readwrite');const done=transactionDone(tx);
    try{
     const track=await request<Track|undefined>(tx.objectStore('tracks').get(trackId));
     const asset=await request<LocalAsset|undefined>(tx.objectStore('assets').get(s.assetId!));
     const store=tx.objectStore('settings'),exists=await request(store.count(LYRICS_PREFIX+trackId)),raw=await request<unknown>(store.get(LYRICS_PREFIX+trackId));
     if(track?.id!==trackId||track.assetId!==s.assetId||track.revision!==s.track.revision||!validAsset(asset)||asset.id!==s.assetId||asset.revision!==s.asset!.revision||asset.sha256!==audioSha256||(exists===1)!==s.exists||describe(raw)!==descriptor)throw new LyricsError('conflict');
     assertDatabaseUse('publish');if(!current())throw new LyricsError('conflict');store.put(next,LYRICS_PREFIX+trackId);await done;
    }catch(e){try{tx.abort();}catch{}await done.catch(()=>{});throw e;}
   }finally{closeDatabase(db);}
  });return result;
 }catch(e){throw normalize(e);}
}
