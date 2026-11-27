import {ACTIVE_LIBRARY_ACCOUNT} from '../accounts/library-local';
import {admittedTransaction,closeDatabase,openExistingDatabase,request} from '../storage/database';
import {WRITER_LOCK} from '../storage/asset-reader';
import {transactionDone} from '../storage/transaction-done';
import {dataArray,dataRecord} from '../telegram/sources-protocol';
import type {AlbumDetail,AlbumTrack} from './album-catalog';
import {albumTrackChoice} from './album-acquisition';
import {musicBrainzArtworkUrl,musicBrainzId,type CatalogId} from './catalog-id';
import {albumEditionId} from './catalog-release';
import {createSongResolver,type SongAliases} from './selected-song';
import {groupAlbums,orderAlbumRows} from './groups';
import type {Track} from './library';
import {artworkUrl} from './player-artwork-provider';

export interface SavedAlbum extends AlbumDetail {
 version:1;
 savedAt:string;
 failedTracks:string[];
}

const LIMIT=500;
export class SavedAlbumLimitError extends Error {
 constructor(){super('saved-album-limit');}
}
export type SaveAlbumResult={state:'saved';album:SavedAlbum}|{state:'limit'|'unavailable'};
export interface SavedAlbumFailures { savedAt:string; failedTracks:string[] }

const prefix = (accountId:string) => ['saved-catalog-album',accountId];
export const savedAlbumKey = (accountId:string,id:CatalogId):IDBValidKey => [...prefix(accountId),id];
export const savedAlbumGroupKey = (id:CatalogId) => JSON.stringify(['saved-catalog-album',id]);
const range = (accountId:string) => IDBKeyRange.bound(prefix(accountId),[...prefix(accountId),[]]);
const positive = (v:unknown,max=Number.MAX_SAFE_INTEGER):v is number => typeof v==='number'&&Number.isSafeInteger(v)&&v>0&&v<=max;
const text = (v:unknown):v is string => typeof v==='string'&&!!v.trim()&&v.length<=300&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
const date = (v:unknown):v is string => typeof v==='string'&&v.length===24&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const fields = (value:unknown,allowed:readonly string[]) => {
 const row=dataRecord(value);
 return row&&Object.keys(row).every(key=>allowed.includes(key))?row:null;
};

export function copySavedAlbum(value:unknown,expectedId?:CatalogId):SavedAlbum|null {
 const row=dataRecord(value,['version','savedAt','edition','tracks','failedTracks']);
 if(!row||row.version!==1||!date(row.savedAt))return null;
 const edition=fields(row.edition,['id','title','artist','trackCount','releaseDate','artworkUrl']);
 const list=dataArray(row.tracks,200),failed=dataArray(row.failedTracks,200);
 if(!edition||!list?.length||!failed||edition.trackCount!==list.length||
  !(positive(edition.id)||musicBrainzId(edition.id))||(expectedId!==undefined&&edition.id!==expectedId)||
  !text(edition.title)||!text(edition.artist)||!(edition.releaseDate===null||text(edition.releaseDate)))return null;
 const id=edition.id,mb=musicBrainzId(id);
 const image=edition.artworkUrl===undefined?null:mb?musicBrainzArtworkUrl(edition.artworkUrl):artworkUrl(edition.artworkUrl);
 if(edition.artworkUrl!==undefined&&(!image||mb&&new URL(image).searchParams.get('id')!==id.slice(12)))return null;
 const tracks:AlbumTrack[]=[],positions=new Set<string>(),choiceIds=new Set<string>();
 for(const input of list){
  const t=fields(input,['releaseId','trackId','disc','position','title','artist','durationMs','primaryArtist']);
  if(!t||t.releaseId!==id||!(mb?musicBrainzId(t.trackId):positive(t.trackId))||
   !positive(t.disc,mb?200:20)||!positive(t.position,200)||!text(t.title)||!text(t.artist)||
   !(t.durationMs===null||positive(t.durationMs,86400000))||
   !(t.primaryArtist===undefined||text(t.primaryArtist)))return null;
  const position=t.disc+':'+t.position;
  if(positions.has(position))return null;
  positions.add(position);
  const track:AlbumTrack={releaseId:id,trackId:t.trackId as CatalogId,disc:t.disc,position:t.position,
   title:t.title,artist:t.artist,durationMs:t.durationMs,...(t.primaryArtist?{primaryArtist:t.primaryArtist}:{})};
  tracks.push(track);
  choiceIds.add(albumTrackChoice(track,edition.title).id);
 }
 const failedTracks:string[]=[];
 for(const key of failed){
  if(typeof key!=='string'||!choiceIds.has(key)||failedTracks.includes(key))return null;
  failedTracks.push(key);
 }
 tracks.sort((a,b)=>a.disc-b.disc||a.position-b.position);
 return {version:1,savedAt:row.savedAt,edition:{id,title:edition.title,artist:edition.artist,trackCount:list.length,
  releaseDate:edition.releaseDate,...(image?{artworkUrl:image}:{})},tracks,failedTracks};
}

export async function readSavedAlbumsFrom(store:IDBObjectStore,accountId:string):Promise<SavedAlbum[]> {
 const keys=await request(store.getAllKeys(range(accountId),LIMIT));
 const values=await request(store.getAll(range(accountId),LIMIT));
 return values.flatMap((value,index)=>{
  const key=keys[index];
  if(!Array.isArray(key)||key.length!==3||!(positive(key[2])||musicBrainzId(key[2])))return [];
  const album=copySavedAlbum(value,key[2]);
  return album?[album]:[];
 });
}

export async function readSavedAlbums(accountId:string):Promise<SavedAlbum[]> {
 const db=await openExistingDatabase();
 try{
  const tx=admittedTransaction(db,['settings']),done=transactionDone(tx);
  const albums=await readSavedAlbumsFrom(tx.objectStore('settings'),accountId);
  await done;
  return albums;
 }finally{closeDatabase(db);}
}

export async function readSavedAlbum(accountId:string,id:CatalogId):Promise<SavedAlbum|null> {
 const db=await openExistingDatabase();
 try{
  const tx=admittedTransaction(db,['settings']),done=transactionDone(tx),store=tx.objectStore('settings');
  const [active,raw]=await Promise.all([request(store.get(ACTIVE_LIBRARY_ACCOUNT)),request(store.get(savedAlbumKey(accountId,id))),done]);
  if(active!==accountId)throw Error('account-changed');
  return copySavedAlbum(raw,id);
 }finally{closeDatabase(db);}
}

export async function saveAlbumRecord(accountId:string,detail:AlbumDetail,current:()=>boolean,failure?:SavedAlbumFailures):Promise<SavedAlbum|null> {
 const record=copySavedAlbum({version:1,savedAt:new Date().toISOString(),edition:detail.edition,tracks:detail.tracks,failedTracks:failure?.failedTracks??[]});
 if(!record||!current())throw Error('saved-album');
 return navigator.locks.request(WRITER_LOCK,async()=>{
  if(!current())throw Error('account-changed');
  const db=await openExistingDatabase();
  try{
   const tx=admittedTransaction(db,['settings'],'readwrite'),done=transactionDone(tx),store=tx.objectStore('settings');
   try{
    const key=savedAlbumKey(accountId,record.edition.id);
    const [active,raw]=await Promise.all([request(store.get(ACTIVE_LIBRARY_ACCOUNT)),request(store.get(key))]);
    if(!current()||active!==accountId)throw Error('account-changed');
    const previous=copySavedAlbum(raw,record.edition.id);
    if(failure&&(!previous||previous.savedAt!==failure.savedAt||JSON.stringify([previous.edition,previous.tracks])!==JSON.stringify([record.edition,record.tracks]))){
     await done;
     return null;
    }
    if(previous&&!failure){await done;return previous;}
    if(raw===undefined){
     const count=await request(store.count(range(accountId)));
     if(!current())throw Error('account-changed');
     if(count>=LIMIT)throw new SavedAlbumLimitError();
    }
    const next=previous?{...previous,failedTracks:record.failedTracks}:record;
    store.put(next,key);
    await done;
    return next;
   }catch(error){try{tx.abort();}catch{/* Already settled. */}await done.catch(()=>{});throw error;}
  }finally{closeDatabase(db);}
 });
}

export function resolvedAlbumTracks(detail:AlbumDetail,resolve:ReturnType<typeof createSongResolver>){
 return detail.tracks.map(track=>{
  const choice=albumTrackChoice(track,detail.edition.title);
  try{return {choice,trackId:resolve(choice)};}catch{return {choice,trackId:null};}
 });
}

export function libraryAlbumCards(tracks:readonly Track[],albums:readonly SavedAlbum[],aliases?:SongAliases|null,allTracks=tracks){
 const resolve=createSongResolver(allTracks,aliases);
 const included=new Set(tracks.map(track=>track.id));
 const saved=albums.map(album=>{
  const resolved=resolvedAlbumTracks(album,resolve);
  return {
  saved:true as const,key:savedAlbumGroupKey(album.edition.id),label:album.edition.title,artist:album.edition.artist,
  editionId:album.edition.id,artworkUrl:album.edition.artworkUrl,count:album.tracks.length,
  coverTrackIds:resolved.flatMap(({trackId})=>trackId?[trackId]:[]),
  trackIds:resolved.flatMap(({trackId})=>trackId&&included.has(trackId)?[trackId]:[]),
 };});
 const covered=new Set(saved.flatMap(album=>album.trackIds));
 const local=tracks.filter(track=>!covered.has(track.id));
 const index=new Map(local.map(track=>[track.id,track]));
 return [...saved,...groupAlbums(local).filter(group=>!group.unknown).map(group=>{
  const ordered=orderAlbumRows(group.trackIds.map(id=>({track:index.get(id)!}))).map(row=>row.track);
  const editions=new Set(ordered.map(albumEditionId).filter(id=>id!==null));
  return {...group,saved:false as const,count:group.trackIds.length,trackIds:ordered.map(t=>t.id),
   editionId:editions.size===1?[...editions][0]:undefined};
 })];
}


// Includes shared tracks even when two different roster entries resolve to the same TrackId.
export function albumRemovalMembership(cards:ReturnType<typeof libraryAlbumCards>,key:string){
 const selected=cards.find(card=>card.key===key);
 const otherSavedTrackIds=new Set(cards.flatMap(card=>card.saved&&card.key!==key?card.trackIds:[]));
 const detach=selected?.trackIds.filter(id=>!otherSavedTrackIds.has(id))??[];
 return {selected,otherSavedTrackIds,detach};
}
