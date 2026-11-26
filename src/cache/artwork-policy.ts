export const THUMBNAIL_PIXELS=300;
export const THUMBNAIL_BYTES=256*1024;
export const ARTWORK_TOUCH_INTERVAL=60_000;
const day=86_400_000;

export function fitsThumbnail({width,height,byteLength}:{width:number;height:number;byteLength:number}){
 return [width,height,byteLength].every(n=>Number.isSafeInteger(n)&&n>0)&&
  width<=THUMBNAIL_PIXELS&&height<=THUMBNAIL_PIXELS&&byteLength<=THUMBNAIL_BYTES;
}

export function artworkFreshness(fetchedAt:number,now:number,online:boolean):'fresh'|'stale'|'expired'{
 const age=now-fetchedAt;
 if(!online||age<30*day)return 'fresh';
 return age<90*day?'stale':'expired';
}

export function artworkPriority(local:{state:string;manual?:boolean}):'local'|'hidden'|'remote'{
 if(local.state==='ready')return 'local';
 return local.state==='unavailable'||local.manual?'hidden':'remote';
}

export function artworkAccountBounds(accountId:string):[IDBValidKey[],IDBValidKey[]]{
 return [[accountId],[accountId,[]]];
}

export const artworkHighWater={count:800,bytes:30*1024*1024};
export const artworkLowWater={count:640,bytes:24*1024*1024};
export const providerHighWater=500;
export const providerLowWater=400;
export interface ArtworkUsage {count:number;bytes:number;providers:number}
export interface ArtworkUsageEntry {artworkKey:string;byteLength:number;lastAccessedAt:number;providerKey?:string}

export function artworkOverHighWater(usage:ArtworkUsage){
 return usage.count>artworkHighWater.count||usage.bytes>artworkHighWater.bytes||usage.providers>providerHighWater;
}

export function selectArtworkEvictions(entries:readonly ArtworkUsageEntry[]):string[]{
 const remaining=entries.reduce((total,row)=>({
  count:total.count+1,bytes:total.bytes+row.byteLength,providers:total.providers+Number(!!row.providerKey),
 }),{count:0,bytes:0,providers:0});
 if(!artworkOverHighWater(remaining))return [];
 const artworkOver=remaining.count>artworkHighWater.count||remaining.bytes>artworkHighWater.bytes;
 const providerOver=remaining.providers>providerHighWater;
 const victims:string[]=[];
 for(const row of [...entries].sort((a,b)=>a.lastAccessedAt-b.lastAccessedAt)){
  const trimArtwork=artworkOver&&(remaining.count>artworkLowWater.count||remaining.bytes>artworkLowWater.bytes);
  const trimProviders=providerOver&&remaining.providers>providerLowWater;
  if(!trimArtwork&&!trimProviders)break;
  if(!trimArtwork&&!row.providerKey)continue;
  victims.push(row.artworkKey);remaining.count--;remaining.bytes-=row.byteLength;
  if(row.providerKey)remaining.providers--;
 }
 return victims;
}
