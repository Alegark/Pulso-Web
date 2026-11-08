import type {MusicCatalogChoice} from './music-search-catalog';
import type {BotDownloadedAudio} from '../telegram/bot-search-protocol';
import {dataRecord,isUuid} from '../telegram/sources-protocol';
import {admittedTransaction,openExistingDatabase,request,closeDatabase} from '../storage/database';
import {transactionDone} from '../storage/transaction-done';
import {validAsset,validAudioFingerprint,type Track,type LocalAsset} from './library';
import {expectedAudioTagMismatch} from '../imports/expected-audio-metadata';
import {musicIdentityText} from '../telegram/bot-search-protocol';

export interface SongCopyInspection {current():boolean;inspect(choice:SongChoice,signal:AbortSignal):Promise<{state:'available'|'missing'|'unknown';trackId:string|null;inLibrary:boolean|null}>}
export interface SongManagement {current():boolean;playReady:boolean;add(current?:()=>boolean):Promise<boolean>;addToPlaylist(id:string):Promise<boolean>;play():Promise<'playing'|'gesture-required'|'failed'>}
export type SongChoice=Pick<MusicCatalogChoice,'id'|'source'|'title'|'artist'|'album'|'duration'> & {searchArtist?:string};
export interface SongPlaybackAttempt {
 current():boolean;
 addToLibrary(trackId:string,current:()=>boolean,signal:AbortSignal):Promise<boolean>;
 lookup(choice:SongChoice,signal:AbortSignal):Promise<string|null>;
 save(audio:BotDownloadedAudio,choice:SongChoice,signal:AbortSignal,onProgress:(bytes:number)=>void):Promise<{state:'saved'|'failed'|'uncertain';trackId:string|null}>;
 play(trackId:string,current:()=>boolean,signal:AbortSignal):Promise<'playing'|'gesture-required'|'failed'>;
}
export {musicIdentityText,matchingSongRows} from '../telegram/bot-search-protocol';
export function songChoiceKey(choice:SongChoice):string|null {
 if(choice.source==='local'&&choice.id.startsWith('local:')&&isUuid(choice.id.slice(6)))return choice.id;
 if(!choice.artist||!choice.title||choice.title.length>300||choice.artist.length>300||choice.album&&choice.album.length>300)return null;
 const itunes=choice.source==='itunes'&&/^itunes:(?:[1-9][0-9]*:){3}[1-9][0-9]*$/.test(choice.id)&&choice.id.slice(7).split(':').every(n=>Number.isSafeInteger(Number(n)));
 if(!(choice.source==='lrclib'&&/^lrclib:[1-9][0-9]{0,14}$/.test(choice.id)||itunes)||choice.duration!==null&&(!Number.isFinite(choice.duration)||choice.duration<0||choice.duration>86400))return null;
 // Exact public catalogue id AND version-bearing metadata: never title alone.
 return JSON.stringify([choice.id,choice.title.normalize('NFC'),choice.artist.normalize('NFC'),choice.album?.normalize('NFC')??null,choice.duration]);
}
const aliasKey=(key:string)=>['music-catalog-alias',1,key];
interface Alias {version:1;key:string;trackId:string;sha256:string;bytes:number}
function alias(value:unknown,key:string):Alias|null {
 const r=dataRecord(value,['version','key','trackId','sha256','bytes']);
 return r&&r.version===1&&r.key===key&&isUuid(r.trackId)&&typeof r.sha256==='string'&&/^[a-f0-9]{64}$/.test(r.sha256)&&Number.isSafeInteger(r.bytes)&&Number(r.bytes)>0&&Number(r.bytes)<=8388608?r as unknown as Alias:null;
}
export async function readSongAlias(choice:SongChoice,current:()=>boolean,allowCompatible=true):Promise<string|null> {
 const key=songChoiceKey(choice);if(!key||!current())return null;
 if(choice.source==='local')return choice.id.slice(6);
 const db=await openExistingDatabase();
 try{
  if(!current())throw Error('cancelled');const tx=admittedTransaction(db,['settings','tracks'],'readonly'),done=transactionDone(tx);
  const raw=await request<unknown>(tx.objectStore('settings').get(aliasKey(key)));
  if(raw===undefined){await done;return allowCompatible&&choice.source==='itunes'?await compatibleLocalSong(db,choice,current):null;}const a=alias(raw,key);if(!a){await done;throw Error('Alias musical inválido; revisa el almacenamiento.');}
  const track=await request<Track|undefined>(tx.objectStore('tracks').get(a.trackId));await done;
  if(!current())throw Error('cancelled');
  if(!track)return null;
  if(track.id!==a.trackId)throw Error('La identidad de la ficha local ha cambiado.');
  // A detached track retains its fingerprint. Never attach an alias to other bytes.
  if(track.audioFingerprint?.sha256!==a.sha256||track.audioFingerprint?.bytes!==a.bytes)throw Error('La referencia de esta canción ha cambiado.');
  return track.id;
 }finally{closeDatabase(db);}
}
async function compatibleLocalSong(db:IDBDatabase,choice:SongChoice,current:()=>boolean):Promise<string|null> {
 if(!choice.artist||choice.duration===null||!current())return null;
 const tx=admittedTransaction(db,['tracks','assets'],'readonly'),done=transactionDone(tx);
 const rows=await request<Track[]>(tx.objectStore('tracks').getAll(undefined,2001));
 if(rows.length>2000){await done;throw Error('Hay demasiadas fichas para comprobar una copia compatible.');}
 const candidates=rows.filter(t=>t&&isUuid(t.id)&&typeof t.title==='string'&&typeof t.artist==='string'&&t.artist.trim()&&typeof t.duration==='number'&&Number.isFinite(t.duration)&&t.duration>0&&Math.abs(t.duration-choice.duration!)<=5&&musicIdentityText(t.title)===musicIdentityText(choice.title)&&!expectedAudioTagMismatch({title:t.title,artist:t.artist},{title:choice.title,artist:choice.artist})&&validAudioFingerprint(t.audioFingerprint));
 // Detached identities still participate in ambiguity. Filtering by physical
 // availability first could silently select another recording with equal tags.
 if(candidates.length>1){await done;throw Error('Hay varias copias locales compatibles. Revisa tu biblioteca antes de continuar.');}
 const candidate=candidates[0];let id:string|null=null;
 if(candidate?.assetId!=null){
  const asset=await request<LocalAsset|undefined>(tx.objectStore('assets').get(candidate.assetId));
  if(asset!==undefined){
   if(!validAsset(asset)||asset.id!==candidate.assetId||asset.sha256!==candidate.audioFingerprint!.sha256||asset.bytes!==candidate.audioFingerprint!.bytes){await done;throw Error('La referencia de esta copia ha cambiado. Revisa Almacenamiento.');}
   id=candidate.id;
  }
 }
 await done;if(!current())throw Error('cancelled');return id;
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
