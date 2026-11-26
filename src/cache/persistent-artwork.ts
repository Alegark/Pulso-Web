import {ARTWORK_TOUCH_INTERVAL,artworkAccountBounds,artworkOverHighWater,fitsThumbnail,selectArtworkEvictions,type ArtworkUsage} from './artwork-policy';
import type {ValidatedArtwork} from './thumbnail';

export const ARTWORK_DATABASE='pulso-web-cache-v1';
const linkKind='track-artwork-link';
const artworkStores=['artwork','catalog','meta'];
interface ArtworkRow {
 version:1;accountId:string;artworkKey:string;providerKey?:string;album?:string;
 bytes:ArrayBuffer;mime:ValidatedArtwork['mime'];width:number;height:number;sha256:string;
 byteLength:number;fetchedAt:number;lastAccessedAt:number;
}
interface Stats {accountId:string;artworkCount:number;artworkBytes:number;providerCount:number}
interface ArtworkLink {accountId:string;kind:typeof linkKind;cacheKey:string;artworkKey:string}
export interface StoredArtwork {blob:Blob;album?:string;sha256?:string;fetchedAt:number;lastAccessedAt:number}

let database:Promise<IDBDatabase>|undefined;
function openArtworkDatabase(){
 if(database)return database;
 database=new Promise<IDBDatabase>((resolve,reject)=>{
  const open=indexedDB.open(ARTWORK_DATABASE,1);
  let abandoned=false;
  const fail=(error:unknown)=>{clearTimeout(timer);abandoned=true;reject(error);};
  const timer=setTimeout(()=>fail(Error('Artwork cache open timed out')),1200);
  open.onblocked=()=>fail(Error('Artwork cache open blocked'));
  open.onerror=()=>fail(open.error);
  open.onupgradeneeded=()=>{
   if(abandoned){open.transaction?.abort();return;}
   const db=open.result;
   const artwork=db.createObjectStore('artwork',{keyPath:['accountId','artworkKey']});
   artwork.createIndex('by_account','accountId');
   artwork.createIndex('by_account_lru',['accountId','lastAccessedAt']);
   db.createObjectStore('catalog',{keyPath:['accountId','kind','cacheKey']}).createIndex('by_account','accountId');
   db.createObjectStore('meta',{keyPath:'accountId'});
  };
  open.onsuccess=()=>{
   clearTimeout(timer);
   const db=open.result;
   if(abandoned){db.close();return;}
   const close=()=>{db.close();database=undefined;};
   db.onversionchange=close;db.onclose=close;resolve(db);
  };
 }).catch(error=>{database=undefined;throw error;});
 return database;
}

function read<T>(request:IDBRequest<T>):Promise<T>{
 return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}

async function transact<T>(stores:string[],mode:IDBTransactionMode,work:(tx:IDBTransaction)=>Promise<T>,signal?:AbortSignal):Promise<T>{
 const db=await openArtworkDatabase();
 signal?.throwIfAborted();
 const tx=db.transaction(stores,mode);
 const abort=()=>{try{tx.abort();}catch{/* Already settled. */}};
 const committed=new Promise<void>((resolve,reject)=>{
  let error:unknown;
  tx.addEventListener('error',event=>{if(event.target instanceof IDBRequest)error??=event.target.error;});
  tx.oncomplete=()=>resolve();tx.onabort=()=>reject(error??tx.error);
 });
 void committed.catch(()=>{});
 signal?.addEventListener('abort',abort,{once:true});
 try{const result=await work(tx);await committed;return result;}
 catch(error){abort();await committed.catch(()=>{});throw error;}
 finally{signal?.removeEventListener('abort',abort);}
}

function deleteAccount(tx:IDBTransaction,accountId:string){
 const keys=IDBKeyRange.bound(...artworkAccountBounds(accountId));
 tx.objectStore('artwork').delete(keys);
 tx.objectStore('catalog').delete(keys);
 tx.objectStore('meta').delete(accountId);
}

export async function purgeArtworkAccount(accountId:string){
 try{await transact(artworkStores,'readwrite',async tx=>deleteAccount(tx,accountId));}
 catch{/* A storage failure must not block sign-out. Subsequent confirmed entry retries the purge. */}
}

export async function retainArtworkAccount(accountId:string,signal:AbortSignal){
 try{
  await transact(artworkStores,'readwrite',async tx=>{
   const keys=await read(tx.objectStore('meta').getAllKeys());
   for(const key of keys)if(typeof key==='string'&&key!==accountId)deleteAccount(tx,key);
  },signal);
 }catch{/* Other accounts remain unreadable by this session even if storage is unavailable. */}
}

function validRow(row:ArtworkRow|undefined):row is ArtworkRow{
 return !!row&&row.version===1&&row.bytes instanceof ArrayBuffer&&row.bytes.byteLength===row.byteLength&&fitsThumbnail(row)&&
  ['image/png','image/jpeg','image/webp'].includes(row.mime)&&/^[a-f0-9]{64}$/.test(row.sha256)&&
  Number.isFinite(row.fetchedAt)&&Number.isFinite(row.lastAccessedAt);
}

export class PersistentArtwork {
 constructor(private accountId:string,private signal:AbortSignal){}

 async get(artworkKey:string,providerKey?:string):Promise<StoredArtwork|null>{
  try{
   const row=await transact(providerKey?['artwork','catalog']:['artwork'],'readonly',async tx=>{
    if(providerKey){
     const link=await read<ArtworkLink|undefined>(tx.objectStore('catalog').get([this.accountId,linkKind,providerKey]));
     if(link?.artworkKey!==artworkKey)return undefined;
    }
    return await read<ArtworkRow|undefined>(tx.objectStore('artwork').get([this.accountId,artworkKey]));
   },this.signal);
   if(!validRow(row)||this.signal.aborted)return null;
   return {blob:new Blob([row.bytes],{type:row.mime}),album:row.album,sha256:row.sha256,fetchedAt:row.fetchedAt,lastAccessedAt:row.lastAccessedAt};
  }catch{return null;}
 }

 async touch(artworkKey:string,now:number){
  try{
   await transact(['artwork'],'readwrite',async tx=>{
    const store=tx.objectStore('artwork');
    const row=await read<ArtworkRow|undefined>(store.get([this.accountId,artworkKey]));
    if(row&&now-row.lastAccessedAt>=ARTWORK_TOUCH_INTERVAL)store.put({...row,lastAccessedAt:now});
   },this.signal);
  }catch{/* A failed touch only affects LRU order. */}
 }

 async put(artworkKey:string,image:ValidatedArtwork,now:number,provider?:{key:string;album:string}){
  try{
   const {blob,mime,width,height,sha256}=image;
   const bytes=await blob.arrayBuffer();
   if(!fitsThumbnail({width,height,byteLength:bytes.byteLength}))return;
   const row:ArtworkRow={version:1,accountId:this.accountId,artworkKey,bytes,mime,width,height,sha256,
    byteLength:bytes.byteLength,fetchedAt:now,lastAccessedAt:now,...(provider?{providerKey:provider.key,album:provider.album}:{})};
   try{await this.write(row);}
   catch(error){
    if(!(error instanceof DOMException)||error.name!=='QuotaExceededError')return;
    await transact(artworkStores,'readwrite',async tx=>{
     const old=await this.accountRows(tx);
     this.remove(tx,old.slice(0,Math.ceil(old.length/2)));
     this.stats(tx,old.slice(Math.ceil(old.length/2)));
    },this.signal);
    await this.write(row);
   }
  }catch{/* Keep validated artwork in memory if IndexedDB is unavailable or full. */}
 }

 private accountRows(tx:IDBTransaction):Promise<ArtworkRow[]>{
  return read(tx.objectStore('artwork').index('by_account_lru').getAll(IDBKeyRange.bound(...artworkAccountBounds(this.accountId))));
 }

 private remove(tx:IDBTransaction,rows:ArtworkRow[]){
  for(const row of rows){
   tx.objectStore('artwork').delete([this.accountId,row.artworkKey]);
   if(row.providerKey)tx.objectStore('catalog').delete([this.accountId,linkKind,row.providerKey]);
  }
 }

 private stats(tx:IDBTransaction,rows:ArtworkRow[]){
  const usage=rows.reduce<ArtworkUsage>((sum,row)=>{
   sum.count++;sum.bytes+=row.byteLength;if(row.providerKey)sum.providers++;return sum;
  },{count:0,bytes:0,providers:0});
  this.recordUsage(tx,usage);
 }

 private recordUsage(tx:IDBTransaction,usage:ArtworkUsage){
  tx.objectStore('meta').put({accountId:this.accountId,artworkCount:usage.count,artworkBytes:usage.bytes,providerCount:usage.providers} satisfies Stats);
 }

 private async write(row:ArtworkRow){
  await transact(artworkStores,'readwrite',async tx=>{
   const store=tx.objectStore('artwork');
   const [old,stats]=await Promise.all([
    read<ArtworkRow|undefined>(store.get([this.accountId,row.artworkKey])),
    read<Stats|undefined>(tx.objectStore('meta').get(this.accountId)),
   ]);
   if(old&&old.fetchedAt>row.fetchedAt)return;
   store.put(row);
   if(row.providerKey){
    tx.objectStore('catalog').put({accountId:this.accountId,kind:linkKind,cacheKey:row.providerKey,artworkKey:row.artworkKey} satisfies ArtworkLink);
   }
   if(stats){
    const usage:ArtworkUsage={count:stats.artworkCount+(old?0:1),bytes:stats.artworkBytes-(old?.byteLength??0)+row.byteLength,
     providers:(stats.providerCount??0)+Number(!!row.providerKey)-Number(!!old?.providerKey)};
    if(!artworkOverHighWater(usage)){this.recordUsage(tx,usage);return;}
   }
   const entries=await this.accountRows(tx);
   const victims=new Set(selectArtworkEvictions(entries));
   this.remove(tx,entries.filter(entry=>victims.has(entry.artworkKey)));
   this.stats(tx,entries.filter(entry=>!victims.has(entry.artworkKey)));
  },this.signal);
 }
}
