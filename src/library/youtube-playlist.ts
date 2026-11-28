/** YouTube playlist metadata for the manual playlist importer. */

export interface YoutubeItem {readonly title:string;readonly channel:string}
export interface YoutubePlaylist {readonly name:string;readonly total:number|null;readonly truncated:boolean;readonly items:readonly YoutubeItem[]}
export type YoutubeFailure='bad-link'|'sign-in-required'|'rate-limited'|'not-configured'|'not-found'|'private'|'quota'|'unavailable'|'invalid'|'cancelled';
export type YoutubeResult={readonly ok:true;readonly value:YoutubePlaylist}|{readonly ok:false;readonly reason:YoutubeFailure};

/** Accepts a full link (playlist?list=…, watch?v=…&list=…) or a bare playlist id. */
export function parsePlaylistId(input:string):string|null {
 const text=input.trim();
 const fromLink=/[?&]list=([A-Za-z0-9_-]{10,64})(?:[&#]|$)/.exec(text)?.[1];
 if(fromLink)return fromLink;
 return /^[A-Za-z0-9_-]{10,64}$/.test(text)&&!/^https?:/i.test(text)?text:null;
}

// Not songs: shorts, "type beat" uploads, long mixes and compilations.
const NOT_A_SONG=/#shorts|#\w*ragebait|type beat|\bplaylist\b|\(pt\.|\bmix\b|\|\s|\bvods?\b|\[free\]/iu;
const NOISE_GROUP=/\s*[[(][^\])]*?\b(?:official|lyrics?|lyric video|visuali[sz]er|music video|video oficial|audio oficial|animated|hd|4k)\b[^\])]*[\])]/giu;
const clean=(s:string)=>s.replace(NOISE_GROUP,'').replace(/\s*[[(]\s*audio\s*[\])]/giu,'').replace(/\s+#\S+/gu,'').replace(/\s+/gu,' ').trim();
export interface YoutubeSongs {readonly songs:readonly {title:string;artist:string}[];readonly ignored:number}
/** Title + artist per video for the playlist importer. "X - Topic" channels are the artist;
 * a title already written "Artist - Title" is split; otherwise the channel is the artist
 * (wrong for fan uploads, which then simply are not found by the bot). Never invents a song. */
export function youtubeItemsToSongs(items:readonly YoutubeItem[]):YoutubeSongs {
 const songs:{title:string;artist:string}[]=[];let ignored=0;
 for(const {title,channel} of items){
  if(NOT_A_SONG.test(title)){ignored++;continue;}
  const topic=/\s-\s*Topic$/iu.test(channel);
  const channelArtist=clean(channel.replace(/\s*-\s*Topic$/iu,'').replace(/\s*(?:official|VEVO)$/iu,''));
  const dash=/\s[-–—]\s/u.exec(title);
  // On an artist (Topic) channel only drop a prefix that repeats the channel artist.
  const split=dash&&(!topic||clean(title.slice(0,dash.index)).toLocaleLowerCase()===channelArtist.toLocaleLowerCase())?dash:null;
  const artist=split?clean(title.slice(0,split.index)):channelArtist;
  const song=clean(split?title.slice(split.index+split[0].length):title);
  if(!artist||!song){ignored++;continue;}
  songs.push({title:song.slice(0,300),artist:artist.slice(0,300)});
 }
 return {songs,ignored};
}

const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max;
function validate(raw:unknown):YoutubePlaylist|null {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const r=raw as Record<string,unknown>;
 if(!text(r.name,300)||typeof r.truncated!=='boolean'||!(r.total===null||Number.isSafeInteger(r.total))||!Array.isArray(r.items)||r.items.length>1500)return null;
 const items:YoutubeItem[]=[];
 for(const item of r.items){
  if(!item||typeof item!=='object')return null;
  const {title,channel}=item as Record<string,unknown>;
  if(!text(title,300)||!title.trim()||!text(channel,300))return null;
  items.push(Object.freeze({title,channel}));
 }
 return Object.freeze({name:r.name,total:r.total as number|null,truncated:r.truncated,items:Object.freeze(items)});
}

export async function loadYoutubePlaylist(input:string,o:{signal:AbortSignal;fetcher?:typeof fetch}):Promise<YoutubeResult> {
 const id=parsePlaylistId(input);
 if(!id)return {ok:false,reason:'bad-link'};
 const fetcher=o.fetcher??((...args:Parameters<typeof fetch>)=>fetch(...args));
 try{
  const response=await fetcher(`/api/youtube-playlist?list=${encodeURIComponent(id)}`,{signal:o.signal,credentials:'same-origin',cache:'no-store'});
  if(!response.ok){
   const body=await response.json().catch(()=>null) as {error?:string}|null;
   const reason:YoutubeFailure=response.status===401?'sign-in-required'
    :response.status===403?'private'
    :response.status===404?'not-found'
    :response.status===429?body?.error==='rate-limited'?'rate-limited':'quota'
    :response.status===503?body?.error==='not-configured'?'not-configured':'unavailable'
    :response.status===400?'invalid':'unavailable';
   return {ok:false,reason};
  }
  const value=validate(await response.json());
  return value?{ok:true,value}:{ok:false,reason:'invalid'};
 }catch{return {ok:false,reason:o.signal.aborted?'cancelled':'unavailable'};}
}

export const youtubeFailureText:Record<Exclude<YoutubeFailure,'cancelled'>,string>={
 'bad-link':'Pega una playlist de YouTube o su ID (PL…).',
 'sign-in-required':'Inicia sesión en Pulso para importar playlists de YouTube.',
 'rate-limited':'Has importado playlists muchas veces. Espera un minuto e inténtalo de nuevo.',
 'not-configured':'La importación de YouTube no está disponible en este sitio.',
 'not-found':'No se encontró esa playlist.',
 private:'La playlist es privada o no se puede leer. Debe ser pública o «no listada».',
 quota:'La cuota de YouTube se agotó. Inténtalo más tarde.',
 unavailable:'No se pudo contactar con YouTube. Inténtalo de nuevo.',
 invalid:'La respuesta no se pudo verificar.',
};
