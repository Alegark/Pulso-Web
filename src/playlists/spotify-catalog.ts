import {ACTIVE_LIBRARY_ACCOUNT} from '../accounts/library-local';
import {catalogSongsFromBatch} from '../library/album-catalog';
import {searchArtwork} from '../library/catalog-artwork';
import {copyCatalogRelease,searchedITunesRelease,trackCatalogRelease,type CatalogRelease} from '../library/catalog-release';
import type {Playlist,Track} from '../library/library';
import {musicCatalogKey} from '../library/music-search-catalog';
import {WRITER_LOCK} from '../storage/asset-reader';
import {admittedTransaction, closeDatabase, openExistingDatabase, request} from '../storage/database';
import {transactionDone} from '../storage/transaction-done';

const credit=(value:string)=>musicCatalogKey(value).replace(/\s+(?:&|and)\s+|,\s*/gu, ' & ');
type ITunesRelease=Extract<CatalogRelease,{source:'itunes'}>;
type SpotifyRelease=Extract<CatalogRelease,{source:'spotify'}>;
export function matchSpotifyCatalogRelease(track:Track,data:unknown,exact?:SpotifyRelease):ITunesRelease|null {
 const song=track.catalogChoice?.source==='spotify'?track.catalogChoice:track;
 const {title,artist,duration}=song;
 if(!artist||!duration||Object.keys(track.manualOverrides??{}).length)return null;
 const count=data&&typeof data==='object'?Object.getOwnPropertyDescriptor(data,'resultCount')?.value:null;
 if(typeof count==='number'&&count>=200)return null;
 const matches=catalogSongsFromBatch(data).filter(row=>musicCatalogKey(row.title)===musicCatalogKey(title)&&
  credit(row.artist)===credit(artist)&&Math.abs(row.durationMs-duration*1000)<=5000&&
  (!track.album||musicCatalogKey(track.album)===musicCatalogKey(row.album))&&
  (!exact||musicCatalogKey(exact.title)===musicCatalogKey(row.album)&&exact.position===row.position&&
   (!exact.artist||!row.primaryArtist||credit(exact.artist)===credit(row.primaryArtist))));
 if(matches.length!==1)return null;
 const match=matches[0];
 const release=copyCatalogRelease({source:'itunes',releaseId:match.releaseId,trackId:match.trackId,disc:match.disc,position:match.position,
  title:match.album,artist:match.primaryArtist??null,...(match.artworkUrl?{artworkUrl:match.artworkUrl}:{})});
 return release?.source==='itunes'?release:null;
}

const CACHE='spotify-catalog-release';
const releaseKey=(accountId:string,trackId:string)=>[CACHE,1,accountId,trackId];
interface CachedRelease {input:string;release:CatalogRelease}

function matchInput(track:Track):string {
 const choice=track.catalogChoice;
 return JSON.stringify([track.title,track.artist,track.album,choice?.source==='spotify'?choice.duration:track.duration,choice?.id,choice?.source,choice?.title,
  choice?.artist,choice?.album,choice?.duration]);
}
function readCachedRelease(value:unknown):CachedRelease|null {
 if(!value||typeof value!=='object')return null;
 const {input,release}=value as CachedRelease;
 const supported=copyCatalogRelease(release);
 return typeof input==='string'&&input.length<=6000&&supported?{input,release:supported}:null;
}
async function cachedReleases(store:IDBObjectStore,accountId:string):Promise<Map<string,CachedRelease>> {
 const range=IDBKeyRange.bound([CACHE,1,accountId],[CACHE,1,accountId,[]]);
 const [keys,values]=await Promise.all([request<IDBValidKey[]>(store.getAllKeys(range,10001)),request<unknown[]>(store.getAll(range,10001))]);
 const result=new Map<string,CachedRelease>();
 if(keys.length>10000)return result;
 keys.forEach((key,i)=>{
  const record=readCachedRelease(values[i]);
  if(record&&Array.isArray(key)&&typeof key[3]==='string')result.set(key[3],record);
 });
 return result;
}
function attachRelease(track:Track,cache:Map<string,CachedRelease>):Track {
 const stored=cache.get(track.id);
 return stored?.input===matchInput(track)?{...track,catalogRelease:stored.release}:track;
}
/** Catalogue descriptors only decorate the local view. Track records, worker
 * messages and the closed account backup format retain their existing schema. */
export async function projectSpotifyReleases(store:IDBObjectStore,rows:Track[],accountId:string):Promise<Track[]> {
 const cache=await cachedReleases(store,accountId);
 return cache.size?rows.map(track=>track.accountId===accountId?attachRelease(track,cache):track):rows;
}
export async function tracksWithSpotifyReleases(rows:Track[],accountId:string):Promise<Track[]> {
 const db=await openExistingDatabase();
 try{
  const tx=admittedTransaction(db,'settings'),done=transactionDone(tx);
  const view=await projectSpotifyReleases(tx.objectStore('settings'),rows,accountId);
  await done;return view;
 }finally{closeDatabase(db);}
}

interface Candidate {track:Track;spotifyId:string|null}
async function playlistTracks(accountId:string,listId:string,current:()=>boolean):Promise<{rows:Candidate[];appleAlbums:ReadonlySet<string>}> {
 const db=await openExistingDatabase();
 try{
  if(!current())return {rows:[],appleAlbums:new Set()};
  const tx=admittedTransaction(db,['tracks','playlists','settings']),done=transactionDone(tx);
  const list=await request<Playlist|undefined>(tx.objectStore('playlists').get(listId));
  const active=await request(tx.objectStore('settings').get(ACTIVE_LIBRARY_ACCOUNT));
  if(list?.accountId!==accountId||active!==accountId){await done;return {rows:[],appleAlbums:new Set()};}
  const settings=tx.objectStore('settings'),store=tx.objectStore('tracks');
  const range=IDBKeyRange.bound(['spotify-track',1,accountId],['spotify-track',1,accountId,[]]);
  const [keys,aliases,tracks,cache]=await Promise.all([
   request<IDBValidKey[]>(settings.getAllKeys(range,10001)),
   request<string[]>(settings.getAll(range,10001)),
   request<Track[]>(store.getAll()),
   cachedReleases(settings,accountId),
  ]);
  await done;
  const ids=new Map<string,Set<string>>();
  if(keys.length<=10000)keys.forEach((key,index)=>{
   const id=Array.isArray(key)&&typeof key[3]==='string'?/^spotify:([A-Za-z0-9]{22})$/.exec(key[3])?.[1]:null;
   if(!id)return;
   const trackId=aliases[index],known=ids.get(trackId);
   if(known)known.add(id);else ids.set(trackId,new Set([id]));
  });
  const owned=tracks.filter(t=>t.accountId===accountId),byId=new Map(owned.map(t=>[t.id,t]));
  const appleAlbums=new Set(owned.filter(t=>searchedITunesRelease(t)!==null)
   .map(t=>musicCatalogKey(t.catalogChoice!.album!)));
  return {appleAlbums,rows:list.entries.flatMap(({trackId})=>{
   const track=byId.get(trackId);if(!track)return [];
   const direct=track.catalogChoice?.source==='spotify'?/^spotify:([A-Za-z0-9]{22})$/.exec(track.catalogChoice.id)?.[1]:null;
   const aliases=ids.get(track.id);
   return direct||aliases?.size===1?[{track:attachRelease(track,cache),spotifyId:direct??[...aliases!][0]}]:[];
  })};
 }finally{closeDatabase(db);}
}

async function saveRelease(track:Track,release:CatalogRelease,accountId:string,listId:string,current:()=>boolean):Promise<boolean> {
 return navigator.locks.request(WRITER_LOCK,async()=>{
  if(!current())return false;
  const db=await openExistingDatabase();
  try{
   if(!current())return false;
   const tx=admittedTransaction(db,['tracks','settings','playlists'],'readwrite'),done=transactionDone(tx),store=tx.objectStore('tracks');
   try{
    const [latest,active,list,saved]=await Promise.all([
     request<Track|undefined>(store.get(track.id)),request(tx.objectStore('settings').get(ACTIVE_LIBRARY_ACCOUNT)),
     request<Playlist|undefined>(tx.objectStore('playlists').get(listId)),
     request(tx.objectStore('settings').get(releaseKey(accountId,track.id))),
    ]);
    const input=matchInput(track),previous=readCachedRelease(saved);
    const changed=previous?.input===input&&JSON.stringify(previous.release)!==JSON.stringify(copyCatalogRelease(track.catalogRelease));
    if(!current()||active!==accountId||!latest||latest.id!==track.id||latest.accountId!==accountId||
     Object.keys(latest.manualOverrides??{}).length||matchInput(latest)!==input||changed||
     list?.accountId!==accountId||!list.entries.some(entry=>entry.trackId===track.id)){await done;return false;}
    tx.objectStore('settings').put({input,release} satisfies CachedRelease,releaseKey(accountId,latest.id));
    await done;return true;
   }catch(error){try{tx.abort();}catch{/* Already settled. */}await done.catch(()=>{});throw error;}
  }finally{closeDatabase(db);}
 });
}


export async function readSpotifyRelease(id:string,signal:AbortSignal):Promise<SpotifyRelease|null>{
 if(!/^[A-Za-z0-9]{22}$/.test(id))return null;
 try{
  const response=await fetch('/api/spotify-track/'+id,{signal,credentials:'omit',cache:'no-store'});
  if(!response.ok)return null;
  const release=copyCatalogRelease(await response.json());
  return release?.source==='spotify'&&release.trackId===id?release:null;
 }catch{return null;}
}

export interface SpotifyCatalogProgress {total:number;checked:number;linked:number;covers:number}
export async function enrichSpotifyPlaylist(
 accountId:string,listId:string,signal:AbortSignal,current:()=>boolean,update:(progress:SpotifyCatalogProgress)=>void,
 search:typeof searchArtwork=searchArtwork, spotify:typeof readSpotifyRelease=readSpotifyRelease,
):Promise<SpotifyCatalogProgress> {
 const live=()=>!signal.aborted&&current();
 const {rows,appleAlbums}=await playlistTracks(accountId,listId,live);
 const progress={total:rows.length,checked:0,linked:0,covers:0};
 for(const {track,spotifyId} of rows){
  if(!live())break;
  let release=trackCatalogRelease(track);
  const appleNeeded=(value:SpotifyRelease)=>!value.artworkUrl||!value.itunesReleaseId&&appleAlbums.has(musicCatalogKey(value.title));
  if((!release||!release.artworkUrl||release.source==='spotify'&&appleNeeded(release))&&!Object.keys(track.manualOverrides??{}).length){
   let exact=release?.source==='spotify'?release:spotifyId?await spotify(spotifyId,signal):null;
   if(!live())break;
   if(exact&&track.album&&musicCatalogKey(track.album)!==musicCatalogKey(exact.title))exact=null;
   const song=track.catalogChoice?.source==='spotify'?track.catalogChoice:track;
   let apple:ITunesRelease|null=null;
   if((!exact||appleNeeded(exact))&&song.artist&&song.duration){
    const query=[song.title,song.artist].join(' ');
    const data=await search(query.length<=160?query:song.title,signal);
    if(!live())break;
    apple=matchSpotifyCatalogRelease(track,data,exact??undefined);
   }
   const match=exact?apple?{...exact,itunesReleaseId:apple.releaseId,...(apple.artworkUrl&&!exact.artworkUrl?{artworkUrl:apple.artworkUrl}:{})}:exact:apple;
   if(match&&JSON.stringify(match)!==JSON.stringify(release)&&await saveRelease(track,match,accountId,listId,live))release=match;
  }
  progress.checked++;
  if(release){progress.linked++;if(release.artworkUrl)progress.covers++;}
  if(live())update({...progress});
 }
 return progress;
}
