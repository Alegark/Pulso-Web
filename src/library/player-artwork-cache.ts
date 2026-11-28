import {ARTWORK_TOUCH_INTERVAL,artworkFreshness} from '../cache/artwork-policy';
import {PersistentArtwork,type StoredArtwork} from '../cache/persistent-artwork';
import {musicCatalogKey} from './music-search-catalog';
import {artworkThumbnail,type ValidatedArtwork} from '../cache/thumbnail';

export function albumArtworkKey(metadata:{editionId?:string|number|null;album?:string|null;artist?:string|null;albumArtist?:string|null}):string|undefined{
 if(metadata.editionId!==undefined&&metadata.editionId!==null&&String(metadata.editionId).trim())return `edition:${String(metadata.editionId)}`;
 const artist=musicCatalogKey(metadata.albumArtist?.trim()||metadata.artist?.trim()||'');
 const album=musicCatalogKey(metadata.album?.trim()||'');
 return artist&&album?`album:${artist}:${album}`:undefined;
}

export interface CachedPlayerArtwork {
 readonly blob:Blob;
 readonly album:string;
}
type Entry=StoredArtwork & {readonly stamp:symbol};
type ProviderEntry=Entry & CachedPlayerArtwork;
const maxEntries=64;
const maxBytes=8*1024*1024;
const providerKey=(key:string)=>'provider:'+key;
const online=()=>globalThis.navigator?.onLine!==false;
const canRefresh=()=>online()&&globalThis.document?.visibilityState!=='hidden';

export class PlayerArtworkCache {
 private controller=new AbortController();
 readonly signal=this.controller.signal;
 private storage?:PersistentArtwork;
 private entries=new Map<string,Entry>();
 private bytes=0;
 private listeners=new Set<()=>void>();
 private reads=new Map<string,Promise<Entry|undefined>>();
 private flights=new Map<string,Promise<Blob|null>>();

 constructor(accountId?:string){
  if(accountId)this.storage=new PersistentArtwork(accountId,this.signal);
 }

 get(key:string):ProviderEntry|undefined{
  const entry=this.entries.get(providerKey(key));
  if(entry?.album&&artworkFreshness(entry.fetchedAt,Date.now(),online())!=='expired')return entry as ProviderEntry;
 }

 subscribe=(listener:()=>void)=>{
  this.listeners.add(listener);
  return ()=>{this.listeners.delete(listener);};
 };

 retire(){
  this.controller.abort();
  this.entries.clear();this.bytes=0;this.reads.clear();this.flights.clear();
  for(const listener of this.listeners)listener();
  this.listeners.clear();
 }

 async preload(keys:readonly string[]):Promise<void>{
  if(this.signal.aborted||!this.storage)return;
  const missing=[...new Set(keys)].filter(key=>!this.entries.has(key)).slice(0,maxEntries);
  if(!missing.length)return;
  const stored=await this.storage.getMany(missing);
  if(this.signal.aborted)return;
  for(const [key,entry] of stored)if(!this.entries.has(key))this.remember(key,entry,false);
 }

 async readProvider(key:string):Promise<ProviderEntry|undefined>{
  await this.read(providerKey(key),key);
  return this.get(key);
 }

 set(key:string,artwork:CachedPlayerArtwork,now=Date.now(),sha256?:string){
  return this.remember(providerKey(key),{...artwork,sha256,fetchedAt:now,lastAccessedAt:now}).blob;
 }

 async saveProvider(key:string,album:string,image:ValidatedArtwork):Promise<Blob|null>{
  const thumbnail=await artworkThumbnail(image);
  if(this.signal.aborted)return null;
  const now=Date.now(),blob=thumbnail?.blob??image.blob;
  if(thumbnail)await this.storage?.put(providerKey(key),thumbnail,now,{key,album});
  if(this.signal.aborted)return null;
  return this.set(key,{blob,album},now,(thumbnail??image).sha256);
 }

 async loadCatalog(key:string,fetchImage:()=>Promise<ValidatedArtwork|null>,onRefresh?:(blob:Blob)=>void):Promise<Blob|null>{
  const entry=await this.read(key);
  if(this.signal.aborted)return null;
  const freshness=entry&&artworkFreshness(entry.fetchedAt,Date.now(),online());
  if(entry&&freshness==='fresh')return entry.blob;
  if(entry&&freshness==='stale'){
   if(canRefresh())void this.refreshCatalog(key,fetchImage).then(blob=>{
    if(blob&&blob!==entry.blob&&!this.signal.aborted)onRefresh?.(blob);
   }).catch(()=>{});
   return entry.blob;
  }
  if(!online())return entry?.blob??null;
  return this.refreshCatalog(key,fetchImage);
 }

 private refreshCatalog(key:string,fetchImage:()=>Promise<ValidatedArtwork|null>){
  const pending=this.flights.get(key);
  if(pending)return pending;
  if(this.flights.size>=80)return Promise.resolve(null);
  const flight=(async()=>{
   const image=await fetchImage();
   if(!image||this.signal.aborted)return null;
   const thumbnail=await artworkThumbnail(image);
   if(this.signal.aborted)return null;
   const now=Date.now(),blob=thumbnail?.blob??image.blob;
   if(thumbnail)await this.storage?.put(key,thumbnail,now);
   if(this.signal.aborted)return null;
   return this.remember(key,{blob,sha256:(thumbnail??image).sha256,fetchedAt:now,lastAccessedAt:now}).blob;
  })().catch(()=>null).finally(()=>{this.flights.delete(key);});
  this.flights.set(key,flight);
  return flight;
 }

 private async read(key:string,provider?:string):Promise<Entry|undefined>{
  if(this.signal.aborted)return undefined;
  const memory=this.entries.get(key);
  if(memory){this.access(key,memory);return memory;}
  const pending=this.reads.get(key);
  if(pending)return pending;
  if(!this.storage)return undefined;
  const hydration=this.storage.get(key,provider).then(stored=>{
   if(!stored||this.signal.aborted)return undefined;
   const entry=this.entries.get(key)??this.remember(key,stored);
   this.access(key,entry);
   return entry;
  }).finally(()=>{this.reads.delete(key);});
  this.reads.set(key,hydration);
  return hydration;
 }

 private access(key:string,entry:Entry){
  this.entries.delete(key);
  this.entries.set(key,entry);
  const now=Date.now();
  if(now-entry.lastAccessedAt<ARTWORK_TOUCH_INTERVAL)return;
  entry.lastAccessedAt=now;
  void this.storage?.touch(key,now);
 }

 private remember(key:string,artwork:StoredArtwork,notify=true){
  const entry={...artwork,stamp:Symbol()};
  if(this.signal.aborted||artwork.blob.size>maxBytes)return entry;
  const previous=this.entries.get(key);
  if(previous&&previous.album===artwork.album&&
   (previous.blob===artwork.blob||artwork.sha256&&previous.sha256===artwork.sha256)){
   previous.fetchedAt=artwork.fetchedAt;this.access(key,previous);return previous;
  }
  if(previous){
   this.bytes-=previous.blob.size;
   this.entries.delete(key);
  }
  this.entries.set(key,entry);
  this.bytes+=artwork.blob.size;
  let changed=!!entry.album;
  for(const [oldest,old] of this.entries){
   if(this.entries.size<=maxEntries&&this.bytes<=maxBytes)break;
   this.entries.delete(oldest);
   this.bytes-=old.blob.size;
   changed||=!!old.album;
  }
  if(changed&&notify)for(const listener of this.listeners)listener();
  return entry;
 }
}
