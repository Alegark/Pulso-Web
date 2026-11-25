export interface CachedPlayerArtwork {
 readonly blob:Blob;
 readonly album:string;
}

const maxEntries=8;
const maxBytes=8*1024*1024;
type Entry=CachedPlayerArtwork & {readonly stamp:symbol};

/** Holds decoded provider artwork for the current library scope. Views own their object URLs. */
export class PlayerArtworkCache {
 private entries=new Map<string,Entry>();
 private bytes=0;
 private listeners=new Set<()=>void>();

 get(key:string){return this.entries.get(key);}

 subscribe=(listener:()=>void)=>{
  this.listeners.add(listener);
  return ()=>{this.listeners.delete(listener);};
 };

 set(key:string,artwork:CachedPlayerArtwork){
  if(artwork.blob.size>maxBytes)return;
  const previous=this.entries.get(key);
  if(previous?.blob===artwork.blob&&previous.album===artwork.album)return;
  if(previous){
   this.bytes-=previous.blob.size;
   this.entries.delete(key);
  }
  this.entries.set(key,{...artwork,stamp:Symbol()});
  this.bytes+=artwork.blob.size;
  for(const [oldest,entry] of this.entries){
   if(this.entries.size<=maxEntries&&this.bytes<=maxBytes)break;
   this.entries.delete(oldest);
   this.bytes-=entry.blob.size;
  }
  for(const listener of this.listeners)listener();
 }
}
