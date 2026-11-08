import type {Track} from './library';
import type {MusicSuggestion} from './music-suggestions';
import type {AlbumEdition,CatalogArtist} from './album-catalog';

interface ChoiceBase {
 readonly id:string;
 readonly title:string;
 readonly artist:string|null;
 readonly album:string|null;
 readonly duration:number|null;
 readonly source:'local'|'lrclib'|'itunes';
}
export type MusicCatalogChoice = (ChoiceBase & {readonly kind:'track'}) | (ChoiceBase & {readonly kind:'album'; readonly editionId?:number}) | (ChoiceBase & {readonly kind:'artist'; readonly artistId:number});
export const MUSIC_CATALOG_LIMITS=Object.freeze({localMatches:50,tracks:70,albums:20,preview:6});
// Ignore presentation differences, not recording/version qualifiers or performers.
export function musicCatalogKey(text:string):string {
 return text.normalize('NFKC').toLocaleLowerCase('es').trim()
  .replace(/[‘’ʼ]/gu,"'").replace(/[‐‑‒–—−]/gu,'-')
  .replace(/^["“”]+|["“”]+$/gu,'').replace(/\s*-\s*/gu,'-').replace(/\s+/gu,' ').trim();
}
function tokens(s:string|null):string[] {
 return musicCatalogKey(s??'').normalize('NFD').replace(/\p{M}/gu,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/u).filter(Boolean);
}
function score(query:string,title:string,artist:string|null,album:string|null):number {
 const words=tokens(query), names=[...tokens(title),...tokens(album)], performers=tokens(artist);
 if(!words.length)return 0;
 const match=(word:string,values:string[])=>values.some(value=>value===word||(word.length>=3&&value.startsWith(word)));
 if(performers.length&&words.every(w=>match(w,performers))&&!words.every(w=>match(w,names)))return 0;
 const named=words.filter(w=>match(w,names)).length;
 if(!named)return 0; // Artist qualifies a song, never creates an artist result.
 const covered=words.filter(w=>match(w,[...names,...performers])).length;
 const artistMatches=words.filter(w=>match(w,performers)).length;
 return (covered===words.length?10000:0)+covered*100+artistMatches*10+named;
}
function albumMatches(query:string,album:string,artist:string|null):boolean {
 const words=tokens(query),names=tokens(album),performers=tokens(artist);
 const has=(word:string,values:string[])=>values.some(value=>value===word||(word.length>=3&&value.startsWith(word)));
 return words.length>0&&words.some(w=>has(w,names))&&words.every(w=>has(w,[...names,...performers]));
}
/** A metadata grouping, not an acoustic identity claim. Album/duration differences
 * do not repeat a title/performer; literal live/remix/etc titles remain distinct.
 * Artist identities and concrete editions come from the bounded public catalogue.
 * Local song matching uses song/album names; remote candidates keep provider relevance.
 */
export function musicSearchCatalog(query:string,local:readonly Track[],remote:readonly MusicSuggestion[], editions:readonly AlbumEdition[] = [], artists:readonly CatalogArtist[] = []):readonly MusicCatalogChoice[] {
 const q=musicCatalogKey(query);if(!q)return [];
 const songs=new Map<string,MusicCatalogChoice>(),albums=new Map<string,MusicCatalogChoice>();
 const add=(id:string,title:string,artist:string|null,album:string|null,duration:number|null,source:'local'|'lrclib')=>{
  // LRCLIB has already ranked these candidates. Do not erase valid fuzzy/accent
  // matches with a stricter second title filter; the root binds them to the query.
  if(source==='local'&&!score(q,title,artist,album))return;
  const key=JSON.stringify([musicCatalogKey(title),musicCatalogKey(artist??'')]);
  if(!songs.has(key)&&songs.size<MUSIC_CATALOG_LIMITS.tracks)songs.set(key,Object.freeze({id,kind:'track',title,artist,album,duration,source}));
  if(album&&albumMatches(q,album,artist)){
   const albumKey=JSON.stringify([musicCatalogKey(artist??''),musicCatalogKey(album)]);
   if(!albums.has(albumKey)&&albums.size<MUSIC_CATALOG_LIMITS.albums)albums.set(albumKey,Object.freeze({id:'album:'+albumKey,kind:'album',title:album,artist,album,duration:null,source}));
  }
 };
 const rankedLocal=local.map((t,index)=>({t,index,score:score(q,t.title,t.artist,t.album)}))
  .filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,MUSIC_CATALOG_LIMITS.localMatches);
 for(const {t} of rankedLocal)add('local:'+t.id,t.title,t.artist,t.album,Number.isFinite(t.duration)?t.duration:null,'local');
 for(const t of remote)add('lrclib:'+t.id,t.trackName,t.artistName,t.albumName||null,t.duration,'lrclib');
 const ranked=[...songs.values()].map((choice,index)=>({choice,index,score:score(q,choice.title,choice.artist,choice.album)}))
  .sort((a,b)=>b.score-a.score||a.index-b.index).map(item=>item.choice);
 const editionChoices:MusicCatalogChoice[]=editions.map(e=>Object.freeze({id:'itunes:album:'+e.id,kind:'album',editionId:e.id,title:e.title,artist:e.artist,album:e.title,duration:null,source:'itunes'}));
 const artistChoices:MusicCatalogChoice[]=artists.map(a=>Object.freeze({id:'itunes:artist:'+a.id,kind:'artist',artistId:a.id,title:a.name,artist:null,album:null,duration:null,source:'itunes'}));
 const concreteKeys=new Set(editions.map(e=>JSON.stringify([musicCatalogKey(e.artist),musicCatalogKey(e.title)])));
 return Object.freeze([...ranked,...editionChoices,...[...albums.entries()].filter(([key])=>!concreteKeys.has(key)).map(([,value])=>value),...artistChoices]);
}
