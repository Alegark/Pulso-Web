import type {Track} from './library';
import type {MusicSuggestion} from './music-suggestions';
import type {AlbumEdition,AlbumHint,CatalogArtist,CatalogSongHint} from './album-catalog';

interface ChoiceBase {
 readonly id:string;
 readonly title:string;
 readonly displayTitle?:string;
 readonly artist:string|null;
 readonly album:string|null;
 readonly duration:number|null;
 readonly source:'local'|'lrclib'|'itunes';
 readonly artworkUrl?:string;
}
export type MusicCatalogChoice = (ChoiceBase & {readonly kind:'track'}) | (ChoiceBase & {readonly kind:'album'; readonly editionId?:number}) | (ChoiceBase & {readonly kind:'artist'; readonly artistId:number});
export const MUSIC_CATALOG_LIMITS=Object.freeze({localMatches:50,tracks:70,albums:20,preview:6});
// Ignore presentation differences, not recording/version qualifiers or performers.
export function musicCatalogKey(text:string):string {
 return text.normalize('NFKC').toLocaleLowerCase('es').trim()
  .replace(/[‘’ʼ]/gu,"'").replace(/[‐‑‒–—−]/gu,'-')
  .replace(/^["“”]+|["“”]+$/gu,'').replace(/\s*-\s*/gu,'-').replace(/\s+/gu,' ').trim();
}
// These labels describe a video presentation, not a recording version. Keep
// the original title for acquisition and use this value only for presentation.
function displayTrackTitle(title:string,artist:string|null):string {
 let result=title.trim();
 if(artist?.trim()){
  for(const separator of result.matchAll(/\s+[-–—]\s+/gu)){
   const index=separator.index;
   const prefix=result.slice(0,index), credit=musicCatalogKey(artist);
   const members=prefix.split(',').map(member=>musicCatalogKey(member));
   if(musicCatalogKey(prefix)===credit||(members.length>1&&members.every(Boolean)&&members.includes(credit))){
    result=result.slice(index+separator[0].length).trim();break;
   }
  }
 }
 const withoutTag=result.replace(/\s+\((?:visualizer|official video|official audio)\)\s*$/iu,'').trim();
 return withoutTag||result||title;
}
function tokens(s:string|null):string[] {
 return musicCatalogKey(s??'').normalize('NFD').replace(/\p{M}/gu,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/u).filter(Boolean);
}
// Every query word must be accounted for by the candidate's own metadata.
// Prefixes support typing, but a performer-only match requires whole words.
function relevance(query:string,fields:readonly (string|null)[],performerOnly=false):number {
 const words=tokens(query),values=fields.flatMap(tokens);
 if(!words.length||!values.length)return 0;
 const exact=words.filter(word=>values.includes(word)).length;
 if(performerOnly)return exact===words.length?10000+exact:0;
 const covered=words.filter(word=>values.some(value=>value===word||(word.length>=3&&value.startsWith(word)))).length;
 return covered===words.length?10000+exact*100:0;
}
function score(query:string,title:string,artist:string|null,album:string|null):number {
 const words=tokens(query),names=[...tokens(title),...tokens(album)];
 const onlyArtist=words.length>0&&words.every(word=>tokens(artist).some(value=>value===word||(word.length>=3&&value.startsWith(word))))&&
  !words.some(word=>names.some(value=>value===word||(word.length>=3&&value.startsWith(word))));
 return relevance(query,[title,artist,album],onlyArtist);
}
function albumMatches(query:string,album:string,artist:string|null):boolean {
 return score(query,album,artist,null)>0;
}
/** A metadata grouping, not an acoustic identity claim. Album/duration differences
 * do not repeat a title/performer; literal live/remix/etc titles remain distinct.
 * Artist identities and concrete editions come from the bounded public catalogue.
 * All candidates are checked against their declared metadata and the full query.
 */
export function musicSearchCatalog(query:string,local:readonly Track[],remote:readonly MusicSuggestion[], editions:readonly AlbumEdition[] = [], artists:readonly CatalogArtist[] = [], hints:readonly AlbumHint[] = [], songHints:readonly CatalogSongHint[] = []):readonly MusicCatalogChoice[] {
 const q=musicCatalogKey(query);if(!q)return [];
 const songs=new Map<string,MusicCatalogChoice>(),albums=new Map<string,MusicCatalogChoice>();
 const add=(id:string,title:string,artist:string|null,album:string|null,duration:number|null,source:'local'|'lrclib'|'itunes',artworkUrl?:string)=>{
  if(!score(q,title,artist,album))return;
  const displayTitle=displayTrackTitle(title,artist);
  const key=JSON.stringify([musicCatalogKey(displayTitle),musicCatalogKey(artist??'')]);
  const existing=songs.get(key);
  const priority={local:3,itunes:2,lrclib:1};
  if((!existing&&songs.size<MUSIC_CATALOG_LIMITS.tracks)||(existing&&(priority[source]>priority[existing.source]||priority[source]===priority[existing.source]&&existing.displayTitle!==undefined&&displayTitle===title)))
   songs.set(key,Object.freeze({id,kind:'track',title,...(displayTitle!==title?{displayTitle}:{}),artist,album,duration,source,...(artworkUrl?{artworkUrl}:{})}));
  if(source!=='itunes'&&album&&albumMatches(q,album,artist)){
   const albumKey=JSON.stringify([musicCatalogKey(artist??''),musicCatalogKey(album)]);
   if(!albums.has(albumKey)&&albums.size<MUSIC_CATALOG_LIMITS.albums)albums.set(albumKey,Object.freeze({id:'album:'+albumKey,kind:'album',title:album,artist,album,duration:null,source}));
  }
 };
 for(const hint of hints){
  if(!albumMatches(q,hint.title,hint.artist))continue;
  const key='hint:'+hint.id;
  if(!albums.has(key)&&albums.size<MUSIC_CATALOG_LIMITS.albums)albums.set(key,Object.freeze({id:'itunes:album:'+hint.id,kind:'album',editionId:hint.id,title:hint.title,artist:hint.artist,album:hint.title,duration:null,source:'itunes',...(hint.artworkUrl?{artworkUrl:hint.artworkUrl}:{})}));
 }
 const rankedLocal=local.map((t,index)=>({t,index,score:score(q,t.title,t.artist,t.album)}))
  .filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,MUSIC_CATALOG_LIMITS.localMatches);
 for(const {t} of rankedLocal)add('local:'+t.id,t.title,t.artist,t.album,Number.isFinite(t.duration)?t.duration:null,'local');
 for(const t of songHints.slice().sort((a,b)=>score(q,b.title,b.artist,b.album)-score(q,a.title,a.artist,a.album)))add(`itunes:${t.releaseId}:${t.disc}:${t.position}:${t.trackId}`,t.title,t.artist,t.album,t.durationMs/1000,'itunes',t.artworkUrl);
 for(const {t} of remote.map((t,index)=>({t,index,score:score(q,t.trackName,t.artistName,t.albumName||null)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.index-b.index))add('lrclib:'+t.id,t.trackName,t.artistName,t.albumName||null,t.duration,'lrclib');
 const ranked=[...songs.values()].map((choice,index)=>({choice,index,score:score(q,choice.title,choice.artist,choice.album)}))
  .sort((a,b)=>b.score-a.score||a.index-b.index).map(item=>item.choice);
 const editionChoices:MusicCatalogChoice[]=editions.filter(e=>albumMatches(q,e.title,e.artist)).slice().sort((a,b)=>score(q,b.title,b.artist,null)-score(q,a.title,a.artist,null)).map(e=>Object.freeze({id:'itunes:album:'+e.id,kind:'album',editionId:e.id,title:e.title,artist:e.artist,album:e.title,duration:null,source:'itunes',artworkUrl:e.artworkUrl}));
 const artistChoices:MusicCatalogChoice[]=artists.filter(a=>relevance(q,[a.name],true)>0).map(a=>Object.freeze({id:'itunes:artist:'+a.id,kind:'artist',artistId:a.id,title:a.name,artist:null,album:null,duration:null,source:'itunes'}));
 const hintKeys=new Set(hints.filter(h=>albumMatches(q,h.title,h.artist)).map(h=>JSON.stringify([musicCatalogKey(h.artist??''),musicCatalogKey(h.title)])));
 const concreteKeys=new Set(editions.filter(e=>albumMatches(q,e.title,e.artist)).map(e=>JSON.stringify([musicCatalogKey(e.artist),musicCatalogKey(e.title)])));
 return Object.freeze([...ranked,...editionChoices,...[...albums.entries()].filter(([key,value])=>value.kind==='album'&&value.editionId!==undefined?!editions.some(e=>e.id===value.editionId):!concreteKeys.has(key)&&!hintKeys.has(key)).map(([,value])=>value).sort((a,b)=>score(q,b.title,b.artist,null)-score(q,a.title,a.artist,null)),...artistChoices]);
}
