import {ACTIVE_LIBRARY_ACCOUNT} from '../accounts/library-local';
import {libraryUuid, LIBRARY_LIMITS} from '../accounts/library-document.mjs';
import {type Playlist, type Track} from '../library/library';
import {musicCatalogKey} from '../library/music-search-catalog';
import type {SongChoice} from '../library/selected-song';
import {WRITER_LOCK} from '../storage/asset-reader';
import {admittedTransaction, closeDatabase, openExistingDatabase, request} from '../storage/database';
import {transactionDone} from '../storage/transaction-done';

interface SpotifyRow {title:string;artists:string;durationMs:number|null;url:string}
interface SpotifyPlaylist {name:string;tracks:SpotifyRow[];omitted:number;limited:boolean;complete:boolean}
export interface SpotifyImportResult {playlist:Playlist; reused:number; repeated:number; omitted:number; limited:boolean; complete:boolean}
const spotifyId=/^[A-Za-z0-9]{22}$/;
const trackUrl=/^https:\/\/open\.spotify\.com\/track\/([A-Za-z0-9]{22})$/;
const text=(value:unknown,max:number)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)?value.trim():'';

export function spotifyPlaylistId(input:string):string|null {
 try {
  const url=new URL(input.trim()),id=/^\/playlist\/([A-Za-z0-9]{22})\/?$/.exec(url.pathname)?.[1];
  return url.protocol==='https:'&&url.hostname==='open.spotify.com'&&!url.port&&!url.username&&!url.password&&id?id:null;
 } catch {return null;}
}

function parsePlaylist(value:unknown):SpotifyPlaylist {
 const playlist=value as SpotifyPlaylist|null;
 if(!playlist||!text(playlist.name,500)||!Array.isArray(playlist.tracks)||playlist.tracks.length>100||
  !Number.isSafeInteger(playlist.omitted)||playlist.omitted<0||playlist.omitted+playlist.tracks.length>100||
  typeof playlist.complete!=='boolean'||typeof playlist.limited!=='boolean')throw Error('Respuesta de Spotify inválida.');
 return playlist;
}

function toChoice(row:SpotifyRow):SongChoice|null {
 const id=typeof row?.url==='string'?trackUrl.exec(row.url)?.[1]:null;
 const title=text(row?.title,300),artist=text(row?.artists,300)||null;
 if(!id||!title)return null;
 const durationMs=row.durationMs;
 return {source:'spotify',id:`spotify:${id}`,title,artist,album:null,duration:typeof durationMs==='number'&&Number.isSafeInteger(durationMs)&&durationMs>0&&durationMs<=86400000?durationMs/1000:null};
}

function songKey(title:string,artist:string|null){
 return artist&&JSON.stringify([musicCatalogKey(title),musicCatalogKey(artist)]);
}

export async function readSpotifyPlaylist(id:string,signal:AbortSignal):Promise<SpotifyPlaylist> {
 if(!spotifyId.test(id))throw Error('Identificador de Spotify inválido.');
 const response=await fetch(`/api/spotify-playlist/${id}`,{signal,credentials:'omit',cache:'no-store'});
 if(!response.ok)throw Error('No se pudo leer el enlace. Comprueba que la playlist sea pública e inténtalo de nuevo.');
 return parsePlaylist(await response.json());
}

export async function importSpotifyPlaylist(data:SpotifyPlaylist,accountId:string,current:()=>boolean):Promise<SpotifyImportResult> {
 const check=()=>{if(!current())throw Error('La importación ya no está vigente.');};
 check();
 const name=data.name.trim().slice(0,100).replace(/[\uD800-\uDBFF]$/u,'').trimEnd();
 return navigator.locks.request(WRITER_LOCK,async()=>{
  check();
  const db=await openExistingDatabase();
  try {
   check();
   const tx=admittedTransaction(db,['tracks','playlists','settings'],'readwrite'),done=transactionDone(tx);
   try {
    const tracks=tx.objectStore('tracks'),playlists=tx.objectStore('playlists'),settings=tx.objectStore('settings');
    const [active,rows,lists]=await Promise.all([
     request(settings.get(ACTIVE_LIBRARY_ACCOUNT)),
     request<Track[]>(tracks.getAll()),
     request<Playlist[]>(playlists.getAll()),
    ]);
    check();
    if(!libraryUuid(accountId)||active!==accountId)throw Error('La cuenta de Pulso ha cambiado.');
    const owned=rows.filter(track=>track.accountId===accountId);
    const byId=new Map(owned.map(track=>[track.id,track]));
    const bySpotifyId=new Map(owned.filter(track=>track.catalogChoice?.source==='spotify').map(track=>[track.catalogChoice!.id,track]));
    const bySong=new Map<string,Track[]>();
    for(const track of owned){
     const key=songKey(track.catalogChoice?.title??track.title,track.catalogChoice?.artist??track.artist);
     if(!key||track.catalogChoice?.source==='spotify')continue;
     const group=bySong.get(key);
     if(group)group.push(track);else bySong.set(key,[track]);
    }
    const entries:Playlist['entries']=[],seen=new Set<string>(),trackIds=new Set<string>(),newTracks:Track[]=[];
    let reused=0,repeated=0,omitted=data.omitted;
    for(const row of data.tracks){
     const choice=toChoice(row);
     if(!choice){omitted++;continue;}
     if(seen.has(choice.id)){repeated++;continue;}
     seen.add(choice.id);
     const aliasKey=['spotify-track',1,accountId,choice.id];
     const alias=await request<string|undefined>(settings.get(aliasKey));
     check();
     const key=songKey(choice.title,choice.artist),duration=choice.duration;
     const compatible=key&&duration!==null?(bySong.get(key)??[]).filter(track=>{
      const known=track.catalogChoice?.duration??track.duration;
      return known>0&&Math.abs(known-duration)<=5;
     }):[];
     let track=bySpotifyId.get(choice.id)??(alias?byId.get(alias):undefined)??(compatible.length===1?compatible[0]:undefined);
     if(track&&trackIds.has(track.id))track=undefined;
     if(track)reused++;
     else{
      track={id:crypto.randomUUID(),accountId,assetId:null,title:choice.title,artist:choice.artist,album:null,
       duration:choice.duration??0,favorite:false,revision:1,createdAt:new Date().toISOString(),manualOverrides:{},catalogChoice:choice};
      newTracks.push(track);
     }
     trackIds.add(track.id);
     settings.put(track.id,aliasKey);
     entries.push({id:crypto.randomUUID(),trackId:track.id});
    }
    if(!entries.length)throw Error('Spotify no devolvió canciones que Pulso pueda importar.');
    const ownedLists=lists.filter(list=>list.accountId===accountId);
    const existing=ownedLists.find(list=>list.name===name&&list.entries.length===entries.length&&list.entries.every((entry,i)=>entry.trackId===entries[i].trackId));
    const playlist:Playlist=existing??{id:crypto.randomUUID(),accountId,name,entries,revision:1};
    if(owned.length+newTracks.length>LIBRARY_LIMITS.tracks||!existing&&(ownedLists.length>=LIBRARY_LIMITS.playlists||
     ownedLists.reduce((sum,list)=>sum+list.entries.length,entries.length)>LIBRARY_LIMITS.entries))throw Error('La biblioteca alcanzó el límite de canciones o playlists.');
    check();
    for(const track of newTracks)tracks.add(track,track.id);
    if(!existing)playlists.add(playlist,playlist.id);
    await done;
    return {playlist,reused,repeated,omitted,limited:data.limited,complete:data.complete};
   }catch(error){
    try{tx.abort();}catch{/* The transaction may already have settled. */}
    await done.catch(()=>{});
    throw error;
   }
  }finally{closeDatabase(db);}
 });
}
