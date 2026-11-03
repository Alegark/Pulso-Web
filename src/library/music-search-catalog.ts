import type {Track} from './library';
import type {MusicSuggestion} from './music-suggestions';

export interface MusicCatalogChoice {
 readonly id:string;
 readonly kind:'track'|'album';
 readonly title:string;
 readonly artist:string|null;
 readonly album:string|null;
 readonly duration:number|null;
 readonly source:'local'|'lrclib';
}
export const MUSIC_CATALOG_LIMITS=Object.freeze({localMatches:50,tracks:70,albums:20,preview:6});
// Ignore presentation differences, not recording/version qualifiers or performers.
export function musicCatalogKey(text:string):string {
 return text.normalize('NFKC').toLocaleLowerCase('es').trim()
  .replace(/[‘’ʼ]/gu,"'").replace(/[‐‑‒–—−]/gu,'-')
  .replace(/^["“”]+|["“”]+$/gu,'').replace(/\s*-\s*/gu,'-').replace(/\s+/gu,' ').trim();
}
function matches(text:string|null,query:string):boolean {
 const searchable=(s:string)=>musicCatalogKey(s).normalize('NFD').replace(/\p{M}/gu,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const needle=searchable(query);if(!needle)return false;
 const value=searchable(text??''),words=needle.split(' ');return words.every(word=>value.includes(word))||value.replace(/ /g,'').includes(needle.replace(/ /g,''));
}
/** A metadata grouping, not an acoustic identity claim. Album/duration differences
 * do not repeat a title/performer; literal live/remix/etc titles remain distinct.
 * Artist names are context, never separate categories. Local matching uses song/album names; remote candidates keep provider relevance.
 */
export function musicSearchCatalog(query:string,local:readonly Track[],remote:readonly MusicSuggestion[]):readonly MusicCatalogChoice[] {
 const q=musicCatalogKey(query);if(!q)return [];
 const songs=new Map<string,MusicCatalogChoice>(),albums=new Map<string,MusicCatalogChoice>();let localMatches=0;
 const add=(id:string,title:string,artist:string|null,album:string|null,duration:number|null,source:'local'|'lrclib')=>{
  // LRCLIB has already ranked these candidates. Do not erase valid fuzzy/accent
  // matches with a stricter second title filter; the root binds them to the query.
  if(source==='local'&&!matches(title,q)&&!matches(album,q))return;
  const key=JSON.stringify([musicCatalogKey(title),musicCatalogKey(artist??'')]);
  if(!songs.has(key)&&songs.size<MUSIC_CATALOG_LIMITS.tracks)songs.set(key,Object.freeze({id,kind:'track',title,artist,album,duration,source}));
  if(album&&matches(album,q)){
   const albumKey=JSON.stringify([musicCatalogKey(artist??''),musicCatalogKey(album)]);
   if(!albums.has(albumKey)&&albums.size<MUSIC_CATALOG_LIMITS.albums)albums.set(albumKey,Object.freeze({id:'album:'+albumKey,kind:'album',title:album,artist,album,duration:null,source}));
  }
 };
 for(const t of local){
  if(!matches(t.title,q)&&!matches(t.album,q))continue;
  if(localMatches++>=MUSIC_CATALOG_LIMITS.localMatches)break;
  add('local:'+t.id,t.title,t.artist,t.album,Number.isFinite(t.duration)?t.duration:null,'local');
 }
 for(const t of remote)add('lrclib:'+t.id,t.trackName,t.artistName,t.albumName||null,t.duration,'lrclib');
 return Object.freeze([...songs.values(),...albums.values()]);
}
