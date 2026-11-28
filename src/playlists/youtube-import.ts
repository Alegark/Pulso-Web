/** YouTube playlist -> Pulso playlist in Biblioteca, the same way the Spotify importer does it.
 * Songs already in the library (same title + artist) are reused, so downloaded copies count at once.
 * New songs are metadata-only tracks; the collection download fetches them from the bot afterwards. */
import {ACTIVE_LIBRARY_ACCOUNT} from '../accounts/library-local';
import {libraryUuid,LIBRARY_LIMITS} from '../accounts/library-document.mjs';
import {type Playlist,type Track} from '../library/library';
import {libraryMembershipKey,makeLibraryMembership} from '../library/library-membership';
import {musicCatalogKey} from '../library/music-search-catalog';
import {WRITER_LOCK} from '../storage/asset-reader';
import {admittedTransaction,closeDatabase,openExistingDatabase,request} from '../storage/database';
import {transactionDone} from '../storage/transaction-done';

export interface YoutubeSong {readonly title:string;readonly artist:string}
export interface YoutubeImportInput {readonly listId:string;readonly name:string;readonly songs:readonly YoutubeSong[]}
export interface YoutubeImportResult {playlist:Playlist;created:number;reused:number;repeated:number;updated:boolean}

const songKey=(title:string,artist:string|null)=>artist?JSON.stringify([musicCatalogKey(title),musicCatalogKey(artist)]):null;
const text=(value:unknown,max:number)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)?value.trim():'';

export async function importYoutubePlaylist(data:YoutubeImportInput,accountId:string,current:()=>boolean,isAvailable:(trackId:string)=>boolean=()=>false):Promise<YoutubeImportResult> {
 const check=()=>{if(!current())throw Error('La importación ya no está vigente.');};
 check();
 if(!/^[A-Za-z0-9_-]{10,64}$/.test(data.listId))throw Error('Enlace de YouTube inválido.');
 const name=(text(data.name,500)||'Playlist de YouTube').slice(0,100).replace(/[\uD800-\uDBFF]$/u,'').trimEnd();
 return navigator.locks.request(WRITER_LOCK,async()=>{
  check();
  const db=await openExistingDatabase();
  try{
   check();
   const tx=admittedTransaction(db,['tracks','playlists','settings'],'readwrite'),done=transactionDone(tx);
   try{
    const tracks=tx.objectStore('tracks'),playlists=tx.objectStore('playlists'),settings=tx.objectStore('settings');
    const listKey=['youtube-playlist',1,accountId,data.listId];
    const aliasRange=IDBKeyRange.bound(
     ['youtube-track',1,accountId,''],
     ['youtube-track',1,accountId,'\uffff'],
    );
    const [active,rows,lists,previousListId,aliasKeys,aliasValues]=await Promise.all([
     request(settings.get(ACTIVE_LIBRARY_ACCOUNT)),
     request<Track[]>(tracks.getAll()),
     request<Playlist[]>(playlists.getAll()),
     request<string|undefined>(settings.get(listKey)),
     request<IDBValidKey[]>(settings.getAllKeys(aliasRange)),
     request<unknown[]>(settings.getAll(aliasRange)),
    ]);
    check();
    if(!libraryUuid(accountId)||active!==accountId)throw Error('La cuenta de Pulso ha cambiado.');
    const owned=rows.filter(track=>track.accountId===accountId);
    const byId=new Map(owned.map(track=>[track.id,track]));
    const aliases=new Map<string,string>();
    for(let index=0;index<aliasKeys.length;index++){
     const key=aliasKeys[index],value=aliasValues[index];
     if(Array.isArray(key)&&key.length===4&&key[0]==='youtube-track'&&key[1]===1&&key[2]===accountId&&
      typeof key[3]==='string'&&typeof value==='string')aliases.set(key[3],value);
    }
    const bySong=new Map<string,Track[]>();
    for(const track of owned){
     const key=songKey(track.manualOverrides?.title??track.title,'artist' in (track.manualOverrides??{})?track.manualOverrides.artist??null:track.artist);
     if(!key)continue;
     const group=bySong.get(key);if(group)group.push(track);else bySong.set(key,[track]);
    }
    // Prefer a copy that is already on this device when the same song exists more than once.
    const pick=(group:Track[])=>group.find(track=>isAvailable(track.id))??group.find(track=>track.assetId)??(group.length===1?group[0]:undefined);
    const entries:Playlist['entries']=[],seen=new Set<string>(),used=new Set<string>(),newTracks:Track[]=[];
    let reused=0,repeated=0;
    for(const song of data.songs){
     const title=text(song.title,300),artist=text(song.artist,300);
     const key=title&&artist?songKey(title,artist):null;
     if(!key){repeated++;continue;}
     if(seen.has(key)){repeated++;continue;}
     seen.add(key);
     const aliasKey=['youtube-track',1,accountId,key];
     const alias=aliases.get(key);
     let track=(alias?byId.get(alias):undefined)??pick(bySong.get(key)??[]);
     if(track&&used.has(track.id))track=undefined;
     if(track)reused++;
     else{
      track={id:crypto.randomUUID(),accountId,assetId:null,title,artist,album:null,duration:0,favorite:false,revision:1,
       createdAt:new Date().toISOString(),manualOverrides:{}};
      newTracks.push(track);
     }
     used.add(track.id);
     settings.put(track.id,aliasKey);
     entries.push({id:crypto.randomUUID(),trackId:track.id});
    }
    if(!entries.length)throw Error('La playlist no tiene canciones que Pulso pueda importar.');
    const ownedLists=lists.filter(list=>list.accountId===accountId);
    // Re-importing the same YouTube list updates the playlist it created before instead of duplicating it.
    const existing=previousListId?ownedLists.find(list=>list.id===previousListId):undefined;
    const playlist:Playlist=existing
     ?{...existing,name,entries:entries.map(entry=>existing.entries.find(old=>old.trackId===entry.trackId)??entry),revision:existing.revision+1}
     :{id:crypto.randomUUID(),accountId,name,entries,revision:1};
    const otherEntries=ownedLists.filter(list=>list.id!==playlist.id).reduce((sum,list)=>sum+list.entries.length,0);
    if(owned.length+newTracks.length>LIBRARY_LIMITS.tracks||!existing&&ownedLists.length>=LIBRARY_LIMITS.playlists||otherEntries+playlist.entries.length>LIBRARY_LIMITS.entries)
     throw Error('La biblioteca alcanzó el límite de canciones o playlists.');
    check();
    for(const track of newTracks){
     tracks.add(track,track.id);
     settings.add(makeLibraryMembership(track.id,false),libraryMembershipKey(track.id));
    }
    playlists.put(playlist,playlist.id);
    settings.put(playlist.id,listKey);
    await done;
    return {playlist,created:newTracks.length,reused,repeated,updated:!!existing};
   }catch(error){
    try{tx.abort();}catch{/* The transaction may already have settled. */}
    await done.catch(()=>{});
    throw error;
   }
  }finally{closeDatabase(db);}
 });
}
