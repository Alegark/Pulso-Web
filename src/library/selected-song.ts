import type {MusicCatalogChoice} from './music-search-catalog';
import type {BotDownloadedAudio} from '../telegram/bot-search-protocol';
import {dataRecord,isUuid} from '../telegram/sources-protocol';
import {admittedTransaction,openExistingDatabase,request,closeDatabase} from '../storage/database';
import {transactionDone} from '../storage/transaction-done';
import {validAsset,type Track,type LocalAsset} from './library';

export interface SongManagement {current():boolean;playReady:boolean;add():Promise<boolean>;addToPlaylist(id:string):Promise<boolean>;play():Promise<'playing'|'gesture-required'|'failed'>}
export type SongChoice=Pick<MusicCatalogChoice,'id'|'source'|'title'|'artist'|'album'|'duration'>;
export interface SongPlaybackAttempt {
 current():boolean;
 lookup(choice:SongChoice,signal:AbortSignal):Promise<string|null>;
 save(audio:BotDownloadedAudio,choice:SongChoice,signal:AbortSignal,onProgress:(bytes:number)=>void):Promise<{state:'saved'|'failed'|'uncertain';trackId:string|null}>;
 play(trackId:string,current:()=>boolean,signal:AbortSignal):Promise<'playing'|'gesture-required'|'failed'>;
}
export {musicIdentityText,matchingSongRows} from '../telegram/bot-search-protocol';
export function songChoiceKey(choice:SongChoice):string|null {
 if(choice.source==='local'&&choice.id.startsWith('local:')&&isUuid(choice.id.slice(6)))return choice.id;
 if(!choice.artist||!choice.title||choice.title.length>300||choice.artist.length>300||choice.album&&choice.album.length>300)return null;
 if(choice.source!=='lrclib'||!/^lrclib:[1-9][0-9]{0,14}$/.test(choice.id)||choice.duration!==null&&(!Number.isFinite(choice.duration)||choice.duration<0||choice.duration>86400))return null;
 // Exact public catalogue id AND version-bearing metadata: never title alone.
 return JSON.stringify([choice.id,choice.title.normalize('NFC'),choice.artist.normalize('NFC'),choice.album?.normalize('NFC')??null,choice.duration]);
}
const aliasKey=(key:string)=>['music-catalog-alias',1,key];
interface Alias {version:1;key:string;trackId:string;sha256:string;bytes:number}
function alias(value:unknown,key:string):Alias|null {
 const r=dataRecord(value,['version','key','trackId','sha256','bytes']);
 return r&&r.version===1&&r.key===key&&isUuid(r.trackId)&&typeof r.sha256==='string'&&/^[a-f0-9]{64}$/.test(r.sha256)&&Number.isSafeInteger(r.bytes)&&Number(r.bytes)>0&&Number(r.bytes)<=8388608?r as unknown as Alias:null;
}
export async function readSongAlias(choice:SongChoice,current:()=>boolean):Promise<string|null> {
 const key=songChoiceKey(choice);if(!key||!current())return null;
 if(choice.source==='local')return choice.id.slice(6);
 const db=await openExistingDatabase();
 try{
  if(!current())throw Error('cancelled');const tx=admittedTransaction(db,['settings','tracks'],'readonly'),done=transactionDone(tx);
  const raw=await request<unknown>(tx.objectStore('settings').get(aliasKey(key)));
  if(raw===undefined){await done;return null;}const a=alias(raw,key);if(!a){await done;throw Error('Alias musical inválido; revisa el almacenamiento.');}
  const track=await request<Track|undefined>(tx.objectStore('tracks').get(a.trackId));await done;
  if(!current())throw Error('cancelled');
  if(!track)return null;
  if(track.id!==a.trackId)throw Error('La identidad de la ficha local ha cambiado.');
  // A detached track retains its fingerprint. Never attach an alias to other bytes.
  if(track.audioFingerprint?.sha256!==a.sha256||track.audioFingerprint?.bytes!==a.bytes)throw Error('La referencia de esta canción ha cambiado.');
  return track.id;
 }finally{closeDatabase(db);}
}
export async function rememberSongAlias(choice:SongChoice,trackId:string,sha256:string,bytes:number,current:()=>boolean):Promise<void> {
 const key=songChoiceKey(choice);if(!key||choice.source==='local')return;
 const db=await openExistingDatabase();let tx:IDBTransaction|undefined;
 try{
  if(!current())throw Error('cancelled');tx=admittedTransaction(db,['settings','tracks','assets'],'readwrite');const done=transactionDone(tx);
  try{
   const track=await request<Track|undefined>(tx.objectStore('tracks').get(trackId));
   const asset=track?.assetId?await request<LocalAsset|undefined>(tx.objectStore('assets').get(track.assetId)):undefined;
   if(!current()||!track||track.id!==trackId||!validAsset(asset)||asset.sha256!==sha256||asset.bytes!==bytes||track.audioFingerprint?.sha256!==sha256)throw Error('conflict');
   tx.objectStore('settings').put({version:1,key,trackId,sha256,bytes} satisfies Alias,aliasKey(key));
   if(!current())throw Error('cancelled');await done;
  }catch(error){try{tx.abort();}catch{/* commit winner */}await done.catch(()=>{});throw error;}
 }finally{closeDatabase(db);}
}
