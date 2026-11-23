import type {SongRejection} from '../diagnostics/contract';
import {musicCatalogKey} from './music-search-catalog';
import {projectSpotifyReleases} from '../playlists/spotify-catalog';
import {catalogRecordingId} from './catalog-release';
import {MB_UUID} from './catalog-id';
import {LIBRARY_LIMITS} from '../accounts/library-document.mjs';
import {activeLibraryAccount} from '../accounts/library-local';
import type {PlayerArtworkQuery} from './player-artwork-provider';
import {AUDIO_FILE_MAX_BYTES} from '../storage/audio-limits';
import type {MusicCatalogChoice} from './music-search-catalog';
import type {BotDownloadedAudio} from '../telegram/bot-search-protocol';
import {dataRecord,isUuid} from '../telegram/sources-protocol';
import {admittedTransaction,openExistingDatabase,request,closeDatabase,readRecord} from '../storage/database';
import {transactionDone} from '../storage/transaction-done';
import {validAsset,validAudioFingerprint,type Track,type LocalAsset} from './library';
import {expectedAudioTagMismatch} from '../imports/expected-audio-metadata';
import {recordingTitlesEquivalent} from './recording-title';
import {musicIdentityText} from '../telegram/bot-search-protocol';

export interface SongCopyInspection {current():boolean;inspect(choice:SongChoice,signal:AbortSignal):Promise<{state:'available'|'missing'|'unknown';trackId:string|null;inLibrary:boolean|null}>}
export interface SongManagement {current():boolean;playReady:boolean;add(current?:()=>boolean):Promise<boolean>;addToPlaylist(id:string,current?:()=>boolean):Promise<boolean>;play():Promise<'playing'|'gesture-required'|'failed'>}
export type SongChoice=Pick<MusicCatalogChoice,'id'|'title'|'displayTitle'|'artist'|'album'|'duration'> & {source:MusicCatalogChoice['source']|'spotify';searchArtist?:string};
export type SongImportRejection=Extract<SongRejection,'import-tag-mismatch'|'import-duration-mismatch'>;
export interface SongPlaybackAttempt {
 current():boolean;
 addToLibrary(trackId:string,current:()=>boolean,signal:AbortSignal):Promise<boolean>;
 lookup(choice:SongChoice,signal:AbortSignal,repair?:boolean):Promise<string|null>;
 save(audio:BotDownloadedAudio,choice:SongChoice,signal:AbortSignal,onProgress:(bytes:number)=>void,operationId?:string):Promise<{state:'saved'|'failed'|'uncertain';trackId:string|null;retryWrite?:boolean;storageUnavailable?:boolean;rejection?:SongImportRejection}>;
 waitForDownload?(signal:AbortSignal):Promise<boolean>;
 inspectDownload?(trackId:string,signal:AbortSignal):Promise<string|null>;
 reconcileDownload?(operationId:string,trackId:string,signal:AbortSignal,repair?:boolean):Promise<{state:'saved'|'missing'|'uncertain';trackId:string|null}>;
 reconcileSongDownload?(operationId:string,choice:SongChoice,signal:AbortSignal):Promise<{state:'saved'|'missing'|'uncertain';trackId:string|null}>;
 parkDownload?(operationId:string,signal:AbortSignal):Promise<void>;
 play(trackId:string,current:()=>boolean,signal:AbortSignal):Promise<'playing'|'gesture-required'|'failed'>;
}
export {musicIdentityText,matchingSongRows} from '../telegram/bot-search-protocol';
export function songChoiceKey(choice:SongChoice):string|null {
 if(choice.source==='local'&&choice.id.startsWith('local:')&&isUuid(choice.id.slice(6)))return choice.id;
 if(!choice.artist||!choice.title||choice.title.length>300||choice.artist.length>300||choice.album&&choice.album.length>300)return null;
 const itunes=choice.source==='itunes'&&/^itunes:(?:[1-9][0-9]*:){3}[1-9][0-9]*$/.test(choice.id)&&choice.id.slice(7).split(':').every(n=>Number.isSafeInteger(Number(n)));
 const mbParts=choice.id.split(':');const musicbrainz=choice.source==='musicbrainz'&&mbParts.length===5&&mbParts[0]==='musicbrainz'&&MB_UUID.test(mbParts[1])&&MB_UUID.test(mbParts[4])&&mbParts.slice(2,4).every(v=>/^[1-9][0-9]{0,2}$/.test(v)&&Number(v)<=200);
 if(!(choice.source==='lrclib'&&/^lrclib:[1-9][0-9]{0,14}$/.test(choice.id)||itunes||musicbrainz)||choice.duration!==null&&(!Number.isFinite(choice.duration)||choice.duration<0||choice.duration>86400))return null;
 // Exact public catalogue id AND version-bearing metadata: never title alone.
 return JSON.stringify([choice.id,choice.title.normalize('NFC'),choice.artist.normalize('NFC'),choice.album?.normalize('NFC')??null,choice.duration]);
}
/** Coalesce only pending cross-catalog selections with the same full credit,
 * version-bearing title and near-identical duration. This is not persistence identity. */
export function samePendingSong(a:SongChoice,b:SongChoice):boolean {
 if(!a.artist||!b.artist||a.duration===null||b.duration===null||!Number.isFinite(a.duration)||!Number.isFinite(b.duration)||a.duration<=0||b.duration<=0||Math.abs(a.duration-b.duration)>5)return false;
 const words=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('es').replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/u).filter(Boolean).join(' ');
 const title=(value:string)=>words(value.replace(/\s+\((?:visualizer|official video|official audio)\)\s*$/iu,''));
 const edition=(value:string|null)=>{const all=words(value??'').split(' ');return all.filter(x=>['live','studio','acoustic','remix','demo','instrumental','karaoke'].includes(x)).sort().join(' ');};
 // A different collection name alone is not a recording conflict; version
 // qualifiers in the title and complete performer credit remain significant.
 return !!title(a.title)&&title(a.title)===title(b.title)&&words(a.artist)===words(b.artist)&&(!edition(a.album)&&!edition(b.album)||edition(a.album)===edition(b.album));
}
const aliasKey=(key:string)=>['music-catalog-alias',1,key];
interface Alias {version:1;key:string;trackId:string;sha256:string;bytes:number;displayArtist?:string}
function alias(value:unknown,key:string):Alias|null {
 const r=dataRecord(value);if(!r||!['version','key','trackId','sha256','bytes'].every(k=>Object.hasOwn(r,k))||Object.keys(r).some(k=>!['version','key','trackId','sha256','bytes','displayArtist'].includes(k)))return null;
 return r.version===1&&r.key===key&&isUuid(r.trackId)&&typeof r.sha256==='string'&&/^[a-f0-9]{64}$/.test(r.sha256)&&Number.isSafeInteger(r.bytes)&&Number(r.bytes)>0&&Number(r.bytes)<=AUDIO_FILE_MAX_BYTES&&(!Object.hasOwn(r,'displayArtist')||typeof r.displayArtist==='string'&&!!r.displayArtist.trim()&&r.displayArtist.length<=300)?r as unknown as Alias:null;
}
/** Read exact catalogue keys bound to the currently playing fingerprint. This
 * is a bounded, read-only indicator aid; it does not verify or hash audio. */
export async function readSongAliasKeys(track:Track,current:()=>boolean):Promise<ReadonlySet<string>> {
 if(!current()||!validAudioFingerprint(track.audioFingerprint))return new Set();const db=await openExistingDatabase();
 try{if(!current())return new Set();const tx=admittedTransaction(db,['settings'],'readonly'),done=transactionDone(tx),store=tx.objectStore('settings'),range=IDBKeyRange.bound(['music-catalog-alias',1],['music-catalog-alias',1,[]]);
  const [keys,values]=await Promise.all([request<IDBValidKey[]>(store.getAllKeys(range,2001)),request<unknown[]>(store.getAll(range,2001))]);await done;if(!current()||keys.length>2000||keys.length!==values.length)return new Set();const out=new Set<string>();
  for(let i=0;i<keys.length;i++){const k=keys[i];if(!Array.isArray(k)||k.length!==3||typeof k[2]!=='string')continue;const a=alias(values[i],k[2]);if(a&&a.trackId===track.id&&a.sha256===track.audioFingerprint.sha256&&a.bytes===track.audioFingerprint.bytes)out.add(a.key);}return out;
 }finally{closeDatabase(db);}
}
/** Presentation only: accept an unambiguous catalogue artist for these exact bytes. */
export async function readSongDisplayArtist(track:Track,current:()=>boolean):Promise<string|null> {
 if(!current()||!validAudioFingerprint(track.audioFingerprint))return null;
 const db=await openExistingDatabase();
 try{
  if(!current())return null;
  const tx=admittedTransaction(db,['settings'],'readonly'),done=transactionDone(tx),store=tx.objectStore('settings');
  const range=IDBKeyRange.bound(['music-catalog-alias',1],['music-catalog-alias',1,[]]);
  const [keys,values]=await Promise.all([request<IDBValidKey[]>(store.getAllKeys(range,2001)),request<unknown[]>(store.getAll(range,2001))]);await done;
  if(!current()||keys.length>2000||keys.length!==values.length)return null;
  const names=new Set<string>();
  for(let i=0;i<keys.length;i++){
   const k=keys[i];if(!Array.isArray(k)||k.length!==3||typeof k[2]!=='string')continue;
   const a=alias(values[i],k[2]);if(!a||a.trackId!==track.id||a.sha256!==track.audioFingerprint.sha256||a.bytes!==track.audioFingerprint.bytes)continue;
   try{
    const parts:unknown=JSON.parse(a.key);if(!Array.isArray(parts)||parts.length!==5||typeof parts[0]!=='string'||typeof parts[1]!=='string'||typeof parts[2]!=='string'||!(parts[3]===null||typeof parts[3]==='string')||!(parts[4]===null||typeof parts[4]==='number'))continue;
    const source=parts[0].startsWith('lrclib:')?'lrclib':parts[0].startsWith('itunes:')?'itunes':parts[0].startsWith('musicbrainz:')?'musicbrainz':null;if(!source)continue;
    const choice:SongChoice={source,id:parts[0],title:parts[1],artist:parts[2],album:parts[3],duration:parts[4]};
    if(songChoiceKey(choice)!==a.key)continue;
    const name=a.displayArtist??choice.artist;if(name?.trim())names.add(name.trim().normalize('NFC'));
   }catch{/* Invalid metadata cannot supply a display name. */}
  }
  return names.size===1?[...names][0]:null;
 }finally{closeDatabase(db);}
}
/** Catalogue identity is presentation-only, bound to the exact local audio bytes.
 * Manual metadata and ambiguous editions must not be silently overridden. */
export async function readSongArtworkIdentity(track:Track,current:()=>boolean):Promise<PlayerArtworkQuery|null> {
 if(!current()||!validAudioFingerprint(track.audioFingerprint)||Object.keys(track.manualOverrides??{}).length)return null;
 const db=await openExistingDatabase();
 try{
  if(!current())return null;
  const tx=admittedTransaction(db,['settings'],'readonly'),done=transactionDone(tx),store=tx.objectStore('settings');
  const range=IDBKeyRange.bound(['music-catalog-alias',1],['music-catalog-alias',1,[]]);
  const [keys,values]=await Promise.all([request<IDBValidKey[]>(store.getAllKeys(range,2001)),request<unknown[]>(store.getAll(range,2001))]);await done;
  if(!current()||keys.length>2000||keys.length!==values.length)return null;
  const matches=new Map<string,PlayerArtworkQuery>();
  for(let i=0;i<keys.length;i++){
   const key=keys[i];if(!Array.isArray(key)||key.length!==3||typeof key[2]!=='string')continue;
   const a=alias(values[i],key[2]);if(!a||a.trackId!==track.id||a.sha256!==track.audioFingerprint.sha256||a.bytes!==track.audioFingerprint.bytes)continue;
   try{
    const parts:unknown=JSON.parse(a.key);if(!Array.isArray(parts)||parts.length!==5||typeof parts[0]!=='string'||typeof parts[1]!=='string'||typeof parts[2]!=='string'||!(parts[3]===null||typeof parts[3]==='string')||typeof parts[4]!=='number'||!Number.isFinite(parts[4])||parts[4]<=0||Math.abs(parts[4]-track.duration)>5)continue;
    const source=parts[0].startsWith('musicbrainz:')?'musicbrainz':'itunes';
    const choice:SongChoice={source,id:parts[0],title:parts[1],artist:parts[2],album:parts[3],duration:parts[4]};
    if(songChoiceKey(choice)!==a.key)continue;
    const [editionId,,,trackId]=parts[0].slice(7).split(':').map(Number);
    const q:PlayerArtworkQuery={title:choice.title,artist:choice.artist!,album:choice.album,durationSeconds:choice.duration!,...(source==='musicbrainz'?{musicbrainzReleaseId:parts[0].split(':')[1]}:{editionId,trackId})};
    matches.set(JSON.stringify([source,source==='musicbrainz'?q.musicbrainzReleaseId:editionId,trackId,q.title,q.artist,q.album]),q);
   }catch{/* Malformed aliases do not supply catalogue identity. */}
  }
  return matches.size===1?[...matches.values()][0]:null;
 }finally{closeDatabase(db);}
}
/** Metadata compatibility only. Keep detached tracks so membership is not lost
 * from the view after removing audio. Ambiguous recordings are never selected. */
export function compatibleSongMetadata(track:Track,choice:SongChoice):boolean {
 const artist=choice.artist;
 return !!artist&&choice.duration!==null&&!!track&&isUuid(track.id)&&typeof track.title==='string'&&typeof track.artist==='string'&&!!track.artist.trim()&&(validAudioFingerprint(track.audioFingerprint)||!!track.accountId&&track.assetId===null)&&
  typeof track.duration==='number'&&Number.isFinite(track.duration)&&track.duration>0&&Math.abs(track.duration-choice.duration)<=5&&
  recordingTitlesEquivalent(track.title,choice.title,{actualAlbum:track.album,expectedAlbum:choice.album,actualDurationSeconds:track.duration,expectedDurationSeconds:choice.duration})&&!expectedAudioTagMismatch({title:track.title,artist:track.artist,album:track.album??undefined},{title:choice.title,artist,...(musicIdentityText(track.title)!==musicIdentityText(choice.title)&&choice.album&&choice.duration!==null?{recordingTitle:track.title,album:choice.album,durationSeconds:choice.duration}:{})},track.duration);
}
function contradictsCorrection(track:Track,choice:SongChoice):boolean {
 const edited=track.manualOverrides??{};
 return (['title','artist','album'] as const).some(field=>Object.hasOwn(edited,field)&&
  musicCatalogKey(edited[field]??'')!==musicCatalogKey(choice[field]??''));
}

function resolveAlias(track:Track,raw:Alias,choice:SongChoice):string|null{
 if(track.audioFingerprint?.sha256!==raw.sha256||track.audioFingerprint?.bytes!==raw.bytes)throw Error('La referencia de esta canción ha cambiado.');
 return contradictsCorrection(track,choice)?null:track.id;
}

export type SongAliases=ReadonlyMap<string,unknown>;
export async function readSongAliasesFrom(store:IDBObjectStore):Promise<SongAliases>{
 const range=IDBKeyRange.bound(['music-catalog-alias',1],['music-catalog-alias',1,[]]);
 const [keys,values]=await Promise.all([request(store.getAllKeys(range)),request(store.getAll(range))]);
 const entries=new Map<string,unknown>();
 keys.forEach((key,index)=>{
  if(Array.isArray(key)&&key.length===3&&typeof key[2]==='string')entries.set(key[2],values[index]);
 });
 return entries;
}
export async function readSongAliases():Promise<SongAliases>{
 const db=await openExistingDatabase();
 try{
  const tx=admittedTransaction(db,'settings'),done=transactionDone(tx);
  const entries=await readSongAliasesFrom(tx.objectStore('settings'));
  await done;
  return entries;
 }finally{closeDatabase(db);}
}

/** Identical precedence for album projections and playback. Copies are verified separately. */
export function createSongResolver(tracks:readonly Track[],aliases:SongAliases=new Map()){
 const byTrack=new Map(tracks.map(track=>[track.id,track]));
 const exact=new Map<string,Track[]>();
 const durations=new Map<number,Track[]>();
 for(const track of tracks){
  const id=catalogRecordingId(track);
  if(id){const matches=exact.get(id)??[];matches.push(track);exact.set(id,matches);}
  if(Number.isFinite(track.duration)&&track.duration>0){
   const bucket=Math.floor(track.duration/5),matches=durations.get(bucket)??[];
   matches.push(track);durations.set(bucket,matches);
  }
 }
 return (choice:SongChoice):string|null=>{
  const key=songChoiceKey(choice);
  if(!key)return null;
  if(aliases.has(key)){
   const saved=alias(aliases.get(key),key);
   if(!saved)throw Error('Alias musical inválido; revisa el almacenamiento.');
   const track=byTrack.get(saved.trackId);
   if(track){
    const id=resolveAlias(track,saved,choice);
    if(id)return id;
   }
  }
  const preferred=exact.get(choice.id)?.filter(track=>!contradictsCorrection(track,choice))??[];
  const matches=preferred.length?preferred:choice.duration===null?[]:
   [Math.floor((choice.duration-5)/5),Math.floor(choice.duration/5),Math.floor((choice.duration+5)/5)]
    .flatMap(bucket=>durations.get(bucket)??[]).filter(track=>!contradictsCorrection(track,choice)&&compatibleSongMetadata(track,choice));
  if(matches.length>1)throw Error('Hay varias copias locales compatibles. Revisa tu biblioteca antes de continuar.');
  return matches[0]?.id??null;
 };
}

/** The local track identity can outlive the copy. Callers verify availability separately. */
export async function readSongAlias(choice:SongChoice,current:()=>boolean,allowCompatible=true):Promise<string|null> {
 const accountId=await activeLibraryAccount();
 const key=songChoiceKey(choice);if(!key||!current())return null;
 if(choice.source==='local'){const t=await readRecord<Track>('tracks',choice.id.slice(6));return current()&&t?.accountId===accountId?t?.id??null:null;}
 const db=await openExistingDatabase();
 try{
  if(!current())throw Error('cancelled');
  const tx=admittedTransaction(db,['settings','tracks']),done=transactionDone(tx),store=tx.objectStore('settings');
  const raw=await request<unknown>(store.get(aliasKey(key)));
  if(raw!==undefined){
   const saved=alias(raw,key);
   if(!saved)throw Error('Alias musical inválido; revisa el almacenamiento.');
   const track=await request<Track|undefined>(tx.objectStore('tracks').get(saved.trackId));
   if(!current())throw Error('cancelled');
   if(track&&track.accountId===accountId){
    if(track.id!==saved.trackId)throw Error('La identidad de la ficha local ha cambiado.');
    const id=resolveAlias(track,saved,choice);
    if(id){await done;return current()?id:null;}
   }
  }
  if(!allowCompatible){await done;return null;}
  const owned=await new Promise<Track[]>((resolve,reject)=>{
   const tracks:Track[]=[];
   const cursorRequest=tx.objectStore('tracks').openCursor();
   cursorRequest.onerror=()=>reject(cursorRequest.error);
   cursorRequest.onsuccess=()=>{
    try{
     if(!current())throw Error('cancelled');
     const cursor=cursorRequest.result;
     if(!cursor){resolve(tracks);return;}
     const track=cursor.value as Track|undefined;
     if(track&&track.accountId===accountId&&cursor.primaryKey===track.id)tracks.push(track);
     if(tracks.length>LIBRARY_LIMITS.tracks){resolve([]);return;}
     cursor.continue();
    }catch(error){reject(error);}
   };
  });
  const tracks=accountId?await projectSpotifyReleases(store,owned,accountId):owned;
  await done;
  if(!current())throw Error('cancelled');
  return createSongResolver(tracks)(choice);
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
   const displayArtist=(choice.source==='itunes'||choice.source==='musicbrainz')?choice.searchArtist:choice.source==='lrclib'?choice.artist:undefined;
   if(!track.catalogChoice){
    const {id,source,title,artist,album,duration,searchArtist}=choice;
    tx.objectStore('tracks').put({...track,catalogChoice:{id,source,title,artist,album,duration,...(searchArtist?{searchArtist}:{})},revision:track.revision+1},track.id);
   }
   tx.objectStore('settings').put({version:1,key,trackId,sha256,bytes,...(displayArtist?.trim()&&displayArtist.length<=300?{displayArtist:displayArtist.trim()}: {})} satisfies Alias,aliasKey(key));
   if(!current())throw Error('cancelled');await done;
  }catch(error){try{tx.abort();}catch{/* commit winner */}await done.catch(()=>{});throw error;}
 }finally{closeDatabase(db);}
}
