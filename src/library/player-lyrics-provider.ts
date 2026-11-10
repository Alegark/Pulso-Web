import {readLrclib,type LrclibInput,type LrclibResult} from './lrclib';
import type {ParsedLyrics} from './lyrics-parser';

export type OnlineLyrics =
 | {state:'ready';lyrics:Exclude<ParsedLyrics,{kind:'absent'}>}
 | {state:'instrumental'} | {state:'not-found'} | {state:'unavailable'} | {state:'cancelled'};

// Only parsed results, never raw responses, live in a small, short-lived memory cache.
const cache=new Map<string,{expires:number;result:OnlineLyrics}>();
const ttl=5*60_000, maxEntries=20;
let nextRequest=0, cooldownUntil=0;
let queue:Promise<void>=Promise.resolve();
const normalized=(s:string)=>s.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu,' ').trim();
function matches(input:LrclibInput,result:LrclibResult):boolean {
 if(!('record' in result))return false;
 const r=result.record;
 return normalized(input.title)===normalized(r.title)&&normalized(input.artist)===normalized(r.artist)
  &&(!input.album||!r.album||normalized(input.album)===normalized(r.album))
  &&(input.durationSeconds==null||!Number.isFinite(input.durationSeconds)||input.durationSeconds<=0||Math.abs(input.durationSeconds-r.durationSeconds)<=5);
}
function cancelled(signal:AbortSignal,current:()=>boolean){return signal.aborted||!current();}
function delay(ms:number,signal:AbortSignal):Promise<void>{
 return new Promise(resolve=>{if(signal.aborted){resolve();return;} const timer=setTimeout(done,ms);function done(){clearTimeout(timer);signal.removeEventListener('abort',done);resolve();}signal.addEventListener('abort',done,{once:true});});
}
export async function readPlayerOnlineLyrics(input:LrclibInput,signal:AbortSignal,current:()=>boolean):Promise<OnlineLyrics> {
 if(!input.title.trim()||!input.artist.trim()||cancelled(signal,current))return {state:'cancelled'};
 const key=JSON.stringify([input.title,input.artist,input.album??null,input.durationSeconds??null]);
 const cached=cache.get(key);
 if(cached&&cached.expires>Date.now())return cached.result;
 if(cached)cache.delete(key);
 let release!:()=>void;
 const previous=queue;queue=new Promise<void>(resolve=>{release=resolve;});
 try {
  await previous;
  if(cancelled(signal,current))return {state:'cancelled'};
  if(Date.now()<cooldownUntil)return {state:'unavailable'};
  await delay(Math.max(0,nextRequest-Date.now()),signal);
  if(cancelled(signal,current))return {state:'cancelled'};
  // A previous queued operation may have populated the cache.
  const existing=cache.get(key);if(existing&&existing.expires>Date.now())return existing.result;
  if(Date.now()<cooldownUntil)return {state:'unavailable'};
  nextRequest=Date.now()+1000;
  const response=await readLrclib(input,{enabled:true,signal,current});
  if(cancelled(signal,current)||response.state==='cancelled')return {state:'cancelled'};
  if(response.state==='unavailable'){
   if(response.reason==='rate-limited'||response.reason==='service-unavailable')cooldownUntil=Date.now()+Math.max(1000,(response.retryAfterSeconds??60)*1000);
   return {state:'unavailable'};
  }
  let result:OnlineLyrics={state:'not-found'};
  if(matches(input,response)&&'record' in response){
   const record=response.record;
   if(record.instrumental)result={state:'instrumental'};
   else {const lyrics=record.syncedLyrics?.kind==='timed'?record.syncedLyrics:record.plainLyrics;
    if(lyrics&&lyrics.kind!=='absent')result={state:'ready',lyrics};}
  }
  if(cache.size>=maxEntries)cache.delete(cache.keys().next().value!);
  cache.set(key,{expires:Date.now()+ttl,result});return result;
 } finally {release();}
}
